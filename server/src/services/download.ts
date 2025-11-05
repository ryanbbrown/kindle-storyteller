import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { Kindle } from "kindle-api";

import { env } from "../env.js";
import {
  readChunkMetadata,
  writeChunkMetadata,
} from "./chunk-metadata-service.js";
import type {
  CoverageRange,
  RendererCoverageMetadata,
} from "../types/chunk-metadata.js";
import { pipelineDebugLog } from "../utils/pipeline-debug-logger.js";

const execFileAsync = promisify(execFile);

const METADATA_FILENAME = "metadata.json";

export type RendererConfigInput = {
  startingPosition: number | string;
  numPages?: number | string;
  skipPages?: number | string;
};

export type RendererConfig = {
  startingPosition: string;
  numPage: string;
  skipPageCount: string;
};

export type EnsureChunkDownloadedOptions = {
  asin: string;
  kindle: Kindle;
  renderingToken: string;
  renderOptions: RendererConfigInput;
};

export type ChunkArtifacts = {
  extractDir: string;
  pagesDir: string;
  combinedTextPath: string;
  contentTarPath: string;
  ocrSummaryPath?: string;
};

export type EnsureChunkDownloadedResult = {
  asin: string;
  chunkId: string;
  chunkDir: string;
  metadataPath: string;
  rendererConfig: RendererConfig;
  manifest: unknown;
  rendererMetadata: unknown;
  toc: unknown;
  chunkMetadata: RendererCoverageMetadata;
  artifacts: ChunkArtifacts;
};

type ExistingChunk = {
  chunkId: string;
  chunkDir: string;
  metadataPath: string;
  metadata: RendererCoverageMetadata;
  range: CoverageRange;
};

export async function ensureChunkDownloaded(
  options: EnsureChunkDownloadedOptions
): Promise<EnsureChunkDownloadedResult> {
  const { asin, kindle, renderingToken } = options;
  const rendererConfig = normalizeRenderOptions(options.renderOptions);

  await pipelineDebugLog("download.ensureChunkDownloaded.start", {
    asin,
    startingPosition: rendererConfig.startingPosition,
    numPage: rendererConfig.numPage,
    skipPageCount: rendererConfig.skipPageCount,
  });

  const startOffset = parseNormalizedOffset(rendererConfig.startingPosition);
  const requestPositionId = extractPositionIdFromInput(rendererConfig.startingPosition);
  await pipelineDebugLog("download.ensureChunkDownloaded.normalizedPosition", {
    asin,
    startOffset,
    requestPositionId,
  });

  const asinDir = path.join(env.storageDir, asin);
  const chunksRoot = path.join(asinDir, "chunks");
  await fs.mkdir(chunksRoot, { recursive: true });
  await pipelineDebugLog("download.ensureChunkDownloaded.chunksRootReady", {
    asin,
    chunksRoot,
  });

  const existing = await findExistingChunk({ asin, startOffset, requestPositionId, chunksRoot });
  await pipelineDebugLog("download.ensureChunkDownloaded.findExistingCompleted", {
    asin,
    startOffset,
    requestPositionId,
    foundChunkId: existing?.chunkId ?? null,
  });
  if (existing) {
    const reuse = await buildResultFromExisting({
      asin,
      rendererConfig,
      existing,
    });
    if (reuse) {
      await pipelineDebugLog("download.ensureChunkDownloaded.reuseSuccess", {
        asin,
        chunkId: reuse.chunkId,
      });
      return reuse;
    }
    await pipelineDebugLog("download.ensureChunkDownloaded.reuseFailed", {
      asin,
      chunkId: existing.chunkId,
    });
  }

  return await downloadFreshChunk({
    asin,
    kindle,
    renderingToken,
    rendererConfig,
    chunksRoot,
  });
}

