import SwiftUI

struct ContentView: View {
    @ObservedObject var sessionStore: SessionStore
    @StateObject private var playbackCoordinator = PlaybackCoordinator()
    @State private var isPresentingLogin = false

    @State private var webViewReloadCounter = 0

    @State private var sessionId: String?
    @State private var latestPipeline: APIClient.PipelineResponse?
    @State private var statusLog: [String] = []
    @State private var isPerformingRequest = false
    @State private var manualStartingPosition: String = ""
    @State private var useManualStartingPosition: Bool = false
    @State private var activeAlert: AppAlert?
    @State private var downloadedAudioURL: URL?
    @State private var benchmarkTimeline: BenchmarkTimeline?
    @State private var isDownloadingAudio = false
    @State private var audioErrorMessage: String?
    @State private var isLoadingBookDetails = false
    @State private var isGeneratingAudiobook = false
    @State private var showLoginHint = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                headerSection
                bookMetadataSection
                // DEBUG MODE: UNCOMMENT
                // pipelineConfigurationSection
                actionButtonsSection
                audioPreviewSection
                // DEBUG MODE: UNCOMMENT
                // logSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .sheet(isPresented: $isPresentingLogin) {
            NavigationView {
                LoginWebView(
                    reloadTrigger: $webViewReloadCounter,
                    initialURL: URL(string: "https://read.amazon.com")!,
                    onCookiesCaptured: { cookies in
                        sessionStore.updateCookies(cookies)
                        Task { @MainActor in invalidateSession(reason: "cookies refreshed") }
                    },
                    onRenderingTokenCaptured: { token, url in
                        sessionStore.updateRenderingToken(token, sourceURL: url)
                        Task { @MainActor in invalidateSession(reason: "rendering token refreshed") }
                    },
                    onDeviceTokenCaptured: { token in
                        sessionStore.updateDeviceToken(token)
                        Task { @MainActor in invalidateSession(reason: "device token refreshed") }
                    },
                    onRendererRevisionCaptured: { revision in
                        sessionStore.updateRendererRevision(revision)
                        Task { @MainActor in invalidateSession(reason: "renderer revision refreshed") }
                    },
                    onStartingPositionCaptured: { position in
                        sessionStore.updateStartingPosition(position)
                    },
                    onGUIDCaptured: { value in
                        sessionStore.updateGUID(value)
                        Task { @MainActor in invalidateSession(reason: "GUID refreshed") }
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
                .overlay(
                    Group {
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
                                        .background(Color.accentColor)
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
                )
            }
            .onAppear {
                showLoginHint = true
                Task {
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    withAnimation {
                        showLoginHint = false
                    }
                }
            }
            .onDisappear {
                showLoginHint = false
            }
        }
        .alert(item: $activeAlert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text("OK"))
            )
        }
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Kindle AI Audiobook")
                .font(.largeTitle.bold())

            Button(action: { isPresentingLogin = true }) {
                Text("Open Kindle Web Viewer")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color.accentColor)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
        }
    }

    private var bookMetadataSection: some View {
        GroupBox("Selected Book") {
            VStack(spacing: 16) {
                if isLoadingBookDetails {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                } else if let details = sessionStore.bookDetails {
                    VStack(spacing: 12) {
                        AsyncImage(url: URL(string: details.coverImage)) { image in
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                        } placeholder: {
                            Color.gray.opacity(0.3)
                        }
                        .frame(width: 120, height: 180)
                        .cornerRadius(8)
                        .shadow(radius: 4)

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
                } else {
                    Text("No book selected yet")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                }
            }
        }
        .onChange(of: sessionStore.asin) { oldValue, newValue in
            if let asin = newValue, !asin.isEmpty, oldValue != newValue {
                Task { await fetchBookDetails(asin: asin) }
            }
        }
        .onChange(of: sessionStore.startingPosition) { oldValue, newValue in
            // Refresh book details when position changes (user navigated in Kindle)
            if let asin = sessionStore.asin, !asin.isEmpty,
               oldValue != newValue, newValue != nil {
                Task { await fetchBookDetails(asin: asin) }
            }
        }
    }

    // DEBUG MODE: UNCOMMENT
//    private var pipelineConfigurationSection: some View {
//        GroupBox("Pipeline Options") {
//            VStack(alignment: .leading, spacing: 12) {
//                Toggle("Use manual starting position", isOn: $useManualStartingPosition)
//                if useManualStartingPosition {
//                    TextField("Enter starting position (e.g. 3698;0 or 210769)", text: $manualStartingPosition)
//                        .textFieldStyle(.roundedBorder)
//                        .font(.caption.monospaced())
//                }
//            }
//        }
//    }

    private var actionButtonsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(isGeneratingAudiobook ? "Generating..." : "Generate Audiobook") {
                Task { await generateAudiobook() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isGeneratingAudiobook || sessionStore.bookDetails == nil)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        }
    }

    private var audioPreviewSection: some View {
        VStack(spacing: 16) {
            if isGeneratingAudiobook {
                // Loading state while generating
                GroupBox {
                    VStack(spacing: 16) {
                        ProgressView()
                            .scaleEffect(1.5)
                        Text("Generating audiobook...")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 30)
                }
            } else if let url = downloadedAudioURL {
                // Audio player card when ready
                AudioPlayerCardView(
                    coordinator: playbackCoordinator,
                    title: sessionStore.bookDetails?.title ?? "Kindle Audio Preview",
                    coverImageURL: sessionStore.bookDetails?.coverImage
                )

                if let message = audioErrorMessage ?? playbackCoordinator.audioController.errorMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundColor(.red)
                }

                if let progressMessage = playbackCoordinator.progressErrorMessage {
                    Text(progressMessage)
                        .font(.caption)
                        .foregroundColor(.orange)
                }
            } else {
                GroupBox {
                    Text("Tap 'Generate Audiobook' to create audio")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                }
            }
        }
    }

    // DEBUG MODE: UNCOMMENT
