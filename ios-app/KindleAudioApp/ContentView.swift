import SwiftUI

struct ContentView: View {
    @ObservedObject var sessionStore: SessionStore
    @StateObject private var viewModel: ContentViewModel
    @State private var appScreen: AppScreen = .home
    @State private var isPresentingLogin = false
    @State private var webViewReloadCounter = 0
    @State private var isGenerationComplete = false
    @State private var durationMinutes: Int = 8

    init(sessionStore: SessionStore) {
        self.sessionStore = sessionStore
        self._viewModel = StateObject(wrappedValue: ContentViewModel(sessionStore: sessionStore))
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                switch appScreen {
                case .home:
                    HomeScreen(onConnectKindle: { isPresentingLogin = true })
                case .audioSettings:
                    AudioSettingsScreen(
                        bookDetails: sessionStore.bookDetails,
                        selectedProvider: $viewModel.selectedAudioProvider,
                        llmPreprocessing: $viewModel.useLlmPreprocessing,
                        durationMinutes: $durationMinutes,
                        useManualPosition: $viewModel.useManualStartingPosition,
                        manualPosition: $viewModel.manualStartingPosition,
                        onGenerate: startGeneration
                    )
                case .loading:
                    LoadingScreen(isComplete: isGenerationComplete, useLlmPreprocessing: viewModel.useLlmPreprocessing)
                case .player:
                    PlayerScreen(
                        coordinator: viewModel.playbackCoordinator,
                        bookDetails: sessionStore.bookDetails
                    )
                case .library:
                    LibraryScreen(
                        audiobooks: viewModel.audiobooks,
                        isLoading: viewModel.isLoadingAudiobooks,
                        onSelect: { entry in selectAudiobook(entry) },
                        onDelete: { entry in Task { await viewModel.deleteAudiobook(entry) } },
                        onRefresh: { Task { await viewModel.fetchAudiobooks() } }
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if appScreen != .loading {
                TabBar(selectedTab: $appScreen)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: appScreen)
        .sheet(isPresented: $isPresentingLogin, onDismiss: handleLoginDismiss) {
            loginSheet
        }
        .alert(item: $viewModel.activeAlert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text("OK"))
            )
        }
        .onChange(of: sessionStore.asin) { oldValue, newValue in
            if let asin = newValue, !asin.isEmpty, oldValue != newValue {
                Task { await viewModel.fetchBookDetails(asin: asin) }
            }
        }
        .onChange(of: sessionStore.startingPosition) { oldValue, newValue in
            if let asin = sessionStore.asin, !asin.isEmpty,
               oldValue != newValue, newValue != nil {
                Task { await viewModel.fetchBookDetails(asin: asin) }
            }
        }
        .task {
            await viewModel.fetchAudiobooks()
        }
    }

    private func handleLoginDismiss() {
        if sessionStore.bookDetails != nil {
            appScreen = .audioSettings
        }
    }

    private func startGeneration() {
        isGenerationComplete = false
        appScreen = .loading
        Task {
            await viewModel.generateAudiobook(durationMinutes: durationMinutes)
            isGenerationComplete = true
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            appScreen = .player
        }
    }

    private func selectAudiobook(_ entry: AudiobookEntry) {
        Task {
            await viewModel.playAudiobook(entry)
            appScreen = .player
        }
    }

    // MARK: - Login Sheet

    private var loginSheet: some View {
        NavigationView {
            LoginWebView(
                reloadTrigger: $webViewReloadCounter,
                initialURL: URL(string: "https://read.amazon.com")!,
                onCookiesCaptured: { cookies in
                    sessionStore.updateCookies(cookies)
                    Task { @MainActor in viewModel.invalidateSession(reason: "cookies refreshed") }
                },
                onRenderingTokenCaptured: { token, url in
                    sessionStore.updateRenderingToken(token, sourceURL: url)
                    Task { @MainActor in viewModel.invalidateSession(reason: "rendering token refreshed") }
                },
                onDeviceTokenCaptured: { token in
                    sessionStore.updateDeviceToken(token)
                    Task { @MainActor in viewModel.invalidateSession(reason: "device token refreshed") }
                },
                onRendererRevisionCaptured: { revision in
                    sessionStore.updateRendererRevision(revision)
                    Task { @MainActor in viewModel.invalidateSession(reason: "renderer revision refreshed") }
                },
                onStartingPositionCaptured: { position in
                    sessionStore.updateStartingPosition(position)
                },
                onGUIDCaptured: { value in
                    sessionStore.updateGUID(value)
                    Task { @MainActor in viewModel.invalidateSession(reason: "GUID refreshed") }
                },
                onASINCaptured: { value in
                    sessionStore.updateASIN(value)
                },
                onDismissRequested: {
                    isPresentingLogin = false
                }
            )
            .navigationTitle("Amazon Login")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Reload") {
                        webViewReloadCounter += 1
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        isPresentingLogin = false
                    }
                }
            }
            .alert(item: $viewModel.activeAlert) { alert in
                Alert(
                    title: Text(alert.title),
                    message: Text(alert.message),
                    dismissButton: .default(Text("OK"))
                )
            }
        }
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView(sessionStore: SessionStore())
    }
}
