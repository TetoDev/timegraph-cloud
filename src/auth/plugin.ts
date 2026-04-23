// src/auth/plugin.ts
import { Elysia } from "elysia";
import { validateSession } from "./session";

export const authPlugin = new Elysia({ name: 'auth-plugin' })
    .derive({ as: 'global' }, async ({ cookie }) => {
        // 1. Access the cookie proxy
        const authSession = cookie.auth_session;
        
        // 2. Extract the value
        const sessionId = authSession?.value;

        // 3. Type Guard: This is the magic. 
        // We explicitly check if it's a string. If not, the session is invalid.
        // This satisfies TypeScript that sessionId is definitely a string for validateSession().
        if (typeof sessionId !== 'string') {
            return { user: null, session: null };
        }
        
        // 4. Now TypeScript is happy because sessionId is guaranteed to be a string
        const { user, session } = await validateSession(sessionId);
        
        if (!session) {
            authSession?.remove();
        }
        
        return { user, session };
    });