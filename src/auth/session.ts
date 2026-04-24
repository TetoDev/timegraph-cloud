// src/auth/session.ts
import { db } from "../db/client";
import type { User, Session } from "@prisma/client";

const SESSION_EXPIRATION_DAYS = 30;

export async function createSession(userId: string): Promise<Session> {

    const sessionId = crypto.randomUUID(); 
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * SESSION_EXPIRATION_DAYS);
    
    return await db.session.create({
        data: {
            id: sessionId,
            userId,
            expiresAt
        }
    });
}

export async function validateSession(sessionId: string): Promise<{ user: User | null, session: Session | null }> {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        include: { user: true }
    });

    if (!session) return { user: null, session: null };

    // Check expiration
    if (Date.now() >= session.expiresAt.getTime()) {
        await db.session.delete({ where: { id: sessionId } });
        return { user: null, session: null };
    }


    const fifteenDays = 1000 * 60 * 60 * 24 * 15;
    if (session.expiresAt.getTime() - Date.now() < fifteenDays) {
        session.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * SESSION_EXPIRATION_DAYS);
        await db.session.update({
            where: { id: session.id },
            data: { expiresAt: session.expiresAt }
        });
    }

    return { user: session.user, session };
}

export async function invalidateSession(sessionId: string): Promise<void> {
    await db.session.delete({ where: { id: sessionId } });
}