import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import type { TtsProvider } from "../types/chunk-metadata.js";

type ChunkAudioParams = {
  asin: string;
  chunkId: string;
};

type ChunkAudioQuery = {
  provider: TtsProvider;
  startPosition: string;
  endPosition: string;
};

/** Registers routes for streaming chunk audio files. */
export async function registerChunkAudioRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: ChunkAudioParams; Querystring: ChunkAudioQuery }>(
    "/books/:asin/chunks/:chunkId/audio",
    async (request, reply) => {
      const asin = request.params.asin?.trim();
      const chunkId = request.params.chunkId?.trim();
      const provider = request.query.provider;
      const startPosition = parseInt(request.query.startPosition, 10);
      const endPosition = parseInt(request.query.endPosition, 10);

      if (!asin || !chunkId) {
        return reply
          .status(400)
          .send({ message: "asin and chunkId are required" } as never);
      }

      if (!provider || (provider !== "cartesia" && provider !== "elevenlabs")) {
        return reply
          .status(400)
          .send({ message: "provider query param is required (cartesia or elevenlabs)" } as never);
      }

      if (!Number.isFinite(startPosition) || !Number.isFinite(endPosition)) {
        return reply
          .status(400)
          .send({ message: "startPosition and endPosition query params are required" } as never);
      }

      request.log.debug({ asin, chunkId, provider, startPosition, endPosition }, "Streaming chunk audio");

      const audioPath = path.join(
        env.storageDir, asin, "chunks", chunkId, "audio",
        `${provider}-audio-${startPosition}-${endPosition}.mp3`
      );

      try {
        const stats = await fs.stat(audioPath);
        const stream = createReadStream(audioPath);
        reply.header("Content-Type", "audio/mpeg");
        reply.header("Accept-Ranges", "bytes");
        reply.header("Content-Length", stats.size);
        return reply.send(stream);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          request.log.warn({ asin, chunkId, provider, audioPath }, "Audio not found");
          return reply
            .status(404)
            .send({ message: "Audio preview not found" } as never);
        }

        request.log.error(
          { err: error, asin, chunkId, provider },
          "Failed to stream chunk audio"
        );
        return reply
          .status(500)
          .send({ message: "Failed to stream chunk audio" } as never);
      }
    }
  );
}
