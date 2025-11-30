/**
 * ASIN-level metadata service for managing book metadata.
 * - readBookMetadata: reads metadata.json from {storageDir}/{asin}/metadata.json
 * - writeBookMetadata: writes metadata.json to {storageDir}/{asin}/metadata.json
 * - getOrCreateBookMetadata: returns existing metadata or creates a new empty one
 * - upsertRange: finds existing range by id and updates, or appends new range
 */
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import type {
  CoverageRange,
  RendererCoverageMetadata,
} from "../types/chunk-metadata.js";

/** Reads ASIN-level metadata JSON if it exists, otherwise returns undefined. */
export async function readBookMetadata(
  asin: string
): Promise<RendererCoverageMetadata | undefined> {
  const metadataPath = path.join(env.storageDir, asin, "metadata.json");
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    return JSON.parse(raw) as RendererCoverageMetadata;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

/** Persists the provided ASIN-level metadata JSON to disk. */
export async function writeBookMetadata(
  asin: string,
  metadata: RendererCoverageMetadata
): Promise<void> {
  const metadataPath = path.join(env.storageDir, asin, "metadata.json");
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
}

/** Returns existing ASIN-level metadata or creates a new empty one. */
export async function getOrCreateBookMetadata(
  asin: string
): Promise<RendererCoverageMetadata> {
  const existing = await readBookMetadata(asin);
  if (existing) {
    return existing;
  }
  return {
    asin,
    updatedAt: new Date().toISOString(),
    ranges: [],
  };
}

/** Finds existing range by id and updates it, or appends a new range. */
export async function upsertRange(
  asin: string,
  range: CoverageRange
): Promise<void> {
  const metadata = await getOrCreateBookMetadata(asin);
  const existingIndex = metadata.ranges.findIndex((r) => r.id === range.id);

  if (existingIndex >= 0) {
    metadata.ranges[existingIndex] = range;
  } else {
    metadata.ranges.push(range);
  }

  metadata.updatedAt = new Date().toISOString();
  await writeBookMetadata(asin, metadata);
}
