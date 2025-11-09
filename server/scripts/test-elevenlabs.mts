import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import dotenv from 'dotenv';
import type { Dirent } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID ?? 'JBFqnCBsd6RMkjVDRZzb';
const ELEVENLABS_MODEL_ID =
  process.env.ELEVENLABS_MODEL_ID ?? 'eleven_flash_v2_5';
const OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT ?? 'mp3_44100_128';
const BENCHMARK_INTERVAL_SECONDS = Number(
  process.env.ELEVENLABS_BENCHMARK_INTERVAL_SECONDS ?? '5',
);
const DEFAULT_MAX_CHARACTERS = process.env.ELEVENLABS_MAX_CHARACTERS
  ? Number(process.env.ELEVENLABS_MAX_CHARACTERS)
  : undefined;
const DEFAULT_SENTENCE_TARGET = (() => {
  const value = Number(process.env.ELEVENLABS_SENTENCE_TARGET ?? '3');
  return Number.isFinite(value) && value > 0 ? value : 3;
})();
const SENTENCE_SLICE_MAX_CHARS = (() => {
  const value = Number(process.env.ELEVENLABS_SENTENCE_MAX_CHARS ?? '1200');
  return Number.isFinite(value) && value > 0 ? value : 1200;
})();

if (!process.env.ELEVENLABS_API_KEY) {
  throw new Error('Missing ELEVENLABS_API_KEY in server/.env');
}

interface Coverage {
  asin: string;
  ranges: CoverageRange[];
}

interface RangeBound {
  offset: number;
  raw: string;
  normalized?: string;
  positionId?: number;
}

interface RangeArtifacts {
  combinedTextPath?: string;
  [key: string]: string | undefined;
}

interface CoverageRange {
  id: string;
  start: RangeBound;
  end: RangeBound;
  artifacts: RangeArtifacts;
}

interface BenchmarkEntry {
  timeSeconds: number;
  charIndexStart: number;
  charIndexEnd: number;
  kindleOffsetStart: number;
  kindleOffsetEnd: number;
  kindleRawStart: string;
  kindleRawEnd: string;
  textNormalized: string;
  textOriginal: string;
}

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

function convertOffsetToRaw(offset: number): string {
  const major = Math.floor(offset / 1000);
  const minor = offset % 1000;
  return `${major};${minor}`;
}

function normalizeTextWithMap(input: string) {
  let normalized = '';
  const map: number[] = [];

  for (let index = 0; index < input.length; index++) {
    let char = input[index];

    if (char === '\r') {
      continue;
    }

    if (/\s/.test(char)) {
      char = ' ';
    }

    normalized += char;
    map.push(index);
  }

  return { normalized, map };
}

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
  for (let index = 0; index < text.length && index < cap; index++) {
    const char = text[index];
    if (char === '.' || char === '!' || char === '?') {
      sentences += 1;
      if (sentences >= targetSentences) {
        let end = index + 1;
        while (end < text.length && end < cap && /\s/.test(text[end])) {
          end += 1;
        }
        return Math.min(Math.max(end, 1), cap);
      }
    }
  }

  return cap;
}

async function resolveDefaultAsin(dataDir: string): Promise<string> {
  const entries = await readdir(dataDir, { withFileTypes: true });
  const asinDir = entries.find(
    (entry) => entry.isDirectory() && !entry.name.startsWith('.'),
  );

  if (!asinDir) {
    throw new Error(`No book data found in ${dataDir}`);
  }

  return asinDir.name;
}

