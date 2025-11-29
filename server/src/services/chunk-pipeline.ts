/**
 * - runChunkPipeline: exported entry that calls determineSteps, ensureChunkDownloaded, runChunkOcr, and generateChunkPreviewAudio.
 * - determineSteps: plans required stages by leveraging findExistingChunk, resolveArtifacts, and statMatches checks.
 *   - findExistingChunk: scans stored chunk metadata via readChunkMetadata and selectMatchingRange to find coverage ranges.
 *   - selectMatchingRange: matches requested Kindle positionIds to metadata ranges for determineSteps.
 * - resolveChunkPositionRange: exposes coverage metadata so clients know which positionIds a chunk spans.
 * - statMatches: shared helper letting determineSteps probe cached artifacts without duplicating fs try/catch logic.
 */
import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import type { Kindle } from "kindle-api";

import { log } from "../logger.js";

import {
  ensureChunkDownloaded,
  resolveArtifacts,
  type ChunkArtifacts,
} from "./download.js";
import { runChunkOcr, type RunChunkOcrResult } from "./ocr.js";
import {
  generateElevenLabsAudio,
  generateCartesiaAudio,
  recordChunkAudioArtifacts,
} from "./tts/index.js";
import { transformTextForTTS } from "./llm.js";
import type { ChunkAudioSummary } from "../types/audio.js";
import { readChunkMetadata } from "./chunk-metadata-service.js";
import { openBenchmarkPayload } from "../utils/benchmarks.js";
import { env } from "../config/env.js";
import type {
  CoverageRange,
  RendererCoverageMetadata,
} from "../types/chunk-metadata.js";

type PipelineStep = "download" | "ocr" | "llm" | "audio";

export type RunChunkPipelineOptions = {
  asin: string;
  kindle: Kindle;
  startingPosition: number | string;
  audioProvider: "cartesia" | "elevenlabs";
  skipLlmPreprocessing?: boolean;
};

export type ChunkPipelinePositionRange = {
  startPositionId: number;
  endPositionId: number;
};

export type ChunkPipelineState = {
  asin: string;
  chunkId: string;
  steps: PipelineStep[];
  positionRange: ChunkPipelinePositionRange;
  artifactsDir: string;
  audioDurationSeconds?: number;
};

const MIN_EXISTING_RANGE_REMAINING_POSITIONS = 3000;