//    private var logSection: some View {
//        GroupBox("Status Log") {
//            if statusLog.isEmpty {
//                Text("No actions yet.")
//                    .foregroundStyle(.secondary)
//            } else {
//                ScrollView {
//                    VStack(alignment: .leading, spacing: 4) {
//                        ForEach(Array(statusLog.enumerated()), id: \.offset) { entry in
//                            Text(entry.element)
//                                .font(.caption.monospaced())
//                                .frame(maxWidth: .infinity, alignment: .leading)
//                        }
//                    }
//                }
//                .frame(minHeight: 120, maxHeight: 200)
//            }
//        }
//    }

    private var canCreateSession: Bool {
        guard !cookieString.isEmpty else { return false }
        guard let deviceToken = sessionStore.deviceToken?.trimmedNonEmpty() else {
            return false
        }
        guard let renderingToken = sessionStore.renderingToken?.trimmedNonEmpty() else {
            return false
        }
        guard sessionStore.rendererRevision?.trimmedNonEmpty() != nil else {
            return false
        }
        guard let guid = sessionStore.guid?.trimmedNonEmpty() else {
            return false
        }
        return true
    }

    private var cookieString: String {
        sessionStore.cookies
            .map { "\($0.name)=\($0.value)" }
            .joined(separator: "; ")
    }

    @MainActor
    private func ensureBookMetadata() -> (asin: String, startingPosition: String)? {
        guard let asin = sessionStore.asin?.trimmedNonEmpty() else {
            presentAlert(
                title: "Missing Book",
                message: "We haven’t captured a book ASIN yet. Open the Login web view, tap the Kindle book you want, then try again."
            )
            log("Missing ASIN; prompted user to reopen the reader.")
            return nil
        }
        guard let startingPosition = sessionStore.startingPosition?.trimmedNonEmpty() else {
            presentAlert(
                title: "Missing Starting Position",
                message: "Navigate inside the Kindle book in the embedded browser so we can capture the current position, then run the action again."
            )
            log("Missing starting position; prompted user to navigate inside the reader.")
            return nil
        }
        return (asin: asin, startingPosition: startingPosition)
    }

    @MainActor
    private func ensureSessionInputs() -> Bool {
        if cookieString.isEmpty {
            presentAlert(
                title: "Sign In Required",
                message: loginRefreshMessage(reason: "Session cookies are missing or expired.")
            )
            log("Missing cookies; prompted user to log in again.")
            return false
        }
        guard sessionStore.deviceToken?.trimmedNonEmpty() != nil else {
            presentAlert(
                title: "Sign In Required",
                message: loginRefreshMessage(reason: "Device token is missing.")
            )
            log("Missing device token; prompted user to log in again.")
            return false
        }
        guard sessionStore.renderingToken?.trimmedNonEmpty() != nil else {
            presentAlert(
                title: "Sign In Required",
                message: loginRefreshMessage(reason: "Rendering token is missing.")
            )
            log("Missing rendering token; prompted user to log in again.")
            return false
        }
        guard sessionStore.rendererRevision?.trimmedNonEmpty() != nil else {
            presentAlert(
                title: "Sign In Required",
                message: loginRefreshMessage(reason: "Renderer revision is missing.")
            )
            log("Missing renderer revision; prompted user to log in again.")
            return false
        }
        guard sessionStore.guid?.trimmedNonEmpty() != nil else {
            presentAlert(
                title: "Sign In Required",
                message: loginRefreshMessage(reason: "GUID is missing.")
            )
            log("Missing GUID; prompted user to log in again.")
            return false
        }
        return true
    }

    @MainActor
    private func createSession() async {
        guard ensureSessionInputs() else { return }
        latestPipeline = nil
        resetAudioPlaybackState()
        do {
            let client = try makeClient()
            isPerformingRequest = true
            log("Ensuring session...")
            defer { isPerformingRequest = false }
            _ = try await ensureSession(client: client)
        } catch {
            logError(error)
        }
    }

    @MainActor
    private func fetchBookDetails(asin: String) async {
        guard ensureSessionInputs() else {
            isLoadingBookDetails = false
            return
        }

        isLoadingBookDetails = true
        defer { isLoadingBookDetails = false }

        do {
            let client = try makeClient()
            let sessionId = try await ensureSession(client: client)
            log("Fetching book details for \(asin)...")

            let response = try await client.fetchFullDetails(sessionId: sessionId, asin: asin)
            let details = BookDetails(
                title: response.title,
                coverImage: response.coverImage,
                currentPosition: response.currentPosition,
                length: response.length
            )
            sessionStore.updateBookDetails(details)
            log("Book details loaded: \(response.title)")
        } catch {
            isLoadingBookDetails = false
            logError(error)
        }
    }

    @MainActor
    private func generateAudiobook() async {
        guard let metadata = ensureBookMetadata() else { return }
        guard ensureSessionInputs() else { return }

        let asin = metadata.asin
        let startingPosition = resolveStartingPosition(defaultValue: metadata.startingPosition)

        do {
            let client = try makeClient()
            isGeneratingAudiobook = true
            resetAudioPlaybackState()
            defer { isGeneratingAudiobook = false }

            // Step 1: Run the pipeline
            log("Starting pipeline for \(asin) at position \(startingPosition)...")
            let sessionId = try await ensureSession(client: client)

            let request = APIClient.PipelineRequest(
                startingPosition: startingPosition
            )
            let response = try await client.runPipeline(sessionId: sessionId, asin: asin, request: request)
            latestPipeline = response

            let stepSummary = response.steps.map { $0.displayName }.joined(separator: ", ")
            log("Pipeline steps completed: \(stepSummary)")

            if response.steps.contains(.ocr) {
                log("Pipeline finished. OCR completed for chunk \(response.chunkId).")
            } else {
                log("Pipeline finished. chunkId=\(response.chunkId)")
            }

            // Step 2: Download the audio
            guard response.audioDurationSeconds != nil else {
                log("Audio is not available from this pipeline run.")
                return
            }

            log("Downloading audio preview for chunk \(response.chunkId)...")
            let fileURL = try await client.downloadChunkAudio(
                sessionId: sessionId,
                asin: response.asin,
                chunkId: response.chunkId
            )

            let benchmarks = try await client.fetchBenchmarks(
                sessionId: sessionId,
                asin: response.asin,
                chunkId: response.chunkId
            )

            let timeline = BenchmarkTimeline(response: benchmarks)

            downloadedAudioURL = fileURL
            benchmarkTimeline = timeline
            let title = sessionStore.bookDetails?.title ?? "Kindle Audio Preview"
            let coverImageURL = sessionStore.bookDetails?.coverImage
            playbackCoordinator.configure(
                audioURL: fileURL,
                title: title,
                coverImageURL: coverImageURL,
                timeline: timeline,
                client: client,
                sessionId: sessionId,
                asin: response.asin
            )
            log("Audio preview saved to \(fileURL.lastPathComponent).")
            log("Loaded \(timeline.checkpoints.count) benchmark checkpoints.")
        } catch {
            logError(error)
        }
    }

    @MainActor
    private func startAudiobookPipeline() async {
        guard let metadata = ensureBookMetadata() else { return }
        guard ensureSessionInputs() else { return }

        let asin = metadata.asin
        let startingPosition = resolveStartingPosition(defaultValue: metadata.startingPosition)

        do {
            let client = try makeClient()
            isPerformingRequest = true
            log("Starting pipeline for \(asin) at position \(startingPosition)...")
            let sessionId = try await ensureSession(client: client)
            defer { isPerformingRequest = false }

            let request = APIClient.PipelineRequest(
                startingPosition: startingPosition
            )
            resetAudioPlaybackState()
            let response = try await client.runPipeline(sessionId: sessionId, asin: asin, request: request)
            latestPipeline = response

            let stepSummary = response.steps.map { $0.displayName }.joined(separator: ", ")
            log("Pipeline steps completed: \(stepSummary)")

            if response.steps.contains(.ocr) {
                log("Pipeline finished. OCR completed for chunk \(response.chunkId).")
            } else {
                log("Pipeline finished. chunkId=\(response.chunkId)")
            }
        } catch {
            logError(error)
        }
    }

    @MainActor
    private func downloadAudioPreview() async {
        guard let pipeline = latestPipeline, pipeline.audioDurationSeconds != nil else {
            log("Audio preview is not available yet. Run the pipeline first.")
            return
        }

        guard ensureSessionInputs() else { return }

        do {
            let client = try makeClient()
            let sessionId = try await ensureSession(client: client)
            isDownloadingAudio = true
            audioErrorMessage = nil
            log("Downloading audio preview for chunk \(pipeline.chunkId)...")
            defer { isDownloadingAudio = false }

            let fileURL = try await client.downloadChunkAudio(
                sessionId: sessionId,
                asin: pipeline.asin,
                chunkId: pipeline.chunkId
            )

            let benchmarks = try await client.fetchBenchmarks(
                sessionId: sessionId,
                asin: pipeline.asin,
                chunkId: pipeline.chunkId
            )

            let timeline = BenchmarkTimeline(response: benchmarks)

            downloadedAudioURL = fileURL
            benchmarkTimeline = timeline
            let title = sessionStore.bookDetails?.title ?? "Kindle Audio Preview"
            let coverImageURL = sessionStore.bookDetails?.coverImage
            playbackCoordinator.configure(
                audioURL: fileURL,
                title: title,
                coverImageURL: coverImageURL,
                timeline: timeline,
                client: client,
                sessionId: sessionId,
                asin: pipeline.asin
            )
            log("Audio preview saved to \(fileURL.lastPathComponent).")
            log("Loaded \(timeline.checkpoints.count) benchmark checkpoints.")
        } catch {
            audioErrorMessage = error.localizedDescription
            logError(error)
        }
    }

    @MainActor
    private func resetAudioPlaybackState() {
        playbackCoordinator.stop()
        downloadedAudioURL = nil
        benchmarkTimeline = nil
        audioErrorMessage = nil
        isDownloadingAudio = false
    }

    private func makeClient() throws -> APIClient {
        guard let baseURL = try resolveBaseURL() else {
            throw ValidationError.invalidBaseURL
        }
        log("API Base URL: \(baseURL.absoluteString)")
        return APIClient(baseURL: baseURL)
    }

    private func resolveBaseURL() throws -> URL? {
        if
            let envValue = ProcessInfo.processInfo.environment["API_BASE_URL"],
            let url = URL(string: envValue.trimmingCharacters(in: .whitespacesAndNewlines)),
            !envValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            return url
        }

        guard
            let rawValue = Bundle.main.object(forInfoDictionaryKey: "API_BASE_HOST") as? String
        else {
            return nil
        }
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }

        let prefix = trimmed.contains(":") ? "http://" : "https://"
        return URL(string: prefix + trimmed)
    }

    @MainActor
    
    private func resolveStartingPosition(defaultValue: String) -> String {
        guard useManualStartingPosition else {
            return defaultValue
        }
        let trimmed = manualStartingPosition.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        if trimmed.isEmpty {
            return defaultValue
        }
        log("Using manual starting position: \\(trimmed)")
        return trimmed
    }
