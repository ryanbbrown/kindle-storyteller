/**
 * - ensureChunkDownloaded: exported entry that prepares renderer inputs then calls downloadFreshChunk and resolveArtifacts to return artifacts.
 * - downloadFreshChunk: performs the renderer HTTP request, writes artifacts/metadata, and relies on helpers:
 *   - findPageDataFile: locates the canonical page_data JSON within extracted renderer output.
 *   - buildChunkId: builds deterministic chunk ids from normalized start/end positions.
 * - resolveArtifacts: merges metadata-provided artifact paths with default chunk directory fallbacks.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { Kindle } from "kindle-api";

import { log } from "../logger.js";

import { env } from "../config/env.js";
import { writeChunkMetadata } from "./chunk-metadata-service.js";
import type {
  CoverageRange,
  RendererCoverageMetadata,
} from "../types/chunk-metadata.js";

const execFileAsync = promisify(execFile);

const METADATA_FILENAME = "metadata.json";

export type RendererConfigInput = {
  startingPosition: number | string;
  numPages?: number | string;
  skipPages?: number | string;
};

export type EnsureChunkDownloadedOptions = {
  asin: string;
  kindle: Kindle;
  renderOptions: RendererConfigInput;
};

export type ChunkArtifacts = {
  extractDir: string;
  pagesDir: string;
  combinedTextPath: string;
  contentTarPath: string;
  audioPath?: string;
  audioAlignmentPath?: string;
  audioBenchmarksPath?: string;
};

export type EnsureChunkDownloadedResult = {
  asin: string;
  chunkId: string;
  chunkDir: string;
  metadataPath: string;
  chunkMetadata: RendererCoverageMetadata;
  artifacts: ChunkArtifacts;
};

/** Ensures a Kindle chunk exists locally by downloading it when needed. */
export async function ensureChunkDownloaded(
  options: EnsureChunkDownloadedOptions
): Promise<EnsureChunkDownloadedResult> {
  const { asin, kindle, renderOptions } = options;

  const asinDir = path.join(env.storageDir, asin);
  const chunksRoot = path.join(asinDir, "chunks");
  await fs.mkdir(chunksRoot, { recursive: true });

  return await downloadFreshChunk({
    asin,
    kindle,
    renderOptions,
    chunksRoot,
  });
}

