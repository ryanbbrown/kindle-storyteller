import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import type { SessionStore } from "../session-store.js";
import { requireSession } from "../utils/auth.js";

type ChunkAudioParams = {
  asin: string;
  chunkId: string;
};

export async function registerChunkAudioRoutes(
  app: FastifyInstance,
  store: SessionStore
): Promise<void> {
  app.get<{ Params: ChunkAudioParams }>(
    "/books/:asin/chunks/:chunkId/audio",
    async (request, reply) => {
      const session = requireSession(store, request, reply);
      if (!session) {
        return;
      }

      const asin = request.params.asin?.trim();
      const chunkId = request.params.chunkId?.trim();

      if (!asin || !chunkId) {
        return reply
          .status(400)
          .send({ message: "asin and chunkId are required" } as never);
      }

      try {
        const { stream, size } = await openAudioStream(asin, chunkId);
        reply.header("Content-Type", "audio/mpeg");
        reply.header("Accept-Ranges", "bytes");
        reply.header("Content-Length", size);
        return reply.send(stream);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return reply
            .status(404)
            .send({ message: "Audio preview not found" } as never);
        }

        request.log.error(
          { err: error, asin, chunkId },
          "Failed to stream chunk audio"
        );
        return reply
          .status(500)
          .send({ message: "Failed to stream chunk audio" } as never);
      }
    }
  );
}

async function openAudioStream(asin: string, chunkId: string) {
  const chunkDir = path.join(env.storageDir, asin, "chunks", chunkId);
  const audioPath = path.join(chunkDir, "audio", "audio.mp3");
  const stats = await fs.stat(audioPath);
  const stream = createReadStream(audioPath);
  return { stream, size: stats.size };
}
