import type { FastifyInstance } from "fastify";

import type { SessionStore } from "../session-store.js";
import { requireSession } from "../utils/auth.js";

type ProgressParams = {
  asin: string;
};

type ProgressBody = {
  position?: number | string;
};

type ProgressResponse = {
  success: boolean;
  status: number;
};

/** Registers progress sync routes for Kindle reading position. */
export async function registerProgressRoutes(
  app: FastifyInstance,
  store: SessionStore
): Promise<void> {
  app.post<{
    Params: ProgressParams;
    Body: ProgressBody;
    Reply: ProgressResponse;
  }>("/books/:asin/progress", async (request, reply) => {
    const session = requireSession(store, request, reply);
    if (!session) {
      return;
    }

    const asin = request.params.asin?.trim();
    if (!asin) {
      return reply.status(400).send({
        success: false,
        status: 400,
      } as any);
    }

    const positionValue = request.body?.position;
    if (positionValue === undefined || positionValue === null || positionValue === "") {
      return reply.status(400).send({
        success: false,
        status: 400,
      } as any);
    }

    const position = String(positionValue);
    request.log.debug({ asin, position }, "Syncing reading progress");

    try {
      const result = await session.kindle.stillReading({ asin, position });
      request.log.debug({ asin, success: result.success }, "Progress sync complete");
      return reply.status(result.success ? 200 : 502).send(result);
    } catch (error) {
      request.log.error({ err: error, asin }, "stillReading failed");
      return reply.status(500).send({
        success: false,
        status: 500,
      });
    }
  });
}