/** Downloads a chunk tarball, extracts it, and writes renderer metadata. */
async function downloadFreshChunk(options: {
  asin: string;
  kindle: Kindle;
  renderOptions: RendererConfigInput;
  chunksRoot: string;
}): Promise<EnsureChunkDownloadedResult> {
  const { asin, kindle, renderOptions, chunksRoot } = options;

  const asinDir = path.dirname(chunksRoot);
  const tempRoot = path.join(asinDir, "tmp");
  await fs.mkdir(tempRoot, { recursive: true });

  const stagingDir = await fs.mkdtemp(path.join(tempRoot, "render-"));
  const stagingTar = path.join(stagingDir, "content.tar");
  const stagingExtractDir = path.join(stagingDir, "extracted");
  await fs.mkdir(stagingExtractDir, { recursive: true });

  log.debug({ asin, startingPosition: renderOptions.startingPosition }, "Calling Kindle renderer");
  const buffer = await kindle.renderChunk({
    asin,
    startingPosition: renderOptions.startingPosition,
    numPages: renderOptions.numPages,
    skipPages: renderOptions.skipPages,
  });
  log.debug({ asin, bytes: buffer.length }, "Renderer response received");

  await fs.writeFile(stagingTar, buffer);

  try {
    await execFileAsync("tar", ["-xf", stagingTar, "-C", stagingExtractDir]);
  } catch (error) {
    throw error;
  }

  const pageDataPath = await findPageDataFile(stagingExtractDir);
  const pageDataRaw = await fs.readFile(pageDataPath, "utf8");
  const pageData = JSON.parse(pageDataRaw);
  if (!Array.isArray(pageData) || pageData.length === 0) {
    throw new Error("Renderer payload contained no page data");
  }

  const startPositionId = extractPositionId(pageData[0], "startPositionId");
  const endPositionId = extractPositionId(
    pageData[pageData.length - 1],
    "endPositionId",
  );
  const start: CoverageRange["start"] = { positionId: startPositionId };
  const end: CoverageRange["end"] = { positionId: endPositionId };
  const chunkId = buildChunkId(start, end);

  const chunkDir = path.join(chunksRoot, chunkId);
  await fs.rm(chunkDir, { recursive: true, force: true });
  await fs.mkdir(chunkDir, { recursive: true });

  const finalTarPath = path.join(chunkDir, "content.tar");
  const finalExtractDir = path.join(chunkDir, "extracted");
  await fs.rename(stagingTar, finalTarPath);
  await fs.rename(stagingExtractDir, finalExtractDir);

  const metadataPath = path.join(chunkDir, METADATA_FILENAME);
  const now = new Date().toISOString();

  const range: CoverageRange = {
    id: chunkId,
    start,
    end,
    artifacts: {
      extractDir: finalExtractDir,
      pagesDir: path.join(chunkDir, "pages"),
      combinedTextPath: path.join(chunkDir, "full-content.txt"),
      contentTarPath: finalTarPath,
    },
    createdAt: now,
    updatedAt: now,
  };

  const chunkMetadata: RendererCoverageMetadata = {
    asin,
    updatedAt: now,
    ranges: [range],
  };

  await writeChunkMetadata(metadataPath, chunkMetadata);

  try {
    return {
      asin,
      chunkId,
      chunkDir,
      metadataPath,
      chunkMetadata,
      artifacts: resolveArtifacts(range, chunkDir),
    };
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Locates the renderer page_data JSON file inside the extraction directory. */
async function findPageDataFile(extractDir: string): Promise<string> {
  const entries = await fs.readdir(extractDir);
  const canonical = entries.find((entry) => entry === "page_data.json");
  if (canonical) {
    return path.join(extractDir, canonical);
  }

  const versioned = entries
    .filter((entry) => entry.startsWith("page_data_") && entry.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const latest = versioned.at(-1);
  if (latest) {
    return path.join(extractDir, latest);
  }

  throw new Error("page_data JSON not found in renderer output");
}

/** Builds a deterministic chunk id from renderer start/end metadata ranges. */
function buildChunkId(start: CoverageRange["start"], end: CoverageRange["end"]): string {
  return `chunk_pid_${start.positionId}_${end.positionId}`;
}

/** Builds chunk artifact paths by combining stored metadata defaults and fallbacks. */
export function resolveArtifacts(
  range: CoverageRange,
  chunkDir: string,
): ChunkArtifacts {
  const defaultExtractDir = path.join(chunkDir, "extracted");
  const defaultPagesDir = path.join(chunkDir, "pages");
  const defaultCombined = path.join(chunkDir, "full-content.txt");
  const defaultTar = path.join(chunkDir, "content.tar");

  return {
    extractDir: range.artifacts.extractDir ?? defaultExtractDir,
    pagesDir: range.artifacts.pagesDir ?? range.artifacts.pngDir ?? defaultPagesDir,
    combinedTextPath: range.artifacts.combinedTextPath ?? defaultCombined,
    contentTarPath: range.artifacts.contentTarPath ?? defaultTar,
    audioPath: range.artifacts.audioPath,
    audioAlignmentPath: range.artifacts.audioAlignmentPath,
    audioBenchmarksPath: range.artifacts.audioBenchmarksPath,
  };
}

function extractPositionId(
  entry: unknown,
  field: "startPositionId" | "endPositionId",
): number {
  if (!entry || typeof entry !== "object") {
    throw new Error("Invalid renderer page data encountered");
  }

  const value = (entry as Record<string, unknown>)[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Renderer payload missing ${field}`);
  }

  return Math.trunc(value);
}
