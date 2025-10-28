import fs from "node:fs/promises";
import path from "node:path";

import { config as loadEnv } from "dotenv";

const projectRoot = path.resolve(process.cwd(), "..");
const kindleEnvPath = path.join(projectRoot, "kindle-api", ".env");

loadEnv({ path: kindleEnvPath });
loadEnv();

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";

async function main() {
  const cookieString = await resolveCookieString();
  const deviceToken = requiredEnv("DEVICE_TOKEN");
  const renderingToken = requiredEnv("RENDERING_TOKEN");
  const guid = requiredEnv("GUID");
  const tlsServerUrl = process.env.TLS_SERVER_URL ?? "http://localhost:8080";
  const tlsApiKey = process.env.TLS_SERVER_API_KEY ?? "";

  console.log("Creating session...");
  const sessionResponse = await fetchJson(`${API_BASE_URL}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cookieString,
      deviceToken,
      renderingToken,
      guid,
      tlsServerUrl,
      tlsApiKey,
    }),
  });

  if (sessionResponse.status >= 400) {
    console.error("Failed to create session:", sessionResponse.data);
    process.exit(1);
  }

  const { sessionId } = sessionResponse.data as {
    sessionId: string;
  };

  console.log("Session created:", sessionId);

  console.log("\nFetching books...");
  const booksResponse = await fetchJson(`${API_BASE_URL}/books`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${sessionId}`,
    },
  });

  if (booksResponse.status >= 400) {
    console.error("Failed to fetch books:", booksResponse.data);
    process.exit(1);
  }

  const { books } = booksResponse.data as {
    books: Array<{ asin: string; title: string }>;
  };

  console.log(`Fetched ${books.length} book(s)`);
  books.slice(0, 5).forEach((book, index) => {
    console.log(`${index + 1}. ${book.title} (${book.asin})`);
  });

  if (books.length > 0) {
    const target = books[0];
    console.log(`\nRequesting content for ${target.title} (${target.asin})...`);
    const contentResponse = await fetchJson(
      `${API_BASE_URL}/books/${encodeURIComponent(target.asin)}/content`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionId}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          renderOptions: {
            startingPosition: 2792593,
            numPage: 3,
            skipPageCount: 0,
          },
        }),
      }
    );

    if (contentResponse.status >= 400) {
      console.error("Failed to fetch book content:", contentResponse.data);
      process.exit(1);
    }

    const content = contentResponse.data as {
      textLength: number;
      textPreview: string;
      cached: boolean;
    };

    console.log(
      `Content fetched. Stored text length=${content.textLength}, cached=${content.cached}`
    );
    console.log("Preview:\n" + content.textPreview.slice(0, 200));

    console.log("\nRunning glyph pipeline...\n");
    const pipelineResponse = await fetchJson(
      `${API_BASE_URL}/books/${encodeURIComponent(target.asin)}/ocr`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionId}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ maxPages: 2 }),
      }
    );

    if (pipelineResponse.status >= 400) {
      console.error("Glyph pipeline failed:", pipelineResponse.data);
      process.exit(1);
    }

    const pipeline = pipelineResponse.data as {
      totalPages: number;
      processedPages: number;
      pages: Array<{ index: number; png: string; text_path: string | null }>;
      combinedTextPath: string | null;
      ocrEnabled: boolean;
      cached: boolean;
    };

    console.log(
      `Glyph pipeline processed ${pipeline.processedPages}/${pipeline.totalPages} pages (cached=${pipeline.cached})`
    );
    console.log("OCR enabled:", pipeline.ocrEnabled);
    console.log("First page output:", pipeline.pages[0]);

    console.log("\nFetching text segment...\n");
    const textResponse = await fetchJson(
      `${API_BASE_URL}/books/${encodeURIComponent(target.asin)}/text?start=0&length=500`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${sessionId}`,
        },
      }
    );

    if (textResponse.status >= 400) {
      console.error("Failed to fetch text segment:", textResponse.data);
      process.exit(1);
    }

    const textPayload = textResponse.data as {
      text: string;
      bytesRead: number;
      hasMore: boolean;
    };

    console.log(
      `Received ${textPayload.bytesRead} bytes (hasMore=${textPayload.hasMore}):\n`
    );
    console.log(textPayload.text);
  }
}

void main().catch((error) => {
  console.error("Test script failed:", error);
  process.exit(1);
});

type FetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

async function fetchJson(
  url: string,
  options: FetchOptions
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(url, options);
  let payload: unknown = null;

  const contentType = response.headers.get("Content-Type");
  if (contentType?.includes("application/json")) {
    payload = await response.json();
  } else {
    payload = await response.text();
  }

  return {
    status: response.status,
    data: payload,
  };
}

async function resolveCookieString(): Promise<string> {
  if (process.env.COOKIES && process.env.COOKIES.trim().length > 0) {
    return process.env.COOKIES.trim();
  }

  const cookieFilePath = path.join(projectRoot, "kindle-api", "cookie.txt");
  const buffer = await fs.readFile(cookieFilePath, "utf8");

  if (!buffer || buffer.trim().length === 0) {
    throw new Error(
      "Cookie string not found. Populate COOKIES in kindle-api/.env or cookie.txt"
    );
  }

  return buffer.trim();
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}
