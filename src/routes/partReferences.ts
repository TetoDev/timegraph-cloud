// src/routes/partReferences.ts
import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { authPlugin } from "../auth/plugin";
import { encryptPartDescription, decryptPartDescription } from "../crypto";

async function decryptPart(part: any) {
    return {
        ...part,
        description: await decryptPartDescription(part.description),
    };
}

export const partReferenceRoutes = new Elysia({ prefix: "/api/part-references" })
    .use(authPlugin)
    .guard({
        beforeHandle({ user, set }) {
            if (!user) {
                set.status = 401;
                return { success: false, message: "Unauthorized" };
            }
        }
    }, (app) => app

        .get("/", async () => {
            const parts = await db.partReference.findMany({
                orderBy: { componentNumber: "asc" },
            });
            return { success: true, parts: await Promise.all(parts.map(decryptPart)) };
        })

        .get("/search", async ({ query: { q } }) => {
            if (!q || q.length < 1) return { success: true, parts: [] };
            const parts = await db.partReference.findMany({
                where: { componentNumber: { contains: q, mode: "insensitive" } },
                take: 50,
                orderBy: { componentNumber: "asc" },
            });
            return { success: true, parts: await Promise.all(parts.map(decryptPart)) };
        }, {
            query: t.Object({ q: t.String() }),
        })

        .get("/lookup", async ({ query: { numbers } }) => {
            const list = numbers.split(",").map((s) => s.trim()).filter(Boolean);
            if (list.length === 0) return { success: true, parts: [] };
            const parts = await db.partReference.findMany({
                where: { componentNumber: { in: list } },
            });
            return { success: true, parts: await Promise.all(parts.map(decryptPart)) };
        }, {
            query: t.Object({ numbers: t.String() }),
        })

        .post("/", async ({ body, user, set }) => {
            try {
                const { componentNumber, description, weight } = body;
                const trimmed = componentNumber.trim();
                if (!trimmed) {
                    set.status = 400;
                    return { success: false, message: "componentNumber required" };
                }
                const encryptedDesc = await encryptPartDescription(description);
                const part = await db.partReference.upsert({
                    where: { componentNumber: trimmed },
                    update: { description: encryptedDesc, weight, updatedById: user!.id },
                    create: {
                        componentNumber: trimmed,
                        description: encryptedDesc,
                        weight,
                        createdById: user!.id,
                        updatedById: user!.id,
                    },
                });
                return { success: true, part: await decryptPart(part) };
            } catch (err: any) {
                console.error("[partReferences POST] failed:", err);
                set.status = 500;
                return { success: false, message: err?.message || "Internal error" };
            }
        }, {
            body: t.Object({
                componentNumber: t.String(),
                description: t.String(),
                weight: t.Number(),
            }),
        })

        .patch("/:id", async ({ params: { id }, body, user, set }) => {
            try {
                const existing = await db.partReference.findUnique({ where: { id } });
                if (!existing) {
                    set.status = 404;
                    return { success: false, message: "Not found" };
                }
                const updateData: any = { updatedById: user!.id };
                if (body.description !== undefined) {
                    updateData.description = await encryptPartDescription(body.description);
                }
                if (body.weight !== undefined) {
                    updateData.weight = body.weight;
                }
                const part = await db.partReference.update({
                    where: { id },
                    data: updateData,
                });
                return { success: true, part: await decryptPart(part) };
            } catch (err: any) {
                console.error("[partReferences PATCH] failed:", err);
                set.status = 500;
                return { success: false, message: err?.message || "Internal error" };
            }
        }, {
            body: t.Object({
                description: t.Optional(t.String()),
                weight: t.Optional(t.Number()),
            }),
        })

        .delete("/:id", async ({ params: { id }, set }) => {
            try {
                const existing = await db.partReference.findUnique({ where: { id } });
                if (!existing) {
                    set.status = 404;
                    return { success: false, message: "Not found" };
                }
                await db.partReference.delete({ where: { id } });
                return { success: true };
            } catch (err: any) {
                console.error("[partReferences DELETE] failed:", err);
                set.status = 500;
                return { success: false, message: err?.message || "Internal error" };
            }
        })
    );
