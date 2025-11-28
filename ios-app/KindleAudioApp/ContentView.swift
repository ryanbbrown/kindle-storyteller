import SwiftUI

struct ContentView: View {
    @ObservedObject var sessionStore: SessionStore
    @StateObject private var viewModel: ContentViewModel
    @State private var isPresentingLogin = false
    @State private var webViewReloadCounter = 0
    @State private var showLoginHint = false
    @State private var hasShownLoginHint = false

    init(sessionStore: SessionStore) {
        self.sessionStore = sessionStore
        self._viewModel = StateObject(wrappedValue: ContentViewModel(sessionStore: sessionStore))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                headerSection
                bookMetadataSection
                // DEBUG
               pipelineConfigurationSection
                actionButtonsSection
                audioPreviewSection
                // DEBUG
//                logSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .sheet(isPresented: $isPresentingLogin) {
            loginSheet
        }
        .alert(item: $viewModel.activeAlert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text("OK"))
            )
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: 4) {
            Text("Kindle Storyteller")
                .font(.largeTitle.bold())
            Text("On-demand AI-generated audiobooks")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Book Metadata

    private var bookMetadataSection: some View {
        GroupBox("Book Selection") {
            VStack(spacing: 16) {
                Image("GenericBook")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 80, height: 80)

                if viewModel.isLoadingBookDetails {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else if let details = sessionStore.bookDetails {
                    bookDetailsContent(details)
                } else {
                    Text("No book currently selected")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }

                Button(action: { isPresentingLogin = true }) {
                    Text("Connect Kindle")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color.accentColor)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }
            }
            .padding(.top, 8)
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
    }

    private func bookDetailsContent(_ details: BookDetails) -> some View {
        VStack(spacing: 8) {
            Text(details.title)
                .font(.headline)
                .multilineTextAlignment(.center)
                .lineLimit(3)

            VStack(spacing: 4) {
                Text("Progress: \(String(format: "%.1f", details.progressPercent))%")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Text("Position: \(details.currentPositionLabel)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Pipeline Config

    private var pipelineConfigurationSection: some View {
        GroupBox("Pipeline Options") {
            VStack(alignment: .leading, spacing: 12) {
                Toggle("Use manual starting position", isOn: $viewModel.useManualStartingPosition)
                if viewModel.useManualStartingPosition {
                    TextField("Enter starting position (e.g. 3698;0 or 210769)", text: $viewModel.manualStartingPosition)
                        .textFieldStyle(.roundedBorder)
                        .font(.caption.monospaced())
                }
            }
        }
    }

    // MARK: - Action Buttons

    private var actionButtonsSection: some View {
        GroupBox("Audiobook Generation") {
            VStack(spacing: 12) {
                audioProviderPicker

                Button(action: { Task { await viewModel.generateAudiobook() } }) {
                    Text(viewModel.isGeneratingAudiobook ? "Generating..." : "Generate")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(viewModel.isGeneratingAudiobook || sessionStore.bookDetails == nil ? Color.gray : Color.accentColor)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }
                .disabled(viewModel.isGeneratingAudiobook || sessionStore.bookDetails == nil)
            }
            .padding(.top, 8)
        }
    }

    private var audioProviderPicker: some View {
        HStack(spacing: 0) {
            Button(action: { viewModel.selectedAudioProvider = "elevenlabs" }) {
                Text("ElevenLabs")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(viewModel.selectedAudioProvider == "elevenlabs" ? Color.accentColor : Color.gray.opacity(0.2))
                    .foregroundColor(viewModel.selectedAudioProvider == "elevenlabs" ? .white : .primary)
            }

            Button(action: { viewModel.selectedAudioProvider = "cartesia" }) {
                Text("Cartesia")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(viewModel.selectedAudioProvider == "cartesia" ? Color.accentColor : Color.gray.opacity(0.2))
                    .foregroundColor(viewModel.selectedAudioProvider == "cartesia" ? .white : .primary)
            }
        }
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.gray.opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Audio Preview

    private var audioPreviewSection: some View {
        GroupBox("Listen") {
            VStack(spacing: 16) {
                if viewModel.isGeneratingAudiobook {
                    VStack(spacing: 16) {
                        ProgressView()
                            .scaleEffect(1.5)
                        Text("Generating audiobook...")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 30)
                } else if viewModel.downloadedAudioURL != nil {
                    AudioPlayerCardView(
                        coordinator: viewModel.playbackCoordinator,
                        title: sessionStore.bookDetails?.title ?? "Kindle Audio Preview",
                        coverImageURL: sessionStore.bookDetails?.coverImage
                    )

                    if let message = viewModel.audioErrorMessage ?? viewModel.playbackCoordinator.audioController.errorMessage {
                        Text(message)
                            .font(.caption)
                            .foregroundColor(.red)
                    }

                    if let progressMessage = viewModel.playbackCoordinator.progressErrorMessage {
                        Text(progressMessage)
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                } else {
                    Text("Tap 'Generate' to create audio")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                }
            }
        }
    }

    // MARK: - Log

    private var logSection: some View {
        GroupBox("Status Log") {
            if viewModel.statusLog.isEmpty {
                Text("No actions yet.")
                    .foregroundStyle(.secondary)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(viewModel.statusLog.enumerated()), id: \.offset) { entry in
                            Text(entry.element)
                                .font(.caption.monospaced())
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .frame(minHeight: 120, maxHeight: 200)
            }
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
