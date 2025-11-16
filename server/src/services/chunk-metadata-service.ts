/**
 * - readChunkMetadata: shared helper for services to load chunk metadata JSON if present.
 * - writeChunkMetadata: persists updated chunk metadata so download/OCR/audio modules stay in sync.
 */
import fs from "node:fs/promises";
import path from "node:path";

import type { RendererCoverageMetadata } from "../types/chunk-metadata.js";

/** Reads chunk metadata JSON if it exists, otherwise returns undefined. */
export async function readChunkMetadata(
  metadataPath: string
): Promise<RendererCoverageMetadata | undefined> {
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

/** Persists the provided chunk metadata JSON to disk. */
export async function writeChunkMetadata(
  metadataPath: string,
  metadata: RendererCoverageMetadata
): Promise<void> {
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
}
