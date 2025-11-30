import Foundation

struct APIClient {
    let baseURL: URL
    let urlSession: URLSession
    let apiKey: String

    init(baseURL: URL, urlSession: URLSession = .shared) {
        self.baseURL = baseURL
        self.urlSession = urlSession
        self.apiKey = Bundle.main.object(forInfoDictionaryKey: "SERVER_API_KEY") as? String ?? ""
    }

    func createSession(request: SessionRequest) async throws -> SessionResponse {
        let body = try JSONEncoder().encode(request)
        return try await send(
            path: "session",
            method: "POST",
            headers: ["Content-Type": "application/json"],
            body: body
        )
    }

    func fetchFullDetails(sessionId: String, asin: String) async throws -> BookDetailsResponse {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        return try await send(
            path: "books/\(encodedASIN)/full-details",
            method: "GET",
            headers: ["Authorization": "Bearer \(sessionId)"]
        )
    }

    func runPipeline(sessionId: String, asin: String, request: PipelineRequest) async throws -> PipelineResponse {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        let body = try JSONEncoder().encode(request)
        return try await send(
            path: "books/\(encodedASIN)/pipeline",
            method: "POST",
            headers: ["Authorization": "Bearer \(sessionId)", "Content-Type": "application/json"],
            body: body
        )
    }

    func fetchBenchmarks(asin: String, chunkId: String, provider: String, startPosition: Int? = nil, endPosition: Int? = nil) async throws -> BenchmarkResponse {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        let encodedChunk = chunkId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? chunkId
        var queryItems = "provider=\(provider)"
        if let start = startPosition {
            queryItems += "&startPosition=\(start)"
        }
        if let end = endPosition {
            queryItems += "&endPosition=\(end)"
        }
        return try await send(
            path: "books/\(encodedASIN)/chunks/\(encodedChunk)/benchmarks?\(queryItems)",
            method: "GET"
        )
    }

    func downloadChunkAudio(asin: String, chunkId: String, provider: String, startPosition: Int? = nil, endPosition: Int? = nil) async throws -> URL {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        let encodedChunk = chunkId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? chunkId

        var queryItems = "provider=\(provider)"
        if let start = startPosition {
            queryItems += "&startPosition=\(start)"
        }
        if let end = endPosition {
            queryItems += "&endPosition=\(end)"
        }

        guard let url = URL(string: "books/\(encodedASIN)/chunks/\(encodedChunk)/audio?\(queryItems)", relativeTo: baseURL)?.absoluteURL else {
            throw APIError(statusCode: -1, message: "Invalid audio URL")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")

        let (tempURL, response) = try await urlSession.download(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError(statusCode: -1, message: "Invalid response")
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let messageData = try? Data(contentsOf: tempURL)
            let message = messageData.flatMap { String(data: $0, encoding: .utf8) } ?? "Unknown error"
            throw APIError(statusCode: httpResponse.statusCode, message: message)
        }

        let fileManager = FileManager.default
        let cachesDir = try fileManager.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let audioDir = cachesDir.appendingPathComponent("AudioPreviews", isDirectory: true)
        try fileManager.createDirectory(at: audioDir, withIntermediateDirectories: true)

        let sanitizedAsin = sanitizeFilenameComponent(asin)
        let sanitizedChunk = sanitizeFilenameComponent(chunkId)
        let destination = audioDir.appendingPathComponent("\(sanitizedAsin)_\(sanitizedChunk)_\(provider).mp3")

        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }

        try fileManager.moveItem(at: tempURL, to: destination)
        return destination
    }

    /** Fetches the list of generated audiobooks from the server. */
    func fetchAudiobooks() async throws -> [AudiobookEntry] {
        return try await send(path: "audiobooks", method: "GET")
    }

    /** Deletes an audiobook from the server. */
    func deleteAudiobook(asin: String, chunkId: String, provider: String, startPosition: Int, endPosition: Int) async throws {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        let encodedChunk = chunkId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? chunkId
        let _: EmptyResponse = try await send(
            path: "audiobooks/\(encodedASIN)/\(encodedChunk)?provider=\(provider)&startPosition=\(startPosition)&endPosition=\(endPosition)",
            method: "DELETE"
        )
    }

    func updateProgress(sessionId: String, asin: String, position: Int) async throws -> UpdateProgressResponse {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        let body = try JSONEncoder().encode(UpdateProgressRequest(position: position))
        return try await send(
            path: "books/\(encodedASIN)/progress",
            method: "POST",
            headers: ["Authorization": "Bearer \(sessionId)", "Content-Type": "application/json"],
            body: body
        )
    }

    private func send<Response: Decodable>(
        path: String,
        method: String,
        headers: [String: String] = [:],
        body: Data? = nil
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw APIError(statusCode: -1, message: "Invalid URL path: \(path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method

        headers.forEach { key, value in
            request.setValue(value, forHTTPHeaderField: key)
        }
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")

        if let body {
            request.httpBody = body
            if request.value(forHTTPHeaderField: "Content-Type") == nil {
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
        }

        let (data, response) = try await urlSession.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError(statusCode: -1, message: "Invalid response")
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw APIError(statusCode: httpResponse.statusCode, message: message)
        }

        let decoder = JSONDecoder()
        if data.isEmpty {
            if Response.self == EmptyResponse.self, let empty = EmptyResponse() as? Response {
                return empty
            }
            throw APIError(statusCode: httpResponse.statusCode, message: "Empty response data")
        }
        return try decoder.decode(Response.self, from: data)
    }

    private func sanitizeFilenameComponent(_ input: String) -> String {
        let sanitized = input.replacingOccurrences(of: "[^A-Za-z0-9-_]+", with: "-", options: .regularExpression)
        let trimmed = sanitized.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return trimmed.isEmpty ? UUID().uuidString : sanitized
    }
}
