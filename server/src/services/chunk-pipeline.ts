import type { Kindle } from "kindle-api";

import {
  ensureChunkDownloaded,
  type EnsureChunkDownloadedResult,
  type ChunkArtifacts,
  type RendererConfig,
} from "./download.js";
import { runChunkOcr, type RunChunkOcrResult } from "./ocr.js";
import type { RendererCoverageMetadata } from "../types/chunk-metadata.js";
import {
  generateChunkPreviewAudio,
  recordChunkAudioArtifacts,
  type ChunkAudioSummary,
} from "./elevenlabs-audio.js";

type PipelineStep = "download" | "ocr";

export type RunChunkPipelineOptions = {
  asin: string;
  kindle: Kindle;
  renderingToken: string;
  startingPosition: number | string;
  numPages?: number | string;
  skipPages?: number | string;
  steps?: PipelineStep[];
  ocr?: {
    startPage?: number;
    maxPages?: number;
  };
};

export type ChunkPipelineState = {
  asin: string;
  chunkId: string;
  rendererConfig: RendererConfig;
  manifest: unknown;
  rendererMetadata: unknown;
  toc: unknown;
  chunkDir: string;
  metadataPath: string;
  chunkMetadata: RendererCoverageMetadata;
  artifacts: ChunkArtifacts;
  steps: PipelineStep[];
  ocr?: RunChunkOcrResult;
  audio?: ChunkAudioSummary;
};

export async function runChunkPipeline(
  options: RunChunkPipelineOptions
): Promise<ChunkPipelineState> {
  const steps = normalizeSteps(options.steps);

  let downloadResult: EnsureChunkDownloadedResult | undefined;
  if (requiresDownload(steps)) {
    downloadResult = await ensureChunkDownloaded({
      asin: options.asin,
      kindle: options.kindle,
      renderingToken: options.renderingToken,
      renderOptions: {
        startingPosition: options.startingPosition,
        numPages: options.numPages,
        skipPages: options.skipPages,
      },
    });
  }

  if (!downloadResult) {
    throw new Error("Chunk download step was skipped, nothing to aggregate");
  }

  let ocrResult: RunChunkOcrResult | undefined;
  let audioResult: ChunkAudioSummary | undefined;
  if (steps.includes("ocr")) {
    ocrResult = await runChunkOcr({
      chunkId: downloadResult.chunkId,
      chunkDir: downloadResult.chunkDir,
      extractDir: downloadResult.artifacts.extractDir,
      metadataPath: downloadResult.metadataPath,
      startPage: options.ocr?.startPage,
      maxPages: options.ocr?.maxPages,
    });

    if (ocrResult?.combinedTextPath) {
      const targetRange = downloadResult.chunkMetadata.ranges.find(
        (range) => range.id === downloadResult.chunkId,
      );
      if (targetRange) {
        const combinedTextPath =
          ocrResult.combinedTextPath ?? targetRange.artifacts.combinedTextPath;
        if (combinedTextPath) {
          audioResult = await generateChunkPreviewAudio({
            asin: downloadResult.asin,
            chunkId: downloadResult.chunkId,
            chunkDir: downloadResult.chunkDir,
            range: targetRange,
            combinedTextPath,
          });

          await recordChunkAudioArtifacts({
            metadataPath: downloadResult.metadataPath,
            metadata: downloadResult.chunkMetadata,
            chunkId: downloadResult.chunkId,
            summary: audioResult,
          });

          downloadResult.artifacts.audioPath = audioResult.audioPath;
          downloadResult.artifacts.audioAlignmentPath =
            audioResult.alignmentPath;
          downloadResult.artifacts.audioBenchmarksPath =
            audioResult.benchmarksPath;
        }
      }
    }
  }

  return {
    asin: downloadResult.asin,
    chunkId: downloadResult.chunkId,
    rendererConfig: downloadResult.rendererConfig,
    manifest: downloadResult.manifest,
    rendererMetadata: downloadResult.rendererMetadata,
    toc: downloadResult.toc,
    chunkDir: downloadResult.chunkDir,
    metadataPath: downloadResult.metadataPath,
    chunkMetadata: downloadResult.chunkMetadata,
    artifacts: downloadResult.artifacts,
    steps,
    ...(ocrResult ? { ocr: ocrResult } : {}),
    ...(audioResult ? { audio: audioResult } : {}),
  };
}

function normalizeSteps(steps: PipelineStep[] | undefined): PipelineStep[] {
  if (!steps || steps.length === 0) {
    return ["download", "ocr"];
  }

  const normalized: PipelineStep[] = [];
  for (const step of steps) {
    if (step === "download" || step === "ocr") {
      if (!normalized.includes(step)) {
        normalized.push(step);
      }
      continue;
    }
    throw new Error(`Unsupported pipeline step: ${String(step)}`);
  }
  return normalized;
}

function requiresDownload(steps: PipelineStep[]): boolean {
  return steps.includes("download") || steps.includes("ocr");
}
