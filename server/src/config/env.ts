import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

loadEnv();
loadEnv({
  path: path.resolve(currentDir, "../../../kindle-api/.env"),
  override: false,
});

const hourInMs = 60 * 60 * 1000;

export const env = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  host: process.env.HOST ?? "0.0.0.0",
  tlsServerUrl: process.env.TLS_SERVER_URL ?? "http://localhost:8080",
  tlsServerApiKey: process.env.TLS_SERVER_API_KEY ?? "",
  sessionTtlMs: Number.parseInt(
    process.env.SESSION_TTL_MS ?? String(4 * hourInMs),
    10
  ),
  logLevel: (process.env.LOG_LEVEL as "fatal" | "error" | "warn" | "info" | "debug" | "trace") ?? "info",
  storageDir:
    process.env.CONTENT_STORAGE_DIR ??
    path.resolve(currentDir, "../../data/books"),
  ttsProvider: (process.env.TTS_PROVIDER as "elevenlabs" | "cartesia") ?? "elevenlabs",
};

export type Env = typeof env;
