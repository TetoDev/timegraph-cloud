// src/index.ts
import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { authPlugin } from "./auth/plugin"; // Our unified auth logic
import { authRoutes } from "./routes/auth";
import { projectRoutes } from "./routes/projects";
import { userRoutes } from "./routes/users";
import { yjsSocketHandler } from "./ws/yjs-handler";
import { db } from "./db/client";

const app = new Elysia()
  .use(cors({ 
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  }))
  
  // 1. Register the authPlugin FIRST. 
  // This injects the 'user' and 'session' into the global context.
  .use(authPlugin)

  // 2. THE WEBSOCKET GATEWAY
  // Because authPlugin is above this, 'user' is now available in beforeHandle
  .ws("/ws/projects/:projectId", {
      async beforeHandle({ user, params: { projectId }, set }) {
          // If the plugin didn't find a user, block the connection
          if (!user) return (set.status = 401);
          
          // Check project permissions in DB
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
  
  // 3. Attach your other route groups
  .use(authRoutes)
  .use(projectRoutes)
  .use(userRoutes)
  
  .listen(3000);

console.log(`| Cloud Orchestrator running at ${app.server?.hostname}:${app.server?.port}`);