/**
 * - runChunkOcr: exported entry that invokes executeOcrPipeline and reuses its output for callers.
 * - executeOcrPipeline: tries uv/python commands, parses stdout via parseSummary, flattens files with reorganizePages, and persists results via updateChunkMetadata.
 * - reorganizePages: reshapes glyph output into a flat pages directory consumed by runChunkOcr callers.
 * - updateChunkMetadata: writes OCR artifact paths back to metadata for later stages.
 * - parseSummary: interprets JSON emitted by the OCR pipeline before executeOcrPipeline processes it.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { log } from "../logger.js";
import {
  readChunkMetadata,
  writeChunkMetadata,
} from "./chunk-metadata-service.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
const textExtractionDir = process.env.TEXT_EXTRACTION_DIR ?? path.join(projectRoot, "text-extraction");

type PipelineSummary = {
  total_pages: number;
  processed_pages: number;
  pages: Array<{
    index: number;
    png: string;
  }>;
  combined_text_path: string | null;
  ocr_enabled: boolean;
};

export type RunChunkOcrOptions = {
  chunkId: string;
  chunkDir: string;
  extractDir: string;
  metadataPath: string;
  startPage?: number;
  maxPages?: number;
};

export type RunChunkOcrResult = {
  pages: Array<{ index: number; png: string }>;
  totalPages: number;
  processedPages: number;
  combinedTextPath: string | null;
  ocrEnabled: boolean;
};

/** Runs the text extraction pipeline for a chunk and stores summary data. */
export async function runChunkOcr(
  options: RunChunkOcrOptions
): Promise<RunChunkOcrResult> {
  const {
    chunkId,
    chunkDir,
    extractDir,
    metadataPath,
    startPage = 0,
    maxPages = 5,
  } = options;

  const result = await executeOcrPipeline({
    chunkId,
    chunkDir,
    extractDir,
    metadataPath,
    startPage,
    maxPages,
  });

  return result;
}

/** Invokes the python OCR pipeline and reshapes the resulting artifacts. */
async function executeOcrPipeline(options: {
  chunkId: string;
  chunkDir: string;
  extractDir: string;
  metadataPath: string;
  startPage: number;
  maxPages: number;
}): Promise<RunChunkOcrResult> {
  const {
    chunkId,
    chunkDir,
    extractDir,
    metadataPath,
    startPage,
    maxPages,
  } = options;

  const outputDir = chunkDir;
  const pagesDir = path.join(chunkDir, "pages");
  await fs.rm(pagesDir, { recursive: true, force: true });

  const baseArgs = [
    "--extract-root",
    extractDir,
    "--output-dir",
    outputDir,
    "--start-page",
    String(startPage),
    "--max-pages",
    String(maxPages),
  ];

  const summary = await runOcrCommand(baseArgs);

  const flattenedPages = await reorganizePages(chunkDir, chunkId, summary.pages);
  const combinedTextPath = summary.combined_text_path;

  const result: RunChunkOcrResult = {
    pages: flattenedPages,
    totalPages: summary.total_pages,
    processedPages: summary.processed_pages,
    combinedTextPath,
    ocrEnabled: summary.ocr_enabled,
  };

  await updateChunkMetadata({
    metadataPath,
    chunkId,
    pagesDir: path.join(chunkDir, "pages"),
    combinedTextPath,
  });

  return result;
}

/** Executes the text extraction pipeline with uv and returns its summary payload. */
async function runOcrCommand(args: string[]): Promise<PipelineSummary> {
  log.debug({ args }, "Running text extraction pipeline");
  try {
    const { stdout } = await execFileAsync(
      "uv",
      ["run", "python", "pipeline.py", ...args],
      {
        cwd: textExtractionDir,
        env: process.env,
        encoding: "utf8",
      } as const,
    );

    const summary = parseSummary(stdout);
    log.debug({ totalPages: summary.total_pages, processedPages: summary.processed_pages }, "Text extraction complete");
    return summary;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    const details = err.stderr ? `${err.message}\n${err.stderr}` : err.message;
    log.error({ err: error }, "Text extraction pipeline failed");
    throw new Error(`OCR pipeline failed: ${details}`);
  }
}

/** Moves generated page PNGs into a flat pages directory for the chunk. */
async function reorganizePages(
  chunkDir: string,
  chunkId: string,
  pages: PipelineSummary["pages"]
): Promise<Array<{ index: number; png: string }>> {
  const parentDir = path.join(chunkDir, "pages");
  const nestedDir = path.join(parentDir, chunkId);
  await fs.mkdir(parentDir, { recursive: true });

  const result: Array<{ index: number; png: string }> = [];

  for (const page of pages) {
    const source = page.png;
    const filename = path.basename(source);
    const target = path.join(parentDir, filename);
    if (source !== target) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(source, target).catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code === "EXDEV") {
          const data = await fs.readFile(source);
          await fs.writeFile(target, data);
          await fs.unlink(source);
        } else {
          throw error;
        }
      });
    }
    result.push({ index: page.index, png: target });
  }

  await fs.rm(nestedDir, { recursive: true, force: true });

  return result;
}

/** Writes OCR artifact locations back into the chunk metadata file. */
async function updateChunkMetadata(options: {
  metadataPath: string;
  chunkId: string;
  pagesDir: string;
  combinedTextPath: string | null;
}): Promise<void> {
  const { metadataPath, chunkId, pagesDir, combinedTextPath } = options;
  const metadata = await readChunkMetadata(metadataPath);
  if (!metadata) {
    return;
  }

  const targetRange = metadata.ranges.find((range) => range.id === chunkId);
  if (!targetRange) {
    return;
  }

  const now = new Date().toISOString();
  targetRange.artifacts.pngDir = pagesDir;
  targetRange.artifacts.pagesDir = pagesDir;
  targetRange.artifacts.combinedTextPath = combinedTextPath ?? undefined;
  metadata.updatedAt = now;
  targetRange.updatedAt = now;

  await writeChunkMetadata(metadataPath, metadata);
}

/** Parses the OCR pipeline stdout payload into structured JSON. */
function parseSummary(raw: string): PipelineSummary {
  try {
    return JSON.parse(raw) as PipelineSummary;
  } catch (error) {
    throw new Error(
      `Failed to parse OCR pipeline output: ${(error as Error).message}. Raw output: ${raw}`
    );
  }
}
