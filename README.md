# Kindle Storyteller

An iOS app that uses AI to generate on-demand audiobook snippets for Kindle.

[DEMO TO BE ADDED]

## 0.0 Overview
### 0.1 Features

- **On-demand audiobook generation** – Generate audio for any Kindle book from your current reading position
- **Multiple TTS providers** – Choose between ElevenLabs and Cartesia voices
- **Configurable duration** – Specify how many minutes of audio to generate (1-8 at a time)
- **Auto-seek playback** – When resuming, audio automatically seeks to match your current Kindle position
- **Bidirectional progress sync** – Listening progress syncs back to Kindle in real-time
- **LLM text preprocessing** – Optional GPT-based cleanup of OCR text before synthesis, including custom pauses for Cartesia
- **Audiobook library** – Browse and replay previously generated audiobooks
- **Background playback** – Lock screen controls and background audio support

### 0.2 Context

I usually read on a Kindle Paperwhite, but when I don't have it with me I use the Kindle app on my phone. Sometimes I want to continue reading after I have to stop using my phone (e.g. I get off the subway and walk to my destination); an audiobook would be perfect for this.

However, I don't normally listen to audiobooks, so I wouldn't want to purchase the audiobook version of my book just for a few minutes of listening when I can't use my phone. Audiobooks on Kindle also only sync with the printed book when Whispersync-for-Voice is enabled. These two factors led me to build this app.

## 1.0 Components

