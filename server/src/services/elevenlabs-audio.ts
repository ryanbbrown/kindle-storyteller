/**
 * - generateChunkPreviewAudio: exported entry reading text, limiting it via resolveSliceCap/computeSentenceSliceLength, calling getElevenLabsClient, and persisting artifacts with buildBenchmark helpers.
 * - recordChunkAudioArtifacts: updates metadata with the paths emitted by generateChunkPreviewAudio for later reuse.
 * - resolveSliceCap: combines overrides and env caps before computeSentenceSliceLength decides the slice length.
 * - normalizeTextWithMap: preprocesses text and produces char maps consumed by generateChunkPreviewAudio and buildBenchmarks.
 * - computeSentenceSliceLength: selects the normalized text span used for TTS.
 * - buildBenchmarkTimeline: defines benchmark timestamps that collectSamples converts into alignment indices.
 * - collectSamples: maps alignment data to benchmark entries before buildBenchmarks composes Kindle offsets.
 * - buildBenchmarks: ties timestamps to Kindle offsets, leveraging convertOffsetToRaw and normalization maps.
 * - convertOffsetToRaw: converts numeric offsets into Kindle "major;minor" strings for metadata.
 * - getElevenLabsClient: lazily creates the ElevenLabs SDK client consumed by generateChunkPreviewAudio.
 */
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs/promises";
import path from "node:path";

import {
  readChunkMetadata,
  writeChunkMetadata,
} from "./chunk-metadata-service.js";
import type {
  CoverageRange,
  RendererCoverageMetadata,
} from "../types/chunk-metadata.js";
import { getElevenLabsAudioConfig } from "../config/elevenlabs.js";

// Reuse a single SDK client so we do not re-auth on every request.
let cachedElevenLabsClient: ElevenLabsClient | undefined;

export type BenchmarkEntry = {
  timeSeconds: number;
  charIndexStart: number;
  charIndexEnd: number;
  kindleOffsetStart: number;
  kindleOffsetEnd: number;
  kindleRawStart: string;
  kindleRawEnd: string;
  textNormalized: string;
  textOriginal: string;
};

export type ChunkAudioSummary = {
  asin: string;
  chunkId: string;
  audioPath: string;
  alignmentPath: string;
  benchmarksPath: string;
  textLength: number;
  totalDurationSeconds: number;
  benchmarkIntervalSeconds: number;
};

export type GenerateChunkAudioOptions = {
  asin: string;
  chunkId: string;
  chunkDir: string;
  range: CoverageRange;
  combinedTextPath: string;
  maxCharactersOverride?: number;
};

