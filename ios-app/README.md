# Kindle Audio iOS App

This folder contains a SwiftUI app that drives the Kindle pipeline workflow you have been testing in the simulator. If you are used to a Python or TypeScript/React stack, think of this as the UI layer plus a lightweight API client, all bundled inside an iOS project.

## Prerequisites
- Xcode 15+ (you already have Xcode 26.0.1 installed).
- Run the companion Fastify backend locally (`kindle-api` project) so the buttons here have something to talk to.
- iOS simulator (Apple silicon Macs ship with it; Xcode downloads components on first run).

## Project Structure

| Path | Purpose |
| --- | --- |
| `KindleAudioApp.xcodeproj/` | Xcode project settings; double-click to open the workspace. |
| `KindleAudioApp/ContentView.swift` | The main SwiftUI screen. Think of it like `App.tsx`: it renders the login button, metadata display, and pipeline controls, and wires up button actions. |
| `KindleAudioApp/LoginWebView.swift` | Hosts the embedded Amazon reader in a `WKWebView`. It injects JavaScript, captures cookies/headers, and sends the parsed values back to Swift via closures. |
| `KindleAudioApp/SessionStore.swift` | Observable state container (similar to a React context store). Keeps cookies, tokens, ASIN, starting position, etc., and publishes changes to the UI. |
| `KindleAudioApp/APIClient.swift` | Minimal REST client using `URLSession`. Mirrors the Fastify endpoints (`/session`, `/books`, `/books/{asin}/pipeline`, `/books/{asin}/text`). |
| `KindleAudioApp/Resources/webhooks.js` | JavaScript injected into the web view. Listens for network traffic, logs URLs, and extracts cookies, render headers, tokens, GUID, ASIN, and starting position straight from the intercepted requests. |
| `KindleAudioApp/Logs/…` | Created at runtime inside the simulator’s Documents folder; network URLs are appended here for debugging. |

Key idea: `LoginWebView` observes the reader’s network requests with that JavaScript, then calls into `SessionStore` updates. SwiftUI views subscribe to `SessionStore`, so the captured values show up live in `ContentView`.

## Run the App
1. Double-click `KindleAudioApp.xcodeproj` to open in Xcode.
2. In the scheme menu (top-left), pick an iPhone simulator (you’ve been using iPhone 17 Pro).
3. Press **Run** (⌘R). Xcode builds, deploys to the simulator, and launches the UI.
4. Tap **Login** in the app, sign into `read.amazon.com` within the embedded web view, and close it when finished.

Captured values (cookies, rendering token, device token, GUID, ASIN, starting position) appear in the main screen once the JS bridge sees the relevant requests.

## Using the Pipeline Buttons
All API buttons ultimately call helpers in `ContentView.swift`:

- **Create Session** → `createSession()`: wraps `ensureSession()`. It builds the payload from captured values and POSTs `/session`. The session ID is cached so future calls reuse it.
- **Fetch Books** → `fetchBooks()`: GETs `/books` so the UI can display cached Kindle titles for the signed-in account.
- **Start Audiobook** → `startAudiobookPipeline()`: POSTs `/books/{asin}/pipeline` with the captured starting position, render steppers (`numPages`, `skipPages`), and optional OCR limits. The server responds with the consolidated chunk/metadata/OCR payload.
- **Get Text Chunk** → `fetchTextChunk()`: GET `/books/{asin}/text` with `start`/`length` stepper values. It prefers the last pipeline chunk ID and bumps `start` by `bytesRead` to stream sequential slices.

Status updates are appended to the “Status Log” box so you can verify each step without diving into the Xcode console.

## Viewing Logged Network URLs
If you need to inspect every webview request, the injected JS writes to `Documents/Logs/webview-network.log` inside the simulator. Grab it with:

```bash
xcrun simctl get_app_container booted com.example.KindleAudioApp data
```

Then open the returned path and look in `Documents/Logs/`.

## Modifying the JavaScript Bridge
- The active script lives in `Resources/webhooks.js`. It exports a handler that Swift loads and injects as raw text.
- To test updates quickly, edit the JS file, run the app again (⌘R), and reload the embedded web view using the toolbar “Reload” button.
- The script returns structured messages (`window.webkit.messageHandlers`) that `LoginWebView.Coordinator` receives and maps to the Swift callbacks. That coordinator is the glue between JS and Swift.

With these pieces in mind you can evolve the app much like you would a React single-page app: `ContentView.swift` is the main UI, `SessionStore` is shared state, `APIClient` handles HTTP, and `webhooks.js` is the custom network interceptor for the Amazon reader. The Xcode project just stitches them together for iOS.***
