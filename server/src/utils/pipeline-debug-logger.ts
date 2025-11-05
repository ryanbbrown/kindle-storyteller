import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../env.js";

const LOG_FILE = path.join(env.storageDir, "pipeline-debug.log");

async function ensureLogDir(): Promise<void> {
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
}

export async function pipelineDebugLog(
  label: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    await ensureLogDir();
    const timestamp = new Date().toISOString();
    const payload = data ? JSON.stringify(data, replacer, 2) : "";
    const lines = [
      `=== ${timestamp} :: ${label} ===`,
      payload,
      "",
    ].join("\n");
    await fs.appendFile(LOG_FILE, `${lines}\n`, "utf8");
  } catch (error) {
    // Swallow logging errors to avoid cascading failures.
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

export function getPipelineLogPath(): string {
  return LOG_FILE;
}