async function findExistingChunk(options: {
  asin: string;
  startOffset: number;
  requestPositionId?: number;
  chunksRoot: string;
}): Promise<ExistingChunk | undefined> {
  const { startOffset, requestPositionId, chunksRoot } = options;

  let entries: string[];
  await pipelineDebugLog("download.findExistingChunk.start", {
    asin: options.asin,
    startOffset,
    requestPositionId,
    chunksRoot,
  });
  try {
    entries = await fs.readdir(chunksRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await pipelineDebugLog("download.findExistingChunk.dirMissing", {
        asin: options.asin,
        chunksRoot,
      });
      return undefined;
    }
    throw error;
  }

  await pipelineDebugLog("download.findExistingChunk.entries", {
    asin: options.asin,
    count: entries.length,
    entries,
  });

  for (const entry of entries) {
    const chunkDir = path.join(chunksRoot, entry);
    const metadataPath = path.join(chunkDir, METADATA_FILENAME);
    const metadata = await readChunkMetadata(metadataPath);
    if (!metadata) {
      await pipelineDebugLog("download.findExistingChunk.metadataMissing", {
        asin: options.asin,
        entry,
      });
      continue;
    }

    const range = metadata.ranges.find((candidate) => {
      const matchesOffset = candidate.start.offset === startOffset;
      if (matchesOffset) {
        return true;
      }

      if (
        requestPositionId !== undefined &&
        candidate.start.positionId !== undefined &&
        candidate.end.positionId !== undefined
      ) {
        const inRange =
          requestPositionId >= candidate.start.positionId &&
          requestPositionId <= candidate.end.positionId;
        if (inRange) {
          return true;
        }
      }

      return false;
    });

    if (!range) {
      await pipelineDebugLog("download.findExistingChunk.rangeMismatch", {
        asin: options.asin,
        entry,
        startOffset,
        requestPositionId,
        availableOffsets: metadata.ranges.map((r) => ({
          offset: r.start.offset,
          startPositionId: r.start.positionId,
          endPositionId: r.end.positionId,
        })),
      });
      continue;
    }

    await pipelineDebugLog("download.findExistingChunk.match", {
      asin: options.asin,
      entry,
      startOffset,
      requestPositionId,
      matchedOffset: range.start.offset,
      matchedStartPositionId: range.start.positionId,
      matchedEndPositionId: range.end.positionId,
    });

    return { chunkId: entry, chunkDir, metadataPath, metadata, range };
  }

  await pipelineDebugLog("download.findExistingChunk.noMatch", {
    asin: options.asin,
    startOffset,
    requestPositionId,
  });
  return undefined;
}

async function buildResultFromExisting(options: {
  asin: string;
  rendererConfig: RendererConfig;
  existing: ExistingChunk;
}): Promise<EnsureChunkDownloadedResult | undefined> {
  const { asin, rendererConfig, existing } = options;
  const { chunkDir, chunkId, metadata, metadataPath, range } = existing;

  const artifacts = resolveArtifacts(range, chunkDir);

  await pipelineDebugLog("download.buildResultFromExisting.artifacts", {
    asin,
    chunkId,
    artifacts,
  });

  const [extractOk, tarOk] = await Promise.all([
    pathExists(artifacts.extractDir, true),
    pathExists(artifacts.contentTarPath, false),
  ]);

  await pipelineDebugLog("download.buildResultFromExisting.pathChecks", {
    asin,
    chunkId,
    extractOk,
    tarOk,
  });

  if (!extractOk || !tarOk) {
    await pipelineDebugLog("download.buildResultFromExisting.pathFailure", {
      asin,
      chunkId,
    });
    return undefined;
  }

  const manifest = await readJsonSafe(path.join(artifacts.extractDir, "manifest.json"));
  const rendererMetadata = await readJsonSafe(path.join(artifacts.extractDir, "metadata.json"));
  const toc = await readJsonSafe(path.join(artifacts.extractDir, "toc.json"));

  await pipelineDebugLog("download.buildResultFromExisting.jsonChecks", {
    asin,
    chunkId,
    manifestPresent: manifest !== null,
    rendererMetadataPresent: rendererMetadata !== null,
    tocPresent: toc !== null,
  });

  if (manifest === null || rendererMetadata === null || toc === null) {
    await pipelineDebugLog("download.buildResultFromExisting.jsonFailure", {
      asin,
      chunkId,
    });
    return undefined;
  }

  await pipelineDebugLog("download.buildResultFromExisting.success", {
    asin,
    chunkId,
  });
  return {
    asin,
    chunkId,
    chunkDir,
    metadataPath,
    rendererConfig,
    manifest,
    rendererMetadata,
    toc,
    chunkMetadata: metadata,
    artifacts,
  };
}

