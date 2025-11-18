import Foundation

struct APIClient {
    let baseURL: URL
    let urlSession: URLSession

    init(baseURL: URL, urlSession: URLSession = .shared) {
        self.baseURL = baseURL
        self.urlSession = urlSession
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

    func fetchBooks(sessionId: String) async throws -> BooksResponse {
        return try await send(
            path: "books",
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

    func fetchBenchmarks(sessionId: String, asin: String, chunkId: String) async throws -> BenchmarkResponse {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        let encodedChunk = chunkId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? chunkId
        return try await send(
            path: "books/\(encodedASIN)/chunks/\(encodedChunk)/benchmarks",
            method: "GET",
            headers: ["Authorization": "Bearer \(sessionId)"]
        )
    }

    func downloadChunkAudio(sessionId: String, asin: String, chunkId: String) async throws -> URL {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        let encodedChunk = chunkId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? chunkId

        guard let url = URL(string: "books/\(encodedASIN)/chunks/\(encodedChunk)/audio", relativeTo: baseURL)?.absoluteURL else {
            throw APIError(statusCode: -1, message: "Invalid audio URL")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(sessionId)", forHTTPHeaderField: "Authorization")

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
        let destination = audioDir.appendingPathComponent("\(sanitizedAsin)_\(sanitizedChunk).mp3")

        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }

        try fileManager.moveItem(at: tempURL, to: destination)
        return destination
    }

    func fetchText(sessionId: String, asin: String, start: Int, length: Int, chunkId: String?) async throws -> TextResponse {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        var path = "books/\(encodedASIN)/text?start=\(start)&length=\(length)"
        if let chunkId,
           let encodedChunk = chunkId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "&chunkId=\(encodedChunk)"
        }
        return try await send(
            path: path,
            method: "GET",
            headers: ["Authorization": "Bearer \(sessionId)"]
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
        decoder.keyDecodingStrategy = .convertFromSnakeCase
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

    struct SessionRequest: Encodable {
        let cookieString: String
        let deviceToken: String
        let renderingToken: String
        let rendererRevision: String
        let guid: String
        let tlsServerUrl: String
        let tlsApiKey: String
    }

    struct SessionResponse: Decodable {
        let sessionId: String
    }

    struct BooksResponse: Decodable {
        let books: [Book]
    }

    struct Book: Decodable, Identifiable, Equatable {
        let asin: String
        let title: String

        var id: String { asin }
    }

    struct TextResponse: Decodable, Equatable {
        let text: String
        let bytesRead: Int
        let hasMore: Bool
    }

    struct PipelineRequest: Encodable {
        let startingPosition: String
    }

    struct PipelineResponse: Decodable, Equatable {
        let asin: String
        let chunkId: String
        let steps: [PipelineStep]
        let positionRange: PositionRange
        let artifactsDir: String
        let audioDurationSeconds: Double?
    }

    struct PositionRange: Decodable, Equatable {
        let startPositionId: Int
        let endPositionId: Int
    }

    enum PipelineStep: String, Codable, Equatable {
        case download
        case ocr
        case audio
    }

    struct BenchmarkResponse: Decodable, Equatable {
        let totalDurationSeconds: Double
        let benchmarkIntervalSeconds: Double
        let benchmarks: [Benchmark]

        struct Benchmark: Decodable, Equatable {
            let timeSeconds: Double
            let kindlePositionIdStart: Int
            let kindlePositionIdEnd: Int
        }
    }

    struct UpdateProgressRequest: Encodable {
        let position: Int
    }

    struct UpdateProgressResponse: Decodable, Equatable {
        let success: Bool
        let upstreamStatus: Int

        private enum CodingKeys: String, CodingKey {
            case success
            case upstreamStatus
        }
    }

    struct EmptyResponse: Decodable {
        init() {}
    }

    struct APIError: LocalizedError {
        let statusCode: Int
        let message: String

        var errorDescription: String? {
            "HTTP \(statusCode): \(message)"
        }
    }
}
