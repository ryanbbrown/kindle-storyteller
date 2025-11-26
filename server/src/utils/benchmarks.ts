import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import type { BenchmarkEntry } from "../services/tts/index.js";

export type BenchmarkPayload = {
  totalDurationSeconds: number;
  benchmarkIntervalSeconds: number;
  benchmarks: BenchmarkEntry[];
};

/** Reads a chunk's benchmark metadata from disk. */
export async function openBenchmarkPayload(
  asin: string,
  chunkId: string,
): Promise<BenchmarkPayload> {
  const chunkDir = path.join(env.storageDir, asin, "chunks", chunkId);
  const benchmarksPath = path.join(chunkDir, "audio", "benchmarks.json");

  try {
    const raw = await fs.readFile(benchmarksPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BenchmarkPayload>;

    if (
      typeof parsed.totalDurationSeconds !== "number" ||
      typeof parsed.benchmarkIntervalSeconds !== "number" ||
      !Array.isArray(parsed.benchmarks)
    ) {
      throw new Error("Invalid benchmark payload");
    }

    return {
      totalDurationSeconds: parsed.totalDurationSeconds,
      benchmarkIntervalSeconds: parsed.benchmarkIntervalSeconds,
      benchmarks: parsed.benchmarks,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const notFoundError = new Error("Benchmarks not found") as NodeJS.ErrnoException & {
        statusCode?: number;
      };
      notFoundError.code = "ENOENT";
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    throw error;
  }
}