async function downloadFreshChunk(options: {
  asin: string;
  kindle: Kindle;
  renderingToken: string;
  rendererConfig: RendererConfig;
  chunksRoot: string;
}): Promise<EnsureChunkDownloadedResult> {
  const { asin, kindle, renderingToken, rendererConfig, chunksRoot } = options;

  const asinDir = path.dirname(chunksRoot);
  const tempRoot = path.join(asinDir, "tmp");
  await fs.mkdir(tempRoot, { recursive: true });

  await pipelineDebugLog("download.downloadFreshChunk.stagingDirCreate", {
    asin,
    tempRoot,
  });

  const stagingDir = await fs.mkdtemp(path.join(tempRoot, "render-"));
  const stagingTar = path.join(stagingDir, "content.tar");
  const stagingExtractDir = path.join(stagingDir, "extracted");
  await fs.mkdir(stagingExtractDir, { recursive: true });

  await pipelineDebugLog("download.downloadFreshChunk.stagingReady", {
    asin,
    stagingDir,
    stagingTar,
    stagingExtractDir,
  });

  try {
    const response = await kindle.request(
      buildRendererUrl(asin, rendererConfig),
      {
        headers: {
          "x-amz-rendering-token": renderingToken,
        },
      }
    );

    await pipelineDebugLog("download.downloadFreshChunk.requestCompleted", {
      asin,
      status: response?.status,
    });

    if (response.status !== 200) {
      throw new Error(
        `Renderer request failed: status=${response.status} body=${String(response.body).slice(0, 200)}`
      );
    }

    const buffer = coerceBodyToBuffer(response.body);
    await fs.writeFile(stagingTar, buffer);
    await pipelineDebugLog("download.downloadFreshChunk.tarWritten", {
      asin,
      stagingTar,
      size: buffer.byteLength,
    });
    await execFileAsync("tar", ["-xf", stagingTar, "-C", stagingExtractDir]);
    await pipelineDebugLog("download.downloadFreshChunk.tarExtracted", {
      asin,
      stagingExtractDir,
    });

    const pageDataPath = await findPageDataFile(stagingExtractDir);
    await pipelineDebugLog("download.downloadFreshChunk.pageDataFound", {
      asin,
      pageDataPath,
    });
    const pageDataRaw = await fs.readFile(pageDataPath, "utf8");
    const pageData = JSON.parse(pageDataRaw);
    if (!Array.isArray(pageData) || pageData.length === 0) {
      throw new Error("Renderer payload contained no page data");
    }

    const start = normalizePagePosition(pageData[0], "start");
    const end = normalizePagePosition(pageData[pageData.length - 1], "end");
    const chunkId = `chunk_pos_${start.offset}_${end.offset}`;

    await pipelineDebugLog("download.downloadFreshChunk.chunkComputed", {
      asin,
      chunkId,
      startOffset: start.offset,
      endOffset: end.offset,
    });

    const chunkDir = path.join(chunksRoot, chunkId);
    await fs.rm(chunkDir, { recursive: true, force: true });
    await fs.mkdir(chunkDir, { recursive: true });

    await pipelineDebugLog("download.downloadFreshChunk.chunkDirPrepared", {
      asin,
      chunkDir,
    });

    const finalTarPath = path.join(chunkDir, "content.tar");
    const finalExtractDir = path.join(chunkDir, "extracted");
    await fs.rename(stagingTar, finalTarPath);
    await fs.rename(stagingExtractDir, finalExtractDir);

    await pipelineDebugLog("download.downloadFreshChunk.artifactsMoved", {
      asin,
      chunkDir,
      finalTarPath,
      finalExtractDir,
    });

    const manifest = await readJsonSafe(path.join(finalExtractDir, "manifest.json"));
    const rendererMetadata = await readJsonSafe(path.join(finalExtractDir, "metadata.json"));
    const toc = await readJsonSafe(path.join(finalExtractDir, "toc.json"));

    await pipelineDebugLog("download.downloadFreshChunk.jsonParsed", {
      asin,
      chunkDir,
      manifestPresent: manifest !== null,
      rendererMetadataPresent: rendererMetadata !== null,
      tocPresent: toc !== null,
    });

    if (manifest === null || rendererMetadata === null || toc === null) {
      throw new Error("Renderer extract missing manifest/metadata/toc files");
    }

    const metadataPath = path.join(chunkDir, METADATA_FILENAME);
    const now = new Date().toISOString();

    const range: CoverageRange = {
      id: chunkId,
      start,
      end,
      artifacts: {
        extractDir: finalExtractDir,
        pagesDir: path.join(chunkDir, "pages"),
        combinedTextPath: path.join(chunkDir, "full-content.txt"),
        contentTarPath: finalTarPath,
      },
      createdAt: now,
      updatedAt: now,
    };

    const chunkMetadata: RendererCoverageMetadata = {
      asin,
      updatedAt: now,
      ranges: [range],
    };

    await writeChunkMetadata(metadataPath, chunkMetadata);

    await pipelineDebugLog("download.downloadFreshChunk.metadataWritten", {
      asin,
      chunkId,
      metadataPath,
    });

    return {
      asin,
      chunkId,
      chunkDir,
      metadataPath,
      rendererConfig,
      manifest,
      rendererMetadata,
      toc,
      chunkMetadata,
      artifacts: resolveArtifacts(range, chunkDir),
    };
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    await pipelineDebugLog("download.downloadFreshChunk.cleanup", {
      asin,
    });
  }
}

