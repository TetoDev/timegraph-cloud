// src/routes/partReferences.ts
import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { authPlugin } from "../auth/plugin";

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
                orderBy: { componentNumber: "asc" }
            });
            return { success: true, parts };
        })

        .get("/search", async ({ query: { q } }) => {
            if (!q || q.length < 1) return { success: true, parts: [] };
            const parts = await db.partReference.findMany({
                where: { componentNumber: { contains: q, mode: "insensitive" } },
                take: 50,
                orderBy: { componentNumber: "asc" }
            });
            return { success: true, parts };
        }, {
            query: t.Object({ q: t.String() })
        })

        .get("/lookup", async ({ query: { numbers } }) => {
            const list = numbers.split(",").map(s => s.trim()).filter(Boolean);
            if (list.length === 0) return { success: true, parts: [] };
            const parts = await db.partReference.findMany({
                where: { componentNumber: { in: list } }
            });
            return { success: true, parts };
        }, {
            query: t.Object({ numbers: t.String() })
        })

        .post("/", async ({ body, user, set }) => {
            try {
                const { componentNumber, description, weight } = body;
                const trimmed = componentNumber.trim();
                if (!trimmed) {
                    set.status = 400;
                    return { success: false, message: "componentNumber required" };
                }
                const part = await db.partReference.upsert({
                    where: { componentNumber: trimmed },
                    update: { description, weight, updatedById: user!.id },
                    create: {
                        componentNumber: trimmed,
                        description,
                        weight,
                        createdById: user!.id,
                        updatedById: user!.id
                    }
                });
                return { success: true, part };
            } catch (err: any) {
                console.error("[partReferences POST] failed:", err);
                set.status = 500;
                return { success: false, message: err?.message || "Internal error" };
            }
        }, {
            body: t.Object({
                componentNumber: t.String(),
                description: t.String(),
                weight: t.Number()
            })
        })

        .patch("/:id", async ({ params: { id }, body, user, set }) => {
            try {
                const existing = await db.partReference.findUnique({ where: { id } });
                if (!existing) {
                    set.status = 404;
                    return { success: false, message: "Not found" };
                }
                const part = await db.partReference.update({
                    where: { id },
                    data: { ...body, updatedById: user!.id }
                });
                return { success: true, part };
            } catch (err: any) {
                console.error("[partReferences PATCH] failed:", err);
                set.status = 500;
                return { success: false, message: err?.message || "Internal error" };
            }
        }, {
            body: t.Object({
                description: t.Optional(t.String()),
                weight: t.Optional(t.Number())
            })
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
