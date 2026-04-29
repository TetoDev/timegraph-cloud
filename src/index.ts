// src/index.ts
import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { authPlugin } from "./auth/plugin";
import { authRoutes } from "./routes/auth";
import { projectRoutes, migrateUnencryptedProjects } from "./routes/projects";
import { userRoutes } from "./routes/users";
import { yjsSocketHandler } from "./ws/yjs-handler";
import { partReferenceRoutes } from "./routes/partReferences";
import { db } from "./db/client";
import { getMasterKey } from "./crypto";

// Validate encryption key at startup
try {
  await getMasterKey();
  console.log("[crypto] Encryption key loaded successfully.");
} catch (err: any) {
  console.error("[crypto] FATAL:", err.message);
  process.exit(1);
}

// Migrate unencrypted projects before starting the server
try {
  await migrateUnencryptedProjects();
} catch (err) {
  console.error("[crypto] Migration failed:", err);
}

const app = new Elysia()
  .use(cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : ["https://app.insa-racing.fr"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  }))

  .use(authPlugin)

  .ws("/ws/projects/:projectId", {
      async beforeHandle({ user, params: { projectId }, set }) {
          if (!user) return (set.status = 401);

          const project = await db.project.findFirst({
              where: {
                  id: projectId,
                  OR: [
                      { ownerId: user.id },
                      { collaborators: { some: { userId: user.id } } }
                  ]
              }
          });

          if (!project) return (set.status = 403);
      },

      ...yjsSocketHandler,

      params: t.Object({
          projectId: t.String()
      })
  })

  .use(authRoutes)
  .use(projectRoutes)
  .use(userRoutes)
  .use(partReferenceRoutes)

  .listen({ hostname: "0.0.0.0", port: 3000 });

console.log(`| Cloud Orchestrator running at ${app.server?.hostname}:${app.server?.port}`);
