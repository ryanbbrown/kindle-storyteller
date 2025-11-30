import fs from "node:fs/promises";
import path from "node:path";

import type { FastifyInstance } from "fastify";

import { env } from "../config/env.js";
import { readBookMetadata } from "../services/chunk-metadata-service.js";
import type { TtsProvider } from "../types/chunk-metadata.js";

type AudiobookEntry = {
  asin: string;
  chunkId: string;
  bookTitle: string | null;
  coverImage: string | null;
  startPercent: number;
  durationSeconds: number;
  ttsProvider: TtsProvider;
};

type BookInfo = {
  title: string;
  coverImage?: string;
  length: number;
};

type AudiobooksResponse = AudiobookEntry[];

type DeleteParams = {
  asin: string;
  chunkId: string;
};

type DeleteQuery = {
  provider: TtsProvider;
};

/** Registers routes for listing generated audiobooks. */
export async function registerAudiobooksRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Reply: AudiobooksResponse }>("/audiobooks", async (request, reply) => {
    request.log.debug("Listing generated audiobooks");

    const entries = await scanAudiobooks();
    return reply.status(200).send(entries);
  });

  app.delete<{ Params: DeleteParams; Querystring: DeleteQuery }>("/audiobooks/:asin/:chunkId", async (request, reply) => {
    const { asin, chunkId } = request.params;
    const provider = request.query.provider;

    if (!provider || (provider !== "cartesia" && provider !== "elevenlabs")) {
      return reply
        .status(400)
        .send({ message: "provider query param is required (cartesia or elevenlabs)" } as never);
    }

    request.log.info({ asin, chunkId, provider }, "Deleting audiobook");

    const audioDir = path.join(env.storageDir, asin, "chunks", chunkId, "audio");

    try {
      const files = [
        `${provider}-audio.mp3`,
        `${provider}-alignment.json`,
        `${provider}-benchmarks.json`,
      ];
      await Promise.all(
        files.map((f) => fs.rm(path.join(audioDir, f), { force: true }))
      );
      request.log.info({ asin, chunkId, provider }, "Audiobook deleted");
      return reply.status(204).send();
    } catch (error) {
      request.log.error({ err: error, asin, chunkId, provider }, "Failed to delete audiobook");
      return reply.status(500).send({ message: "Failed to delete audiobook" } as never);
    }
  });
}

/** Scans ASIN-level metadata to build the audiobook list. Returns one entry per (chunk, provider) pair. */
async function scanAudiobooks(): Promise<AudiobookEntry[]> {
  const entries: AudiobookEntry[] = [];

  let asinDirs: string[];
  try {
    asinDirs = await fs.readdir(env.storageDir);
  } catch {
    return entries;
  }

  for (const asin of asinDirs) {
    const asinPath = path.join(env.storageDir, asin);
    const stat = await fs.stat(asinPath).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const bookInfo = await readBookInfo(asinPath);
    const metadata = await readBookMetadata(asin);
    if (!metadata) continue;

    for (const range of metadata.ranges) {
      if (!range.artifacts.audio) continue;

      for (const [provider, audio] of Object.entries(range.artifacts.audio)) {
        if (!audio?.benchmarksPath) continue;

        try {
          const raw = await fs.readFile(audio.benchmarksPath, "utf8");
          const benchmarks = JSON.parse(raw);

          const startPositionId = range.start.positionId;
          const startPercent = bookInfo?.length
            ? (startPositionId / bookInfo.length) * 100
            : 0;

          entries.push({
            asin,
            chunkId: range.id,
            bookTitle: bookInfo?.title ?? null,
            coverImage: bookInfo?.coverImage ?? null,
            startPercent,
            durationSeconds: benchmarks.totalDurationSeconds ?? 0,
            ttsProvider: provider as TtsProvider,
          });
        } catch {
          // Benchmarks file missing or invalid, skip
        }
      }
    }
  }

  return entries;
}

/** Reads book-info.json from an ASIN directory if it exists. */
async function readBookInfo(asinPath: string): Promise<BookInfo | null> {
  try {
    const raw = await fs.readFile(path.join(asinPath, "book-info.json"), "utf8");
    return JSON.parse(raw) as BookInfo;
  } catch {
    return null;
  }
}
