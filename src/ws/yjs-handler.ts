// src/ws/yjs-handler.ts
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { db } from '../db/client';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const activeProjects = new Map<string, Y.Doc>();
const activeAwareness = new Map<string, awarenessProtocol.Awareness>();
const roomClients = new Map<string, Set<any>>();

// Prevents the race condition where two clients connecting simultaneously both
// pass the cache check before either has finished initializing the doc, which
// would create two Y.Doc instances with diverging CRDT histories.
const pendingDocs = new Map<string, Promise<{ doc: Y.Doc; awareness: awarenessProtocol.Awareness }>>();

export async function getProjectDoc(projectId: string) {
    if (activeProjects.has(projectId)) {
        return { doc: activeProjects.get(projectId)!, awareness: activeAwareness.get(projectId)! };
    }

    if (pendingDocs.has(projectId)) {
        return pendingDocs.get(projectId)!;
    }

    const initPromise = (async () => {
        const doc = new Y.Doc();
        const awareness = new awarenessProtocol.Awareness(doc);

        const project = await db.project.findUnique({ where: { id: projectId } });
        if (project) {
            if (project.yjsState) {
                // Load the proper Y.js binary CRDT state — preserves the exact history
                // clients have, so delta updates can always be applied without ambiguity.
                Y.applyUpdate(doc, project.yjsState);
            } else if (project.data) {
                // Fallback for projects saved before yjsState was introduced.
                // Plain JSON loading creates fresh CRDT ops; once the project is
                // saved via WebSocket the proper binary state takes over.
                const state = doc.getMap('state');
                doc.transact(() => {
                    for (const [key, value] of Object.entries(project.data as Record<string, unknown>)) {
                        state.set(key, value);
                    }
                });
            }
        }

        activeProjects.set(projectId, doc);
        activeAwareness.set(projectId, awareness);
        pendingDocs.delete(projectId);

        doc.on('update', (update: Uint8Array, origin: any) => {
            const clients = roomClients.get(projectId);
            if (!clients) return;

            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            sync.writeUpdate(encoder, update);
            // Buffer, not Uint8Array — Elysia's ws.send JSON-stringifies Uint8Array.
            const message = Buffer.from(encoding.toUint8Array(encoder));

            clients.forEach(client => {
                if (client === origin) return;
                try {
                    client.send(message);
                } catch {
                    clients.delete(client);
                }
            });
        });

        awareness.on('update', ({ added, updated, removed }: any, origin: any) => {
            const clients = roomClients.get(projectId);
            if (!clients) return;

            const changedClients = [...added, ...updated, ...removed];
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
            encoding.writeVarUint8Array(
                encoder,
                awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
            );
            const message = Buffer.from(encoding.toUint8Array(encoder));

            clients.forEach(client => {
                if (client === origin) return;
                try {
                    client.send(message);
                } catch {
                    clients.delete(client);
                }
            });
        });

        doc.on('update', () => debounceSave(projectId, doc));

        return { doc, awareness };
    })();

    pendingDocs.set(projectId, initPromise);
    return initPromise;
}

const saveTimeouts = new Map<string, any>();
function debounceSave(projectId: string, doc: Y.Doc) {
    if (saveTimeouts.has(projectId)) clearTimeout(saveTimeouts.get(projectId));
    saveTimeouts.set(projectId, setTimeout(async () => {
        await db.project.update({
            where: { id: projectId },
            data: {
                yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)),
                data: doc.getMap('state').toJSON(),
            }
        });
        saveTimeouts.delete(projectId);
        console.log(`💾 Project ${projectId} saved`);
    }, 5000));
}

export const yjsSocketHandler = {
    type: 'arrayBuffer' as const,

    open(ws: any) {
        const { projectId } = ws.data.params;
        if (!roomClients.has(projectId)) roomClients.set(projectId, new Set());
        roomClients.get(projectId)!.add(ws);

        getProjectDoc(projectId).then(({ doc, awareness }) => {
            // Sync step 1 only. Client responds with step 2 containing any ops
            // server is missing, then sends its own step 1 — server replies via
            // the message handler. Full bidirectional sync via standard protocol.
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            sync.writeSyncStep1(encoder, doc);
            ws.send(Buffer.from(encoding.toUint8Array(encoder)));

            const awarenessStates = awareness.getStates();
            if (awarenessStates.size > 0) {
                const awarenessEncoder = encoding.createEncoder();
                encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
                encoding.writeVarUint8Array(
                    awarenessEncoder,
                    awarenessProtocol.encodeAwarenessUpdate(awareness, [...awarenessStates.keys()])
                );
                ws.send(Buffer.from(encoding.toUint8Array(awarenessEncoder)));
            }
        });
    },

    async message(ws: any, message: ArrayBuffer) {
        const { projectId } = ws.data.params;
        const { doc, awareness } = await getProjectDoc(projectId);
        const messageArray = new Uint8Array(message);

        const decoder = decoding.createDecoder(messageArray);
        const encoder = encoding.createEncoder();
        const messageType = decoding.readVarUint(decoder);

        if (messageType === MESSAGE_SYNC) {
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            // ws is the transactionOrigin so the update listener skips echoing to this sender.
            sync.readSyncMessage(decoder, encoder, doc, ws);
            if (encoding.length(encoder) > 1) ws.send(Buffer.from(encoding.toUint8Array(encoder)));
        } else if (messageType === MESSAGE_AWARENESS) {
            awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
        }
    },

    close(ws: any) {
        const { projectId } = ws.data.params;
        roomClients.get(projectId)?.delete(ws);
        getProjectDoc(projectId).then(({ awareness }) => {
            awarenessProtocol.removeAwarenessStates(awareness, [ws.data.clientId ?? 0], 'connection closed');
        });
    }
};