function normalizeRenderOptions(input: RendererConfigInput): RendererConfig {
  return {
    startingPosition: String(input.startingPosition),
    numPage: input.numPages !== undefined ? String(input.numPages) : "5",
    skipPageCount: input.skipPages !== undefined ? String(input.skipPages) : "0",
  };
}

function parseNormalizedOffset(raw: string): number {
  const normalized = normalizePositionValue(raw);
  const offset = Number.parseInt(normalized, 10);
  if (!Number.isFinite(offset)) {
    throw new Error("Unable to parse starting position offset");
  }
  return offset;
}

function extractPositionIdFromInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function buildRendererUrl(asin: string, config: RendererConfig): string {
  const params = new URLSearchParams({
    version: "3.0",
    asin,
    contentType: "FullBook",
    revision: "4019dcc4",
    fontFamily: "Bookerly",
    fontSize: "8.91",
    lineHeight: "1.4",
    dpi: "160",
    height: "784",
    width: "886",
    marginBottom: "0",
    marginLeft: "9",
    marginRight: "9",
    marginTop: "0",
    maxNumberColumns: "2",
    theme: "dark",
    locationMap: "false",
    packageType: "TAR",
    encryptionVersion: "NONE",
    numPage: config.numPage,
    skipPageCount: config.skipPageCount,
    startingPosition: config.startingPosition,
    bundleImages: "false",
  });

  return `https://read.amazon.com/renderer/render?${params.toString()}`;
}

