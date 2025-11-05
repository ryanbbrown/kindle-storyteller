import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  readChunkMetadata,
  writeChunkMetadata,
} from "./chunk-metadata-service.js";
import { pipelineDebugLog } from "../utils/pipeline-debug-logger.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
const glyphExtractionDir = path.join(projectRoot, "glyph-extraction");

const SUMMARY_FILENAME = "ocr-summary.json";

type PipelineSummary = {
  total_pages: number;
  processed_pages: number;
  pages: Array<{
    index: number;
    png: string;
    text_path: string | null;
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

  const summaryPath = path.join(chunkDir, SUMMARY_FILENAME);

  await pipelineDebugLog("ocr.runChunkOcr.start", {
    chunkId,
    chunkDir,
    extractDir,
    metadataPath,
    startPage,
    maxPages,
    summaryPath,
  });

  const existing = await loadExistingSummary({
    chunkId,
    chunkDir,
    metadataPath,
    summaryPath,
  });
  if (existing) {
    await pipelineDebugLog("ocr.runChunkOcr.reuse", {
      chunkId,
      processedPages: existing.processedPages,
      totalPages: existing.totalPages,
    });
    return existing;
  }

  await pipelineDebugLog("ocr.runChunkOcr.executePipeline", {
    chunkId,
  });

  const result = await executeOcrPipeline({
    chunkId,
    chunkDir,
    extractDir,
    metadataPath,
    startPage,
    maxPages,
    summaryPath,
  });

  await pipelineDebugLog("ocr.runChunkOcr.finish", {
    chunkId,
    processedPages: result.processedPages,
    totalPages: result.totalPages,
    combinedTextPath: result.combinedTextPath,
  });

  return result;
}

async function loadExistingSummary(options: {
  chunkId: string;
  chunkDir: string;
  metadataPath: string;
  summaryPath: string;
}): Promise<RunChunkOcrResult | undefined> {
  const { chunkId, chunkDir, metadataPath, summaryPath } = options;

  await pipelineDebugLog("ocr.loadExistingSummary.start", {
    chunkId,
    summaryPath,
  });

  const summary = await readSummary(summaryPath);
  if (!summary) {
    await pipelineDebugLog("ocr.loadExistingSummary.noSummary", {
      chunkId,
      summaryPath,
    });
    return undefined;
  }

  const ok = await validateSummaryArtifacts(summary);
  if (!ok) {
    await pipelineDebugLog("ocr.loadExistingSummary.artifactMissing", {
      chunkId,
      summaryPath,
    });
    return undefined;
  }

  await ensureSummaryPathRecorded({ metadataPath, chunkId, summaryPath });

  await pipelineDebugLog("ocr.loadExistingSummary.valid", {
    chunkId,
    summaryPath,
  });

  return summary;
}

async function executeOcrPipeline(options: {
  chunkId: string;
  chunkDir: string;
  extractDir: string;
  metadataPath: string;
  startPage: number;
  maxPages: number;
  summaryPath: string;
}): Promise<RunChunkOcrResult> {
  const {
    chunkId,
    chunkDir,
    extractDir,
    metadataPath,
    startPage,
    maxPages,
    summaryPath,
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

  const commands: Array<{ cmd: string; args: string[] }> = [
    { cmd: "uv", args: ["run", "python", "pipeline.py", ...baseArgs] },
    { cmd: "python", args: ["pipeline.py", ...baseArgs] },
    { cmd: "python3", args: ["pipeline.py", ...baseArgs] },
  ];

  let lastError: Error | undefined;
  let summary: PipelineSummary | undefined;

  for (const { cmd, args } of commands) {
    try {
      const { stdout } = await execFileAsync(cmd, args, {
        cwd: glyphExtractionDir,
        env: process.env,
        encoding: "utf8",
      } as const);

      summary = parseSummary(stdout);
      break;
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stderr?: string };
      if (err.code === "ENOENT") {
        lastError = err;
        continue;
      }
      const details = err.stderr ? `${err.message}\n${err.stderr}` : err.message;
      throw new Error(`OCR pipeline failed using ${cmd}: ${details}`);
    }
  }

  if (!summary) {
    throw new Error(
      `Unable to execute OCR pipeline; ensure Python/uv is installed. Last error: ${
        lastError?.message ?? "unknown"
      }`
    );
  }

  const flattenedPages = await reorganizePages(chunkDir, chunkId, summary.pages);
  const combinedTextPath = await relocateCombinedText(chunkId, chunkDir, summary.combined_text_path);

  const result: RunChunkOcrResult = {
    pages: flattenedPages,
    totalPages: summary.total_pages,
    processedPages: summary.processed_pages,
    combinedTextPath,
    ocrEnabled: summary.ocr_enabled,
  };

  await persistSummary(summaryPath, result);
  await updateChunkMetadata({
    metadataPath,
    chunkId,
    pagesDir: path.join(chunkDir, "pages"),
    combinedTextPath,
    summaryPath,
  });

  return result;
}

async function reorganizePages(
  chunkDir: string,
  chunkId: string,
  pages: PipelineSummary["pages"]
): Promise<Array<{ index: number; png: string }>> {
  const parentDir = path.join(chunkDir, "pages");
  const nestedDir = path.join(parentDir, chunkId);
  await fs.mkdir(parentDir, { recursive: true });
  await pipelineDebugLog("ocr.reorganizePages.parentReady", {
    chunkId,
    parentDir,
    nestedDir,
    pageCount: pages.length,
  });

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
      await pipelineDebugLog("ocr.reorganizePages.moved", {
        chunkId,
        source,
        target,
      });
    }
    result.push({ index: page.index, png: target });
  }

  await fs.rm(nestedDir, { recursive: true, force: true });
  await pipelineDebugLog("ocr.reorganizePages.cleaned", {
    chunkId,
    nestedDir,
  });

  return result;
}

