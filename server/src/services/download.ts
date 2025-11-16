/**
 * - ensureChunkDownloaded: exported entry that prepares renderer inputs then calls downloadFreshChunk and resolveArtifacts to return artifacts.
 * - downloadFreshChunk: performs the renderer HTTP request, writes artifacts/metadata, and relies on helpers:
 *   - normalizeRenderOptions: coerces provided render options into renderer-friendly strings.
 *   - buildRendererUrl: builds the Kindle renderer URL with query parameters derived from the normalized config.
 *   - readJsonSafe: loads JSON files from the extracted tar, tolerating missing files.
 *   - findPageDataFile: locates the canonical page_data JSON within extracted renderer output.
 *   - normalizePagePosition: reshapes renderer start/end entries with help from parsePositionOffset.
 *   - parsePositionOffset: validates and truncates offsets coming from renderer metadata.
 *   - coerceBodyToBuffer: converts varying HTTP body encodings into a Buffer for tar extraction.
 *   - buildChunkId: builds deterministic chunk ids from normalized start/end positions.
 * - resolveArtifacts: merges metadata-provided artifact paths with default chunk directory fallbacks.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { Kindle } from "kindle-api";

import { env } from "../env.js";
import { writeChunkMetadata } from "./chunk-metadata-service.js";
import type {
  CoverageRange,
  RendererCoverageMetadata,
} from "../types/chunk-metadata.js";

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
  audioPath?: string;
  audioAlignmentPath?: string;
  audioBenchmarksPath?: string;
};

export type EnsureChunkDownloadedResult = {
  asin: string;
  chunkId: string;
  chunkDir: string;
  metadataPath: string;
  chunkMetadata: RendererCoverageMetadata;
  artifacts: ChunkArtifacts;
};

/** Ensures a Kindle chunk exists locally by downloading it when needed. */
export async function ensureChunkDownloaded(
  options: EnsureChunkDownloadedOptions
): Promise<EnsureChunkDownloadedResult> {
  const { asin, kindle, renderingToken } = options;
  const rendererConfig = normalizeRenderOptions(options.renderOptions);

  const asinDir = path.join(env.storageDir, asin);
  const chunksRoot = path.join(asinDir, "chunks");
  await fs.mkdir(chunksRoot, { recursive: true });

  return await downloadFreshChunk({
    asin,
    kindle,
    renderingToken,
    rendererConfig,
    chunksRoot,
  });
}

/** Downloads a chunk tarball, extracts it, and writes renderer metadata. */
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

  const stagingDir = await fs.mkdtemp(path.join(tempRoot, "render-"));
  const stagingTar = path.join(stagingDir, "content.tar");
  const stagingExtractDir = path.join(stagingDir, "extracted");
  await fs.mkdir(stagingExtractDir, { recursive: true });

  try {
    const response = await kindle.request(
      buildRendererUrl(asin, rendererConfig),
      {
        headers: {
          "x-amz-rendering-token": renderingToken,
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(
        `Renderer request failed: status=${response.status} body=${String(response.body).slice(0, 200)}`
      );
    }

    const buffer = coerceBodyToBuffer(response.body);
    await fs.writeFile(stagingTar, buffer);
    await execFileAsync("tar", ["-xf", stagingTar, "-C", stagingExtractDir]);

    const pageDataPath = await findPageDataFile(stagingExtractDir);
    const pageDataRaw = await fs.readFile(pageDataPath, "utf8");
    const pageData = JSON.parse(pageDataRaw);
    if (!Array.isArray(pageData) || pageData.length === 0) {
      throw new Error("Renderer payload contained no page data");
    }

    const start = normalizePagePosition(pageData[0], "start");
    const end = normalizePagePosition(pageData[pageData.length - 1], "end");
    const chunkId = buildChunkId(start, end);

    const chunkDir = path.join(chunksRoot, chunkId);
    await fs.rm(chunkDir, { recursive: true, force: true });
    await fs.mkdir(chunkDir, { recursive: true });

    const finalTarPath = path.join(chunkDir, "content.tar");
    const finalExtractDir = path.join(chunkDir, "extracted");
    await fs.rename(stagingTar, finalTarPath);
    await fs.rename(stagingExtractDir, finalExtractDir);

    const manifest = await readJsonSafe(path.join(finalExtractDir, "manifest.json"));
    const rendererMetadata = await readJsonSafe(path.join(finalExtractDir, "metadata.json"));
    const toc = await readJsonSafe(path.join(finalExtractDir, "toc.json"));

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

    return {
      asin,
      chunkId,
      chunkDir,
      metadataPath,
      chunkMetadata,
      artifacts: resolveArtifacts(range, chunkDir),
    };
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Converts renderer options into the exact string fields the renderer expects. */
function normalizeRenderOptions(input: RendererConfigInput): RendererConfig {
  return {
    startingPosition: String(input.startingPosition),
    numPage: input.numPages !== undefined ? String(input.numPages) : "5",
    skipPageCount: input.skipPages !== undefined ? String(input.skipPages) : "0",
  };
}

/** Builds the Kindle renderer URL for the requested ASIN and config. */
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

/** Reads JSON if the file exists, otherwise returns null when missing. */
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

/** Locates the renderer page_data JSON file inside the extraction directory. */
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

/** Normalizes a renderer page entry into the CoverageRange start/end format. */
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
  const offset = parsePositionOffset(raw ?? fallback);

  const positionIdValue = page[positionIdKey];
  const positionId = typeof positionIdValue === "number" ? Math.trunc(positionIdValue) : undefined;

  return {
    raw: raw !== undefined ? String(raw) : "",
    offset,
    normalized: offset.toString(),
    positionId,
  };
}

/** Parses a renderer offset string/number into a sanitized integer. */
function parsePositionOffset(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Non-finite numeric position value");
    }
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("Empty position string");
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Unable to parse numeric position from string: ${value}`);
    }
    return Math.trunc(parsed);
  }
  throw new Error("Position value missing");
}

/** Converts the renderer body payload into a Buffer regardless of encoding. */
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

/** Builds a deterministic chunk id from renderer start/end metadata ranges. */
function buildChunkId(start: CoverageRange["start"], end: CoverageRange["end"]): string {
  const startId = typeof start.positionId === "number" ? Math.trunc(start.positionId) : undefined;
  const endId = typeof end.positionId === "number" ? Math.trunc(end.positionId) : undefined;
  if (Number.isFinite(startId) && Number.isFinite(endId)) {
    return `chunk_pid_${startId}_${endId}`;
  }
  return `chunk_pos_${start.offset}_${end.offset}`;
}

/** Builds chunk artifact paths by combining stored metadata defaults and fallbacks. */
export function resolveArtifacts(
  range: CoverageRange,
  chunkDir: string,
): ChunkArtifacts {
  const defaultExtractDir = path.join(chunkDir, "extracted");
  const defaultPagesDir = path.join(chunkDir, "pages");
  const defaultCombined = path.join(chunkDir, "full-content.txt");
  const defaultTar = path.join(chunkDir, "content.tar");

  return {
    extractDir: range.artifacts.extractDir ?? defaultExtractDir,
    pagesDir: range.artifacts.pagesDir ?? range.artifacts.pngDir ?? defaultPagesDir,
    combinedTextPath: range.artifacts.combinedTextPath ?? defaultCombined,
    contentTarPath: range.artifacts.contentTarPath ?? defaultTar,
    audioPath: range.artifacts.audioPath,
    audioAlignmentPath: range.artifacts.audioAlignmentPath,
    audioBenchmarksPath: range.artifacts.audioBenchmarksPath,
  };
}
