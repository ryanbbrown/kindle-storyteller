/**
 * Test script for Cartesia TTS implementation.
 * Converts first 500 characters of sample text to audio.
 */
import "dotenv/config";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getCartesiaAudioConfig } from "../src/config/cartesia.js";
import {
  buildBenchmarksFromWordTimestamps,
  normalizeTextWithMap,
  pcmToWav,
} from "../src/services/cartesia-audio.js";
import type { WordTimestamps } from "../src/types/audio.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SAMPLE_TEXT_PATH = path.resolve(
  __dirname,
  "../data/books/B0CPWQZNQB/chunks/chunk_pid_9584_17525/full-content.txt",
);
const OUTPUT_DIR = path.resolve(__dirname, "../data/cartesia-test");
const CHAR_LIMIT = 500;

type CartesiaSSEEvent =
  | { type: "chunk"; data: string }
  | { type: "timestamps"; word_timestamps: WordTimestamps }
  | { type: "done" };

async function main() {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    console.error("Error: CARTESIA_API_KEY environment variable not set");
    process.exit(1);
  }

  // Read sample text
  const rawText = await fs.readFile(SAMPLE_TEXT_PATH, "utf8");
  const { normalized: normalizedText, map: normalizedMap } =
    normalizeTextWithMap(rawText);
  const slicedText = normalizedText.slice(0, CHAR_LIMIT).trimEnd();
  const textForTts = slicedText;
  const charToOriginalIndex = normalizedMap.slice(0, slicedText.length);

  console.log(`Input text (${textForTts.length} chars):\n"${textForTts}"\n`);

  const config = getCartesiaAudioConfig();
  console.log("Using config:", config);
  console.log("\nCalling Cartesia TTS API...\n");

  // Call Cartesia SSE endpoint
  const response = await fetch("https://api.cartesia.ai/tts/sse", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Cartesia-Version": "2025-04-16",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: config.modelId,
      transcript: textForTts,
      voice: { mode: "id", id: config.voiceId },
      output_format: config.outputFormat,
      language: "en",
      add_timestamps: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Cartesia API error (${response.status}): ${errorText}`);
    process.exit(1);
  }

  // Parse SSE stream
  const audioChunks: Buffer[] = [];
  const allWords: string[] = [];
  const allStarts: number[] = [];
  const allEnds: number[] = [];

  const reader = response.body?.getReader();
  if (!reader) {
    console.error("No response body from Cartesia");
    process.exit(1);
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
            process.stdout.write(".");
          } else if (event.type === "timestamps" && event.word_timestamps) {
            allWords.push(...event.word_timestamps.words);
            allStarts.push(...event.word_timestamps.start);
            allEnds.push(...event.word_timestamps.end);
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }

  console.log("\n\nStreaming complete!");

  const pcmBuffer = Buffer.concat(audioChunks);
  const wavBuffer = pcmToWav(pcmBuffer, config.outputFormat.sample_rate);
  const wordTimestamps: WordTimestamps = {
    words: allWords,
    start: allStarts,
    end: allEnds,
  };
  const totalDurationSeconds =
    allEnds.length > 0 ? allEnds[allEnds.length - 1] : 0;

  console.log(`\nRaw PCM size: ${pcmBuffer.length} bytes`);
  console.log(`WAV size: ${wavBuffer.length} bytes`);
  console.log(`Total duration: ${totalDurationSeconds.toFixed(2)} seconds`);
  console.log(`Word count: ${allWords.length}`);

  // Build fake position IDs for testing (start=0, end=textLength)
  const charToKindlePositionId = charToOriginalIndex.map((_, i) =>
    Math.round((i / (charToOriginalIndex.length - 1)) * textForTts.length),
  );

  // Build benchmarks using the real function
  const benchmarks = buildBenchmarksFromWordTimestamps({
    wordTimestamps,
    textForTts,
    rawText,
    charToOriginalIndex,
    charToKindlePositionId,
    endPositionId: textForTts.length,
    totalDurationSeconds,
    benchmarkIntervalSeconds: config.benchmarkIntervalSeconds,
  });

  // Save outputs
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const audioPath = path.join(OUTPUT_DIR, "audio.wav");
  const audioMp3Path = path.join(OUTPUT_DIR, "audio.mp3");
  const alignmentPath = path.join(OUTPUT_DIR, "alignment.json");
  const benchmarksPath = path.join(OUTPUT_DIR, "benchmarks.json");

  await fs.writeFile(audioPath, wavBuffer);

  // Convert WAV to MP3 using ffmpeg
  console.log("\nConverting WAV to MP3...");
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", audioPath,
    "-codec:a", "libmp3lame",
    "-qscale:a", "2",
    audioMp3Path,
  ]);
  const mp3Stats = await fs.stat(audioMp3Path);
  console.log(`MP3 size: ${mp3Stats.size} bytes (${((mp3Stats.size / wavBuffer.length) * 100).toFixed(1)}% of WAV)`);
  await fs.writeFile(
    alignmentPath,
    JSON.stringify(
      {
        voiceId: config.voiceId,
        modelId: config.modelId,
        outputFormat: config.outputFormat,
        textLength: textForTts.length,
        totalDurationSeconds,
        wordTimestamps,
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    benchmarksPath,
    JSON.stringify(
      {
        benchmarkIntervalSeconds: config.benchmarkIntervalSeconds,
        totalDurationSeconds,
        benchmarks,
      },
      null,
      2,
    ),
  );

  console.log(`\nSaved WAV to: ${audioPath}`);
  console.log(`Saved MP3 to: ${audioMp3Path}`);
  console.log(`Saved alignment to: ${alignmentPath}`);
  console.log(`Saved benchmarks to: ${benchmarksPath}`);

  // Print sample of word timestamps
  console.log("\nFirst 10 word timestamps:");
  for (let i = 0; i < Math.min(10, allWords.length); i++) {
    console.log(
      `  "${allWords[i]}": ${allStarts[i].toFixed(3)}s - ${allEnds[i].toFixed(3)}s`,
    );
  }

  // Print sample benchmarks
  console.log(`\nFirst 3 benchmarks (of ${benchmarks.length}):`);
  for (let i = 0; i < Math.min(3, benchmarks.length); i++) {
    const b = benchmarks[i];
    console.log(
      `  ${b.timeSeconds}s: chars ${b.charIndexStart}-${b.charIndexEnd} "${b.textNormalized.slice(0, 30)}..."`,
    );
  }
}

main().catch(console.error);
