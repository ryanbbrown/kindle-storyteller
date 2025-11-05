import fs from "node:fs/promises";
import path from "node:path";

import type { RendererCoverageMetadata } from "../types/chunk-metadata.js";

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

export async function writeChunkMetadata(
  metadataPath: string,
  metadata: RendererCoverageMetadata
): Promise<void> {
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
}
