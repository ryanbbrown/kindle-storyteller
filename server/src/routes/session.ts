import type { FastifyInstance } from "fastify";

import { env } from "../config/env.js";
import type { SessionStore } from "../session-store.js";
import { serializeBooks } from "../utils/serializers.js";

type SessionRequestBody = {
  cookieString?: string;
  deviceToken?: string;
  renderingToken?: string;
  rendererRevision?: string;
  guid?: string;
  tlsServerUrl?: string;
  tlsApiKey?: string;
};

type SessionResponse = {
  sessionId: string;
  expiresInMs: number;
  books: ReturnType<typeof serializeBooks>;
};

/** Registers the session routes for Kindle sessions. */
export async function registerSessionRoutes(
  app: FastifyInstance,
  store: SessionStore
): Promise<void> {
  app.post<{ Body: SessionRequestBody; Reply: SessionResponse }>(
    "/session",
    async (request, reply) => {
      const body = request.body ?? {};

      try {
        const session = await store.createSession({
          cookies: body.cookieString ?? "",
          deviceToken: body.deviceToken ?? "",
          renderingToken: body.renderingToken,
          rendererRevision: body.rendererRevision,
          guid: body.guid,
          tlsServer: {
            url: body.tlsServerUrl ?? env.tlsServerUrl,
            apiKey: body.tlsApiKey ?? env.tlsServerApiKey,
          },
        });

        return reply.status(201).send({
          sessionId: session.id,
          expiresInMs: env.sessionTtlMs,
          books: serializeBooks(session.booksCache),
        });
      } catch (error) {
        request.log.error({ err: error }, "Failed to create session");
        return reply
          .status(401)
          .send({ message: "Failed to authenticate with Kindle" } as never);
      }
    }
  );
}
