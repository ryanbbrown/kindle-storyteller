import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

import type { Kindle } from "kindle-api";

import { env } from "../env.js";

const execFileAsync = promisify(execFile);

export type RenderOptions = {
  asin: string;
  renderingToken: string;
  kindle: Kindle;
  refresh?: boolean;
  renderOptions?: RendererConfigInput;
};

type RendererConfigInput = {
  startingPosition?: number | string;
  numPage?: number | string;
  skipPageCount?: number | string;
};

type RendererConfig = {
  startingPosition: string;
  numPage: string;
  skipPageCount: string;
};

export type ContentPayload = {
  asin: string;
  manifest: unknown;
  metadata: unknown;
  toc: unknown;
  textPreview: string;
  textLength: number;
  extractDir: string;
  tarPath: string;
};

export async function downloadAndExtractContent(
  options: RenderOptions
): Promise<ContentPayload> {
  const { asin, renderingToken, kindle, refresh = false } = options;

  const asinDir = path.join(env.storageDir, asin);
  const rendererDir = path.join(asinDir, "renderer");
  const extractDir = path.join(rendererDir, "extracted");
  const tarPath = path.join(rendererDir, "book-content.tar");

  await fs.mkdir(rendererDir, { recursive: true });

  if (refresh) {
    await fs.rm(tarPath, { force: true });
    await fs.rm(extractDir, { recursive: true, force: true });
  }

  const tarExists = await fileExists(tarPath);
  const extractReady = await directoryHasContent(extractDir);

  if (!refresh && tarExists && extractReady) {
    const manifest = await readJsonSafe(path.join(extractDir, "manifest.json"));
    const metadata = await readJsonSafe(path.join(extractDir, "metadata.json"));
    const toc = await readJsonSafe(path.join(extractDir, "toc.json"));
    const textPreview = await extractTextPreview(extractDir);

    return {
      asin,
      manifest,
      metadata,
      toc,
      textPreview: textPreview.preview,
      textLength: textPreview.length,
      extractDir,
      tarPath,
    };
  }

  await fs.rm(extractDir, { recursive: true, force: true });
  await fs.mkdir(extractDir, { recursive: true });

    const rendererConfig = normalizeRenderOptions(
      options.renderOptions
    );

    const renderResponse = await kindle.request(
      buildRendererUrl(asin, rendererConfig),
      {
        headers: {
          "x-amz-rendering-token": renderingToken,
        },
      }
    );

  if (renderResponse.status !== 200) {
    throw new Error(
      `Renderer request failed: status=${renderResponse.status} body=${renderResponse.body?.slice(
        0,
        200
      )}`
    );
  }

  const buffer = toBuffer(renderResponse.body);
  await fs.writeFile(tarPath, buffer);

  await execFileAsync("tar", ["-xf", tarPath, "-C", extractDir]);

  const manifest = await readJsonSafe(path.join(extractDir, "manifest.json"));
  const metadata = await readJsonSafe(path.join(extractDir, "metadata.json"));
  const toc = await readJsonSafe(path.join(extractDir, "toc.json"));

  const textPreview = await extractTextPreview(extractDir);

  return {
    asin,
    manifest,
    metadata,
    toc,
    textPreview: textPreview.preview,
    textLength: textPreview.length,
    extractDir,
    tarPath,
  };
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

function normalizeRenderOptions(
  input?: RendererConfigInput
): RendererConfig {
  return {
    startingPosition:
      input?.startingPosition !== undefined
        ? String(input.startingPosition)
        : "2792593",
    numPage:
      input?.numPage !== undefined ? String(input.numPage) : "5",
    skipPageCount:
      input?.skipPageCount !== undefined ? String(input.skipPageCount) : "0",
  };
}

function toBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === "string") {
    if (/^[A-Za-z0-9+/]+=*$/.test(body.substring(0, 100))) {
      return Buffer.from(body, "base64");
    }
    return Buffer.from(body, "binary");
  }
  throw new Error("Unexpected renderer response body type");
}

async function readJsonSafe(filePath: string): Promise<unknown> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function directoryHasContent(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function extractTextPreview(dir: string): Promise<{
  preview: string;
  length: number;
}> {
  const entries = await fs.readdir(dir);
  const tokenFiles = entries.filter((file) => file.startsWith("tokens_"));
  let aggregated = "";

  for (const tokenFile of tokenFiles.sort()) {
    const tokensRaw = await fs.readFile(path.join(dir, tokenFile), "utf8");
    const tokens = JSON.parse(tokensRaw) as unknown;
    const text = extractTextFromTokens(tokens);
    aggregated += text;
    if (aggregated.length > 5000) {
      break;
    }
  }

  return {
    preview: aggregated.slice(0, 2000),
    length: aggregated.length,
  };
}

function extractTextFromTokens(payload: unknown): string {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && "text" in entry) {
          const value = (entry as Record<string, unknown>).text;
          return typeof value === "string" ? value : "";
        }
        if (entry && typeof entry === "object" && "content" in entry) {
          const value = (entry as Record<string, unknown>).content;
          return typeof value === "string" ? value : "";
        }
        if (entry && typeof entry === "object" && "value" in entry) {
          const value = (entry as Record<string, unknown>).value;
          return typeof value === "string" ? value : "";
        }
        return "";
      })
      .join("");
  }

  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as Record<string, unknown>).tokens)
  ) {
    return extractTextFromTokens(
      (payload as Record<string, unknown>).tokens
    );
  }

  return "";
}
