/**
 * - runChunkPipeline: exported entry that calls determineSteps, ensureChunkDownloaded, runChunkOcr, and generateChunkPreviewAudio.
 * - determineSteps: plans required stages by leveraging findExistingChunk, resolveArtifacts, and statMatches checks.
 *   - findExistingChunk: scans stored chunk metadata via readChunkMetadata and selectMatchingRange to find coverage ranges.
 *   - selectMatchingRange: matches requested offsets/positionIds to metadata ranges for determineSteps.
 * - resolveChunkByteRange: translates coverage metadata into byte offsets for runChunkPipeline results.
 * - statMatches: shared helper letting determineSteps probe cached artifacts without duplicating fs try/catch logic.
 */
import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import type { Kindle } from "kindle-api";

import {
  ensureChunkDownloaded,
  resolveArtifacts,
  type ChunkArtifacts,
} from "./download.js";
import { runChunkOcr, type RunChunkOcrResult } from "./ocr.js";
import {
  generateChunkPreviewAudio,
  recordChunkAudioArtifacts,
  type ChunkAudioSummary,
} from "./elevenlabs-audio.js";
import { env } from "../env.js";
import { readChunkMetadata } from "./chunk-metadata-service.js";
import type {
  CoverageRange,
  RendererCoverageMetadata,
} from "../types/chunk-metadata.js";

type PipelineStep = "download" | "ocr" | "audio";

export type RunChunkPipelineOptions = {
  asin: string;
  kindle: Kindle;
  renderingToken: string;
  startingPosition: number | string;
};

export type ChunkPipelineByteRange = {
  startOffset: number;
  endOffset: number;
};

export type ChunkPipelineState = {
  asin: string;
  chunkId: string;
  steps: PipelineStep[];
  byteRange: ChunkPipelineByteRange;
  artifactsDir: string;
  audioDurationSeconds?: number;
};

/** Runs the download/OCR/audio stages for a Kindle chunk while skipping cached work. */
export async function runChunkPipeline(
  options: RunChunkPipelineOptions
): Promise<ChunkPipelineState> {
  const DEFAULT_RENDER_NUM_PAGES = 5;
  const DEFAULT_RENDER_SKIP_PAGES = 0;
  const DEFAULT_OCR_MAX_PAGES = 5;
  const plan = await determineSteps({
    asin: options.asin,
    startingPosition: options.startingPosition,
  });

  let activeChunk: LoadedChunk | undefined = plan.existing;
  let downloadExecuted = false;

  if (plan.needsDownload) {
    const downloadResult = await ensureChunkDownloaded({
      asin: options.asin,
      kindle: options.kindle,
      renderingToken: options.renderingToken,
      renderOptions: {
        startingPosition: options.startingPosition,
        numPages: DEFAULT_RENDER_NUM_PAGES,
        skipPages: DEFAULT_RENDER_SKIP_PAGES,
      },
    });

    activeChunk = {
      asin: downloadResult.asin,
      chunkId: downloadResult.chunkId,
      chunkDir: downloadResult.chunkDir,
      metadataPath: downloadResult.metadataPath,
      metadata: downloadResult.chunkMetadata,
      artifacts: downloadResult.artifacts,
    };
    downloadExecuted = true;
  }

  if (!activeChunk) {
    throw new Error("Unable to resolve chunk for the requested starting position");
  }

  const executedSteps: PipelineStep[] = [];
  if (downloadExecuted) {
    executedSteps.push("download");
  }

  const targetRange = activeChunk.metadata.ranges.find(
    (range) => range.id === activeChunk.chunkId,
  );

  let ocrResult: RunChunkOcrResult | undefined;
  const shouldRunOcr = plan.needsOcr || downloadExecuted;
  if (shouldRunOcr) {
    executedSteps.push("ocr");
    ocrResult = await runChunkOcr({
      chunkId: activeChunk.chunkId,
      chunkDir: activeChunk.chunkDir,
      extractDir: activeChunk.artifacts.extractDir,
      metadataPath: activeChunk.metadataPath,
      startPage: 0,
      maxPages: DEFAULT_OCR_MAX_PAGES,
    });
  }

  let combinedTextPath =
    activeChunk.artifacts.combinedTextPath ??
    path.join(activeChunk.chunkDir, "full-content.txt");
  if (ocrResult?.combinedTextPath) {
    combinedTextPath = ocrResult.combinedTextPath;
    activeChunk.artifacts.combinedTextPath = combinedTextPath;
  }

  let audioResult: ChunkAudioSummary | undefined;
  const shouldRunAudio = plan.needsAudio || shouldRunOcr;
  if (shouldRunAudio && targetRange) {
    executedSteps.push("audio");
    audioResult = await generateChunkPreviewAudio({
      asin: activeChunk.asin,
      chunkId: activeChunk.chunkId,
      chunkDir: activeChunk.chunkDir,
      range: targetRange,
      combinedTextPath,
    });

    await recordChunkAudioArtifacts({
      metadataPath: activeChunk.metadataPath,
      metadata: activeChunk.metadata,
      chunkId: activeChunk.chunkId,
      summary: audioResult,
    });

    activeChunk.artifacts.audioPath = audioResult.audioPath;
    activeChunk.artifacts.audioAlignmentPath = audioResult.alignmentPath;
    activeChunk.artifacts.audioBenchmarksPath =
      audioResult.benchmarksPath;
  }

  const byteRange = resolveChunkByteRange(
    activeChunk.metadata,
    activeChunk.chunkId,
  );

  return {
    asin: activeChunk.asin,
    chunkId: activeChunk.chunkId,
    steps: executedSteps,
    byteRange,
    artifactsDir: activeChunk.artifacts.extractDir,
    ...(audioResult ? { audioDurationSeconds: audioResult.totalDurationSeconds } : {}),
  };
}

