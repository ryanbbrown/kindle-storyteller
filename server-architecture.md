# Server Architecture

The server is a Fastify API that bridges authenticated Kindle sessions with AI-powered audiobook generation. It handles Kindle content rendering, OCR text extraction, and text-to-speech synthesis.

## Dependencies

The server uses my fork of [`kindle-api`](https://github.com/ryanbbrown/kindle-api) to handle all Kindle API interactions including authentication, library fetching, content rendering, and reading progress sync. This abstracts away the low-level HTTP requests and token management.

## Core File Structure

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

## Data Structure

The `data/books/` directory stores all pipeline-generated artifacts:

```
data/books/
├── {asin}/                           # One directory per book (e.g., B01E3PFTXK)
│   ├── metadata.json                 # ASIN-level metadata with all chunk ranges
│   └── chunks/
│       └── chunk_pid_{start}_{end}/  # Chunk named by position ID range
│           ├── content.tar           # Raw TAR from Kindle renderer
│           ├── full-content.txt      # OCR-extracted text
│           ├── extracted/            # Unpacked renderer data
│           │   ├── metadata.json         # Kindle renderer metadata (title, authors, etc.)
│           │   ├── glyphs.json           # Glyph/font data (used by OCR)
│           │   ├── page_data_X_Y.json    # Page positioning (used for position IDs)
│           │   └── ...                   # Other renderer JSON files
│           ├── pages/                # Rendered page images
│           │   ├── page_0000.png
│           │   ├── page_0001.png
│           │   └── ...
│           └── audio/                # Generated audio artifacts
│               └── {provider}_{startPosId}_{endPosId}/  # Per-provider, per-range
│                   ├── audio.mp3             # Synthesized audio
│                   ├── alignment.json        # Character-to-timestamp mapping
│                   ├── benchmarks.json       # Time-indexed position ID lookups
│                   └── source-content.txt    # LLM-preprocessed text used for TTS
```

### ASIN-Level Metadata

The `metadata.json` at the book level tracks all processed chunks and their artifacts:

```typescript
interface RendererCoverageMetadata {
  asin: string;
  updatedAt: IsoDateTime;
  ranges: CoverageRange[];  // All processed chunks for this book
}

interface CoverageRange {
  id: string;                    // e.g., "chunk_pid_91817_100088"
  start: { positionId: number };
  end: { positionId: number };
  pages?: {
    count: number;
    indexStart?: number;
    indexEnd?: number;
  };
  artifacts: {
    extractDir: string;
    pngDir?: string;
    pagesDir?: string;
    combinedTextPath?: string;
    contentTarPath?: string;
    audio?: {                    // Provider-specific audio artifact arrays
      elevenlabs?: AudioArtifact[];
      cartesia?: AudioArtifact[];
    };
  };
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

interface AudioArtifact {
  audioPath: string;
  alignmentPath: string;
  benchmarksPath: string;
  sourceTextPath: string;
  startPositionId: number;      // Audio covers this position range
  endPositionId: number;
  createdAt: IsoDateTime;
}
```

This structure allows:
- Multiple TTS providers to generate audio for the same chunk independently
- Multiple audio segments per provider with different position ranges (e.g., user generates 3 mins from position 1000, then later generates 5 mins from position 2000)

## Core Flow

1. **Session** - Client sends Kindle credentials to `POST /session`, which creates an authenticated session and returns a session ID for subsequent requests
2. **Download** - `kindle.renderChunk()` fetches rendered book pages as a TAR containing page images and position data
3. **OCR** - The `text-extraction` Python pipeline extracts text from page images into `full-content.txt`
4. **LLM** (optional) - OpenAI transforms extracted text for better TTS narration, outputting `{provider}-content.txt`
5. **TTS** - ElevenLabs or Cartesia generates audio with character-level timestamps for position sync

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
| GET | `/audiobooks` | List all generated audiobooks |
| DELETE | `/audiobooks/:asin/:chunkId` | Delete audiobook audio artifacts |

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
