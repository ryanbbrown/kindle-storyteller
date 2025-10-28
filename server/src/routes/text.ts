import fs from "node:fs/promises";
import path from "node:path";

import type { FastifyInstance } from "fastify";

import { env } from "../env.js";
import type { SessionStore } from "../session-store.js";
import { requireSession } from "../utils/auth.js";

type TextParams = {
  asin: string;
};

type TextQuery = {
  start?: string;
  length?: string;
};

type TextResponse = {
  asin: string;
  start: number;
  length: number;
  bytesRead: number;
  totalBytes: number;
  hasMore: boolean;
  text: string;
};

export async function registerTextRoutes(
  app: FastifyInstance,
  store: SessionStore
): Promise<void> {
  app.get<{
    Params: TextParams;
    Querystring: TextQuery;
    Reply: TextResponse;
  }>("/books/:asin/text", async (request, reply) => {
    const session = requireSession(store, request, reply);
    if (!session) {
      return;
    }

    const asin = request.params.asin?.trim();
    if (!asin) {
      return reply
        .status(400)
        .send({ message: "asin is required" } as never);
    }

    const start = clampToZero(parseIntSafe(request.query?.start, 0));
    const length = clampToPositive(parseIntSafe(request.query?.length, 2000));

    const combinedPath =
      session.glyphCache.get(asin)?.combined_text_path ??
      path.join(env.storageDir, asin, "ocr", "combined.txt");

    try {
      const stats = await fs.stat(combinedPath);
      const fileHandle = await fs.open(combinedPath, "r");

      const buffer = Buffer.alloc(length);
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        length,
        start
      );
      await fileHandle.close();

      const text = buffer.slice(0, bytesRead).toString("utf8");

      return reply.send({
        asin,
        start,
        length,
        bytesRead,
        totalBytes: stats.size,
        hasMore: start + bytesRead < stats.size,
        text,
      });
    } catch (error) {
      request.log.error({ err: error }, "Failed to read combined text");
      return reply
        .status(404)
        .send({ message: "Combined text not found for this ASIN" } as never);
    }
  });
}

function parseIntSafe(value: string | undefined, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampToZero(value: number): number {
  return value < 0 ? 0 : value;
}

function clampToPositive(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 2000;
  }
  return value;
}
