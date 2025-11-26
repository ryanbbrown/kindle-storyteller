import Foundation

@MainActor
final class ContentViewModel: ObservableObject {
    let sessionStore: SessionStore
    let sessionService: SessionService
    let playbackCoordinator: PlaybackCoordinator

    @Published var activeAlert: AppAlert?
    @Published var statusLog: [String] = []
    @Published var isGeneratingAudiobook = false
    @Published var isLoadingBookDetails = false
    @Published var downloadedAudioURL: URL?
    @Published var audioErrorMessage: String?
    @Published var selectedAudioProvider: String = "cartesia"
    @Published var manualStartingPosition: String = ""
    @Published var useManualStartingPosition: Bool = false

    private var latestPipeline: PipelineResponse?
    private var benchmarkTimeline: BenchmarkTimeline?

    init(sessionStore: SessionStore) {
        self.sessionStore = sessionStore
        self.sessionService = SessionService(sessionStore: sessionStore)
        self.playbackCoordinator = PlaybackCoordinator()
    }

    /** Generates audiobook audio for the current book position. */
    func generateAudiobook() async {
        guard let metadata = validateBookMetadata() else { return }
        guard validateSessionInputs() else { return }

        let asin = metadata.asin
        let startingPosition = resolveStartingPosition(defaultValue: metadata.startingPosition)

        do {
            let client = try makeClient()
            isGeneratingAudiobook = true
            resetAudioPlaybackState()
            defer { isGeneratingAudiobook = false }

            log("Starting pipeline for \(asin) at position \(startingPosition)...")
            let sessionId = try await sessionService.ensureSession(client: client)
            log(sessionService.hasSession ? "Reusing existing session." : "Session created: \(sessionId)")

            let request = PipelineRequest(
                startingPosition: startingPosition,
                audioProvider: selectedAudioProvider
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

    /** Fetches book details for the given ASIN. */
    func fetchBookDetails(asin: String) async {
        guard validateSessionInputs() else {
            isLoadingBookDetails = false
            return
        }

        isLoadingBookDetails = true
        defer { isLoadingBookDetails = false }

        do {
            let client = try makeClient()
            let sessionId = try await sessionService.ensureSession(client: client)
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

    /** Resets all audio playback state. */
    func resetAudioPlaybackState() {
        playbackCoordinator.stop()
        downloadedAudioURL = nil
        benchmarkTimeline = nil
        audioErrorMessage = nil
    }

    /** Invalidates the current session cache. */
    func invalidateSession(reason: String?) {
        guard sessionService.hasSession else { return }
        sessionService.invalidateSession(reason: reason)
        if let reason {
            log("Cleared cached session: \(reason).")
        } else {
            log("Cleared cached session.")
        }
    }

    /** Appends a message to the status log. */
    func log(_ message: String) {
        statusLog.append(message)
        if statusLog.count > 50 {
            statusLog.removeFirst(statusLog.count - 50)
        }
    }

    /** Presents an alert to the user. */
    func presentAlert(title: String, message: String) {
        activeAlert = AppAlert(title: title, message: message)
    }

    // MARK: - Private

    private func makeClient() throws -> APIClient {
        guard let baseURL = resolveBaseURL() else {
            throw ValidationError.invalidBaseURL
        }
        log("API Base URL: \(baseURL.absoluteString)")
        return APIClient(baseURL: baseURL)
    }

    private func resolveBaseURL() -> URL? {
        if let envValue = ProcessInfo.processInfo.environment["API_BASE_URL"],
           let url = URL(string: envValue.trimmingCharacters(in: .whitespacesAndNewlines)),
           !envValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return url
        }

        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "API_BASE_HOST") as? String else {
            return nil
        }
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let prefix = trimmed.contains(":") ? "http://" : "https://"
        return URL(string: prefix + trimmed)
    }

    private func resolveStartingPosition(defaultValue: String) -> String {
        guard useManualStartingPosition else { return defaultValue }
        let trimmed = manualStartingPosition.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return defaultValue }
        log("Using manual starting position: \(trimmed)")
        return trimmed
    }

    private func validateBookMetadata() -> (asin: String, startingPosition: String)? {
        guard let asin = sessionStore.asin?.trimmedNonEmpty() else {
            presentAlert(
                title: "Missing Book",
                message: "We haven't captured a book ASIN yet. Open the Login web view, tap the Kindle book you want, then try again."
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

    private func validateSessionInputs() -> Bool {
        let result = sessionService.validateInputs()
        switch result {
        case .valid:
            return true
        case .missing(let field, let guidance):
            presentAlert(title: "Sign In Required", message: guidance)
            log("Missing \(field); prompted user to log in again.")
            return false
        }
    }

    private func logError(_ error: Error) {
        if let validation = error as? ValidationError {
            log("Error: \(validation.localizedDescription ?? "Unknown")")
            presentAlert(title: "Missing Information", message: validation.guidanceMessage)
            return
        }

        if let apiError = error as? APIError {
            log("Error: \(apiError.localizedDescription ?? "Unknown")")
            let classification = sessionService.classifyError(apiError)
            switch classification {
            case .sessionExpired(let reason):
                presentAlert(title: "Session Expired", message: loginRefreshMessage(reason: reason))
            case .networkError(let message), .other(let message):
                presentAlert(title: "Request Failed", message: message)
            }
            return
        }

        log("Error: \(error.localizedDescription)")
        presentAlert(title: "Request Failed", message: error.localizedDescription)
    }

    private func loginRefreshMessage(reason: String) -> String {
        """
        \(reason)

        Please open the Login screen, sign into Amazon again, and tap the book you want so we can refresh the session.
        """
    }
}
