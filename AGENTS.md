# General Rules
- Always ask the user any necessary follow up questions about their intent before making changes.
- Always create the simplest solution first; don't add excess features the user didn't mention.
- Do NOT use ad-hoc python or jquery scripts to read or modify files. Only use built-in read and write tools, along with bash commands like grep.

# iOS App Build Check

Before landing SwiftUI changes, run an Xcode build locally to catch compiler errors:

```bash
cd ios-app
xcodebuild -scheme KindleAudioApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

This mirrors the manual Xcode build (⌘B) and fails fast if the app no longer compiles.***
