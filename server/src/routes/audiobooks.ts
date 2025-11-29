import fs from "node:fs/promises";
import path from "node:path";

import type { FastifyInstance } from "fastify";

import { env } from "../config/env.js";

type AudiobookEntry = {
  asin: string;
  chunkId: string;
  bookTitle: string | null;
  coverImage: string | null;
  startPercent: number;
  durationSeconds: number;
  ttsProvider: string;
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

/** Registers routes for listing generated audiobooks. */
export async function registerAudiobooksRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Reply: AudiobooksResponse }>("/audiobooks", async (request, reply) => {
    request.log.debug("Listing generated audiobooks");

    const entries = await scanAudiobooks();
    return reply.status(200).send(entries);
  });

  app.delete<{ Params: DeleteParams }>("/audiobooks/:asin/:chunkId", async (request, reply) => {
    const { asin, chunkId } = request.params;
    request.log.info({ asin, chunkId }, "Deleting audiobook");

    const audioDir = path.join(env.storageDir, asin, "chunks", chunkId, "audio");

    try {
      await fs.rm(audioDir, { recursive: true, force: true });
      request.log.info({ asin, chunkId }, "Audiobook deleted");
      return reply.status(204).send();
    } catch (error) {
      request.log.error({ err: error, asin, chunkId }, "Failed to delete audiobook");
      return reply.status(500).send({ message: "Failed to delete audiobook" } as never);
    }
  });
}

/** Scans data/books/{asin}/chunks/{chunkId}/audio/benchmarks.json to build the audiobook list. */
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

    const chunksPath = path.join(asinPath, "chunks");
    let chunkDirs: string[];
    try {
      chunkDirs = await fs.readdir(chunksPath);
    } catch {
      continue;
    }

    for (const chunkId of chunkDirs) {
      const chunkPath = path.join(chunksPath, chunkId);
      const chunkStat = await fs.stat(chunkPath).catch(() => null);
      if (!chunkStat?.isDirectory()) continue;

      const benchmarksPath = path.join(chunkPath, "audio", "benchmarks.json");
      try {
        const raw = await fs.readFile(benchmarksPath, "utf8");
        const benchmarks = JSON.parse(raw);

        const startPositionId = parseStartPositionFromChunkId(chunkId);
        const startPercent = bookInfo?.length
          ? (startPositionId / bookInfo.length) * 100
          : 0;

        entries.push({
          asin: benchmarks.asin ?? asin,
          chunkId: benchmarks.chunkId ?? chunkId,
          bookTitle: bookInfo?.title ?? null,
          coverImage: bookInfo?.coverImage ?? null,
          startPercent,
          durationSeconds: benchmarks.totalDurationSeconds ?? 0,
          ttsProvider: benchmarks.ttsProvider ?? "unknown",
        });
      } catch {
        // No benchmarks.json or invalid, skip
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

/** Extracts start position ID from chunk ID format: chunk_pid_START_END */
function parseStartPositionFromChunkId(chunkId: string): number {
  const match = chunkId.match(/chunk_pid_(\d+)_\d+/);
  return match ? parseInt(match[1], 10) : 0;
}