/** Generates preview audio plus metadata for a single chunk of Kindle text. */
export async function generateChunkPreviewAudio(
  options: GenerateChunkAudioOptions,
): Promise<ChunkAudioSummary> {
  const {
    asin,
    chunkId,
    chunkDir,
    range,
    combinedTextPath,
    maxCharactersOverride,
  } = options;

  // Pull env-driven limits/model settings once per process.
  const config = getElevenLabsAudioConfig();

  await fs.access(combinedTextPath);
  const rawText = await fs.readFile(combinedTextPath, "utf8");
  const { normalized: normalizedText, map: normalizedMap } =
    normalizeTextWithMap(rawText);

  // Respect overrides/env caps while trying to hit the target sentence count.
  const userCap = resolveSliceCap(
    normalizedText.length,
    maxCharactersOverride,
    config.maxCharacters,
  );
  const sliceLength = computeSentenceSliceLength(
    normalizedText,
    config.sentenceTarget,
    Math.min(config.sentenceMaxChars, userCap),
  );
  const textForTts = normalizedText.slice(0, sliceLength);
  const charToOriginalIndex = normalizedMap.slice(0, sliceLength);

  // Bail early if the normalized slice ended up empty.
  if (!textForTts.trim()) {
    throw new Error(
      `Text content for ${chunkId} (ASIN ${asin}) is empty after normalization`,
    );
  }

  // Ask ElevenLabs for both audio bytes and per-character timestamps.
  const { audioBase64, alignment, normalizedAlignment } =
    await getElevenLabsClient().textToSpeech.convertWithTimestamps(
      config.voiceId,
      {
        text: textForTts,
        modelId: config.modelId,
        outputFormat: config.outputFormat,
      },
    );

  const activeAlignment = alignment ?? normalizedAlignment;
  if (!activeAlignment?.characterStartTimesSeconds?.length) {
    throw new Error("Timestamp alignment data was not returned by ElevenLabs");
  }

  // Sanity check that ElevenLabs aligned against the exact text we sent.
  if (activeAlignment.characters.length !== textForTts.length) {
    const alignmentText = activeAlignment.characters.join("");
    if (alignmentText !== textForTts) {
      throw new Error(
        `Mismatch between alignment characters (${activeAlignment.characters.length}) and generated text (${textForTts.length})`,
      );
    }
  }

  // Convert the base64 payload to a buffer and derive total duration.
  const audioBuffer = Buffer.from(audioBase64, "base64");
  const totalDurationSeconds =
    activeAlignment.characterEndTimesSeconds[
      activeAlignment.characterEndTimesSeconds.length - 1
    ];

  // Map every normalized char back to its Kindle source offset.
  const charToKindleOffset = charToOriginalIndex.map(
    (originalIndex) => range.start.offset + originalIndex,
  );

  const processedRawLength =
    charToOriginalIndex.length > 0
      ? charToOriginalIndex[charToOriginalIndex.length - 1] + 1
      : 0;
  const processedKindleEndOffset = range.start.offset + processedRawLength;

  // Build benchmark records so the client can scrub audio deterministically.
  const benchmarkTimes = buildBenchmarkTimeline(
    totalDurationSeconds,
    config.benchmarkIntervalSeconds,
  );
  const samples = collectSamples(activeAlignment, benchmarkTimes);
  const benchmarks = buildBenchmarks({
    samples,
    textForTts,
    rawText,
    charToOriginalIndex,
    charToKindleOffset,
    processedRawLength,
    processedKindleEndOffset,
    totalDurationSeconds,
  });

  const audioDir = path.join(chunkDir, "audio");
  await fs.mkdir(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "audio.mp3");
  const alignmentPath = path.join(audioDir, "alignment.json");
  const benchmarksPath = path.join(audioDir, "benchmarks.json");

  // Persist audio + metadata that downstream services expect.
  await fs.writeFile(audioPath, audioBuffer);

  const alignmentPayload = {
    asin,
    chunkId,
    voiceId: config.voiceId,
    modelId: config.modelId,
    outputFormat: config.outputFormat,
    chunkStartOffset: range.start.offset,
    textLength: textForTts.length,
    totalDurationSeconds,
    charToKindleOffset,
    alignment: alignment ?? normalizedAlignment,
  };
  await fs.writeFile(
    alignmentPath,
    JSON.stringify(alignmentPayload, null, 2),
    "utf8",
  );

  const benchmarkPayload = {
    asin,
    chunkId,
    benchmarkIntervalSeconds: config.benchmarkIntervalSeconds,
    totalDurationSeconds,
    maxCharacters: sliceLength,
    audioPath,
    alignmentPath,
    benchmarks,
  };
  await fs.writeFile(
    benchmarksPath,
    JSON.stringify(benchmarkPayload, null, 2),
    "utf8",
  );

  return {
    asin,
    chunkId,
    audioPath,
    alignmentPath,
    benchmarksPath,
    textLength: textForTts.length,
    totalDurationSeconds,
    benchmarkIntervalSeconds: config.benchmarkIntervalSeconds,
  };
}

