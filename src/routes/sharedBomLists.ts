import { Elysia, t } from "elysia";
import { db } from "../db/client";
import { authPlugin } from "../auth/plugin";
import { encryptPartDescription, decryptPartDescription } from "../crypto";

async function decryptBomList(list: any) {
    return {
        ...list,
        items: list.items ? JSON.parse(await decryptPartDescription(list.items) || "[]") : [],
    };
}

export const sharedBomListRoutes = new Elysia({ prefix: "/api/shared-bom-lists" })
    .use(authPlugin)
    .guard({
        beforeHandle({ user, set }) {
            if (!user) {
                set.status = 401;
                return { success: false, message: "Unauthorized" };
            }
        }
    }, (app) => app
        .get("/", async ({ query }) => {
            try {
                const limit = Math.min(Number(query.limit) || 20, 100);
                const offset = Number(query.offset) || 0;
                const q = (query.q || "").trim();
                const where: any = {};
                if (q) {
                    where.OR = [
                        { name: { contains: q, mode: "insensitive" } },
                        { partNumber: { contains: q, mode: "insensitive" } },
                    ];
                }
                const [lists, total] = await Promise.all([
                    db.sharedBomList.findMany({
                        where,
                        orderBy: { updatedAt: "desc" },
                        select: { id: true, name: true, partNumber: true, drawing: true, items: true, createdAt: true, updatedAt: true },
                        take: limit,
                        skip: offset,
                    }),
                    db.sharedBomList.count({ where }),
                ]);
                const result = lists.map(l => ({
                    id: l.id,
                    name: l.name,
                    partNumber: l.partNumber,
                    drawing: l.drawing,
                    itemCount: (() => { try { return JSON.parse(l.items).length; } catch { return 0; } })(),
                    createdAt: l.createdAt,
                    updatedAt: l.updatedAt,
                }));
                return { success: true, lists: result, total, hasMore: offset + limit < total };
            } catch (err: any) {
                console.error("[sharedBomLists GET] failed:", err);
                return { success: false, message: err?.message || "Internal error" };
            }
        }, {
            query: t.Object({
                limit: t.Optional(t.String()),
                offset: t.Optional(t.String()),
                q: t.Optional(t.String()),
            }),
        })

        .get("/:id", async ({ params, set }) => {
            try {
                const list = await db.sharedBomList.findUnique({ where: { id: params.id } });
                if (!list) { set.status = 404; return { success: false, message: "Not found" }; }
                return { success: true, list: await decryptBomList(list) };
            } catch (err: any) {
                console.error("[sharedBomLists GET/:id] failed:", err);
                return { success: false, message: err?.message || "Internal error" };
            }
        })

        .post("/", async ({ body, user, set }) => {
            try {
                const encryptedItems = await encryptPartDescription(JSON.stringify(body.items || []));
                const list = await db.sharedBomList.create({
                    data: {
                        name: body.name,
                        partNumber: body.partNumber || "",
                        drawing: body.drawing || "",
                        items: encryptedItems,
                        createdById: user!.id,
                        updatedById: user!.id,
                    },
                });
                return { success: true, list: await decryptBomList(list) };
            } catch (err: any) {
                console.error("[sharedBomLists POST] failed:", err);
                return { success: false, message: err?.message || "Internal error" };
            }
        }, {
            body: t.Object({
                name: t.String(),
                partNumber: t.Optional(t.String()),
                drawing: t.Optional(t.String()),
                items: t.Optional(t.Array(t.Any())),
            }),
        })

        .patch("/:id", async ({ params, body, user, set }) => {
            try {
                const existing = await db.sharedBomList.findUnique({ where: { id: params.id } });
                if (!existing) { set.status = 404; return { success: false, message: "Not found" }; }
                const updateData: any = { updatedById: user!.id };
                if (body.name !== undefined) updateData.name = body.name;
                if (body.partNumber !== undefined) updateData.partNumber = body.partNumber;
                if (body.drawing !== undefined) updateData.drawing = body.drawing;
                if (body.items !== undefined) updateData.items = await encryptPartDescription(JSON.stringify(body.items));
                const list = await db.sharedBomList.update({ where: { id: params.id }, data: updateData });
                return { success: true, list: await decryptBomList(list) };
            } catch (err: any) {
                console.error("[sharedBomLists PATCH] failed:", err);
                return { success: false, message: err?.message || "Internal error" };
            }
        }, {
            body: t.Object({
                name: t.Optional(t.String()),
                partNumber: t.Optional(t.String()),
                drawing: t.Optional(t.String()),
                items: t.Optional(t.Array(t.Any())),
            }),
        })

        .delete("/:id", async ({ params, set }) => {
            try {
                const existing = await db.sharedBomList.findUnique({ where: { id: params.id } });
                if (!existing) { set.status = 404; return { success: false, message: "Not found" }; }
                await db.sharedBomList.delete({ where: { id: params.id } });
                return { success: true };
            } catch (err: any) {
                console.error("[sharedBomLists DELETE] failed:", err);
                return { success: false, message: err?.message || "Internal error" };
            }
        })
    );
