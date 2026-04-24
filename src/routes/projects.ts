// src/routes/projects.ts
import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { authPlugin } from "../auth/plugin"; 

export const projectRoutes = new Elysia({ prefix: "/api/projects" })
    .use(authPlugin) 
    .guard({
        beforeHandle({ user, set }) {
            if (!user) {
                set.status = 401;
                return { success: false, message: "Unauthorized" };
            }
        }
    }, (app) => app
        
        // 1. CREATE NEW CLOUD PROJECT
        .post("/", async ({ body, user }) => {
            const { name, data } = body;
            const project = await db.project.create({
                data: { name, data, ownerId: user!.id }
            });
            return { success: true, projectId: project.id };
        }, { body: t.Object({ name: t.String(), data: t.Any() }) })
        
        // 2. LIST ALL PROJECTS
        .get("/", async ({ user }) => {
            const dbProjects = await db.project.findMany({
                where: { OR: [ { ownerId: user!.id }, { collaborators: { some: { userId: user!.id } } } ] },
                select: {
                    id: true, name: true, updatedAt: true, ownerId: true,
                    owner: { select: { username: true } },
                    collaborators: { where: { userId: user!.id }, select: { role: true } }
                },
                orderBy: { updatedAt: 'desc' }
            });

            return { success: true, projects: dbProjects.map(p => ({
                id: p.id, name: p.name, updatedAt: p.updatedAt,
                isOwner: p.ownerId === user!.id,
                ownerName: p.owner?.username || "Unknown",
                // MAP TO YOUR ENUM:
                role: p.ownerId === user!.id ? "OWNER" : (p.collaborators[0]?.role || "READ")
            }))}; 
        })

        // 3. GET SINGLE PROJECT DATA
        .get("/:id", async ({ params: { id }, user, set }) => {
            const project = await db.project.findUnique({
                where: { id }, include: { collaborators: true }
            });

            if (!project) return (set.status = 404, { success: false, message: "Project not found" });

            const hasAccess = project.ownerId === user!.id || project.collaborators.some(c => c.userId === user!.id);
            if (!hasAccess) return (set.status = 403, { success: false, message: "Forbidden" });

            return { success: true, project };
        })

        // 4. RENAME PROJECT
        .patch("/:id", async ({ params: { id }, body, user, set }) => {
            const project = await db.project.findUnique({ where: { id } });
            if (!project || project.ownerId !== user!.id) return (set.status = 403, { success: false });

            await db.project.update({ where: { id }, data: { name: body.name } });
            return { success: true };
        }, { body: t.Object({ name: t.String() }) })

        // 5. DELETE PROJECT
        .delete("/:id", async ({ params: { id }, user, set }) => {
            const project = await db.project.findUnique({ where: { id } });
            if (!project || project.ownerId !== user!.id) return (set.status = 403, { success: false });

            await db.project.delete({ where: { id } });
            return { success: true };
        })

        // 6. SHARE PROJECT (Add Collaborator)
        .post("/:id/collaborators", async ({ params: { id }, body, user, set }) => {
            const project = await db.project.findUnique({ where: { id } });
            if (!project || project.ownerId !== user!.id) return (set.status = 403, { success: false });

            await db.projectCollaborator.upsert({
                where: { projectId_userId: { projectId: id, userId: body.userId } },
                // Use the type directly to satisfy Prisma's Enum expectations
                update: { role: body.role as "READ" | "WRITE" },
                create: { projectId: id, userId: body.userId, role: body.role as "READ" | "WRITE" }
            });

            return { success: true };
        }, { 
            // RESTRICT THE API TO ONLY ACCEPT YOUR PRISMA ENUM VALUES
            body: t.Object({ 
                userId: t.String(), 
                role: t.Union([t.Literal("READ"), t.Literal("WRITE")]) 
            }) 
        })
    );