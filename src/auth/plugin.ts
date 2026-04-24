// src/auth/plugin.ts
import { Elysia } from "elysia";
import { validateSession } from "./session";

export const authPlugin = new Elysia({ name: 'auth-plugin' })
    .derive({ as: 'global' }, async ({ cookie }) => {

        const authSession = cookie.auth_session;
        

        const sessionId = authSession?.value;

        if (typeof sessionId !== 'string') {
            return { user: null, session: null };
        }
        

        const { user, session } = await validateSession(sessionId);
        
        if (!session) {
            authSession?.remove();
        }
        
        return { user, session };
    });