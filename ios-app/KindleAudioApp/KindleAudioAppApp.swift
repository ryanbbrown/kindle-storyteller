import SwiftUI

@main
struct KindleAudioAppApp: App {
    @StateObject private var sessionStore = SessionStore()

    var body: some Scene {
        WindowGroup {
            ContentView(sessionStore: sessionStore)
        }
    }
}