async function loadCoverage(dataDir: string, asin: string): Promise<Coverage> {
  const chunksDir = resolve(dataDir, asin, 'chunks');
  let entries: Dirent[];

  try {
    entries = await readdir(chunksDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Unable to read chunks directory for ASIN ${asin}: ${(error as Error).message}`,
    );
  }

  const ranges: CoverageRange[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const metadataPath = resolve(chunksDir, entry.name, 'metadata.json');
    let metadataRaw: string;

    try {
      metadataRaw = await readFile(metadataPath, 'utf8');
    } catch {
      continue;
    }

    try {
      const metadata = JSON.parse(metadataRaw) as Coverage;
      if (Array.isArray(metadata.ranges)) {
        for (const range of metadata.ranges) {
          ranges.push(range);
        }
      }
    } catch {
      // Ignore malformed metadata files.
    }
  }

  if (!ranges.length) {
    throw new Error(
      `No chunk metadata ranges found for ASIN ${asin} in ${chunksDir}`,
    );
  }

  ranges.sort((a, b) => {
    const aKey = a.start.positionId ?? a.start.offset;
    const bKey = b.start.positionId ?? b.start.offset;
    return aKey - bKey;
  });

  return { asin, ranges };
}

async function ensureExists(path: string) {
  await stat(path);
}

async function main() {
  const [asinArg, chunkIdArg, maxCharsArg] = process.argv.slice(2);
  const dataDir = resolve(__dirname, '../data/books');
  const maxCharacters =
    maxCharsArg != null
      ? Number(maxCharsArg)
      : DEFAULT_MAX_CHARACTERS != null
        ? DEFAULT_MAX_CHARACTERS
        : undefined;

  if (maxCharacters != null && Number.isNaN(maxCharacters)) {
    throw new Error(`Invalid max character argument: ${maxCharsArg}`);
  }

  const asin = asinArg ?? (await resolveDefaultAsin(dataDir));
  const coverage = await loadCoverage(dataDir, asin);

  const range =
    coverage.ranges.find((item) => item.id === chunkIdArg) ??
    coverage.ranges[0];

  if (!range) {
    throw new Error(`Unable to resolve a range for ASIN ${asin}`);
  }

  const combinedTextPath = range.artifacts.combinedTextPath;
  if (!combinedTextPath) {
    throw new Error(
      `Range ${range.id} is missing combined text artifacts. Re-run OCR pipeline first.`,
    );
  }

  await ensureExists(combinedTextPath);
  const rawText = await readFile(combinedTextPath, 'utf8');
  const { normalized: normalizedText, map: normalizedMap } =
    normalizeTextWithMap(rawText);

  const userCap =
    maxCharacters != null
      ? Math.min(Math.max(maxCharacters, 1), normalizedText.length)
      : normalizedText.length;
  const hardCap = Math.min(userCap, SENTENCE_SLICE_MAX_CHARS, normalizedText.length);
  const sliceLength = computeSentenceSliceLength(
    normalizedText,
    DEFAULT_SENTENCE_TARGET,
    hardCap,
  );

  const textForTts = normalizedText.slice(0, sliceLength);
  const charToOriginalIndex = normalizedMap.slice(0, sliceLength);

  if (!textForTts.trim()) {
    throw new Error(
      `Text content for ${range.id} (ASIN ${asin}) is empty after normalization`,
    );
  }

  const {
    audioBase64,
    alignment,
    normalizedAlignment,
  } = await elevenlabs.textToSpeech.convertWithTimestamps(
    ELEVENLABS_VOICE_ID,
    {
      text: textForTts,
      modelId: ELEVENLABS_MODEL_ID,
      outputFormat: OUTPUT_FORMAT,
    },
  );

  const activeAlignment = alignment ?? normalizedAlignment;

  if (!activeAlignment?.characterStartTimesSeconds?.length) {
    throw new Error('Timestamp alignment data was not returned by ElevenLabs');
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');

  if (activeAlignment.characters.length !== textForTts.length) {
    const alignmentText = activeAlignment.characters.join('');
    if (alignmentText !== textForTts) {
      throw new Error(
        `Mismatch between alignment characters (${activeAlignment.characters.length}) and generated text (${textForTts.length})`,
      );
    }
  }

  const totalDurationSeconds =
    activeAlignment.characterEndTimesSeconds[
      activeAlignment.characterEndTimesSeconds.length - 1
    ];

  const charToKindleOffset = charToOriginalIndex.map(
    (originalIndex) => range.start.offset + originalIndex,
  );
  const processedRawLength =
    charToOriginalIndex.length > 0
      ? charToOriginalIndex[charToOriginalIndex.length - 1] + 1
      : 0;
  const processedKindleEndOffset = range.start.offset + processedRawLength;

  const benchmarkTimes: number[] = [];
  for (
    let t = 0;
    t <= totalDurationSeconds;
    t += Math.max(BENCHMARK_INTERVAL_SECONDS, 0.1)
  ) {
    benchmarkTimes.push(Number(t.toFixed(3)));
  }

  if (benchmarkTimes[benchmarkTimes.length - 1] !== totalDurationSeconds) {
    benchmarkTimes.push(Number(totalDurationSeconds.toFixed(3)));
  }

  const samples: { timeSeconds: number; charIndex: number }[] = [];
  let cursor = 0;

  for (const time of benchmarkTimes) {
    while (
      cursor < activeAlignment.characterStartTimesSeconds.length &&
      activeAlignment.characterStartTimesSeconds[cursor] <= time
    ) {
      cursor += 1;
    }

    const charIndex = Math.max(0, cursor - 1);
    samples.push({
      timeSeconds: Number(time.toFixed(3)),
      charIndex,
    });
  }

  const benchmarks: BenchmarkEntry[] = [];

  for (let index = 0; index < samples.length; index++) {
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

    const kindleOffsetStart =
      charToKindleOffset[startCharIndex] ?? processedKindleEndOffset;

    const kindleOffsetEnd =
      endCharIndex < charToKindleOffset.length
        ? charToKindleOffset[endCharIndex]
        : processedKindleEndOffset;

    benchmarks.push({
      timeSeconds: current.timeSeconds,
      charIndexStart: startCharIndex,
      charIndexEnd: endCharIndex,
      kindleOffsetStart,
      kindleOffsetEnd,
      kindleRawStart: convertOffsetToRaw(kindleOffsetStart),
      kindleRawEnd: convertOffsetToRaw(kindleOffsetEnd),
      textNormalized: textForTts.slice(startCharIndex, endCharIndex),
      textOriginal: rawText
        .slice(startOriginalIndex, endOriginalIndex)
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }

  const outputDir = resolve(__dirname, '../../tmp');
  await mkdir(outputDir, { recursive: true });

  const baseName = `${asin}-${range.id}-${Date.now()}`;
  const audioPath = resolve(outputDir, `${baseName}.mp3`);
  const alignmentPath = resolve(outputDir, `${baseName}-alignment.json`);
  const benchmarkPath = resolve(outputDir, `${baseName}-benchmarks.json`);

  await writeFile(audioPath, audioBuffer);

  const savedAlignment = alignment ?? normalizedAlignment;
  const alignmentPayload = {
    asin,
    chunkId: range.id,
    voiceId: ELEVENLABS_VOICE_ID,
    modelId: ELEVENLABS_MODEL_ID,
    outputFormat: OUTPUT_FORMAT,
    chunkStartOffset: range.start.offset,
    textLength: textForTts.length,
    totalDurationSeconds,
    charToKindleOffset,
    alignment: savedAlignment,
  };

  await writeFile(alignmentPath, JSON.stringify(alignmentPayload, null, 2));

  const benchmarkOutput = {
    asin,
    chunkId: range.id,
    benchmarkIntervalSeconds: BENCHMARK_INTERVAL_SECONDS,
    totalDurationSeconds,
    maxCharacters: sliceLength,
    audioPath,
    alignmentPath,
    benchmarks,
  };

  await writeFile(benchmarkPath, JSON.stringify(benchmarkOutput, null, 2));

  console.log(`Saved ElevenLabs audio to ${audioPath}`);
  console.log(`Saved alignment data to ${alignmentPath}`);
  console.log(`Saved benchmark map to ${benchmarkPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
