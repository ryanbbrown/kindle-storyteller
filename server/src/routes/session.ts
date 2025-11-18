import type { FastifyInstance } from "fastify";
import type { KindleRequiredCookies } from "kindle-api";

import { env } from "../env.js";
import type { SessionStore } from "../session-store.js";
import { serializeBooks } from "../lib/serializers.js";

type SessionRequestBody = {
  cookieString?: string;
  cookies?: Partial<Record<string, string>>;
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
      const cookies = resolveCookies(body);
      const deviceToken = body.deviceToken ?? env.defaultDeviceToken;
      const renderingToken = body.renderingToken ?? env.defaultRenderingToken;
      const rendererRevision =
        body.rendererRevision ?? env.defaultRendererRevision;
      const guid = body.guid ?? env.defaultGuid;
      const tlsServerUrl = body.tlsServerUrl ?? env.tlsServerUrl;
      const tlsApiKey = body.tlsApiKey ?? env.tlsServerApiKey;

      if (!cookies) {
        return reply
          .status(400)
          .send({ message: "Cookies or cookieString is required" } as never);
      }
      if (!deviceToken) {
        return reply
          .status(400)
          .send({ message: "deviceToken is required" } as never);
      }
      if (!renderingToken) {
        return reply
          .status(400)
          .send({ message: "renderingToken is required" } as never);
      }
      if (!rendererRevision) {
        return reply
          .status(400)
          .send({ message: "rendererRevision is required" } as never);
      }
      if (!guid) {
        return reply.status(400).send({ message: "guid is required" } as never);
      }

      try {
        request.log.info(
          {
            renderingTokenProvided: typeof body.renderingToken === "string",
            renderingTokenPreview: renderingToken?.slice(0, 12),
          },
          "Creating Kindle session"
        );
        request.log.info({ guid }, "Received session GUID");
        const session = await store.createSession({
          cookies,
          deviceToken,
          renderingToken,
          rendererRevision,
          guid,
          tlsServer: {
            url: tlsServerUrl,
            apiKey: tlsApiKey,
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

/** Resolves Kindle cookies from the session request body or defaults. */
function resolveCookies(
  body: SessionRequestBody
): string | KindleRequiredCookies | undefined {
  if (body.cookieString && body.cookieString.trim().length > 0) {
    return body.cookieString.trim();
  }

  const candidate = body.cookies ?? {};
  const ubidMain = candidate.ubidMain ?? candidate["ubid-main"];
  const atMain = candidate.atMain ?? candidate["at-main"];
  const sessionId = candidate.sessionId ?? candidate["session-id"];
  const xMain = candidate.xMain ?? candidate["x-main"];

  if (ubidMain && atMain && sessionId && xMain) {
    return {
      ubidMain,
      atMain,
      sessionId,
      xMain,
    };
  }

  if (env.defaultCookieString && env.defaultCookieString.length > 0) {
    return env.defaultCookieString;
  }

  return undefined;
}