/** Runs the download/OCR/audio stages for a Kindle chunk while skipping cached work. */
export async function runChunkPipeline(
  options: RunChunkPipelineOptions
): Promise<ChunkPipelineState> {
  const DEFAULT_RENDER_NUM_PAGES = 5;
  const DEFAULT_RENDER_SKIP_PAGES = 0;
  const DEFAULT_OCR_MAX_PAGES = 5;

  log.debug({ asin: options.asin, startingPosition: options.startingPosition }, "Determining pipeline steps");
  const plan = await determineSteps({
    asin: options.asin,
    startingPosition: options.startingPosition,
    audioProvider: options.audioProvider,
    skipLlmPreprocessing: options.skipLlmPreprocessing ?? false,
  });
  log.debug(
    { needsDownload: plan.needsDownload, needsOcr: plan.needsOcr, needsLlm: plan.needsLlm, needsAudio: plan.needsAudio },
    "Pipeline plan determined"
  );

  let activeChunk: LoadedChunk | undefined = plan.existing;
  let downloadExecuted = false;

  if (plan.needsDownload) {
    log.info({ asin: options.asin }, "Downloading chunk from Kindle");
    const downloadResult = await ensureChunkDownloaded({
      asin: options.asin,
      kindle: options.kindle,
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
    log.info({ chunkId: downloadResult.chunkId }, "Chunk downloaded");
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
    log.info({ chunkId: activeChunk.chunkId }, "Running text extraction");
    executedSteps.push("ocr");
    ocrResult = await runChunkOcr({
      chunkId: activeChunk.chunkId,
      chunkDir: activeChunk.chunkDir,
      extractDir: activeChunk.artifacts.extractDir,
      metadataPath: activeChunk.metadataPath,
      startPage: 0,
      maxPages: DEFAULT_OCR_MAX_PAGES,
    });
    log.info({ processedPages: ocrResult.processedPages }, "Text extraction complete");
  }

  let combinedTextPath =
    activeChunk.artifacts.combinedTextPath ??
    path.join(activeChunk.chunkDir, "full-content.txt");
  if (ocrResult?.combinedTextPath) {
    combinedTextPath = ocrResult.combinedTextPath;
    activeChunk.artifacts.combinedTextPath = combinedTextPath;
  }

  // Run LLM preprocessing as a separate step if needed
  const providerContentPath = path.join(activeChunk.chunkDir, `${options.audioProvider}-content.txt`);
  const shouldRunLlm = plan.needsLlm || shouldRunOcr;
  if (shouldRunLlm && !options.skipLlmPreprocessing) {
    log.info({ chunkId: activeChunk.chunkId, provider: options.audioProvider }, "Running LLM preprocessing");
    executedSteps.push("llm");
    const originalText = await fs.readFile(combinedTextPath, "utf8");
    const transformedText = await transformTextForTTS(originalText, options.audioProvider);
    await fs.writeFile(providerContentPath, transformedText, "utf8");
    log.info({ outputLength: transformedText.length }, "LLM preprocessing complete");
  }

  let audioResult: ChunkAudioSummary | undefined;
  let audioDurationSeconds: number | undefined;
  const shouldRunAudio = plan.needsAudio || shouldRunLlm;
  if (shouldRunAudio && targetRange) {
    log.info({ chunkId: activeChunk.chunkId, provider: options.audioProvider }, "Generating audio");
    executedSteps.push("audio");
    const generateAudio = options.audioProvider === "elevenlabs"
      ? generateElevenLabsAudio
      : generateCartesiaAudio;
    audioResult = await generateAudio({
      asin: activeChunk.asin,
      chunkId: activeChunk.chunkId,
      chunkDir: activeChunk.chunkDir,
      range: targetRange,
      combinedTextPath,
      skipLlmPreprocessing: true, // LLM step already ran if needed
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
    audioDurationSeconds = audioResult.totalDurationSeconds;
    log.info({ durationSeconds: audioDurationSeconds }, "Audio generation complete");
  }

  if (audioDurationSeconds === undefined) {
    try {
      const benchmarks = await openBenchmarkPayload(
        activeChunk.asin,
        activeChunk.chunkId,
      );
      audioDurationSeconds = benchmarks.totalDurationSeconds;
    } catch {
      // Leave audioDurationSeconds undefined if benchmarks cannot be loaded.
    }
  }

  const positionRange = resolveChunkPositionRange(
    activeChunk.metadata,
    activeChunk.chunkId,
  );

  return {
    asin: activeChunk.asin,
    chunkId: activeChunk.chunkId,
    steps: executedSteps,
    positionRange,
    artifactsDir: activeChunk.artifacts.extractDir,
    ...(audioDurationSeconds !== undefined
      ? { audioDurationSeconds }
      : {}),
  };
}

/** Picks the Kindle position range for the current chunk to avoid shipping full metadata. */
function resolveChunkPositionRange(
  metadata: RendererCoverageMetadata,
  chunkId: string,
): ChunkPipelinePositionRange {
  const candidates = metadata.ranges;
  const target = candidates.find((range) => range.id === chunkId);
  const chosen = target ?? candidates[0];
  if (!chosen) {
    throw new Error(`Chunk ${chunkId} is missing coverage metadata`);
  }
  return {
    startPositionId: chosen.start.positionId,
    endPositionId: chosen.end.positionId,
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
  needsLlm: boolean;
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
  audioProvider: "cartesia" | "elevenlabs";
  skipLlmPreprocessing: boolean;
}): Promise<StepPlan> {
  const rawStart = String(options.startingPosition ?? "").trim();
  const requestPositionId = Number.parseInt(rawStart, 10);
  if (!Number.isFinite(requestPositionId)) {
    throw new Error("Invalid starting position");
  }

  const existing = await findExistingChunk({
    asin: options.asin,
    requestPositionId: Math.trunc(requestPositionId),
  });
  if (!existing) {
    return { needsDownload: true, needsOcr: true, needsLlm: !options.skipLlmPreprocessing, needsAudio: true };
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
      needsLlm: !options.skipLlmPreprocessing,
      needsAudio: true,
      existing: loaded,
    };
  }

  // Check if provider-specific LLM-preprocessed content exists
  const providerContentPath = path.join(
    existing.chunkDir,
    `${options.audioProvider}-content.txt`
  );
  const hasLlmContent = options.skipLlmPreprocessing
    ? true
    : await statMatches(providerContentPath, (stats) => stats.isFile());

  const hasAudio = artifacts.audioPath
    ? await statMatches(artifacts.audioPath, (stats) => stats.isFile())
    : false;

  return {
    needsDownload: false,
    needsOcr: false,
    needsLlm: !hasLlmContent,
    needsAudio: !hasAudio,
    existing: loaded,
  };
}

/** Finds a chunk in data/books/[asin] covering the requested start offset, if it exists. */
async function findExistingChunk(options: {
  asin: string;
  requestPositionId: number;
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
  requestPositionId: number;
}): CoverageRange | undefined {
  const { metadata, requestPositionId } = options;
  for (const range of metadata.ranges) {
    const withinRange =
      range.start.positionId === requestPositionId ||
      (requestPositionId >= range.start.positionId &&
        requestPositionId <= range.end.positionId);
    if (!withinRange) {
      continue;
    }

    const remainingPositions = range.end.positionId - requestPositionId;
    if (remainingPositions > MIN_EXISTING_RANGE_REMAINING_POSITIONS) {
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
