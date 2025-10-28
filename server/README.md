# Kindle Backend

## Overview
Node/TypeScript Fastify service that wraps the `kindle-api` library, proxies renderer downloads through `tls-client`, runs the glyph/OCR pipeline (Python), and exposes REST endpoints for the iOS client. Single-user deployments keep session state and extracted files on local disk.

## Core Modules

### 1. HTTP Server (Fastify)
Defines routes in `src/routes/` for session setup, book listing, renderer download, glyph pipeline, reading-progress updates, and streaming OCR text. `session.ts` exposes the public `POST /session` entry point; every other route expects a `sessionId` via `Authorization: Bearer <token>` and delegates work to services.

- `session.ts` → `POST /session`: validate cookies/device token/render token/GUID, create session, return `sessionId` + initial books.
- `content.ts` → `POST /books/:asin/content`: download renderer TAR, extract metadata; honors `renderOptions` (starting position, page count).
- `ocr.ts` → `POST /books/:asin/ocr`: run glyph/OCR pipeline (calls content service if needed) and cache PNG/TXT paths.
- `text.ts` → `GET /books/:asin/text`: stream a slice of the combined OCR text (`start`/`length` query params).
- `progress.ts` → `POST /books/:asin/progress`: proxy Kindle `stillReading` to update position using cached ADP token/GUID.

Non-core
- `books.ts` → `GET /books`: list cached Kindle books (refresh via `?refresh=true`).

### 2. Session Store
`SessionStore` creates Kindle clients from supplied cookies/device token, caches renderer/glyph results, and tracks TTL. In-memory only; session id is a UUID returned from `/session`.

### 3. Content Service
`downloadAndExtractContent` hits Amazon’s renderer with TLS client, stores the `.tar` bundle under `server/data/books/<asin>/renderer/`, and extracts glyph/token metadata. Allows caller to override `startingPosition`, `numPage`, `skipPageCount`.

### 4. Glyph Pipeline Service
`runGlyphPipeline` invokes the Python pipeline (`glyph-extraction/pipeline.py`). Renders pages to PNG, runs Tesseract when available, writes OCR output under `server/data/books/<asin>/ocr/`, and returns metadata JSON.

## Data Flow

```
POST /session → SessionStore.create → Kindle.fromConfig (cookies, device token)
          ↓
GET /books → session.kindle.books() → cache
          ↓
POST /books/:asin/content → downloadAndExtractContent → renderer .tar + JSON
          ↓
POST /books/:asin/ocr → runGlyphPipeline → PNG + OCR text
          ↓
GET /books/:asin/text?start&length → stream combined.txt slice
          ↓
POST /books/:asin/progress → Kindle.stillReading() (ADP session token)
```

## Layout & Scripts

```
server/
├── src/
│   ├── app.ts              # Fastify bootstrap + route registration
│   ├── session-store.ts    # Session context map, TTL GC
│   ├── routes/             # session, books, content, pipeline, text, progress
│   ├── services/           # content-service, glyph-service, (auth utils)
│   └── env.ts              # dotenv loader + defaults (storageDir, TLS)
├── data/
│   ├── .gitkeep            # Persist directory structure
│   └── books/<asin>/...    # Renderer and OCR artifacts (ignored by git)
└── scripts/
    └── test-api.ts         # Smoke test: session → books → content → extract → text
```

## Running & Testing
1. Start TLS client proxy on `http://localhost:8080`.
2. Populate `kindle-api/.env` with cookies, device token, GUID, rendering token.
3. From `server/`: `pnpm install` (once), `pnpm dev` to run Fastify.
4. In another terminal: `pnpm test:api` to exercise the full flow (requires valid tokens).

## Session Token Usage
- `POST /session` returns `{ sessionId, expiresInMs }`.
- Include `Authorization: Bearer <sessionId>` (or `x-session-id`) on every subsequent call.
- Sessions expire after `SESSION_TTL_MS` or on server restart; rerun `/session` to renew.
