/**
 * ElevenLabs TTS audio generation service with character-level timestamp support.
 */
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "node:fs/promises";
import path from "node:path";

import {
  normalizeTextWithMap,
  computeSentenceSliceLength,
  buildCharToPositionIdMap,
  computeProportionalEndPosition,
  buildBenchmarkTimeline,
  recordChunkAudioArtifacts,
} from "./audio-utils.js";
import type {
  BenchmarkEntry,
  ChunkAudioSummary,
  GenerateChunkAudioOptions,
} from "../types/audio.js";
import { getElevenLabsAudioConfig } from "../config/elevenlabs.js";

export { recordChunkAudioArtifacts };
export type { BenchmarkEntry, ChunkAudioSummary, GenerateChunkAudioOptions };

// Reuse a single SDK client so we do not re-auth on every request.
let cachedElevenLabsClient: ElevenLabsClient | undefined;

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
  } = options;

  // Pull env-driven limits/model settings once per process.
  const config = getElevenLabsAudioConfig();

  await fs.access(combinedTextPath);
  const rawText = await fs.readFile(combinedTextPath, "utf8");
  const { normalized: normalizedText, map: normalizedMap } =
    normalizeTextWithMap(rawText);

  // Respect overrides/env caps while trying to hit the target sentence count.
  const sliceLength = computeSentenceSliceLength(
    normalizedText,
    config.sentenceTarget,
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

  const proportionalEndPositionId = computeProportionalEndPosition({
    processedTextLength: textForTts.length,
    fullTextLength: normalizedText.length,
    startPositionId: range.start.positionId,
    endPositionId: range.end.positionId,
  });

  const charToKindlePositionId = buildCharToPositionIdMap({
    textLength: charToOriginalIndex.length,
    startPositionId: range.start.positionId,
    endPositionId: proportionalEndPositionId,
  });

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
    charToKindlePositionId,
    endPositionId: proportionalEndPositionId,
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
    chunkStartPositionId: range.start.positionId,
    textLength: textForTts.length,
    totalDurationSeconds,
    charToKindlePositionId,
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

/** Generates benchmark entries tying timestamps back to Kindle position ids. */
function buildBenchmarks(options: {
  samples: Array<{ timeSeconds: number; charIndex: number }>;
  textForTts: string;
  rawText: string;
  charToOriginalIndex: number[];
  charToKindlePositionId: number[];
  endPositionId: number;
  totalDurationSeconds: number;
}): BenchmarkEntry[] {
  const {
    samples,
    textForTts,
    rawText,
    charToOriginalIndex,
    charToKindlePositionId,
    endPositionId,
    totalDurationSeconds,
  } = options;

  const processedRawLength =
    charToOriginalIndex.length > 0
      ? charToOriginalIndex[charToOriginalIndex.length - 1] + 1
      : 0;

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

    // Kindle position ids mirror what the rest of the system expects for jump navigation.
    const kindlePositionIdStart =
      charToKindlePositionId[startCharIndex] ?? endPositionId;
    const kindlePositionIdEnd =
      endCharIndex < charToKindlePositionId.length
        ? charToKindlePositionId[endCharIndex]
        : endPositionId;

    benchmarks.push({
      timeSeconds: Number(current.timeSeconds.toFixed(3)),
      charIndexStart: startCharIndex,
      charIndexEnd: endCharIndex,
      kindlePositionIdStart,
      kindlePositionIdEnd,
      textNormalized: textForTts.slice(startCharIndex, endCharIndex),
      textOriginal: rawText
        .slice(startOriginalIndex, endOriginalIndex)
        .replace(/\s+/g, " ")
        .trim(),
    });
  }

  return benchmarks;
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
