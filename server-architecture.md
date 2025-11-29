# Server Architecture

The server is a Fastify API that bridges authenticated Kindle sessions with AI-powered audiobook generation. It handles Kindle content rendering, OCR text extraction, and text-to-speech synthesis.

## Dependencies

The server uses [`kindle-api`](https://github.com/ryanbbrown/kindle-api) (installed from GitHub) to handle all Kindle API interactions including authentication, library fetching, content rendering, and reading progress sync. This abstracts away the low-level HTTP requests and token management.

## File Structure

```
server/
├── src/
│   ├── index.ts              # Entry point, starts server
│   ├── app.ts                # Fastify app setup, registers routes
│   ├── session-store.ts      # In-memory Kindle session management
│   ├── routes/
│   │   ├── session.ts        # POST /session - authenticate with Kindle
│   │   ├── books.ts          # GET /books/:asin/full-details
│   │   ├── pipeline.ts       # POST /books/:asin/pipeline - run audiobook generation
│   │   ├── chunk-audio.ts    # GET /books/:asin/chunks/:chunkId/audio
│   │   ├── progress.ts       # POST /books/:asin/progress - sync reading position
│   │   └── benchmarks.ts     # Audio benchmark data endpoints
│   ├── services/
│   │   ├── chunk-pipeline.ts # Orchestrates download → OCR → LLM → TTS stages
│   │   ├── download.ts       # Downloads content via kindle-api renderChunk
│   │   ├── ocr.ts            # Runs text-extraction Python pipeline
│   │   ├── llm.ts            # OpenAI text transformation for TTS
│   │   ├── chunk-metadata-service.ts  # Reads/writes chunk metadata JSON
│   │   └── tts/
│   │       ├── index.ts      # TTS barrel export
│   │       ├── elevenlabs.ts # ElevenLabs TTS with character timestamps
│   │       ├── cartesia.ts   # Cartesia TTS alternative
│   │       └── utils.ts      # Text normalization, benchmark generation
│   ├── config/
│   │   ├── env.ts            # Environment variable parsing
│   │   ├── llm.ts            # OpenAI config (model, prompts)
│   │   ├── elevenlabs.ts     # ElevenLabs config (voice, model, limits)
│   │   └── cartesia.ts       # Cartesia config
│   ├── types/
│   │   ├── audio.ts          # TTS-related type definitions
│   │   └── chunk-metadata.ts # Chunk coverage range types
│   └── utils/
│       ├── auth.ts           # Session validation helper
│       ├── serializers.ts    # Book/details serialization
│       └── benchmarks.ts     # Benchmark file loading
└── data/books/               # Generated content storage
```

## Core Flow

### 1. Session Management

Sessions are created via `POST /session` with Kindle credentials:
- Cookies, device token, rendering token, renderer revision, and GUID
- Credentials are passed to `Kindle.fromConfig()` which handles authentication
- Returns a session ID used in subsequent requests via `X-Session-Id` header
- Sessions expire after 4 hours (configurable via `SESSION_TTL_MS`)
- Automatic garbage collection removes expired sessions

### 2. Audiobook Pipeline

The pipeline (`POST /books/:asin/pipeline`) runs up to four stages:

```
Download → OCR → LLM (optional) → TTS
```

**Download** (`services/download.ts`):
- Calls `kindle.renderChunk()` to fetch rendered book pages
- Extracts the TAR response containing page images and position data
- Writes chunk metadata with position ID ranges

**OCR** (`services/ocr.ts`):
- Invokes the `text-extraction` Python pipeline via `uv run python pipeline.py`
- Extracts text from rendered page images
- Outputs combined text file (`full-content.txt`)

**LLM** (`services/llm.ts`) - optional:
- Transforms extracted text for better TTS narration using OpenAI
- Provider-specific prompts optimize output for ElevenLabs vs Cartesia
- Outputs provider-specific content file (`{provider}-content.txt`)
- Skip with `skipLlmPreprocessing: true` in pipeline request
- Requires `OPENAI_API_KEY` environment variable

**TTS** (`services/tts/*.ts`):
- Supports ElevenLabs or Cartesia providers (selected per-request)
- Generates audio with character-level timestamp alignment
- Creates benchmark entries mapping audio time → Kindle position IDs
- Enables synchronized reading position updates during playback

### 3. Caching & Artifacts

Content is cached in `data/books/{asin}/chunks/{chunkId}/`:
- `metadata.json` - chunk position ranges and artifact paths
- `extracted/` - raw renderer output
- `pages/` - processed page images
- `full-content.txt` - extracted text from OCR
- `{provider}-content.txt` - LLM-preprocessed text (per TTS provider)
- `audio/audio.mp3` - generated audiobook audio
- `audio/alignment.json` - character-to-timestamp mapping
- `audio/benchmarks.json` - time-indexed position lookups

The pipeline checks for existing artifacts and skips completed stages.

## API Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/session` | Create authenticated Kindle session (returns books list) |
| GET | `/books/:asin/full-details` | Get book metadata and cover |
| POST | `/books/:asin/pipeline` | Generate audiobook chunk |
| GET | `/books/:asin/chunks/:chunkId/audio` | Stream audio file |
| GET | `/books/:asin/chunks/:chunkId/benchmarks` | Get audio timestamp-to-position mapping |
| POST | `/books/:asin/progress` | Sync reading position to Kindle |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `SESSION_TTL_MS` | 4 hours | Session expiration |
| `CONTENT_STORAGE_DIR` | `data/books` | Content storage path |
| `TLS_SERVER_URL` | localhost:8080 | TLS proxy URL |
| `TLS_SERVER_API_KEY` | - | TLS proxy API key |
| `ELEVENLABS_API_KEY` | - | ElevenLabs API key |
| `CARTESIA_API_KEY` | - | Cartesia API key |
| `OPENAI_API_KEY` | - | OpenAI API key (for LLM preprocessing) |
| `LOG_LEVEL` | info | Fastify log level |
