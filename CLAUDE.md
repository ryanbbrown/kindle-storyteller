# General Rules
## Tools to use
- Do NOT use ad-hoc python or jquery scripts to read or modify files. Only use built-in read and write tools, along with bash commands like grep.
- Use uv for all python-related operations; `uv add` to install new packages, and `uv run file.py` to run files. No need to activate the venv first.

## How to interact
- Always ask the user any necessary follow up questions about their intent before making changes.
- If the user interrupts you and asks a question, IMMEDIATELY ANSWER THE QUESTION. Do not use the question as a jumping-off point for additional changes.

## How to write code
- Do NOT program defensively; solve the user request in the simplest way possible. Don't include extra parameters that aren't currently necessary. Don't over-functionize or over-nest data structures; inline code where possible.
- Add one-line docstrings to all TypeScript functions (e.g. `/** Description of function */`)
- ALWAYS use existing libraries and utility functions; do NOT rewrite functions for basic language functionality
- Do NOT delete files when your intent is to edit


# Build Checks
After making changes, run builds for both the iOS app and the server to ensure that nothing is broken.

## iOS App
```bash
cd ios-app
xcodebuild -scheme KindleAudioApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

## Fastify Server
```bash
cd server
pnpm run build
```
