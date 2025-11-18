# Kindle AI Audiobook

## Components
- `ios-app`: SwiftUI client that captures Kindle session info and drives the pipeline.
- `server`: Fastify backend orchestrating Kindle fetches and the OCR/glyph workflow.
- `kindle-api`: TypeScript Kindle client, wrapped by the server for upstream requests.
- `glyph-extraction`: Python utilities for renderer glyph extraction and OCR stitching.
- `tls-client-api`: Prebuilt TLS proxy binary used by the backend for Amazon requests.

## Instructions for Use
1. Start the TLS proxy:
   ```bash
   cd kindle-ai-audiobook/tls-client-api/dist
   ./tls-client-api-darwin-arm64-
   ```
2. Run the Fastify backend (from the repo root):
   ```bash
   cd server
   pnpm dev
   ```
3. With both services running, open the iOS project in Xcode and run it in a simulator; the app should connect without additional setup.

## iOS App Configuration
The Swift client now reads its API base URL from `ios-app/KindleAudioApp/Config.xcconfig`, which is ignored from git. Copy the example file and customize as needed:
```bash
cp ios-app/KindleAudioApp/Config.xcconfig.example ios-app/KindleAudioApp/Config.xcconfig
```
Set `API_BASE_HOST` to your Fly deployment hostname. In CI or release builds you can override the same build setting via Xcode build configurations or environment-specific `.xcconfig` files.  
At runtime the iOS app still honors an `API_BASE_URL` environment variable (e.g. supplied via Xcode scheme arguments or CI); if present it overrides the generated Info.plist value and should contain the full URL (including scheme).

## Deploying to Fly.io
The repository now includes a multi-stage `Dockerfile`, combined process supervisor (`start.sh`), and a baseline `fly.toml` so you can run the Fastify backend, TLS proxy, and glyph-extraction worker in a single Fly machine.

1. **Create the Fly app**
   ```bash
   fly launch --no-deploy --copy-config
   ```
   Adjust the generated app name/region inside `fly.toml` if needed.

2. **Configure secrets** – set the TLS proxy key (also used by the Fastify server) and, if you use ElevenLabs TTS, its API key:
   ```bash
   fly secrets set \
     TLS_PROXY_API_KEY="replace-me" \
     ELEVENLABS_API_KEY="optional"
   ```
   - Use `TLS_PROXY_AUTH_KEYS` instead of `TLS_PROXY_API_KEY` if you need multiple comma-separated TLS keys.  
   - All Kindle cookies/tokens now must come from the iOS client; there’s no longer a fallback to `.env`.

3. **Deploy**
   ```bash
   fly deploy --remote-only
   ```
   The container installs Node 20, Python 3.12 + uv (for the glyph-extraction pipeline), Tesseract, and builds the Go TLS proxy. The `start.sh` entrypoint boots the TLS proxy first, points the Fastify server to `http://127.0.0.1:${TLS_PROXY_PORT}`, and keeps both processes supervised.

4. **Point the iOS app at Fly**
   Update the client’s base URL (or session creation form) to the deployed Fly hostname. The backend automatically routes traffic through the co-located TLS proxy.

You can customize CPU/memory with `fly scale vm` if Tesseract workload requires extra resources. The included Fly HTTP service exposes port `3000`; make sure any additional ports go through `start.sh` or another supervisor if you later split workloads.
