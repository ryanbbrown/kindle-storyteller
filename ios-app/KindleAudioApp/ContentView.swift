import SwiftUI

struct ContentView: View {
    @ObservedObject var sessionStore: SessionStore
    @StateObject private var playbackCoordinator = PlaybackCoordinator()
    @State private var isPresentingLogin = false

    @State private var webViewReloadCounter = 0

    @State private var sessionId: String?
    @State private var books: [APIClient.Book] = []
    @State private var latestPipeline: APIClient.PipelineResponse?
    @State private var latestTextChunk: APIClient.TextResponse?
    @State private var statusLog: [String] = []
    @State private var isPerformingRequest = false
    @State private var textStart: Int = 0
    @State private var textLength: Int = 500
    @State private var manualStartingPosition: String = ""
    @State private var useManualStartingPosition: Bool = false
    @State private var activeAlert: AppAlert?
    @State private var downloadedAudioURL: URL?
    @State private var benchmarkTimeline: BenchmarkTimeline?
    @State private var isDownloadingAudio = false
    @State private var audioErrorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                headerSection
                bookMetadataSection
                pipelineConfigurationSection
                textConfigurationSection
                actionButtonsSection
                sessionInfoSection
                booksSection
                pipelineSummarySection
                audioPreviewSection
                textOutputSection
                logSection
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
            Text("Kindle Audio App")
                .font(.largeTitle.bold())

