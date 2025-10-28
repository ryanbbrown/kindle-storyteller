import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { SessionStore } from "../session-store.js";
import { requireSession } from "../utils/auth.js";
import { tryParseJson } from "../lib/json.js";

type ProgressParams = {
  asin: string;
};

type ProgressBody = {
  position?: number | string;
};

type ProgressResponse = {
  success: boolean;
  upstreamStatus: number;
  payload: unknown;
};

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
        upstreamStatus: 400,
        payload: { message: "asin is required" },
      });
    }

    const positionValue = request.body?.position;
    if (positionValue === undefined || positionValue === null || positionValue === "") {
      return reply.status(400).send({
        success: false,
        upstreamStatus: 400,
        payload: { message: "position is required" },
      });
    }

    const position = String(positionValue);
    const adpSessionToken = session.kindle.client.getAdpSessionId();

    if (!adpSessionToken) {
      request.log.error("Missing ADP session token");
      return reply.status(500).send({
        success: false,
        upstreamStatus: 500,
        payload: { message: "ADP session token unavailable; reauthenticate" },
      });
    }

    const kindleSessionId = randomUUID();
    const timezoneOffset = new Date().getTimezoneOffset();
    const stillReadingUrl = buildStillReadingUrl(
      asin,
      session.guid,
      position,
      kindleSessionId,
      timezoneOffset
    );

    const response = await session.kindle.request(stillReadingUrl, {
      headers: {
        "x-adp-session-token": adpSessionToken,
        referer: `https://read.amazon.com/?asin=${asin}`,
      },
    });

    const parsed = tryParseJson(response.body);
    const payload = parsed ?? response.body ?? null;
    const success = response.status >= 200 && response.status < 300;

    return reply.status(success ? 200 : 502).send({
      success,
      upstreamStatus: response.status,
      payload,
    });
  });
}

function buildStillReadingUrl(
  asin: string,
  guid: string,
  position: string,
  kindleSessionId: string,
  timezoneOffset: number
): string {
  const base = "https://read.amazon.com/service/mobile/reader/stillReading";
  const params =
    `?asin=${encodeURIComponent(asin)}` +
    `&guid=${guid}` +
    `&kindleSessionId=${encodeURIComponent(kindleSessionId)}` +
    `&lastPageRead=${encodeURIComponent(position)}` +
    `&positionType=YJBinary` +
    `&localTimeOffset=${encodeURIComponent(String(-timezoneOffset))}` +
    `&clientVersion=20000100`;

  return `${base}${params}`;
}
