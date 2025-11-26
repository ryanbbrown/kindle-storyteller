/**
 * Shared utilities for TTS audio generation services.
 * Used by both elevenlabs-audio.ts and cartesia-audio.ts.
 */
import fs from "node:fs/promises";

import {
  readChunkMetadata,
  writeChunkMetadata,
} from "../chunk-metadata-service.js";
import type { RendererCoverageMetadata } from "../../types/chunk-metadata.js";
import type { ChunkAudioSummary } from "../../types/audio.js";

/** Normalizes whitespace and tracks original indices for each character. */
export function normalizeTextWithMap(input: string): {
  normalized: string;
  map: number[];
} {
  let normalized = "";
  const map: number[] = [];

  for (let index = 0; index < input.length; index += 1) {
    let char = input[index];

    if (char === "\r") {
      continue;
    }

    if (/\s/.test(char)) {
      char = " ";
    }

    normalized += char;
    map.push(index);
  }

  return { normalized, map };
}

/** Picks a slice length that ends on the target sentence count. */
export function computeSentenceSliceLength(
  text: string,
  targetSentences: number,
): number {
  const cap = Math.max(1, text.length);
  if (!Number.isFinite(targetSentences) || targetSentences <= 0) {
    return cap;
  }

  let sentences = 0;
  for (let index = 0; index < cap; index += 1) {
    const char = text[index];
    if (char === "." || char === "!" || char === "?") {
      sentences += 1;
      if (sentences >= targetSentences) {
        return index + 1;
      }
    }
  }

  return cap;
}

/** Builds a linear mapping from character indices to Kindle position IDs. */
export function buildCharToPositionIdMap(options: {
  textLength: number;
  startPositionId: number;
  endPositionId: number;
}): number[] {
  const { textLength, startPositionId, endPositionId } = options;
  if (!Number.isFinite(startPositionId) || !Number.isFinite(endPositionId)) {
    throw new Error("Chunk metadata is missing Kindle position ids");
  }
  if (textLength <= 0) {
    return [];
  }

  const steps = Math.max(textLength - 1, 1);
  const span = endPositionId - startPositionId;
  const result = new Array<number>(textLength);

  for (let index = 0; index < textLength; index += 1) {
    const ratio = steps === 0 ? 0 : index / steps;
    const value = Math.round(startPositionId + span * ratio);
    result[index] = value;
  }

  return result;
}

/** Calculates proportional end position based on how much text was processed. */
export function computeProportionalEndPosition(options: {
  processedTextLength: number;
  fullTextLength: number;
  startPositionId: number;
  endPositionId: number;
}): number {
  const { processedTextLength, fullTextLength, startPositionId, endPositionId } = options;
  if (fullTextLength <= 0) {
    return startPositionId;
  }
  const processedRatio = processedTextLength / fullTextLength;
  const fullSpan = endPositionId - startPositionId;
  return Math.round(startPositionId + fullSpan * processedRatio);
}

/** Builds the timeline of timestamps at which benchmarks should be recorded. */
export function buildBenchmarkTimeline(
  totalDurationSeconds: number,
  intervalSeconds: number,
): number[] {
  const times: number[] = [];
  for (
    let t = 0;
    t <= totalDurationSeconds;
    t += Math.max(intervalSeconds, 0.1)
  ) {
    times.push(Number(t.toFixed(3)));
  }

  return times;
}

/** Stores the generated audio artifacts back onto the chunk metadata record. */
export async function recordChunkAudioArtifacts(options: {
  metadataPath: string;
  metadata?: RendererCoverageMetadata;
  chunkId: string;
  summary: ChunkAudioSummary;
}): Promise<RendererCoverageMetadata | undefined> {
  const {
    metadataPath,
    metadata: providedMetadata,
    chunkId,
    summary,
  } = options;
  const metadata =
    providedMetadata ?? (await readChunkMetadata(metadataPath));
  if (!metadata) {
    return undefined;
  }

  const targetRange = metadata.ranges.find((range) => range.id === chunkId);
  if (!targetRange) {
    return metadata;
  }

  targetRange.artifacts.audioPath = summary.audioPath;
  targetRange.artifacts.audioAlignmentPath = summary.alignmentPath;
  targetRange.artifacts.audioBenchmarksPath = summary.benchmarksPath;
  const now = new Date().toISOString();
  metadata.updatedAt = now;
  targetRange.updatedAt = now;
  await writeChunkMetadata(metadataPath, metadata);
  return metadata;
}
