import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../config/env.js";
import type { SessionContext, SessionStore } from "../session-store.js";

/** Validates the X-API-Key header against the configured server API key. */
export function requireApiKey(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.serverApiKey) {
    return true;
  }

  const apiKey = request.headers["x-api-key"];
  if (!apiKey) {
    request.log.warn({ url: request.url }, "Missing API key");
    reply.status(401).send({ error: "Missing API key" });
    return false;
  }

  if (apiKey !== env.serverApiKey) {
    request.log.warn({ url: request.url }, "Invalid API key");
    reply.status(401).send({ error: "Invalid API key" });
    return false;
  }

  return true;
}

export function extractSessionId(
  request: FastifyRequest
): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }

  const sessionHeader = request.headers["x-session-id"];
  if (typeof sessionHeader === "string") {
    return sessionHeader.trim();
  }

  const query = request.query as Record<string, unknown> | undefined;
  const queryValue = query?.sessionId;
  if (typeof queryValue === "string") {
    return queryValue.trim();
  }

  return undefined;
}

export function requireSession(
  store: SessionStore,
  request: FastifyRequest,
  reply: FastifyReply
): SessionContext | undefined {
  const sessionId = extractSessionId(request);
  if (!sessionId) {
    void reply.status(401).send({ message: "Missing session token" });
    return undefined;
  }

  const session = store.get(sessionId);
  if (!session) {
    void reply.status(401).send({ message: "Invalid or expired session" });
    return undefined;
  }

  return session;
}
