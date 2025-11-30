import SwiftUI

struct ContentView: View {
    @ObservedObject var sessionStore: SessionStore
    @StateObject private var viewModel: ContentViewModel
    @State private var appScreen: AppScreen = .home
    @State private var isPresentingLogin = false
    @State private var webViewReloadCounter = 0
    @State private var showLoginHint = false
    @State private var hasShownLoginHint = false
    @State private var isGenerationComplete = false
    @State private var placeholderToggle1 = false
    @State private var placeholderToggle2 = false

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
                        placeholderToggle1: $placeholderToggle1,
                        placeholderToggle2: $placeholderToggle2,
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
            await viewModel.generateAudiobook()
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
            .overlay(loginHintOverlay)
            .alert(item: $viewModel.activeAlert) { alert in
                Alert(
                    title: Text(alert.title),
                    message: Text(alert.message),
                    dismissButton: .default(Text("OK"))
                )
            }
        }
        .onAppear {
            if !hasShownLoginHint {
                hasShownLoginHint = true
                showLoginHint = true
                Task {
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    withAnimation {
                        showLoginHint = false
                    }
                }
            }
        }
        .onDisappear {
            showLoginHint = false
        }
    }

    @ViewBuilder
    private var loginHintOverlay: some View {
        if showLoginHint {
            VStack(spacing: 12) {
                Text("Log in and open the book you want to make an audiobook for")
                    .font(.body)
                    .multilineTextAlignment(.center)

                Button(action: {
                    withAnimation {
                        showLoginHint = false
                    }
                }) {
                    Text("Got it")
                        .font(.subheadline.bold())
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 8)
                        .background(Color.gray.opacity(0.6))
                        .cornerRadius(8)
                }
            }
            .padding()
            .background(Color.black.opacity(0.85))
            .foregroundColor(.white)
            .cornerRadius(12)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView(sessionStore: SessionStore())
    }
}
