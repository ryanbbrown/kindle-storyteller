import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

import { readChunkMetadata } from "../src/services/chunk-metadata-service.js";
import {
  generateChunkPreviewAudio,
  recordChunkAudioArtifacts,
} from "../src/services/elevenlabs-audio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function main() {
  const [asinArg, chunkIdArg] = process.argv.slice(2);

  const dataDir = path.resolve(__dirname, "../data/books");
  const asin = asinArg ?? (await resolveDefaultAsin(dataDir));
  const chunksDir = path.join(dataDir, asin, "chunks");
  const chunkId = chunkIdArg ?? (await resolveDefaultChunkId(chunksDir));
  const chunkDir = path.join(chunksDir, chunkId);
  const metadataPath = path.join(chunkDir, "metadata.json");

  const metadata = await readChunkMetadata(metadataPath);
  if (!metadata) {
    throw new Error(`Chunk metadata missing for ${chunkDir}`);
  }

  const range =
    metadata.ranges.find((candidate) => candidate.id === chunkId) ??
    metadata.ranges[0];
  if (!range) {
    throw new Error(`No coverage range found for chunk ${chunkId}`);
  }

  const combinedTextPath = await resolveCombinedTextPath(chunkDir, range);

  const summary = await generateChunkPreviewAudio({
    asin,
    chunkId: range.id,
    chunkDir,
    range,
    combinedTextPath,
  });

  await recordChunkAudioArtifacts({
    metadataPath,
    metadata,
    chunkId: range.id,
    summary,
  });

  console.log(`Saved preview audio to ${summary.audioPath}`);
  console.log(`Saved alignment data to ${summary.alignmentPath}`);
  console.log(`Saved benchmark map to ${summary.benchmarksPath}`);
}

async function resolveDefaultAsin(dataDir: string): Promise<string> {
  const entries = await fs.readdir(dataDir, { withFileTypes: true });
  const asinDir = entries.find(
    (entry) => entry.isDirectory() && !entry.name.startsWith("."),
  );

  if (!asinDir) {
    throw new Error(`No book data found in ${dataDir}`);
  }

  return asinDir.name;
}

async function resolveDefaultChunkId(chunksDir: string): Promise<string> {
  const entries = await fs.readdir(chunksDir, { withFileTypes: true });
  const chunkDir = entries.find(
    (entry) => entry.isDirectory() && !entry.name.startsWith("."),
  );

  if (!chunkDir) {
    throw new Error(`No chunks found in ${chunksDir}`);
  }

  return chunkDir.name;
}

async function resolveCombinedTextPath(
  chunkDir: string,
  range: { artifacts: { combinedTextPath?: string } },
): Promise<string> {
  const candidate =
    range.artifacts.combinedTextPath ?? path.join(chunkDir, "full-content.txt");

  await fs.access(candidate);
  return candidate;
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
