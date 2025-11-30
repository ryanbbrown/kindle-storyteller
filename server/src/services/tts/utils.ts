/**
 * Shared utilities for TTS audio generation services.
 * Used by both elevenlabs-audio.ts and cartesia-audio.ts.
 */
import {
  readBookMetadata,
  upsertRange,
} from "../chunk-metadata-service.js";
import type { TtsProvider } from "../../types/chunk-metadata.js";
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

export const MAX_DURATION_MINUTES = 8;

/** Computes text slice start index based on position offset within the chunk's range. */
export function computeTextStartIndex(options: {
  textLength: number;
  chunkStartPositionId: number;
  chunkEndPositionId: number;
  requestedStartPositionId: number;
}): number {
  const { textLength, chunkStartPositionId, chunkEndPositionId, requestedStartPositionId } = options;

  // If requested start is at or before chunk start, start from beginning
  if (requestedStartPositionId <= chunkStartPositionId) {
    return 0;
  }

  // If requested start is at or after chunk end, return end (will produce empty slice)
  if (requestedStartPositionId >= chunkEndPositionId) {
    return textLength;
  }

  // Calculate proportional offset into the text
  const chunkSpan = chunkEndPositionId - chunkStartPositionId;
  const offsetIntoChunk = requestedStartPositionId - chunkStartPositionId;
  const proportionalIndex = Math.round(textLength * (offsetIntoChunk / chunkSpan));

  return Math.min(proportionalIndex, textLength);
}

/** Computes text slice length for the requested duration, ending at a sentence boundary. */
export function computeTextSliceForDuration(options: {
  text: string;
  startIndex: number;
  durationMinutes: number;
}): number {
  const { text, startIndex, durationMinutes } = options;
  const remainingText = text.slice(startIndex);
  const cap = Math.max(1, remainingText.length);

  if (durationMinutes >= MAX_DURATION_MINUTES) {
    return cap;
  }

  // Duration is proportional to full chunk (8 min), so calculate target length accordingly
  const targetLength = Math.round(text.length * (durationMinutes / MAX_DURATION_MINUTES));

  // Find nearest sentence ending at or before targetLength in the remaining text
  let lastSentenceEnd = -1;
  for (let index = 0; index < targetLength && index < cap; index += 1) {
    const char = remainingText[index];
    if (char === "." || char === "!" || char === "?") {
      lastSentenceEnd = index + 1;
    }
  }

  // If no sentence boundary found, return target length (fallback)
  return lastSentenceEnd > 0 ? lastSentenceEnd : Math.min(targetLength, cap);
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
  asin: string;
  chunkId: string;
  provider: TtsProvider;
  summary: ChunkAudioSummary;
}): Promise<void> {
  const { asin, chunkId, provider, summary } = options;
  const metadata = await readBookMetadata(asin);
  if (!metadata) {
    return;
  }

  const targetRange = metadata.ranges.find((range) => range.id === chunkId);
  if (!targetRange) {
    return;
  }

  if (!targetRange.artifacts.audio) {
    targetRange.artifacts.audio = {};
  }

  if (!targetRange.artifacts.audio[provider]) {
    targetRange.artifacts.audio[provider] = [];
  }

  const artifact = {
    audioPath: summary.audioPath,
    alignmentPath: summary.alignmentPath,
    benchmarksPath: summary.benchmarksPath,
    sourceTextPath: summary.sourceTextPath,
    startPositionId: summary.startPositionId,
    endPositionId: summary.endPositionId,
    createdAt: new Date().toISOString(),
  };

  targetRange.artifacts.audio[provider]!.push(artifact);
  targetRange.updatedAt = new Date().toISOString();
  await upsertRange(asin, targetRange);
}
