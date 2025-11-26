# Kindle AI Audiobook

## Architecture

(TODO)

## Components

- `ios-app`: SwiftUI client that captures Kindle session info and drives the pipeline.
- `server`: Fastify backend orchestrating Kindle fetches and the OCR/glyph workflow.
- `kindle-api`: TypeScript Kindle client, wrapped by the server for upstream requests.
- `glyph-extraction`: Python utilities for renderer glyph extraction and OCR stitching.
- `tls-client-api`: Prebuilt TLS proxy binary used by the backend for Amazon requests ([repo link](https://github.com/bogdanfinn/tls-client-api)).

## Setup

### iOS App Configuration

There are three ways to test the app (iPhone simulator on Mac, iPhone on local network, or iPhone against production), so you need to tell the iOS app which server to connect to. The API base URL is stored in `ios-app/KindleAudioApp/Config.xcconfig` (git-ignored). Copy the example file and set `API_BASE_HOST` to one of:
- `localhost:3000` – local development with simulator
- `<your-mac-ip>:3000` – testing on a physical iPhone connected to the same network
- `<your-fly-app>.fly.dev` – production Fly.io deployment, works for simulator or actual iPhone

### Running Locally

1. Start the TLS proxy: `cd tls-client-api/dist && ./tls-client-api-darwin-arm64-`
2. Run the Fastify backend: `cd server && pnpm dev`
3. With both services running, open the iOS project in Xcode and build + run it.



### iOS App Installation (iPhone)

#### Add Apple ID to Xcode
- Open Xcode
- Click "Xcode" -> "Settings"
- Click "Apple Accounts"
- Add your apple account
- Click on the account, then "Personal Team", then "Manage Certificates..."
- If a certificate doesn't exist, click the "+" in the bottom left, then "Apple Development" to create a new certificate

#### Configure project
- Open the KindleAudioApp project in Xcode
- In the navigation bar on the left, select the top-level "KindleAudioApp"
- Go to the "Signing & Capabilities" tab
- Under "Team", select your "Personal Team" (your Apple ID) that you added.
- Ensure "Automatically manage signing" is enabled.
- Set "Bundle Identifier" to something unique; I used com.example.KindleAudioApp (probably should change lol)
- Near the top left, click "+ Capability", then click on the "Background Modes" capability to add it
- Expand it and check the "Audio, AirPlay, and Picture in Picture" box

#### Connect iPhone
- Plug your iPhone into your Mac
- Click "Trust" if you haven't already
- In center top bar of Xcode, click on the device selector and select your iPhone
- Click the Run (▶) button
- You'll receive a pop-up that says "Developer Mode disabled"; go to Settings -> Privacy & Security, scroll all the way down, click on "Developer Mode", then enable it, restart your phone, and accept any prompts
- Click the Run button again if needed

### Deploying to Fly.io

The repository includes a multi-stage `Dockerfile`, process supervisor (`start.sh`), and `fly.toml` to run the Fastify backend, TLS proxy, and glyph-extraction worker in a single Fly machine.

1. **Create the Fly app**
   ```bash
   fly launch --no-deploy --copy-config
   ```
   Adjust the generated app name/region inside `fly.toml` if needed.

2. **Configure secrets** – set the TLS proxy key and (optionally) ElevenLabs API key:
   ```bash
   fly secrets set \
     TLS_SERVER_API_KEY="replace-me" \
     ELEVENLABS_API_KEY="optional"
   ```
   All Kindle cookies/tokens must come from the iOS client; there's no server-side fallback.

3. **Deploy**
   ```bash
   fly deploy --remote-only
   ```
   The container installs Node 20, Python 3.12 + uv, and builds the Go TLS proxy. The `start.sh` entrypoint boots the TLS proxy first, then starts the Fastify server.

4. **Point the iOS app at Fly** – update `API_BASE_HOST` in your `Config.xcconfig` to your Fly hostname.