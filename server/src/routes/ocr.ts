import type { FastifyInstance } from "fastify";

import { requireSession } from "../utils/auth.js";
import type { SessionStore } from "../session-store.js";
import { downloadAndExtractContent } from "../services/content-service.js";
import { runGlyphPipeline } from "../services/glyph-service.js";

type OcrParams = {
  asin: string;
};

type OcrBody = {
  refresh?: boolean;
  startPage?: number;
  maxPages?: number;
};

type OcrResponse = {
  asin: string;
  pages: Array<{
    index: number;
    png: string;
    textPath: string | null;
  }>;
  totalPages: number;
  processedPages: number;
  combinedTextPath: string | null;
  ocrEnabled: boolean;
  cached: boolean;
};

export async function registerOcrRoutes(
  app: FastifyInstance,
  store: SessionStore
): Promise<void> {
  app.post<{
    Params: OcrParams;
    Body: OcrBody;
    Reply: OcrResponse;
  }>("/books/:asin/ocr", async (request, reply) => {
    const session = requireSession(store, request, reply);
    if (!session) {
      return;
    }

    const asin = request.params.asin?.trim();
    if (!asin) {
      return reply
        .status(400)
        .send({ message: "asin is required" } as never);
    }

    const refresh = Boolean(request.body?.refresh);
    const startPage = request.body?.startPage ?? 0;
    const maxPages = request.body?.maxPages ?? 5;

    let content = session.contentCache.get(asin);
    if (!content || refresh) {
      content = await downloadAndExtractContent({
        asin,
        renderingToken: session.renderingToken,
        kindle: session.kindle,
        refresh,
      });
      session.contentCache.set(asin, content);
    }

    if (!refresh) {
      const cachedResult = session.glyphCache.get(asin);
      if (cachedResult) {
        return reply.send({
          asin,
          pages: normalizePages(cachedResult.pages),
          totalPages: cachedResult.total_pages,
          processedPages: cachedResult.processed_pages,
          combinedTextPath: cachedResult.combined_text_path,
          ocrEnabled: cachedResult.ocr_enabled,
          cached: true,
        });
      }
    }

    const result = await runGlyphPipeline({
      asin,
      extractDir: content.extractDir,
      startPage,
      maxPages,
    });

    session.glyphCache.set(asin, result);

    return reply.status(201).send({
      asin,
      pages: normalizePages(result.pages),
      totalPages: result.total_pages,
      processedPages: result.processed_pages,
      combinedTextPath: result.combined_text_path,
      ocrEnabled: result.ocr_enabled,
      cached: false,
    });
  });
}

function normalizePages(
  pages: Array<{ index: number; png: string; text_path?: string | null }>
) {
  return pages.map((page) => ({
    index: page.index,
    png: page.png,
    textPath: page.text_path ?? null,
  }));
}
