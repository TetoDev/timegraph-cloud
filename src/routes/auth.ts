// src/routes/auth.ts
import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { createSession, invalidateSession } from "../auth/session";

export const authRoutes = new Elysia({ prefix: "/api/auth" })
    
    .post("/register", async ({ body, set, cookie: { auth_session } }) => {
        const { username, email, password } = body;
        
        const hashedPassword = await Bun.password.hash(password);
        
        try {
            const user = await db.user.create({
                data: { username, email, password: hashedPassword }
            });
            
            const session = await createSession(user.id);
            

            auth_session.set({
                value: session.id,
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                maxAge: 60 * 60 * 24 * 30,
                path: "/"
            });
            
            return { success: true, user: { id: user.id, username: user.username } };
        } catch (e) {
            set.status = 400;
            return { success: false, message: "Username or email already exists" };
        }
    }, {
        body: t.Object({
            username: t.String(),
            email: t.String(),
            password: t.String()
        }),

        cookie: t.Object({
            auth_session: t.Optional(t.String())
        })
    })

    .post("/login", async ({ body, set, cookie: { auth_session } }) => {
        const { email, password } = body;
        
        const user = await db.user.findUnique({ where: { email } });
        if (!user) {
            set.status = 400;
            return { success: false, message: "Invalid credentials" };
        }
        
        const isMatch = await Bun.password.verify(password, user.password);
        if (!isMatch) {
            set.status = 400;
            return { success: false, message: "Invalid credentials" };
        }
        
        const session = await createSession(user.id);
        
        auth_session.set({
            value: session.id,
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            maxAge: 60 * 60 * 24 * 30,
            path: "/"
        });
        
        return { success: true, user: { id: user.id, username: user.username } };
    }, {
        body: t.Object({
            email: t.String(),
            password: t.String()
        }),

        cookie: t.Object({
            auth_session: t.Optional(t.String())
        })
    })

    .post("/logout", async ({ cookie: { auth_session } }) => {
        if (auth_session.value) {
            await invalidateSession(auth_session.value);
            auth_session.remove();
        }
        return { success: true };
    }, {

        cookie: t.Object({
            auth_session: t.Optional(t.String())
        })
    });