import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { env } from "../env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
const glyphExtractionDir = path.join(projectRoot, "glyph-extraction");
const execFileAsync = promisify(execFile);

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

export type GlyphPipelineOptions = {
  asin: string;
  extractDir: string;
  startPage?: number;
  maxPages?: number;
};

export type GlyphPipelineResult = PipelineSummary & {
  outputDir: string;
};

export async function runGlyphPipeline(
  options: GlyphPipelineOptions
): Promise<GlyphPipelineResult> {
  const { asin, extractDir, startPage = 0, maxPages = 5 } = options;

  const outputDir = path.join(env.storageDir, asin, "ocr");
  await fs.mkdir(outputDir, { recursive: true });

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

  for (const { cmd, args } of commands) {
    try {
      const { stdout } = await execFileAsync(cmd, args, {
        cwd: glyphExtractionDir,
        env: process.env,
        encoding: "utf8",
      } as const);

      const payload = parseSummary(stdout);
      return {
        ...payload,
        outputDir,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stderr?: string };
      if (err.code === "ENOENT") {
        lastError = err;
        continue;
      }
      const details = err.stderr ? `${err.message}\n${err.stderr}` : err.message;
      throw new Error(`Glyph pipeline failed using ${cmd}: ${details}`);
    }
  }

  throw new Error(
    `Unable to execute glyph pipeline; ensure Python/uv is installed. Last error: ${
      lastError?.message ?? "unknown"
    }`
  );
}

function parseSummary(raw: string): PipelineSummary {
  try {
    return JSON.parse(raw) as PipelineSummary;
  } catch (error) {
    throw new Error(
      `Failed to parse glyph pipeline output: ${(error as Error).message}. Raw output: ${raw}`
    );
  }
}