/** Stores the generated audio artifacts back onto the chunk metadata record. */
export async function recordChunkAudioArtifacts(options: {
  metadataPath: string;
  metadata?: RendererCoverageMetadata;
  chunkId: string;
  summary: ChunkAudioSummary;
}): Promise<RendererCoverageMetadata | undefined> {
  const { metadataPath, metadata: providedMetadata, chunkId, summary } = options;
  const metadata =
    providedMetadata ?? (await readChunkMetadata(metadataPath));
  if (!metadata) {
    return undefined;
  }

  // Attach the generated artifact paths to the matching coverage range.
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

/** Determines the maximum character slice allowed by overrides/env caps. */
function resolveSliceCap(
  textLength: number,
  override: number | undefined,
  envCap: number | undefined,
): number {
  // Prefer caller overrides, fall back to env caps, otherwise use full text.
  if (override !== undefined) {
    if (!Number.isFinite(override)) {
      throw new Error("Invalid max character override value");
    }
    return Math.min(Math.max(Math.trunc(override), 1), textLength);
  }
  if (envCap !== undefined) {
    return Math.min(Math.max(envCap, 1), textLength);
  }
  return textLength;
}

/** Normalizes whitespace and tracks original indices for each character. */
function normalizeTextWithMap(input: string): {
  normalized: string;
  map: number[];
} {
  let normalized = "";
  const map: number[] = [];

  for (let index = 0; index < input.length; index += 1) {
    let char = input[index];

    // Drop carriage returns so offsets match OSX/Linux alike.
    if (char === "\r") {
      continue;
    }

    // Collapse any whitespace run into a single space.
    if (/\s/.test(char)) {
      char = " ";
    }

    normalized += char;
    map.push(index);
  }

  return { normalized, map };
}

/** Picks a slice length that ends on the target sentence count within a cap. */
function computeSentenceSliceLength(
  text: string,
  targetSentences: number,
  hardCap: number,
): number {
  const cap = Math.max(1, Math.min(hardCap, text.length));
  if (!Number.isFinite(targetSentences) || targetSentences <= 0) {
    return cap;
  }

  let sentences = 0;
  for (let index = 0; index < text.length && index < cap; index += 1) {
    const char = text[index];
    if (char === "." || char === "!" || char === "?") {
      sentences += 1;
      if (sentences >= targetSentences) {
        let end = index + 1;
        // Finish the sentence but skip trailing whitespace.
        while (end < text.length && end < cap && /\s/.test(text[end])) {
          end += 1;
        }
        return Math.min(Math.max(end, 1), cap);
      }
    }
  }

  return cap;
}

/** Builds the timeline of timestamps at which benchmarks should be recorded. */
function buildBenchmarkTimeline(
  totalDurationSeconds: number,
  intervalSeconds: number,
): number[] {
  const times: number[] = [];
  for (
    let t = 0;
    t <= totalDurationSeconds;
    t += Math.max(intervalSeconds, 0.1)
  ) {
    // Round to milliseconds to keep payload small but precise.
    times.push(Number(t.toFixed(3)));
  }

  if (times[times.length - 1] !== totalDurationSeconds) {
    times.push(Number(totalDurationSeconds.toFixed(3)));
  }

  return times;
}

/** Maps each benchmark timestamp to the nearest preceding character index. */
function collectSamples(
  alignment: {
    characterStartTimesSeconds: number[];
  },
  times: number[],
): { timeSeconds: number; charIndex: number }[] {
  const samples: { timeSeconds: number; charIndex: number }[] = [];
  let cursor = 0;

  for (const time of times) {
    // Advance until we find the first character after the current timestamp.
    while (
      cursor < alignment.characterStartTimesSeconds.length &&
      alignment.characterStartTimesSeconds[cursor] <= time
    ) {
      cursor += 1;
    }

    samples.push({
      timeSeconds: time,
      charIndex: Math.max(0, cursor - 1),
    });
  }

  return samples;
}

/** Generates benchmark entries tying timestamps back to Kindle offsets. */
function buildBenchmarks(options: {
  samples: Array<{ timeSeconds: number; charIndex: number }>;
  textForTts: string;
  rawText: string;
  charToOriginalIndex: number[];
  charToKindleOffset: number[];
  processedRawLength: number;
  processedKindleEndOffset: number;
  totalDurationSeconds: number;
}): BenchmarkEntry[] {
  const {
    samples,
    textForTts,
    rawText,
    charToOriginalIndex,
    charToKindleOffset,
    processedRawLength,
    processedKindleEndOffset,
    totalDurationSeconds,
  } = options;

  const benchmarks: BenchmarkEntry[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index];
    const next =
      index + 1 < samples.length
        ? samples[index + 1]
        : { timeSeconds: totalDurationSeconds, charIndex: textForTts.length };

    const startCharIndex = current.charIndex;
    const endCharIndex = Math.min(
      textForTts.length,
      Math.max(startCharIndex + 1, next.charIndex),
    );

    const startOriginalIndex = charToOriginalIndex[startCharIndex];
    const endOriginalIndex =
      endCharIndex < charToOriginalIndex.length
        ? charToOriginalIndex[endCharIndex]
        : processedRawLength;

    // Kindle offsets mirror what the renderer expects for jump navigation.
    const kindleOffsetStart =
      charToKindleOffset[startCharIndex] ?? processedKindleEndOffset;
    const kindleOffsetEnd =
      endCharIndex < charToKindleOffset.length
        ? charToKindleOffset[endCharIndex]
        : processedKindleEndOffset;

    benchmarks.push({
      timeSeconds: Number(current.timeSeconds.toFixed(3)),
      charIndexStart: startCharIndex,
      charIndexEnd: endCharIndex,
      kindleOffsetStart,
      kindleOffsetEnd,
      kindleRawStart: convertOffsetToRaw(kindleOffsetStart),
      kindleRawEnd: convertOffsetToRaw(kindleOffsetEnd),
      textNormalized: textForTts.slice(startCharIndex, endCharIndex),
      textOriginal: rawText
        .slice(startOriginalIndex, endOriginalIndex)
        .replace(/\s+/g, " ")
        .trim(),
    });
  }

  return benchmarks;
}

/** Converts an absolute Kindle offset into the raw "major;minor" string. */
function convertOffsetToRaw(offset: number): string {
  const major = Math.floor(offset / 1000);
  const minor = offset % 1000;
  // Kindle raw offsets are e.g. "123;456".
  return `${major};${minor}`;
}

/** Lazily creates and caches the ElevenLabs SDK client. */
function getElevenLabsClient(): ElevenLabsClient {
  if (cachedElevenLabsClient) {
    return cachedElevenLabsClient;
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY environment variable");
  }
  // Lazily instantiate the SDK with the user's API key.
  cachedElevenLabsClient = new ElevenLabsClient({ apiKey });
  return cachedElevenLabsClient;
}
