import type { FastifyInstance } from "fastify";

import { requireSession } from "../utils/auth.js";
import type { SessionStore } from "../session-store.js";
import { downloadAndExtractContent } from "../services/content-service.js";

type ContentParams = {
  asin: string;
};

type ContentBody = {
  renderOptions?: {
    startingPosition?: number | string;
    numPage?: number;
    skipPageCount?: number;
  };
};

type ContentResponse = {
  asin: string;
  textPreview: string;
  textLength: number;
  metadata: unknown;
  manifest: unknown;
  toc: unknown;
  cached: boolean;
};

export async function registerContentRoutes(
  app: FastifyInstance,
  store: SessionStore
): Promise<void> {
  app.post<{ Params: ContentParams; Body: ContentBody; Reply: ContentResponse }>(
    "/books/:asin/content",
    async (request, reply) => {
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

      const cached = session.contentCache.get(asin);
      if (cached) {
        return reply.send({
          asin: cached.asin,
          textPreview: cached.textPreview,
          textLength: cached.textLength,
          metadata: cached.metadata,
          manifest: cached.manifest,
          toc: cached.toc,
          cached: true,
        });
      }

      request.log.info(
        {
          asin,
          renderingTokenPreview: session.renderingToken.slice(0, 12),
        },
        "Rendering book content"
      );

      const payload = await downloadAndExtractContent({
        asin,
        renderingToken: session.renderingToken,
        kindle: session.kindle,
        renderOptions: request.body?.renderOptions,
      });

      session.contentCache.set(asin, payload);

      return reply.status(201).send({
        asin: payload.asin,
        textPreview: payload.textPreview,
        textLength: payload.textLength,
        metadata: payload.metadata,
        manifest: payload.manifest,
        toc: payload.toc,
        cached: false,
      });
    }
  );
}
