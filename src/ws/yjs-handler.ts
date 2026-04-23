// src/ws/yjs-handler.ts
import * as Y from 'yjs';

// MODIFIED: Corrected import paths for y-protocols and lib0
import * as sync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import { db } from '../db/client';

const activeProjects = new Map<string, Y.Doc>();

export async function getProjectDoc(projectId: string): Promise<Y.Doc> {
    if (activeProjects.has(projectId)) {
        return activeProjects.get(projectId)!;
    }

    const doc = new Y.Doc();
    
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (project && project.data) {
        const state = doc.getMap('project-data');
        state.set('content', project.data);
    }

    activeProjects.set(projectId, doc);

    doc.on('update', () => {
        debounceSave(projectId, doc);
    });

    return doc;
}

const saveTimeouts = new Map<string, any>();

function debounceSave(projectId: string, doc: Y.Doc) {
    if (saveTimeouts.has(projectId)) return;

    const timeout = setTimeout(async () => {
        const jsonData = doc.getMap('project-data').get('content');
        await db.project.update({
            where: { id: projectId },
            data: { data: jsonData as any }
        });
        saveTimeouts.delete(projectId);
        console.log(`💾 Project ${projectId} auto-saved to DB`);
    }, 10000);

    saveTimeouts.set(projectId, timeout);
}

const messageSync = 0;

export const yjsSocketHandler = {
    open(ws: any) {
        const { projectId } = ws.data.params;
        ws.subscribe(projectId); 
        
        getProjectDoc(projectId).then(doc => {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, messageSync);
            sync.writeSyncStep1(encoder, doc);
            ws.send(encoding.toUint8Array(encoder));
        });
    },

    async message(ws: any, message: Uint8Array) {
        const { projectId } = ws.data.params;
        const doc = await getProjectDoc(projectId);
        
        const decoder = decoding.createDecoder(message);
        const encoder = encoding.createEncoder();
        const messageType = decoding.readVarUint(decoder);

        if (messageType === messageSync) {
            encoding.writeVarUint(encoder, messageSync);
            sync.readSyncMessage(decoder, encoder, doc, null);
            
            if (encoding.length(encoder) > 1) {
                ws.send(encoding.toUint8Array(encoder));
            }
        } 
        
        ws.publish(projectId, message);
    },

    close(ws: any) {
        const { projectId } = ws.data.params;
        ws.unsubscribe(projectId);
    }
};