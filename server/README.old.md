# Backend Guide

## How the Test Script works
- The helper `fetchJson` in `scripts/test-api.ts` is just a small wrapper around `fetch`; it sends HTTP requests to the Fastify server and parses the responses. There is nothing special about it—each request still hits the REST endpoint directly.
- `pnpm test:api` assumes the server is already running and performs two calls:
  1. `POST /session` with cookies, device token, rendering token, GUID, and TLS proxy info.
  2. `GET /books` with the returned session id in the `Authorization` header.
- Output is printed to the terminal so you can quickly verify that the backend is reachable and authenticated.

## Session lifecycle
1. The client sends credentials to `POST /session`.
2. The route invokes `SessionStore.createSession`, which internally calls `Kindle.fromConfig` from the `kindle-api` library.
3. `SessionStore` creates a UUID (`sessionId`) and stores a `SessionContext` inside an in-memory `Map`.
4. The response includes only the UUID. The full context (Kindle client, renderer token, GUID, cached books) remains on the server.

## Request flow
- Every authenticated request includes `Authorization: Bearer <sessionId>` (alternatively `x-session-id` or `?sessionId=`).
- Each route calls `requireSession`, which looks up the `sessionId` in the store and returns the associated context if it exists and hasn’t expired.
- Nothing is attached to the Fastify request object; routes simply pull the session from the store and use it to satisfy the request.
- Sessions stay in memory until they expire or the server restarts; no persistence yet. A background GC pass clears idle sessions based on `SESSION_TTL_MS`.
