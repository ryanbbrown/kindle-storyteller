import SwiftUI

struct ContentView: View {
    @ObservedObject var sessionStore: SessionStore
    @State private var isPresentingLogin = false

    @State private var baseURLString = "http://127.0.0.1:3000"
    @State private var deviceToken = ""
    @State private var renderingToken = ""
    @State private var guid = ""
    @State private var asin = ""
    @State private var webViewReloadCounter = 0

    @State private var sessionId: String?
    @State private var books: [APIClient.Book] = []
    @State private var latestContent: APIClient.BookContent?
    @State private var latestOcr: APIClient.OcrResponse?
    @State private var latestTextChunk: APIClient.TextResponse?
    @State private var statusLog: [String] = []
    @State private var isPerformingRequest = false
    @State private var renderNumPages: Int = 5
    @State private var renderSkipPages: Int = 0
    @State private var ocrMaxPages: Int = 2
    @State private var textStart: Int = 0
    @State private var textLength: Int = 500

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                headerSection
                cookiesSection
                apiConfigurationSection
                ocrConfigurationSection
                textConfigurationSection
                actionButtonsSection
                sessionInfoSection
                booksSection
                contentPreviewSection
                ocrInfoSection
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
                    },
                    onRenderingTokenCaptured: { token, url in
                        sessionStore.updateRenderingToken(token, sourceURL: url)
                    },
                    onDeviceTokenCaptured: { token in
                        sessionStore.updateDeviceToken(token)
                    },
                    onStartingPositionCaptured: { position in
                        sessionStore.updateStartingPosition(position)
                    },
                    onGUIDCaptured: { value in
                        sessionStore.updateGUID(value)
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
        .onChange(of: sessionStore.renderingToken) { newValue in
            guard let token = newValue, !token.isEmpty else { return }
            renderingToken = token
        }
        .onChange(of: sessionStore.deviceToken) { newValue in
            guard let token = newValue, !token.isEmpty else { return }
            deviceToken = token
        }
        .onChange(of: sessionStore.guid) { newValue in
            guard let value = newValue, !value.isEmpty else { return }
            guid = value
        }
        .onChange(of: sessionStore.asin) { newValue in
            guard let value = newValue, !value.isEmpty else { return }
            asin = value
        }
        .onAppear {
            if let token = sessionStore.renderingToken, !token.isEmpty {
                renderingToken = token
            }
            if let token = sessionStore.deviceToken, !token.isEmpty {
                deviceToken = token
            }
            if let value = sessionStore.guid, !value.isEmpty {
                guid = value
            }
            if let value = sessionStore.asin, !value.isEmpty {
                asin = value
            }
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

    private var cookiesSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Session Cookies")
                    .font(.title3.bold())

                if sessionStore.cookies.isEmpty {
                    Text("No cookies captured yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(sessionStore.cookies, id: \.name) { cookie in
                        Text("\(cookie.name): \(cookie.value.truncated(maxLength: 40))")
                            .font(.caption.monospaced())
                    }
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Rendering Token")
                    .font(.title3.bold())

                if let token = sessionStore.renderingToken, !token.isEmpty {
                    Text(token.truncated(maxLength: 60))
                        .font(.caption.monospaced())
                } else {
                    Text("Not captured yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Device Token")
                    .font(.title3.bold())

                if let token = sessionStore.deviceToken, !token.isEmpty {
                    Text(token)
                        .font(.caption.monospaced())
                } else {
                    Text("Not captured yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("GUID")
                    .font(.title3.bold())

                if let guidValue = sessionStore.guid, !guidValue.isEmpty {
                    Text(guidValue)
                        .font(.caption.monospaced())
                } else {
                    Text("Not captured yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("ASIN")
                    .font(.title3.bold())

                if let asinValue = sessionStore.asin, !asinValue.isEmpty {
                    Text(asinValue)
                        .font(.caption.monospaced())
                } else {
                    Text("Not captured yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Starting Position")
                    .font(.title3.bold())

                if let position = sessionStore.startingPosition, !position.isEmpty {
                    Text(position)
                        .font(.caption.monospaced())
                } else {
                    Text("Not captured yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var apiConfigurationSection: some View {
        GroupBox("API Configuration") {
            VStack(alignment: .leading, spacing: 12) {
                configurationField(title: "Base URL", text: $baseURLString)
                configurationField(title: "Rendering Token", text: $renderingToken)
            }
        }
    }

    private var ocrConfigurationSection: some View {
        GroupBox("OCR Options") {
            VStack(alignment: .leading, spacing: 12) {
                Stepper("Pages to render: \(renderNumPages)", value: $renderNumPages, in: 1...20)
                Stepper("Skip pages: \(renderSkipPages)", value: $renderSkipPages, in: 0...20)
                Stepper("Max pages to OCR: \(ocrMaxPages == 0 ? "all" : String(ocrMaxPages))", value: $ocrMaxPages, in: 0...20)
                    .help("Set to 0 to process all pages")
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

    private func configurationField(title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField(title, text: text)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.callout.monospaced())
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

                    Button("Fetch Renderer Preview") {
                        Task { await fetchFirstBookContent() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isPerformingRequest || (sessionStore.asin?.isEmpty ?? true))
                }

                HStack(spacing: 12) {
                    Button("Run OCR") {
                        Task { await runOcrPipeline() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isPerformingRequest)

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

    private var contentPreviewSection: some View {
        GroupBox("Content Preview") {
            if let latestContent {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Length: \(latestContent.textLength)")
                        .font(.caption)
                    Text("Cached: \(latestContent.cached ? "yes" : "no")")
                        .font(.caption)
                    Divider()
                    Text(latestContent.textPreview)
                        .font(.caption.monospaced())
                }
            } else {
                Text("No content fetched yet.")
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
        !cookieString.isEmpty &&
        !deviceToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !renderingToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !guid.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)) != nil
    }

    private var cookieString: String {
        sessionStore.cookies
            .map { "\($0.name)=\($0.value)" }
            .joined(separator: "; ")
    }

    @MainActor
    private func createSession() async {
        latestOcr = nil
        latestTextChunk = nil
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
    private func fetchFirstBookContent() async {
        guard let asin = sessionStore.asin, !asin.isEmpty else {
            log("No ASIN captured yet. Open the reader to load a book.")
            return
        }
        guard let startingPosition = sessionStore.startingPosition, !startingPosition.isEmpty else {
            log("Starting position missing. Navigate inside the reader first.")
            return
        }

        latestOcr = nil
        latestTextChunk = nil

        do {
            let client = try makeClient()
            let sessionId = try await ensureSession(client: client)
            isPerformingRequest = true
            log("Fetching renderer preview for \(asin)...")
            defer { isPerformingRequest = false }

            let renderRequest = APIClient.RenderRequest(renderOptions: .init(
                startingPosition: startingPosition,
                numPage: renderNumPages,
                skipPageCount: renderSkipPages
            ))
            let response = try await client.fetchBookContent(sessionId: sessionId, asin: asin, renderOptions: renderRequest)
            latestContent = response
            log("Renderer bundle ready. length=\(response.textLength) cached=\(response.cached)")
        } catch {
            logError(error)
        }
    }

    @MainActor
    private func runOcrPipeline() async {
        guard let asin = sessionStore.asin, !asin.isEmpty else {
            log("No ASIN captured yet. Open the reader to load a book.")
            return
        }
        guard let startingPosition = sessionStore.startingPosition, !startingPosition.isEmpty else {
            log("Starting position missing. Navigate inside the reader first.")
            return
        }

        do {
            let client = try makeClient()
            isPerformingRequest = true
            log("OCR pipeline starting for \(asin).")
            log("Step 1: Ensuring session...")
            let sessionId = try await ensureSession(client: client)
            log("Step 1: Session ready.")
            log("Step 2: Using captured ASIN \(asin).")
            log("Step 3: Downloading renderer bundle (start \(startingPosition), numPage \(renderNumPages), skip \(renderSkipPages))...")
            defer { isPerformingRequest = false }

            let renderRequest = APIClient.RenderRequest(renderOptions: .init(
                startingPosition: startingPosition,
                numPage: renderNumPages,
                skipPageCount: renderSkipPages
            ))
            let contentResponse = try await client.fetchBookContent(sessionId: sessionId, asin: asin, renderOptions: renderRequest)
            latestContent = contentResponse
            log("Step 3: Renderer bundle saved (cached=\(contentResponse.cached ? "yes" : "no")).")

            let ocrRequest: APIClient.OcrRequest?
            if ocrMaxPages > 0 {
                ocrRequest = APIClient.OcrRequest(maxPages: ocrMaxPages)
                log("Step 4: Running OCR (maxPages=\(ocrMaxPages))...")
            } else {
                ocrRequest = nil
                log("Step 4: Running OCR (all pages)...")
            }
            let ocrResponse = try await client.runOcr(sessionId: sessionId, asin: asin, request: ocrRequest)
            latestOcr = ocrResponse
            log("Step 4: OCR complete for \(asin). Processed \(ocrResponse.processedPages)/\(ocrResponse.totalPages) pages (cached=\(ocrResponse.cached ? "yes" : "no")).")
        } catch {
            logError(error)
        }
    }

    @MainActor
    private func fetchTextChunk() async {
        guard let asin = sessionStore.asin, !asin.isEmpty else {
            log("No ASIN captured yet. Open the reader to load a book.")
            return
        }

        do {
            let client = try makeClient()
            let sessionId = try await ensureSession(client: client)
            isPerformingRequest = true
            log("Fetching text chunk start=\(textStart) length=\(textLength)...")
            defer { isPerformingRequest = false }

            let response = try await client.fetchText(sessionId: sessionId, asin: asin, start: textStart, length: textLength)
            latestTextChunk = response
            log("Fetched text chunk (bytesRead=\(response.bytesRead)).")
            if response.bytesRead > 0 {
                textStart += response.bytesRead
            }
        } catch {
            logError(error)
        }
    }

    private func makeClient() throws -> APIClient {
        let trimmedBase = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let baseURL = URL(string: trimmedBase), !trimmedBase.isEmpty else {
            throw ValidationError.invalidBaseURL
        }
        return APIClient(baseURL: baseURL)
    }

    @MainActor
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
        let trimmedDeviceToken = deviceToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedDeviceToken.isEmpty else { throw ValidationError.missing("device token") }
        let trimmedRenderingToken = renderingToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedRenderingToken.isEmpty else { throw ValidationError.missing("rendering token") }
        let trimmedGUID = guid.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedGUID.isEmpty else { throw ValidationError.missing("GUID") }

        return APIClient.SessionRequest(
            cookieString: cookieString,
            deviceToken: trimmedDeviceToken,
            renderingToken: trimmedRenderingToken,
            guid: trimmedGUID,
            tlsServerUrl: "http://localhost:8080",
            tlsApiKey: "my-auth-key-1"
        )
    }
    private var ocrInfoSection: some View {
        GroupBox("OCR Results") {
            if let latestOcr {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Pages processed: \(latestOcr.processedPages) / \(latestOcr.totalPages)")
                        .font(.caption)
                    Text("Cached: \(latestOcr.cached ? "yes" : "no") • OCR enabled: \(latestOcr.ocrEnabled ? "yes" : "no")")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    if let combined = latestOcr.combinedTextPath {
                        Text("Combined text: \(combined)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    if let firstPage = latestOcr.pages.first {
                        Text("Sample page: index \(firstPage.index)")
                            .font(.caption)
                        Text(firstPage.png)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        if let textPath = firstPage.textPath {
                            Text(textPath)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                Text("OCR has not been run yet.")
                    .foregroundStyle(.secondary)
            }
        }
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
        if let apiError = error as? APIClient.APIError {
            log("Error: \(apiError.localizedDescription)")
        } else {
            log("Error: \(error.localizedDescription)")
        }
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
}

private extension String {
    func truncated(maxLength: Int) -> String {
        guard count > maxLength else { return self }
        let endIndex = index(startIndex, offsetBy: maxLength)
        return String(self[..<endIndex]) + "..."
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView(sessionStore: SessionStore())
    }
}