            Button(action: { isPresentingLogin = true }) {
                Text("Login")
                    .font(.headline)
                    .padding(.horizontal, 32)
                    .padding(.vertical, 12)
                    .background(Color.accentColor)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
        }
    }

    private var bookMetadataSection: some View {
        GroupBox("Captured Book Data") {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("ASIN")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(sessionStore.asin ?? "—")
                        .font(.caption.monospaced())
                        .foregroundStyle((sessionStore.asin?.isEmpty ?? true) ? .secondary : .primary)
                }

                HStack {
                    Text("Starting Position")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(sessionStore.startingPosition ?? "—")
                        .font(.caption.monospaced())
                        .foregroundStyle((sessionStore.startingPosition?.isEmpty ?? true) ? .secondary : .primary)
                }
            }
        }
    }

    private var pipelineConfigurationSection: some View {
        GroupBox("Pipeline Options") {
            VStack(alignment: .leading, spacing: 12) {
                Toggle("Use manual starting position", isOn: $useManualStartingPosition)
                if useManualStartingPosition {
                    TextField("Enter starting position (e.g. 3698;0 or 210769)", text: $manualStartingPosition)
                        .textFieldStyle(.roundedBorder)
                        .font(.caption.monospaced())
                }
            }
        }
    }

    private var textConfigurationSection: some View {
        GroupBox("Text Retrieval") {
            VStack(alignment: .leading, spacing: 12) {
                Stepper("Start byte: \(textStart)", value: $textStart, in: 0...1_000_000, step: 100)
                Stepper("Chunk length: \(textLength)", value: $textLength, in: 100...5000, step: 100)
            }
        }
    }

    private var actionButtonsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Actions")
                .font(.title3.bold())

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Button("Create Session") {
                        Task { await createSession() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isPerformingRequest || !canCreateSession)

                    Button("Fetch Books") {
                        Task { await fetchBooks() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isPerformingRequest)
                }

                HStack(spacing: 12) {
                    Button("Start Audiobook") {
                        Task { await startAudiobookPipeline() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isPerformingRequest || (sessionStore.asin?.isEmpty ?? true))

                    Button("Get Text Chunk") {
                        Task { await fetchTextChunk() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isPerformingRequest)
                }

            }
        }
    }

    private var sessionInfoSection: some View {
        GroupBox("Session") {
            if let sessionId {
                Text("Active session ID: \(sessionId)")
                    .font(.caption.monospaced())
            } else {
                Text("No active session yet.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var booksSection: some View {
        GroupBox("Books") {
            if books.isEmpty {
                Text("No books fetched yet.")
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(books.enumerated()), id: \.element.id) { entry in
                        Text("\(entry.offset + 1). \(entry.element.title) (\(entry.element.asin))")
                            .font(.caption)
                    }
                }
            }
        }
    }

    private var pipelineSummarySection: some View {
        GroupBox("Pipeline Summary") {
            if let pipeline = latestPipeline {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Chunk ID: \(pipeline.chunkId)")
                        .font(.caption)

                    Text("Positions: \(pipeline.positionRange.startPositionId) → \(pipeline.positionRange.endPositionId)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    Text("Steps: \(pipeline.steps.map { $0.displayName }.joined(separator: ", "))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    Text("Artifacts stored at \(pipeline.artifactsDir)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("Pipeline has not been run yet.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var audioPreviewSection: some View {
        GroupBox("Audio Preview") {
            if let pipeline = latestPipeline, let duration = pipeline.audioDurationSeconds {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Duration: \(formatDuration(duration))")
                        .font(.caption)

                    if let url = downloadedAudioURL {
                        Text("Saved to: \(url.lastPathComponent)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Audio has not been downloaded yet.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    if let timeline = benchmarkTimeline {
                        Text("Loaded \(timeline.checkpoints.count) checkpoints")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    if let message = audioErrorMessage ?? playbackCoordinator.audioController.errorMessage {
                        Text(message)
                            .font(.caption2)
                            .foregroundColor(.red)
                    }

                    if let progressMessage = playbackCoordinator.progressErrorMessage {
                        Text(progressMessage)
                            .font(.caption2)
                            .foregroundColor(.orange)
                    }

                    HStack(spacing: 12) {
                        Button(isDownloadingAudio ? "Downloading..." : "Download Audio") {
                            Task { await downloadAudioPreview() }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isDownloadingAudio)

                        Button(playbackCoordinator.audioController.isPlaying ? "Pause" : "Play") {
                            if playbackCoordinator.audioController.isPlaying {
                                playbackCoordinator.pause()
                            } else {
                                playbackCoordinator.play()
                            }
                        }
                        .buttonStyle(.bordered)
                        .disabled(!playbackCoordinator.audioController.isReady)
                    }
                }
            } else {
                Text("Run the pipeline with OCR to generate an audio preview.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var logSection: some View {
        GroupBox("Status Log") {
            if statusLog.isEmpty {
                Text("No actions yet.")
                    .foregroundStyle(.secondary)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(statusLog.enumerated()), id: \.offset) { entry in
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
        latestTextChunk = nil
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
    private func fetchBooks() async {
        guard ensureSessionInputs() else { return }
        do {
            let client = try makeClient()
            let sessionId = try await ensureSession(client: client)
            isPerformingRequest = true
            log("Fetching books...")
            defer { isPerformingRequest = false }

            let response = try await client.fetchBooks(sessionId: sessionId)
            books = response.books
            log("Fetched \(response.books.count) book(s).")
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

            latestTextChunk = nil
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
    private func fetchTextChunk() async {
        guard let metadata = ensureBookMetadata() else { return }
        guard ensureSessionInputs() else { return }
        let asin = metadata.asin

        do {
            let client = try makeClient()
            let sessionId = try await ensureSession(client: client)
            isPerformingRequest = true
            let chunkId = latestPipeline?.chunkId
            log("Fetching text chunk start=\(textStart) length=\(textLength) chunkId=\(chunkId ?? "latest")...")
            defer { isPerformingRequest = false }

            let response = try await client.fetchText(
                sessionId: sessionId,
                asin: asin,
                start: textStart,
                length: textLength,
                chunkId: chunkId
            )
            latestTextChunk = response
            log("Fetched text chunk (bytesRead=\(response.bytesRead)).")
            if response.bytesRead > 0 {
                textStart += response.bytesRead
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
            let title = books.first(where: { $0.asin == pipeline.asin })?.title ?? "Kindle Audio Preview"
            playbackCoordinator.configure(
                audioURL: fileURL,
                title: title,
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
        // For device testing switch to: http://192.168.1.30:3000
        guard let baseURL = URL(string: "http://localhost:3000") else {
            throw ValidationError.invalidBaseURL
        }
        return APIClient(baseURL: baseURL)
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
            tlsServerUrl: "http://localhost:8080",
            tlsApiKey: "my-auth-key-1"
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
    private var textOutputSection: some View {
        GroupBox("Text Chunk") {
            if let latestTextChunk {
                VStack(alignment: .leading, spacing: 8) {
                    Text(latestTextChunk.text)
                        .font(.callout)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("Bytes read: \(latestTextChunk.bytesRead) • Has more: \(latestTextChunk.hasMore ? "yes" : "no")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("No text fetched yet.")
                    .foregroundStyle(.secondary)
            }
        }
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