async function readJsonSafe(filePath: string): Promise<unknown | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function findPageDataFile(extractDir: string): Promise<string> {
  const entries = await fs.readdir(extractDir);
  const direct = entries.find((entry) => entry === "page_data.json");
  if (direct) {
    return path.join(extractDir, direct);
  }

  const match = entries
    .filter((entry) => entry.startsWith("page_data_"))
    .sort()
    .at(-1);
  if (!match) {
    throw new Error("page_data JSON not found in renderer output");
  }
  return path.join(extractDir, match);
}

function normalizePagePosition(
  pageEntry: unknown,
  kind: "start" | "end"
): CoverageRange["start"] {
  if (!pageEntry || typeof pageEntry !== "object") {
    throw new Error("Invalid page data encountered");
  }

  const key = `${kind}Position` as const;
  const positionIdKey = `${kind}PositionId` as const;
  const page = pageEntry as Record<string, unknown>;

  const raw = page[key];
  const fallback = page[positionIdKey];

  const normalized = normalizePositionValue(raw ?? fallback);
  const offset = Number.parseInt(normalized, 10);
  if (!Number.isFinite(offset)) {
    throw new Error(`Unable to parse ${kind} position offset`);
  }

  const positionIdValue = page[positionIdKey];
  const positionId = typeof positionIdValue === "number" ? Math.trunc(positionIdValue) : undefined;

  return {
    raw: raw !== undefined ? String(raw) : "",
    offset,
    normalized,
    positionId,
  };
}

function normalizePositionValue(value: unknown): string {
  if (value === undefined || value === null) {
    throw new Error("Position value missing");
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Non-finite numeric position value");
    }
    return Math.trunc(value).toString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("Empty position string");
    }
    if (trimmed.includes(";")) {
      const [majorRaw, minorRaw = ""] = trimmed.split(";", 2);
      const majorDigits = majorRaw.replace(/\D+/g, "");
      const minorDigits = minorRaw.replace(/\D+/g, "");
      if (majorDigits) {
        return `${Number.parseInt(majorDigits, 10)}${minorDigits.padStart(3, "0")}`;
      }
    }
    const digits = trimmed.replace(/\D+/g, "");
    if (digits) {
      return digits;
    }
    throw new Error(`Unable to normalize position string: ${value}`);
  }

  throw new Error(`Unsupported position value type: ${String(value)}`);
}

function coerceBodyToBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === "string") {
    const sample = body.slice(0, 100);
    if (/^[A-Za-z0-9+/]+=*$/.test(sample)) {
      return Buffer.from(body, "base64");
    }
    return Buffer.from(body, "binary");
  }
  throw new Error("Unexpected renderer response body type");
}

function resolveArtifacts(range: CoverageRange, chunkDir: string): ChunkArtifacts {
  const defaultExtractDir = path.join(chunkDir, "extracted");
  const defaultPagesDir = path.join(chunkDir, "pages");
  const defaultCombined = path.join(chunkDir, "full-content.txt");
  const defaultTar = path.join(chunkDir, "content.tar");

  return {
    extractDir: range.artifacts.extractDir ?? defaultExtractDir,
    pagesDir: range.artifacts.pagesDir ?? range.artifacts.pngDir ?? defaultPagesDir,
    combinedTextPath: range.artifacts.combinedTextPath ?? defaultCombined,
    contentTarPath: range.artifacts.contentTarPath ?? defaultTar,
    ocrSummaryPath: range.artifacts.ocrSummaryPath,
  };
}

async function pathExists(targetPath: string, expectDirectory: boolean): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    await pipelineDebugLog("download.pathExists.success", {
      targetPath,
      expectDirectory,
      isDirectory: stats.isDirectory?.() ?? false,
      isFile: stats.isFile?.() ?? false,
    });
    return expectDirectory ? stats.isDirectory() : stats.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await pipelineDebugLog("download.pathExists.missing", {
        targetPath,
        expectDirectory,
      });
      return false;
    }
    throw error;
  }
}