- `ios-app`: SwiftUI client that captures Kindle session info, and drives audiobook genertion, listening, and management. See [ios-app-architecture.md](ios-app-architecture.md).
- `server`: Fastify backend orchestrating Kindle fetches and text extraction. Uses my fork of [`kindle-api`](https://github.com/ryanbbrown/kindle-api) for Kindle interactions. See [server-architecture.md](server-architecture.md).
- `text-extraction`: Python pipeline for extracting text from Kindle renderer output.
- `tls-client-api`: Submoduled TLS proxy binary used by the backend for Amazon requests ([repo](https://github.com/bogdanfinn/tls-client-api)).

## 2.0 Setup

Clone the repository with submodules:
```bash
git clone --recursive https://github.com/ryanbbrown/kindle-ai-audiobook.git
```

### 2.1 Testing Environments

There are three ways to test the app (iPhone simulator on Mac, iPhone on local network, or iPhone against production), so you need to tell the iOS app which server to connect to. The API base URL is stored in `ios-app/KindleAudioApp/Config.xcconfig` (git-ignored). `API_BASE_HOST` should be one of:
- `localhost:3000` – local development with simulator
- `<your-mac-ip>:3000` – testing on a physical iPhone connected to the same network
- `<your-fly-app>.fly.dev` – production Fly.io deployment, works for simulator or actual iPhone

For running on a physical iPhone, see [4.0 iOS App Installation](#40-ios-app-installation-iphone).

### 2.2 Environment Variables

Copy the example config files and fill in your values:
- `server/.env.example` → `server/.env`
- `text-extraction/.env.example` → `text-extraction/.env`
- `ios-app/KindleAudioApp/Config.xcconfig.example` → `ios-app/KindleAudioApp/Config.xcconfig`

**Server (`server/.env`):**
- `SERVER_API_KEY` – Secret key for authenticating iOS client requests. Set to any secure random string, then configure the same value in `Config.xcconfig`.
- `TLS_SERVER_API_KEY` – API key for the TLS proxy (can be any string).
- `ELEVENLABS_API_KEY` – [ElevenLabs](https://elevenlabs.io/) API key for text-to-speech.
- `CARTESIA_API_KEY` – [Cartesia](https://cartesia.ai/) API key for text-to-speech.
- `OPENAI_API_KEY` – [OpenAI](https://platform.openai.com/) API key for LLM-based text preprocessing.

**Text extraction (`text-extraction/.env`):**
- `OCRSPACE_API_KEY` – [OCR.space](https://ocr.space/) API key for text extraction from images.

**iOS app (`ios-app/KindleAudioApp/Config.xcconfig`):**
- `API_BASE_HOST` – Server hostname (see Testing Environments above).
- `SERVER_API_KEY` – Must match the server's `SERVER_API_KEY`.

### 2.3 TLS Proxy Setup
The TLS proxy requires Go to build from source:
1. Build the binaries:
   ```bash
   cd tls-client-api/cmd/tls-client-api && ./build.sh
   ```
2. Copy the config template and add your API key:
   ```bash
   cp tls-client-api/cmd/tls-client-api/config.dist.yml tls-client-api/dist/config.yml
   ```
3. Edit `tls-client-api/dist/config.yml` and add your `TLS_SERVER_API_KEY` to the `api_auth_keys` array.

## 3.0 Running

### 3.1 Running Locally
1. Start the TLS proxy: `cd tls-client-api/dist && ./tls-client-api-darwin-arm64-`
2. Run the Fastify backend: `cd server && pnpm dev`
3. With both services running, open the iOS project in Xcode and build + run it.

### 3.2 Deploying to Fly.io
The repository includes a multi-stage `Dockerfile`, process supervisor (`start.sh`), and `fly.toml` to run the Fastify backend, TLS proxy, and text-extraction pipeline in a single Fly machine.

1. **Create the Fly app**
   ```bash
   fly launch --no-deploy --copy-config
   ```
   Adjust the generated app name/region inside `fly.toml` if needed.

2. **Configure secrets** – set the server API key, TLS proxy key, TTS keys, LLM key, and OCR key:
   ```bash
   fly secrets set \
     SERVER_API_KEY="your-key" \
     TLS_SERVER_API_KEY="your-key" \
     ELEVENLABS_API_KEY="your-key" \
     CARTESIA_API_KEY="your-key" \
     OPENAI_API_KEY="your-key" \
     OCRSPACE_API_KEY="your-key"
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

## 4.0 iOS App Installation (iPhone)
If you want to use the app on an iPhone instead of the simulator, there are steps to follow on Mac. 

Not all of these are necessary if you've done iOS app development on your Mac before, and note that I don't use a paid developer account, so the app has to be re-signed every 7 days.

### 4.1 Add Apple ID to Xcode
<details>
  <summary>Expand to see steps</summary>

- Open Xcode
- Click "Xcode" -> "Settings"
- Click "Apple Accounts"
- Add your apple account
- Click on the account, then "Personal Team", then "Manage Certificates..."
- If a certificate doesn't exist, click the "+" in the bottom left, then "Apple Development" to create a new certificate
</details>



### 4.2 Configure project
<details>
  <summary>Expand to see steps</summary>

- Open the KindleAudioApp project in Xcode
- In the navigation bar on the left, select the top-level "KindleAudioApp"
- Go to the "Signing & Capabilities" tab
- Under "Team", select your "Personal Team" (your Apple ID) that you added.
- Ensure "Automatically manage signing" is enabled.
- Set "Bundle Identifier" to something unique; I used com.example.KindleAudioApp (probably should change lol)
- Near the top left, click "+ Capability", then click on the "Background Modes" capability to add it
- Expand it and check the "Audio, AirPlay, and Picture in Picture" box
</details>

### 4.3 Connect iPhone
<details>
  <summary>Expand to see steps</summary>

- Plug your iPhone into your Mac
- Click "Trust" if you haven't already
- In center top bar of Xcode, click on the device selector and select your iPhone
- Click the Run (▶) button
- You'll receive a pop-up that says "Developer Mode disabled"; go to Settings -> Privacy & Security, scroll all the way down, click on "Developer Mode", then enable it, restart your phone, and accept any prompts
- Click the Run button again if needed
</details>

## 5.0 Disclaimer

This project is a personal proof-of-concept for generating short audio snippets from books you own. It's intended for temporary, on-the-go listening when you can't look at a screen—not as a replacement for purchasing audiobooks.

If you enjoy a book in audio form, please support the author and narrator by buying the official audiobook. Professional narrators bring craft and interpretation that AI-generated speech can't replicate.

Use this tool only with content you've legitimately purchased, and at your own risk.
