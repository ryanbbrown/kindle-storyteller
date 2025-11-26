import fs from "node:fs/promises";

import Fastify from "fastify";
import cors from "@fastify/cors";

import { env } from "./config/env.js";
import { SessionStore } from "./session-store.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerBooksRoutes } from "./routes/books.js";
import { registerProgressRoutes } from "./routes/progress.js";
import { registerPipelineRoutes } from "./routes/pipeline.js";
import { registerTextRoutes } from "./routes/text.js";
import { registerChunkAudioRoutes } from "./routes/chunk-audio.js";
import { registerBenchmarkRoutes } from "./routes/benchmarks.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.logLevel,
    },
  });

  await fs.mkdir(env.storageDir, { recursive: true });

  const store = new SessionStore(env.sessionTtlMs);

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await registerSessionRoutes(app, store);
  await registerBooksRoutes(app, store);
  await registerProgressRoutes(app, store);
  await registerPipelineRoutes(app, store);
  await registerChunkAudioRoutes(app, store);
  await registerBenchmarkRoutes(app, store);
  await registerTextRoutes(app, store);

  const timer = setInterval(() => {
    const removed = store.gc();
    if (removed > 0) {
      app.log.debug({ removed }, "Cleaned up expired sessions");
    }
  }, Math.max(env.sessionTtlMs, 60_000));

  timer.unref();

  app.addHook("onClose", (_instance, done) => {
    clearInterval(timer);
    done();
  });

  return app;
}
