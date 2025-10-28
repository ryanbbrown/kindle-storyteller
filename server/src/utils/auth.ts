import type { FastifyReply, FastifyRequest } from "fastify";

import type { SessionContext, SessionStore } from "../session-store.js";

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
