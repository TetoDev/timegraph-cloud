// src/ws/yjs-handler.ts
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { db } from '../db/client';
import { decryptProjectData, encryptProjectData } from '../crypto';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const activeProjects = new Map<string, Y.Doc>();
const activeAwareness = new Map<string, awarenessProtocol.Awareness>();
const roomClients = new Map<string, Set<any>>();


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
                Y.applyUpdate(doc, project.yjsState);
            } else if (project.data) {
                let projectData: Record<string, unknown>;

                if (project.encrypted && project.dataKey && project.dataIV && project.deKIV) {
                    projectData = await decryptProjectData(
                        project.data as string,
                        project.dataKey,
                        project.dataIV,
                        project.deKIV
                    ) as Record<string, unknown>;
                } else {
                    projectData = project.data as Record<string, unknown>;
                }

                const state = doc.getMap('state');
                doc.transact(() => {
                    for (const [key, value] of Object.entries(projectData)) {
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
async function debounceSave(projectId: string, doc: Y.Doc) {
    if (saveTimeouts.has(projectId)) clearTimeout(saveTimeouts.get(projectId));
    saveTimeouts.set(projectId, setTimeout(async () => {
        try {
            const project = await db.project.findUnique({ where: { id: projectId } });
            const yjsUpdate = Buffer.from(Y.encodeStateAsUpdate(doc));
            const dataJson = doc.getMap('state').toJSON();

            if (project?.encrypted) {
                const { encryptedData, encryptedDEK, dataIV, deKIV } = await encryptProjectData(dataJson);
                await db.project.update({
                    where: { id: projectId },
                    data: {
                        yjsState: yjsUpdate,
                        data: encryptedData as any,
                        dataKey: encryptedDEK,
                        dataIV,
                        deKIV,
                    }
                });
            } else {
                await db.project.update({
                    where: { id: projectId },
                    data: {
                        yjsState: yjsUpdate,
                        data: dataJson as any,
                    }
                });
            }
            console.log(`💾 Project ${projectId} saved`);
        } catch (err) {
            console.error(`[yjs] Failed to save project ${projectId}:`, err);
        }
        saveTimeouts.delete(projectId);
    }, 5000));
}

export const yjsSocketHandler = {
    type: 'arrayBuffer' as const,

    open(ws: any) {
        const { projectId } = ws.data.params;
        if (!roomClients.has(projectId)) roomClients.set(projectId, new Set());
        roomClients.get(projectId)!.add(ws);

        getProjectDoc(projectId).then(({ doc, awareness }) => {

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