async function relocateCombinedText(
  chunkId: string,
  chunkDir: string,
  combinedPath: string | null
): Promise<string | null> {
  if (!combinedPath) {
    await pipelineDebugLog("ocr.relocateCombinedText.none", {
      chunkId,
    });
    return null;
  }

  const target = path.join(chunkDir, "full-content.txt");
  if (combinedPath === target) {
    await pipelineDebugLog("ocr.relocateCombinedText.already", {
      chunkId,
      target,
    });
    return target;
  }

  await fs.rename(combinedPath, target).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      const data = await fs.readFile(combinedPath);
      await fs.writeFile(target, data);
      await fs.unlink(combinedPath);
    } else if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  });

  await pipelineDebugLog("ocr.relocateCombinedText.moved", {
    chunkId,
    source: combinedPath,
    target,
  });

  return target;
}

async function updateChunkMetadata(options: {
  metadataPath: string;
  chunkId: string;
  pagesDir: string;
  combinedTextPath: string | null;
  summaryPath: string;
}): Promise<void> {
  const { metadataPath, chunkId, pagesDir, combinedTextPath, summaryPath } = options;
  const metadata = await readChunkMetadata(metadataPath);
  if (!metadata) {
    await pipelineDebugLog("ocr.updateChunkMetadata.noMetadata", {
      chunkId,
      metadataPath,
    });
    return;
  }

  const targetRange = metadata.ranges.find((range) => range.id === chunkId);
  if (!targetRange) {
    await pipelineDebugLog("ocr.updateChunkMetadata.noRange", {
      chunkId,
      metadataPath,
    });
    return;
  }

  const now = new Date().toISOString();
  targetRange.artifacts.pngDir = pagesDir;
  targetRange.artifacts.pagesDir = pagesDir;
  targetRange.artifacts.combinedTextPath = combinedTextPath ?? undefined;
  targetRange.artifacts.ocrSummaryPath = summaryPath;
  metadata.updatedAt = now;
  targetRange.updatedAt = now;

  await pipelineDebugLog("ocr.updateChunkMetadata.updated", {
    chunkId,
    metadataPath,
    pagesDir,
    combinedTextPath,
    summaryPath,
  });

  await writeChunkMetadata(metadataPath, metadata);

  await pipelineDebugLog("ocr.updateChunkMetadata.written", {
    chunkId,
    metadataPath,
  });
}

