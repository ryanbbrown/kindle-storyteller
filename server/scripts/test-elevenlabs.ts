/**
 * Test script for ElevenLabs TTS implementation.
 * Converts first 500 characters of sample text to audio.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { getElevenLabsAudioConfig } from "../src/config/elevenlabs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SAMPLE_TEXT_PATH = path.resolve(
  __dirname,
  "../data/books/B0CPWQZNQB/chunks/chunk_pid_9584_17525/full-content.txt",
);
const OUTPUT_DIR = path.resolve(__dirname, "../data/elevenlabs-test");
const CHAR_LIMIT = 500;

/** Normalizes whitespace and tracks original indices for each character. */
function normalizeTextWithMap(input: string): {
  normalized: string;
  map: number[];
} {
  let normalized = "";
  const map: number[] = [];

  for (let index = 0; index < input.length; index += 1) {
    let char = input[index];
    if (char === "\r") continue;
    if (/\s/.test(char)) char = " ";
    normalized += char;
    map.push(index);
  }

  return { normalized, map };
}

/** Builds benchmark entries from character-level alignment data. */
function buildBenchmarks(options: {
  alignment: {
    characters: string[];
    characterStartTimesSeconds: number[];
    characterEndTimesSeconds: number[];
  };
  textForTts: string;
  rawText: string;
  charToOriginalIndex: number[];
  charToKindlePositionId: number[];
  endPositionId: number;
  totalDurationSeconds: number;
  benchmarkIntervalSeconds: number;
}) {
  const {
    alignment,
    textForTts,
    rawText,
    charToOriginalIndex,
    charToKindlePositionId,
    endPositionId,
    totalDurationSeconds,
    benchmarkIntervalSeconds,
  } = options;

  // Build benchmark timeline (don't add totalDurationSeconds - last interval extends to end)
  const times: number[] = [];
  for (let t = 0; t <= totalDurationSeconds; t += benchmarkIntervalSeconds) {
    times.push(Number(t.toFixed(3)));
  }

  // Collect samples at each benchmark time
  const samples: { timeSeconds: number; charIndex: number }[] = [];
  let cursor = 0;
  for (const time of times) {
    while (
      cursor < alignment.characterStartTimesSeconds.length &&
      alignment.characterStartTimesSeconds[cursor] <= time
    ) {
      cursor += 1;
    }
    samples.push({ timeSeconds: time, charIndex: Math.max(0, cursor - 1) });
  }

  // Build benchmark entries
  const processedRawLength =
    charToOriginalIndex.length > 0
      ? charToOriginalIndex[charToOriginalIndex.length - 1] + 1
      : 0;

  const benchmarks = [];
  for (let i = 0; i < samples.length; i++) {
    const current = samples[i];
    const next =
      i + 1 < samples.length
        ? samples[i + 1]
        : { timeSeconds: totalDurationSeconds, charIndex: textForTts.length };

    const startCharIndex = current.charIndex;
    const endCharIndex = Math.min(
      textForTts.length,
      Math.max(startCharIndex + 1, next.charIndex),
    );

    const startOriginalIndex = charToOriginalIndex[startCharIndex] ?? 0;
    const endOriginalIndex =
      endCharIndex < charToOriginalIndex.length
        ? charToOriginalIndex[endCharIndex]
        : processedRawLength;

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

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("Error: ELEVENLABS_API_KEY environment variable not set");
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

  const config = getElevenLabsAudioConfig();
  console.log("Using config:", {
    voiceId: config.voiceId,
    modelId: config.modelId,
    outputFormat: config.outputFormat,
  });
  console.log("\nCalling ElevenLabs TTS API...\n");

  const client = new ElevenLabsClient({ apiKey });
  const { audioBase64, alignment, normalizedAlignment } =
    await client.textToSpeech.convertWithTimestamps(config.voiceId, {
      text: textForTts,
      modelId: config.modelId,
      outputFormat: config.outputFormat,
    });

  const activeAlignment = alignment ?? normalizedAlignment;
  if (!activeAlignment?.characterStartTimesSeconds?.length) {
    console.error("No alignment data returned");
    process.exit(1);
  }

  console.log("API call complete!");

  const audioBuffer = Buffer.from(audioBase64, "base64");
  const totalDurationSeconds =
    activeAlignment.characterEndTimesSeconds[
      activeAlignment.characterEndTimesSeconds.length - 1
    ];

  console.log(`\nAudio size: ${audioBuffer.length} bytes`);
  console.log(`Total duration: ${totalDurationSeconds.toFixed(2)} seconds`);
  console.log(`Character count: ${activeAlignment.characters.length}`);

  // Build fake position IDs for testing (start=0, end=textLength)
  const charToKindlePositionId = charToOriginalIndex.map((_, i) =>
    Math.round((i / (charToOriginalIndex.length - 1)) * textForTts.length),
  );

  // Build benchmarks
  const benchmarks = buildBenchmarks({
    alignment: activeAlignment,
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
  const audioPath = path.join(OUTPUT_DIR, "audio.mp3");
  const alignmentPath = path.join(OUTPUT_DIR, "alignment.json");
  const benchmarksPath = path.join(OUTPUT_DIR, "benchmarks.json");

  await fs.writeFile(audioPath, audioBuffer);
  await fs.writeFile(
    alignmentPath,
    JSON.stringify(
      {
        voiceId: config.voiceId,
        modelId: config.modelId,
        outputFormat: config.outputFormat,
        textLength: textForTts.length,
        totalDurationSeconds,
        alignment: activeAlignment,
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

  console.log(`\nSaved audio to: ${audioPath}`);
  console.log(`Saved alignment to: ${alignmentPath}`);
  console.log(`Saved benchmarks to: ${benchmarksPath}`);

  // Print sample of character timestamps
  console.log("\nFirst 10 character timestamps:");
  for (let i = 0; i < Math.min(10, activeAlignment.characters.length); i++) {
    console.log(
      `  "${activeAlignment.characters[i]}": ${activeAlignment.characterStartTimesSeconds[i].toFixed(3)}s - ${activeAlignment.characterEndTimesSeconds[i].toFixed(3)}s`,
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
