/**
 * Cartesia TTS audio generation service with word-level timestamp support.
 * Mirrors elevenlabs-audio.ts but adapts for Cartesia's word-level (not character-level) timestamps.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import {
  readChunkMetadata,
  writeChunkMetadata,
} from "./chunk-metadata-service.js";
import type { RendererCoverageMetadata } from "../types/chunk-metadata.js";
import type {
  BenchmarkEntry,
  ChunkAudioSummary,
  GenerateChunkAudioOptions,
  WordTimestamps,
} from "../types/audio.js";
import { getCartesiaAudioConfig } from "../config/cartesia.js";

export type { BenchmarkEntry, ChunkAudioSummary, GenerateChunkAudioOptions };

type CartesiaSSEEvent =
  | { type: "chunk"; data: string }
  | { type: "timestamps"; word_timestamps: WordTimestamps }
  | { type: "done" };

/** Generates preview audio plus metadata for a single chunk using Cartesia TTS. */
export async function generateChunkPreviewAudio(
  options: GenerateChunkAudioOptions,
): Promise<ChunkAudioSummary> {
  const { asin, chunkId, chunkDir, range, combinedTextPath } = options;

  const config = getCartesiaAudioConfig();

  await fs.access(combinedTextPath);
  const rawText = await fs.readFile(combinedTextPath, "utf8");
  const { normalized: normalizedText, map: normalizedMap } =
    normalizeTextWithMap(rawText);

  const sliceLength = computeSentenceSliceLength(
    normalizedText,
    config.sentenceTarget,
  );
  const textForTts = normalizedText.slice(0, sliceLength);
  const charToOriginalIndex = normalizedMap.slice(0, sliceLength);

  if (!textForTts.trim()) {
    throw new Error(
      `Text content for ${chunkId} (ASIN ${asin}) is empty after normalization`,
    );
  }

  const { audioBuffer, wordTimestamps, totalDurationSeconds } =
    await callCartesiaTTS(textForTts, config);

  const charToKindlePositionId = buildCharToPositionIdMap({
    textLength: charToOriginalIndex.length,
    startPositionId: range.start.positionId,
    endPositionId: range.end.positionId,
  });

  const benchmarks = buildBenchmarksFromWordTimestamps({
    wordTimestamps,
    textForTts,
    rawText,
    charToOriginalIndex,
    charToKindlePositionId,
    endPositionId: range.end.positionId,
    totalDurationSeconds,
    benchmarkIntervalSeconds: config.benchmarkIntervalSeconds,
  });

  const audioDir = path.join(chunkDir, "audio");
  await fs.mkdir(audioDir, { recursive: true });
  const wavPath = path.join(audioDir, "audio.wav");
  const audioPath = path.join(audioDir, "audio.mp3");
  const alignmentPath = path.join(audioDir, "alignment.json");
  const benchmarksPath = path.join(audioDir, "benchmarks.json");

  await fs.writeFile(wavPath, audioBuffer);
  await execFileAsync("ffmpeg", ["-y", "-i", wavPath, "-codec:a", "libmp3lame", "-qscale:a", "2", audioPath]);
  await fs.unlink(wavPath);

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
    wordTimestamps,
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

/** Converts raw PCM f32le audio to WAV format. */
export function pcmToWav(pcmBuffer: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 32;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const headerSize = 44;

  const wavBuffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  wavBuffer.write("RIFF", 0);
  wavBuffer.writeUInt32LE(36 + dataSize, 4);
  wavBuffer.write("WAVE", 8);

  // fmt sub-chunk
  wavBuffer.write("fmt ", 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(3, 20); // AudioFormat (3 = IEEE float)
  wavBuffer.writeUInt16LE(numChannels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  wavBuffer.write("data", 36);
  wavBuffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer;
}

/** Calls Cartesia SSE endpoint and collects audio chunks and timestamps. */
async function callCartesiaTTS(
  text: string,
  config: ReturnType<typeof getCartesiaAudioConfig>,
): Promise<{
  audioBuffer: Buffer;
  wordTimestamps: WordTimestamps;
  totalDurationSeconds: number;
}> {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    throw new Error("Missing CARTESIA_API_KEY environment variable");
  }

  const response = await fetch("https://api.cartesia.ai/tts/sse", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Cartesia-Version": "2025-04-16",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: config.modelId,
      transcript: text,
      voice: { mode: "id", id: config.voiceId },
      output_format: config.outputFormat,
      language: "en",
      add_timestamps: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cartesia API error (${response.status}): ${errorText}`);
  }

  const result = await collectAudioAndTimestamps(response);
  // Convert raw PCM to WAV
  const wavBuffer = pcmToWav(result.audioBuffer, config.outputFormat.sample_rate);
  return { ...result, audioBuffer: wavBuffer };
}

/** Parses SSE stream from Cartesia, collecting audio chunks and word timestamps. */
async function collectAudioAndTimestamps(response: Response): Promise<{
  audioBuffer: Buffer;
  wordTimestamps: WordTimestamps;
  totalDurationSeconds: number;
}> {
  const audioChunks: Buffer[] = [];
  const allWords: string[] = [];
  const allStarts: number[] = [];
  const allEnds: number[] = [];

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body from Cartesia");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data:")) {
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr) as CartesiaSSEEvent;

          if (event.type === "chunk" && event.data) {
            audioChunks.push(Buffer.from(event.data, "base64"));
          } else if (event.type === "timestamps" && event.word_timestamps) {
            allWords.push(...event.word_timestamps.words);
            allStarts.push(...event.word_timestamps.start);
            allEnds.push(...event.word_timestamps.end);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  }

  const audioBuffer = Buffer.concat(audioChunks);
  const wordTimestamps: WordTimestamps = {
    words: allWords,
    start: allStarts,
    end: allEnds,
  };

  const totalDurationSeconds =
    allEnds.length > 0 ? allEnds[allEnds.length - 1] : 0;

  return { audioBuffer, wordTimestamps, totalDurationSeconds };
}

/** Builds benchmarks from word-level timestamps by mapping words to character positions. */
export function buildBenchmarksFromWordTimestamps(options: {
  wordTimestamps: WordTimestamps;
  textForTts: string;
  rawText: string;
  charToOriginalIndex: number[];
  charToKindlePositionId: number[];
  endPositionId: number;
  totalDurationSeconds: number;
  benchmarkIntervalSeconds: number;
}): BenchmarkEntry[] {
  const {
    wordTimestamps,
    textForTts,
    rawText,
    charToOriginalIndex,
    charToKindlePositionId,
    endPositionId,
    totalDurationSeconds,
    benchmarkIntervalSeconds,
  } = options;

  // Build word-to-character-index mapping
  const wordCharPositions = buildWordToCharMap(
    textForTts,
    wordTimestamps.words,
  );

  // Build benchmark timeline
  const benchmarkTimes = buildBenchmarkTimeline(
    totalDurationSeconds,
    benchmarkIntervalSeconds,
  );

  const processedRawLength =
    charToOriginalIndex.length > 0
      ? charToOriginalIndex[charToOriginalIndex.length - 1] + 1
      : 0;

  const benchmarks: BenchmarkEntry[] = [];

  for (let i = 0; i < benchmarkTimes.length; i++) {
    const time = benchmarkTimes[i];
    const nextTime =
      i + 1 < benchmarkTimes.length
        ? benchmarkTimes[i + 1]
        : totalDurationSeconds;

    // Find the word that spans this benchmark time
    const wordIndex = findWordAtTime(wordTimestamps, time);
    const nextWordIndex = findWordAtTime(wordTimestamps, nextTime);

    // Get character positions for this word range
    const startCharIndex =
      wordIndex >= 0 && wordIndex < wordCharPositions.length
        ? wordCharPositions[wordIndex].start
        : 0;

    // Use start of next word (not end) to avoid overlap, matching ElevenLabs behavior
    // For the last benchmark (no next time), use textForTts.length
    const isLastBenchmark = i === benchmarkTimes.length - 1;
    const endCharIndex =
      !isLastBenchmark && nextWordIndex >= 0 && nextWordIndex < wordCharPositions.length
        ? wordCharPositions[nextWordIndex].start
        : textForTts.length;

    const clampedStart = Math.min(startCharIndex, textForTts.length - 1);
    const clampedEnd = Math.min(
      Math.max(endCharIndex, clampedStart + 1),
      textForTts.length,
    );

    const startOriginalIndex = charToOriginalIndex[clampedStart] ?? 0;
    const endOriginalIndex =
      clampedEnd < charToOriginalIndex.length
        ? charToOriginalIndex[clampedEnd]
        : processedRawLength;

    const kindlePositionIdStart =
      charToKindlePositionId[clampedStart] ?? endPositionId;
    const kindlePositionIdEnd =
      clampedEnd < charToKindlePositionId.length
        ? charToKindlePositionId[clampedEnd]
        : endPositionId;

    benchmarks.push({
      timeSeconds: Number(time.toFixed(3)),
      charIndexStart: clampedStart,
      charIndexEnd: clampedEnd,
      kindlePositionIdStart,
      kindlePositionIdEnd,
      textNormalized: textForTts.slice(clampedStart, clampedEnd),
      textOriginal: rawText
        .slice(startOriginalIndex, endOriginalIndex)
        .replace(/\s+/g, " ")
        .trim(),
    });
  }

  return benchmarks;
}

/** Maps each word from timestamps to its character position in the text. */
function buildWordToCharMap(
  text: string,
  words: string[],
): { start: number; end: number }[] {
  const positions: { start: number; end: number }[] = [];
  let searchFrom = 0;

  for (const word of words) {
    // Find this word in the text starting from our current position
    const normalizedWord = word.toLowerCase().replace(/[^\w]/g, "");
    let foundIndex = -1;

    // Search for the word allowing for punctuation differences
    for (let i = searchFrom; i < text.length; i++) {
      // Check if the word starts at position i
      let textWord = "";
      let j = i;
      while (j < text.length && !/\s/.test(text[j])) {
        textWord += text[j];
        j++;
      }
      const normalizedTextWord = textWord.toLowerCase().replace(/[^\w]/g, "");

      if (normalizedTextWord === normalizedWord) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex >= 0) {
      // Find the end of this word in the original text
      let wordEnd = foundIndex;
      while (wordEnd < text.length && !/\s/.test(text[wordEnd])) {
        wordEnd++;
      }
      positions.push({ start: foundIndex, end: wordEnd });
      searchFrom = wordEnd;
    } else {
      // Word not found - use last known position
      const lastEnd = positions.length > 0 ? positions[positions.length - 1].end : 0;
      positions.push({ start: lastEnd, end: lastEnd });
    }
  }

  return positions;
}

/** Finds the word index that contains or precedes the given time. */
function findWordAtTime(timestamps: WordTimestamps, time: number): number {
  for (let i = timestamps.start.length - 1; i >= 0; i--) {
    if (timestamps.start[i] <= time) {
      return i;
    }
  }
  return 0;
}

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
function computeSentenceSliceLength(
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
function buildCharToPositionIdMap(options: {
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
    times.push(Number(t.toFixed(3)));
  }

  // Don't add totalDurationSeconds as a separate entry - the last interval
  // will be extended to cover the full duration in buildBenchmarksFromWordTimestamps
  return times;
}
