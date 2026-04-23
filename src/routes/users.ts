// src/routes/users.ts
import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { authPlugin } from "../auth/plugin"; // 1. Import the plugin

export const userRoutes = new Elysia({ prefix: "/api/users" })
    .use(authPlugin) // 2. Use the plugin to inject 'user' and 'session' types
    .guard({
        beforeHandle({ user, set }) {
            if (!user) {
                set.status = 401;
                return { success: false, message: "Unauthorized" };
            }
        }
    }, (app) => app
        // ---------------------------------------------------------
        // 1. SEARCH USERS
        // ---------------------------------------------------------
        .get("/search", async ({ query: { q }, user }) => {
            if (q.length < 3) return { success: true, users: [] };

            const users = await db.user.findMany({
                where: {
                    AND: [
                        {
                            OR: [
                                { username: { contains: q, mode: 'insensitive' } },
                                { email: { contains: q, mode: 'insensitive' } }
                            ]
                        },
                        { NOT: { id: user!.id } }
                    ]
                },
                select: {
                    id: true,
                    username: true,
                    email: true
                },
                take: 10
            });

            return { success: true, users };
        }, {
            query: t.Object({
                q: t.String()
            })
        })

        // ---------------------------------------------------------
        // 2. GET USER PROFILE
        // ---------------------------------------------------------
        .get("/:id", async ({ params: { id }, set }) => {
            const foundUser = await db.user.findUnique({
                where: { id },
                select: {
                    id: true,
                    username: true,
                    createdAt: true
                }
            });

            if (!foundUser) {
                set.status = 404;
                return { success: false, message: "User not found" };
            }

            return { success: true, user: foundUser };
        })
    );