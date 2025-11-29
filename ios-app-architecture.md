# iOS App Architecture

The iOS app is a SwiftUI application that authenticates with Amazon Kindle, captures session tokens via WebView interception, and plays AI-generated audiobooks while syncing progress back to the server.

## Dependencies

Pure Swift/Apple frameworks only - no external dependencies:
- `SwiftUI` - UI framework
- `AVFoundation` - Audio playback
- `MediaPlayer` - Remote media controls (lock screen, control center)
- `WebKit` - Embedded browser for Amazon login
- `QuartzCore` - Display link timing for progress sync

## File Structure

```
ios-app/
├── KindleAudioApp/
│   ├── KindleAudioAppApp.swift        # App entry point
│   ├── ContentView.swift              # Main UI view
│   ├── Info.plist                     # App configuration
│   ├── Config.xcconfig                # Build configuration (API host, key)
│   │
│   ├── ViewModels/
│   │   └── ContentViewModel.swift     # Main business logic, orchestrates flows
│   │
│   ├── Models/
│   │   ├── APIModels.swift            # API request/response structures
│   │   ├── BookDetails.swift          # Book metadata model
│   │   └── BenchmarkTimeline.swift    # Playback checkpoint timeline
│   │
│   ├── Services/
│   │   └── SessionService.swift       # Session validation and caching
│   │
│   ├── SessionStore.swift             # Global state container (tokens, book details)
│   ├── APIClient.swift                # HTTP client for server communication
│   ├── AudioPlaybackController.swift  # AVAudioPlayer wrapper with remote controls
│   ├── PlaybackCoordinator.swift      # Coordinates playback + progress sync
│   ├── ProgressUpdateScheduler.swift  # CADisplayLink scheduler for progress updates
│   ├── AudioPlayerCardView.swift      # Audio player UI component
│   ├── LoginWebView.swift             # WKWebView wrapper for Amazon login
│   │
│   ├── Shared/Utilities/
│   │   ├── StringExtensions.swift     # trimmedNonEmpty() helper
│   │   └── ValidationError.swift      # Error types and AppAlert
│   │
│   └── Resources/
│       └── webhooks.js                # Injected script for network interception
```

## Core Flow

### 1. Authentication via WebView Interception

The app uses a novel approach to capture Amazon Kindle session data:

1. User opens `LoginWebView` which loads `read.amazon.com`
2. `webhooks.js` is injected at document start
3. Script intercepts all `fetch()` and `XMLHttpRequest` calls
4. As user navigates, script captures:
   - **Cookies** - from document.cookie after login
   - **Rendering token** - from `/renderer/render` requests
   - **Device token** - from `/service/web/register/getDeviceToken` responses
   - **Renderer revision** - from URL parameters
   - **GUID** - from `/annotations` API calls
   - **ASIN** - from request parameters when user opens a book
   - **Starting position** - from render response bodies

5. Captured data flows via `webkit.messageHandlers['kindleBridge']` to `SessionStore`

### 2. Audiobook Generation

When user taps "Generate":

```
Validate tokens (SessionService)
    ↓
POST /session → Get server sessionId
    ↓
POST /books/:asin/pipeline (startingPosition, audioProvider, skipLlmPreprocessing)
    ↓
Server runs: Download → OCR → TTS
    ↓
GET /books/:asin/chunks/:chunkId/benchmarks → Playback checkpoints
    ↓
GET /books/:asin/chunks/:chunkId/audio → Download MP3 to cache
    ↓
Configure PlaybackCoordinator with audio + timeline
```

### 3. Audio Playback with Progress Sync

The app syncs playback position back to the server at discrete checkpoints:

**AudioPlaybackController:**
- Wraps `AVAudioPlayer` for MP3 playback
- Integrates with `MPRemoteCommandCenter` for lock screen controls
- Updates `MPNowPlayingInfoCenter` with cover art and progress

**ProgressUpdateScheduler:**
- Uses `CADisplayLink` (60 FPS) for precise timing
- Compares current playback time to checkpoint array
- When audio passes a checkpoint, calls `POST /books/:asin/progress`
- Implements retry with 1-second backoff on failures

## State Management

Uses SwiftUI's reactive patterns with a centralized store:

```
KindleAudioAppApp
  └── SessionStore (@StateObject) - source of truth
      - cookies, tokens, ASIN, bookDetails

ContentView (@ObservedObject)
  └── ContentViewModel (@StateObject)
      - UI state (loading, errors, logs)
      └── PlaybackCoordinator (@Published)
          ├── AudioPlaybackController - playback state
          └── ProgressUpdateScheduler - sync state
```

## API Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/session` | Create authenticated session with Kindle tokens |
| GET | `/books/:asin/full-details` | Fetch book metadata and cover |
| POST | `/books/:asin/pipeline` | Generate audiobook chunk |
| GET | `/books/:asin/chunks/:chunkId/benchmarks` | Get timestamp→position mapping |
| GET | `/books/:asin/chunks/:chunkId/audio` | Download audio file |
| POST | `/books/:asin/progress` | Sync reading position to Kindle |

## Configuration

**Config.xcconfig:**
```
API_BASE_HOST = localhost:3000
SERVER_API_KEY = mykey
```

**Info.plist:**
- `API_BASE_HOST` - Server host from xcconfig
- `SERVER_API_KEY` - API key for X-API-Key header
- `UIBackgroundModes: audio` - Enables background playback

**Environment Override:**
- `API_BASE_URL` - Overrides xcconfig if set
