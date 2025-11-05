import type { Kindle } from "kindle-api";

import {
  ensureChunkDownloaded,
  type EnsureChunkDownloadedResult,
  type ChunkArtifacts,
  type RendererConfig,
} from "./download.js";
import { runChunkOcr, type RunChunkOcrResult } from "./ocr.js";
import type { RendererCoverageMetadata } from "../types/chunk-metadata.js";
import { pipelineDebugLog } from "../utils/pipeline-debug-logger.js";

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
};

export async function runChunkPipeline(
  options: RunChunkPipelineOptions
): Promise<ChunkPipelineState> {
  const steps = normalizeSteps(options.steps);

  await pipelineDebugLog("pipeline.runChunkPipeline.start", {
    asin: options.asin,
    startingPosition: options.startingPosition,
    steps,
    numPages: options.numPages,
    skipPages: options.skipPages,
    ocrOptions: options.ocr,
  });

  let downloadResult: EnsureChunkDownloadedResult | undefined;
  if (requiresDownload(steps)) {
    await pipelineDebugLog("pipeline.runChunkPipeline.download.begin", {
      asin: options.asin,
    });
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
    await pipelineDebugLog("pipeline.runChunkPipeline.download.completed", {
      asin: options.asin,
      chunkId: downloadResult.chunkId,
    });
  }

  if (!downloadResult) {
    await pipelineDebugLog("pipeline.runChunkPipeline.download.missingResult", {
      asin: options.asin,
    });
    throw new Error("Chunk download step was skipped, nothing to aggregate");
  }

  let ocrResult: RunChunkOcrResult | undefined;
  if (steps.includes("ocr")) {
    await pipelineDebugLog("pipeline.runChunkPipeline.ocr.begin", {
      asin: options.asin,
      chunkId: downloadResult.chunkId,
    });
    ocrResult = await runChunkOcr({
      chunkId: downloadResult.chunkId,
      chunkDir: downloadResult.chunkDir,
      extractDir: downloadResult.artifacts.extractDir,
      metadataPath: downloadResult.metadataPath,
      startPage: options.ocr?.startPage,
      maxPages: options.ocr?.maxPages,
    });
    await pipelineDebugLog("pipeline.runChunkPipeline.ocr.completed", {
      asin: options.asin,
      chunkId: downloadResult.chunkId,
      processedPages: ocrResult.processedPages,
      totalPages: ocrResult.totalPages,
    });
  }

  await pipelineDebugLog("pipeline.runChunkPipeline.aggregate", {
    asin: downloadResult.asin,
    chunkId: downloadResult.chunkId,
    steps,
    hasOcr: Boolean(ocrResult),
  });

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
  };
}

function normalizeSteps(steps: PipelineStep[] | undefined): PipelineStep[] {
  if (!steps || steps.length === 0) {
    pipelineDebugLog("pipeline.normalizeSteps.default", {
      provided: steps,
      normalized: ["download", "ocr"],
    }).catch(() => {});
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
    pipelineDebugLog("pipeline.normalizeSteps.unsupported", {
      step,
    }).catch(() => {});
    throw new Error(`Unsupported pipeline step: ${String(step)}`);
  }
  pipelineDebugLog("pipeline.normalizeSteps.result", {
    provided: steps,
    normalized,
  }).catch(() => {});
  return normalized;
}

function requiresDownload(steps: PipelineStep[]): boolean {
  pipelineDebugLog("pipeline.requiresDownload.evaluate", {
    steps,
    requiresDownload: steps.includes("download") || steps.includes("ocr"),
  }).catch(() => {});
  return steps.includes("download") || steps.includes("ocr");
}
