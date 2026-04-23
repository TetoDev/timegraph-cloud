// src/routes/projects.ts
import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { authPlugin } from "../auth/plugin"; // Import the plugin

export const projectRoutes = new Elysia({ prefix: "/api/projects" })
    .use(authPlugin) // <--- THIS IS THE KEY: It injects the 'user' type
    .guard({
        beforeHandle({ user, set }) {
            if (!user) {
                set.status = 401;
                return { success: false, message: "Unauthorized" };
            }
        }
    }, (app) => app
        .post("/", async ({ body, user }) => {
            const { name, data } = body;

            const project = await db.project.create({
                data: {
                    name,
                    data, 
                    ownerId: user!.id, // Now TypeScript knows 'user' exists!
                }
            });

            return { success: true, projectId: project.id };
        }, {
            body: t.Object({
                name: t.String(),
                data: t.Any()
            })
        })
        // ... (rest of your routes will now work perfectly)
        .get("/", async ({ user }) => {
             const projects = await db.project.findMany({
                where: {
                    OR: [
                        { ownerId: user!.id },
                        { collaborators: { some: { userId: user!.id } } }
                    ]
                },
                // ... rest of your logic
             });
             // ...
             return { success: true, projects: [] }; 
        })
    );