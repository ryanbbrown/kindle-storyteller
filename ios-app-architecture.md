# Kindle Audio iOS App

A SwiftUI app that converts Kindle books into audiobooks using the Fastify backend for content extraction and TTS synthesis.

## File Structure

```
ios-app/
├── KindleAudioApp.xcodeproj/          # Xcode project settings
└── KindleAudioApp/
    ├── KindleAudioAppApp.swift        # App entry point
    ├── ContentView.swift              # Root view with tab navigation
    ├── LoginWebView.swift             # WKWebView for Amazon login, injects JS bridge
    ├── SessionStore.swift             # Observable state container (cookies, tokens, etc.)
    ├── APIClient.swift                # REST client for Fastify backend
    ├── AudioPlaybackController.swift  # AVPlayer wrapper for audio playback
    ├── PlaybackCoordinator.swift      # Coordinates audio position with Kindle position IDs
    ├── ProgressUpdateScheduler.swift  # Schedules reading progress syncs to Kindle
    ├── Models/
    │   ├── APIModels.swift            # API request/response types
    │   ├── AppNavigation.swift        # Navigation state and routes
    │   ├── BenchmarkTimeline.swift    # Maps audio timestamps to Kindle positions
    │   └── BookDetails.swift          # Book metadata model
    ├── Views/
    │   ├── HomeScreen.swift           # Main home tab with current book
    │   ├── LibraryScreen.swift        # Book library grid
    │   ├── PlayerScreen.swift         # Full audiobook player UI
    │   ├── AudioSettingsScreen.swift  # TTS provider and voice settings
    │   ├── LoadingScreen.swift        # Loading/progress indicator
    │   └── TabBar.swift               # Bottom tab navigation
    ├── ViewModels/
    │   └── ContentViewModel.swift     # Business logic for ContentView
    ├── Services/
    │   └── SessionService.swift       # Session management helpers
    ├── Shared/Utilities/
    │   ├── StringExtensions.swift     # String helper methods
    │   └── ValidationError.swift      # Error types
    └── Resources/
        └── webhooks.js                # JS injected into web view to capture credentials
```

## Core Flow

The app has four tabs: **Connect**, **Generate**, **Listen**, and **Library**.

1. **Connect** - Tapping "Connect Kindle" opens a `WKWebView` to `read.amazon.com`. The user logs in and selects a book to read. Injected JavaScript (`webhooks.js`) intercepts network requests and extracts cookies, tokens, ASIN, and starting position. Once a book is selected, the sheet dismisses and navigates to Generate.

2. **Generate** - Shows the selected book's cover and metadata with audio settings (TTS provider, LLM preprocessing). Tapping "Generate Audiobook" triggers `POST /books/:asin/pipeline` and shows a loading screen while the server runs OCR and TTS.

3. **Listen** - Once generation completes, the app navigates to the Listen tab. Audio is downloaded via `GET /books/:asin/chunks/:chunkId/audio`. During playback, `PlaybackCoordinator` maps audio timestamps to Kindle position IDs using benchmark data, and `ProgressUpdateScheduler` syncs progress back to Kindle via `POST /books/:asin/progress`.

4. **Library** - Shows all previously generated audiobooks via `GET /audiobooks`. Users can tap to replay or swipe to delete (`DELETE /audiobooks/:asin/:chunkId`).