private func ensureSession(client: APIClient) async throws -> String {
        if let sessionId, !sessionId.isEmpty {
            log("Reusing existing session.")
            return sessionId
        }

        log("Creating new session with captured credentials...")
        let request = try buildSessionRequest()
        let response = try await client.createSession(request: request)
        sessionId = response.sessionId
        log("Session created: \(response.sessionId)")
        return response.sessionId
    }

    private func buildSessionRequest() throws -> APIClient.SessionRequest {
        guard !cookieString.isEmpty else { throw ValidationError.missing("session cookies") }
        guard let deviceToken = sessionStore.deviceToken?.trimmedNonEmpty() else {
            throw ValidationError.missing("device token")
        }
        guard let renderingToken = sessionStore.renderingToken?.trimmedNonEmpty() else {
            throw ValidationError.missing("rendering token")
        }
        guard let rendererRevision = sessionStore.rendererRevision?.trimmedNonEmpty() else {
            throw ValidationError.missing("renderer revision")
        }
        guard let guid = sessionStore.guid?.trimmedNonEmpty() else {
            throw ValidationError.missing("GUID")
        }

        return APIClient.SessionRequest(
            cookieString: cookieString,
            deviceToken: deviceToken,
            renderingToken: renderingToken,
            rendererRevision: rendererRevision,
            guid: guid,
            tlsServerUrl: nil,
            tlsApiKey: nil
        )
    }

    @MainActor
    private func invalidateSession(reason: String? = nil) {
        guard sessionId != nil else { return }
        sessionId = nil
        if let reason {
            log("Cleared cached session: \(reason).")
        } else {
            log("Cleared cached session.")
        }
    }

    @MainActor
    private func presentAlert(title: String, message: String) {
        activeAlert = AppAlert(title: title, message: message)
    }

    private func loginRefreshMessage(reason: String) -> String {
        """
        \(reason)

        Please open the Login screen, sign into Amazon again, and tap the book you want so we can refresh the session.
        """
    }

    private func sessionExpiryReason(for apiError: APIClient.APIError) -> String? {
        let normalized = normalizedApiMessage(from: apiError)
        let lower = normalized.lowercased()

        if apiError.statusCode == 401 || apiError.statusCode == 403 {
            return "Amazon rejected our credentials (HTTP \(apiError.statusCode))."
        }

        if lower.contains("expired") {
            return "Amazon reports the session is expired."
        }

        if (400...499).contains(apiError.statusCode) {
            if lower.contains("cookie") {
                return "Amazon could not validate the Kindle cookies."
            }
            if lower.contains("rendering") && lower.contains("token") {
                return "Amazon could not validate the rendering token."
            }
            if lower.contains("device") && lower.contains("token") {
                return "Amazon could not validate the device token."
            }
            if lower.contains("guid") {
                return "Amazon could not validate the GUID."
            }
            if lower.contains("unauthorized") || lower.contains("forbidden") {
                return "Amazon rejected our credentials (HTTP \(apiError.statusCode))."
            }
        }

        return nil
    }

    private func normalizedApiMessage(from apiError: APIClient.APIError) -> String {
        let raw = apiError.message
        guard let data = raw.data(using: .utf8) else { return raw }

        if let object = try? JSONSerialization.jsonObject(with: data, options: []),
           let dict = object as? [String: Any] {
            if let message = dict["message"] as? String, !message.isEmpty {
                return message
            }
            if let error = dict["error"] as? String, !error.isEmpty {
                return error
            }
            if let detail = dict["detail"] as? String, !detail.isEmpty {
                return detail
            }
        }

        return raw
    }

    @MainActor
    private func log(_ message: String) {
        statusLog.append(message)
        if statusLog.count > 50 {
            statusLog.removeFirst(statusLog.count - 50)
        }
    }

    @MainActor
    private func logError(_ error: Error) {
        if let validation = error as? ValidationError {
            log("Error: \(validation.localizedDescription)")
            presentAlert(
                title: "Missing Information",
                message: validation.guidanceMessage
            )
            return
        }

        if let apiError = error as? APIClient.APIError {
            log("Error: \(apiError.localizedDescription)")
            if let reason = sessionExpiryReason(for: apiError) {
                presentAlert(
                    title: "Session Expired",
                    message: loginRefreshMessage(reason: reason)
                )
            } else {
                presentAlert(
                    title: "Request Failed",
                    message: normalizedApiMessage(from: apiError)
                )
            }
            return
        }

        log("Error: \(error.localizedDescription)")
        presentAlert(
            title: "Request Failed",
            message: error.localizedDescription
        )
    }

    private func formatDuration(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "--" }
        let totalSeconds = Int(seconds.rounded())
        let minutes = totalSeconds / 60
        let remainder = totalSeconds % 60
        return String(format: "%d:%02d", minutes, remainder)
    }
}

private enum ValidationError: LocalizedError {
    case invalidBaseURL
    case missing(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "Invalid base URL"
        case .missing(let field):
            return "Missing \(field)."
        }
    }

    var guidanceMessage: String {
        switch self {
        case .invalidBaseURL:
            return "The app’s base URL is invalid. Update the code with a reachable API host and try again."
        case .missing(let field):
            return """
            \(field.capitalized) is missing or expired.

            Please open the Login screen, sign into Amazon again, and tap your book so we can refresh the session.
            """
        }
    }
}

private extension String {
    func truncated(maxLength: Int) -> String {
        guard count > maxLength else { return self }
        let endIndex = index(startIndex, offsetBy: maxLength)
        return String(self[..<endIndex]) + "..."
    }

    func trimmedNonEmpty() -> String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private extension APIClient.PipelineStep {
    var displayName: String {
        rawValue.capitalized
    }
}

private struct AppAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView(sessionStore: SessionStore())
    }
}
