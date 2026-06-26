// src/routes/projects.ts
import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { authPlugin } from "../auth/plugin";
import { encryptProjectData, decryptProjectData } from "../crypto";

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

        .post("/", async ({ body, user }) => {
            const { name, data } = body;
            const { encryptedData, encryptedDEK, dataIV, deKIV } = await encryptProjectData(data);

            const project = await db.project.create({
                data: {
                    name,
                    data: encryptedData as any,
                    dataKey: encryptedDEK,
                    dataIV,
                    deKIV,
                    encrypted: true,
                    ownerId: user!.id,
                },
            });
            return { success: true, projectId: project.id };
        }, { body: t.Object({ name: t.String(), data: t.Any() }) })

        .get("/", async ({ user }) => {
            const dbProjects = await db.project.findMany({
                where: { OR: [{ ownerId: user!.id }, { collaborators: { some: { userId: user!.id } } }] },
                select: {
                    id: true, name: true, updatedAt: true, ownerId: true,
                    owner: { select: { username: true } },
                    collaborators: { where: { userId: user!.id }, select: { role: true } },
                },
                orderBy: { updatedAt: "desc" },
            });

            return {
                success: true,
                projects: dbProjects.map((p) => ({
                    id: p.id,
                    name: p.name,
                    updatedAt: p.updatedAt,
                    isOwner: p.ownerId === user!.id,
                    ownerName: p.owner?.username || "Unknown",
                    role: p.ownerId === user!.id ? "OWNER" : (p.collaborators[0]?.role || "READ"),
                })),
            };
        })

        .get("/:id", async ({ params: { id }, user, set }) => {
            const project = await db.project.findUnique({
                where: { id },
                include: { collaborators: true },
            });

            if (!project) return (set.status = 404, { success: false, message: "Project not found" });

            const hasAccess = project.ownerId === user!.id || project.collaborators.some((c) => c.userId === user!.id);
            if (!hasAccess) return (set.status = 403, { success: false, message: "Forbidden" });

            let decryptedData = project.data;

            if (project.encrypted && project.dataKey && project.dataIV && project.deKIV) {
                try {
                    decryptedData = await decryptProjectData(
                        project.data as string,
                        project.dataKey,
                        project.dataIV,
                        project.deKIV
                    );
                } catch (err) {
                    console.error("[projects] Failed to decrypt project data:", err);
                    return (set.status = 500, { success: false, message: "Failed to decrypt project data" });
                }
            }

            return {
                success: true,
                project: {
                    ...project,
                    data: decryptedData,
                },
            };
        })


        .patch("/:id", async ({ params: { id }, body, user, set }) => {
            const project = await db.project.findUnique({ where: { id } });
            if (!project || project.ownerId !== user!.id) return (set.status = 403, { success: false });

            await db.project.update({ where: { id }, data: { name: body.name } });
            return { success: true };
        }, { body: t.Object({ name: t.String() }) })


        .delete("/:id", async ({ params: { id }, user, set }) => {
            const project = await db.project.findUnique({ where: { id } });
            if (!project || project.ownerId !== user!.id) return (set.status = 403, { success: false });

            await db.project.delete({ where: { id } });
            return { success: true };
        })


        .post("/:id/collaborators", async ({ params: { id }, body, user, set }) => {
            const project = await db.project.findUnique({ where: { id } });
            if (!project || project.ownerId !== user!.id) return (set.status = 403, { success: false });

            await db.projectCollaborator.upsert({
                where: { projectId_userId: { projectId: id, userId: body.userId } },
                update: { role: body.role as "READ" | "WRITE" },
                create: { projectId: id, userId: body.userId, role: body.role as "READ" | "WRITE" },
            });

            return { success: true };
        }, {
            body: t.Object({
                userId: t.String(),
                role: t.Union([t.Literal("READ"), t.Literal("WRITE")]),
            }),
        })

        .get("/:id/collaborators", async ({ params: { id }, user, set }) => {
            const project = await db.project.findUnique({ where: { id } });
            if (!project || project.ownerId !== user!.id) return (set.status = 403, { success: false });

            const collabs = await db.projectCollaborator.findMany({
                where: { projectId: id },
                include: { user: { select: { id: true, username: true, email: true } } },
                orderBy: { user: { username: "asc" } },
            });

            return {
                success: true,
                collaborators: collabs.map((c) => ({
                    userId: c.user.id,
                    username: c.user.username,
                    email: c.user.email,
                    role: c.role,
                })),
            };
        })

        .delete("/:id/collaborators/:userId", async ({ params: { id, userId }, user, set }) => {
            const project = await db.project.findUnique({ where: { id } });
            if (!project || project.ownerId !== user!.id) return (set.status = 403, { success: false });

            await db.projectCollaborator.delete({
                where: { projectId_userId: { projectId: id, userId } },
            });

            return { success: true };
        })
    );

export async function migrateUnencryptedProjects(): Promise<number> {
    const unencrypted = await db.project.findMany({
        where: { encrypted: false },
        select: { id: true, data: true },
    });

    if (unencrypted.length === 0) return 0;

    console.log(`[crypto] Migrating ${unencrypted.length} unencrypted project(s)...`);

    let migrated = 0;
    for (const project of unencrypted) {
        try {
            const { encryptedData, encryptedDEK, dataIV, deKIV } = await encryptProjectData(project.data);

            await db.project.update({
                where: { id: project.id },
                data: {
                    data: encryptedData as any,
                    dataKey: encryptedDEK,
                    dataIV,
                    deKIV,
                    encrypted: true,
                },
            });
            migrated++;
        } catch (err) {
            console.error(`[crypto] Failed to migrate project ${project.id}:`, err);
        }
    }

    console.log(`[crypto] Migration complete: ${migrated}/${unencrypted.length} project(s) encrypted.`);
    return migrated;
}
