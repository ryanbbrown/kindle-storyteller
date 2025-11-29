# Kindle AI Audiobook

## Architecture

(TODO)

## Components

- `ios-app`: SwiftUI client that captures Kindle session info and drives the pipeline.
- `server`: Fastify backend orchestrating Kindle fetches and text extraction. Uses my fork of [`kindle-api`](https://github.com/ryanbbrown/kindle-api) for Kindle interactions.
- `text-extraction`: Python pipeline for extracting text from Kindle renderer output.
- `tls-client-api`: Prebuilt TLS proxy binary used by the backend for Amazon requests ([repo link](https://github.com/bogdanfinn/tls-client-api)).

## Setup

### iOS App Configuration

There are three ways to test the app (iPhone simulator on Mac, iPhone on local network, or iPhone against production), so you need to tell the iOS app which server to connect to. The API base URL is stored in `ios-app/KindleAudioApp/Config.xcconfig` (git-ignored). Copy the example file and set `API_BASE_HOST` to one of:
- `localhost:3000` – local development with simulator
- `<your-mac-ip>:3000` – testing on a physical iPhone connected to the same network
- `<your-fly-app>.fly.dev` – production Fly.io deployment, works for simulator or actual iPhone

### Server Environment Variables

The server requires several API keys and configuration values. Copy the example env file and fill in your values:

```bash
cd server
cp .env.example .env
```

Required variables:
- `SERVER_API_KEY` – A secret key for authenticating iOS client requests to the server. Set this to any secure random string, then configure the same value in the iOS app.
- `TLS_SERVER_URL` – URL of the TLS proxy (default: `http://localhost:8080` for local dev)
- `TLS_SERVER_API_KEY` – API key for the TLS proxy

TTS provider keys (at least one required):
- `ELEVENLABS_API_KEY` – [ElevenLabs](https://elevenlabs.io/) API key for text-to-speech
- `CARTESIA_API_KEY` – [Cartesia](https://cartesia.ai/) API key for text-to-speech

LLM key (for text preprocessing):
- `OPENAI_API_KEY` – [OpenAI](https://platform.openai.com/) API key for LLM-based text preprocessing

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

The repository includes a multi-stage `Dockerfile`, process supervisor (`start.sh`), and `fly.toml` to run the Fastify backend, TLS proxy, and text-extraction pipeline in a single Fly machine.

1. **Create the Fly app**
   ```bash
   fly launch --no-deploy --copy-config
   ```
   Adjust the generated app name/region inside `fly.toml` if needed.

2. **Configure secrets** – set the server API key, TLS proxy key, TTS keys, and LLM key:
   ```bash
   fly secrets set \
     SERVER_API_KEY="your-secret-key" \
     TLS_SERVER_API_KEY="replace-me" \
     ELEVENLABS_API_KEY="your-key" \
     CARTESIA_API_KEY="your-key" \
     OPENAI_API_KEY="your-key"
   ```
   Or, if you've already configured `server/.env`, set all secrets from it:
   ```bash
   grep -v '^#' server/.env | grep '=' | xargs fly secrets set
   ```
   All Kindle cookies/tokens must come from the iOS client; there's no server-side fallback.

3. **Deploy**
   ```bash
   fly deploy --remote-only
   ```
   The container installs Node 20, Python 3.12 + uv, and builds the Go TLS proxy. The `start.sh` entrypoint boots the TLS proxy first, then starts the Fastify server.

4. **Point the iOS app at Fly** – update `API_BASE_HOST` in your `Config.xcconfig` to your Fly hostname.

## Backlog
- Audio re-generation for the same part of the book with a different provider
- Improve linear interpolation for character to position map
- Cartesia/ElevenLabs voice demo + selection within app
- Specification of duration for audio to be generated (currently does it for full content download, ~8 mins)
- If using already generated audio and the user's position is in the middle of the range, automatically set the audio playback to the correct time