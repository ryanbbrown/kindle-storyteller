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

## Deploying to Fly.io
The repository now includes a multi-stage `Dockerfile`, combined process supervisor (`start.sh`), and a baseline `fly.toml` so you can run the Fastify backend, TLS proxy, and glyph-extraction worker in a single Fly machine.

1. **Create the Fly app**
   ```bash
   fly launch --no-deploy --copy-config
   ```
   Adjust the generated app name/region inside `fly.toml` if needed.

2. **Configure secrets** – at minimum set the TLS proxy key (also used by the Fastify server) along with any Kindle auth artifacts you expect to load by default:
   ```bash
   fly secrets set \
     TLS_PROXY_API_KEY="replace-me" \
     COOKIES="cookie string" \
     DEVICE_TOKEN="..." \
     RENDERING_TOKEN="..." \
     RENDERER_REVISION="..." \
     GUID="..."
   ```
   - Use `TLS_PROXY_AUTH_KEYS` instead of `TLS_PROXY_API_KEY` if you prefer to expose multiple comma-separated TLS keys.  
   - Override any other environment variables from `server/src/env.ts` via `fly secrets set VAR=value`.

3. **Deploy**
   ```bash
   fly deploy --remote-only
   ```
   The container installs Node 20, Python 3.12 + uv (for the glyph-extraction pipeline), Tesseract, and builds the Go TLS proxy. The `start.sh` entrypoint boots the TLS proxy first, points the Fastify server to `http://127.0.0.1:${TLS_PROXY_PORT}`, and keeps both processes supervised.

4. **Point the iOS app at Fly**
   Update the client’s base URL (or session creation form) to the deployed Fly hostname (e.g. `https://kindle-ai-audiobook.fly.dev`). The backend automatically routes traffic through the co-located TLS proxy.

You can customize CPU/memory with `fly scale vm` if Tesseract workload requires extra resources. The included Fly HTTP service exposes port `3000`; make sure any additional ports go through `start.sh` or another supervisor if you later split workloads.