function parseSummary(raw: string): PipelineSummary {
  try {
    return JSON.parse(raw) as PipelineSummary;
  } catch (error) {
    pipelineDebugLog("ocr.parseSummary.failure", {
      raw: raw.slice(0, 200),
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw new Error(
      `Failed to parse OCR pipeline output: ${(error as Error).message}. Raw output: ${raw}`
    );
  }
}

async function persistSummary(
  summaryPath: string,
  result: RunChunkOcrResult
): Promise<void> {
  const data = {
    ...result,
    savedAt: new Date().toISOString(),
  };
  await fs.writeFile(summaryPath, JSON.stringify(data, null, 2), "utf8");
  await pipelineDebugLog("ocr.persistSummary.written", {
    summaryPath,
    processedPages: result.processedPages,
    totalPages: result.totalPages,
  });
}

async function readSummary(summaryPath: string): Promise<RunChunkOcrResult | undefined> {
  try {
    const raw = await fs.readFile(summaryPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RunChunkOcrResult> & {
      pages?: Array<{ index: number; png: string }>;
    };

    if (!parsed || !Array.isArray(parsed.pages)) {
      await pipelineDebugLog("ocr.readSummary.invalidShape", {
        summaryPath,
      });
      return undefined;
    }

    const pages = parsed.pages
      .map((page) => ({
        index: Number(page.index),
        png: String(page.png),
      }))
      .filter((page) => Number.isFinite(page.index) && page.png.length > 0);

    const totalPages = Number(parsed.totalPages);
    const processedPages = Number(parsed.processedPages);
    const ocrEnabled = Boolean(parsed.ocrEnabled);

    if (!Number.isFinite(totalPages) || !Number.isFinite(processedPages)) {
      await pipelineDebugLog("ocr.readSummary.invalidNumbers", {
        summaryPath,
        totalPages,
        processedPages,
      });
      return undefined;
    }

    await pipelineDebugLog("ocr.readSummary.success", {
      summaryPath,
      totalPages,
      processedPages,
      pageCount: pages.length,
    });

    return {
      pages,
      totalPages,
      processedPages,
      combinedTextPath:
        typeof parsed.combinedTextPath === "string"
          ? parsed.combinedTextPath
          : null,
      ocrEnabled,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await pipelineDebugLog("ocr.readSummary.missing", {
        summaryPath,
      });
      return undefined;
    }
    await pipelineDebugLog("ocr.readSummary.error", {
      summaryPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function validateSummaryArtifacts(summary: RunChunkOcrResult): Promise<boolean> {
  const checks: Array<Promise<boolean>> = [];
  for (const page of summary.pages) {
    checks.push(pathExists(page.png));
  }
  if (summary.combinedTextPath) {
    checks.push(pathExists(summary.combinedTextPath));
  }

  const results = await Promise.all(checks);
  await pipelineDebugLog("ocr.validateSummaryArtifacts.results", {
    pageCount: summary.pages.length,
    combinedTextPath: summary.combinedTextPath,
    valid: results.every(Boolean),
  });
  return results.every(Boolean);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    await pipelineDebugLog("ocr.pathExists.success", {
      targetPath,
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await pipelineDebugLog("ocr.pathExists.missing", {
        targetPath,
      });
      return false;
    }
    await pipelineDebugLog("ocr.pathExists.error", {
      targetPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function ensureSummaryPathRecorded(options: {
  metadataPath: string;
  chunkId: string;
  summaryPath: string;
}): Promise<void> {
  const { metadataPath, chunkId, summaryPath } = options;
  const metadata = await readChunkMetadata(metadataPath);
  if (!metadata) {
    await pipelineDebugLog("ocr.ensureSummaryPathRecorded.noMetadata", {
      chunkId,
      metadataPath,
    });
    return;
  }
  const range = metadata.ranges.find((candidate) => candidate.id === chunkId);
  if (!range) {
    await pipelineDebugLog("ocr.ensureSummaryPathRecorded.noRange", {
      chunkId,
      metadataPath,
    });
    return;
  }
  if (range.artifacts.ocrSummaryPath === summaryPath) {
    await pipelineDebugLog("ocr.ensureSummaryPathRecorded.alreadySet", {
      chunkId,
      summaryPath,
    });
    return;
  }

  range.artifacts.ocrSummaryPath = summaryPath;
  range.updatedAt = new Date().toISOString();
  metadata.updatedAt = range.updatedAt;
  await writeChunkMetadata(metadataPath, metadata);
  await pipelineDebugLog("ocr.ensureSummaryPathRecorded.updated", {
    chunkId,
    summaryPath,
  });
}
