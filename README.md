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
   cd /Users/ryanbrown/code/kindle-ai-audiobook/tls-client-api/dist
   ./tls-client-api-darwin-arm64-
   ```
2. Run the Fastify backend (from the repo root):
   ```bash
   cd server
   pnpm dev
   ```
3. With both services running, open the iOS project in Xcode and run it in a simulator; the app should connect without additional setup.
