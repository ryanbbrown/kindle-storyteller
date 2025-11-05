# General Rules
Always ask the user any necessary follow up questions about their intent before making changes.
Always create the simplest solution first; don't add excess features the user didn't mention.

# iOS App Build Check

Before landing SwiftUI changes, run an Xcode build locally to catch compiler errors:

```bash
cd ios-app
xcodebuild -scheme KindleAudioApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

This mirrors the manual Xcode build (⌘B) and fails fast if the app no longer compiles.***