/** Picks the byte offsets for the current chunk to avoid shipping full metadata. */
function resolveChunkByteRange(
  metadata: RendererCoverageMetadata,
  chunkId: string,
): ChunkPipelineByteRange {
  const candidates = metadata.ranges;
  const target = candidates.find((range) => range.id === chunkId);
  const chosen = target ?? candidates[0];
  if (!chosen) {
    throw new Error(`Chunk ${chunkId} is missing coverage metadata`);
  }
  return {
    startOffset: chosen.start.offset,
    endOffset: chosen.end.offset,
  };
}

type LoadedChunk = {
  asin: string;
  chunkId: string;
  chunkDir: string;
  metadataPath: string;
  metadata: RendererCoverageMetadata;
  artifacts: ChunkArtifacts;
};

type StepPlan = {
  needsDownload: boolean;
  needsOcr: boolean;
  needsAudio: boolean;
  existing?: LoadedChunk;
};

type ExistingChunk = {
  chunkId: string;
  chunkDir: string;
  metadataPath: string;
  metadata: RendererCoverageMetadata;
  range: CoverageRange;
};

/** Examines cached artifacts to decide which pipeline stages must run. */
async function determineSteps(options: {
  asin: string;
  startingPosition: number | string;
}): Promise<StepPlan> {
  const rawStart = String(options.startingPosition ?? "").trim();
  const startOffset = Number.parseInt(rawStart, 10);
  if (!Number.isFinite(startOffset)) {
    throw new Error("Invalid starting position");
  }
  const positionId = Math.trunc(startOffset);

  const existing = await findExistingChunk({
    asin: options.asin,
    startOffset,
    requestPositionId: positionId,
  });
  if (!existing) {
    return { needsDownload: true, needsOcr: true, needsAudio: true };
  }

  const artifacts = resolveArtifacts(existing.range, existing.chunkDir);

  const loaded: LoadedChunk = {
    asin: options.asin,
    chunkId: existing.chunkId,
    chunkDir: existing.chunkDir,
    metadataPath: existing.metadataPath,
    metadata: existing.metadata,
    artifacts,
  };

  const hasCombinedText = await statMatches(
    artifacts.combinedTextPath,
    (stats) => stats.isFile(),
  );
  if (!hasCombinedText) {
    return {
      needsDownload: false,
      needsOcr: true,
      needsAudio: true,
      existing: loaded,
    };
  }

  const hasAudio = artifacts.audioPath
    ? await statMatches(artifacts.audioPath, (stats) => stats.isFile())
    : false;

  return {
    needsDownload: false,
    needsOcr: false,
    needsAudio: !hasAudio,
    existing: loaded,
  };
}

/** Finds a chunk in data/books/[asin] covering the requested start offset, if it exists. */
async function findExistingChunk(options: {
  asin: string;
  startOffset: number;
  requestPositionId?: number;
}): Promise<ExistingChunk | undefined> {
  const asinDir = path.join(env.storageDir, options.asin);
  const chunksRoot = path.join(asinDir, "chunks");

  let entries: string[];
  try {
    entries = await fs.readdir(chunksRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  for (const entry of entries) {
    const chunkDir = path.join(chunksRoot, entry);
    const metadataPath = path.join(chunkDir, "metadata.json");
    const metadata = await readChunkMetadata(metadataPath);
    if (!metadata) {
      continue;
    }

    const range = selectMatchingRange({
      metadata,
      startOffset: options.startOffset,
      requestPositionId: options.requestPositionId,
    });
    if (!range) {
      continue;
    }

    return {
      chunkId: entry,
      chunkDir,
      metadataPath,
      metadata,
      range,
    };
  }

  return undefined;
}

/** Locates the coverage range matching the requested Kindle position metadata. */
function selectMatchingRange(options: {
  metadata: RendererCoverageMetadata;
  startOffset: number;
  requestPositionId?: number;
}): CoverageRange | undefined {
  const { metadata, startOffset, requestPositionId } = options;
  for (const range of metadata.ranges) {
    if (
      requestPositionId !== undefined &&
      range.start.positionId !== undefined &&
      range.start.positionId === requestPositionId
    ) {
      return range;
    }

    if (
      requestPositionId !== undefined &&
      range.start.positionId !== undefined &&
      range.end.positionId !== undefined &&
      requestPositionId >= range.start.positionId &&
      requestPositionId <= range.end.positionId
    ) {
      return range;
    }

    if (range.start.offset === startOffset) {
      return range;
    }
  }
  return undefined;
}

/** Checks whether the provided path exists and matches the given predicate. */
async function statMatches(
  targetPath: string,
  predicate: (stats: Stats) => boolean,
): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return predicate(stats);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
