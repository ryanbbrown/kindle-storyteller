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

    struct SessionRequest: Encodable {
        let cookieString: String
        let deviceToken: String
        let renderingToken: String
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
        let numPages: Int?
        let skipPages: Int?
        let steps: [PipelineStep]?
        let ocr: OcrOptions?

        struct OcrOptions: Encodable {
            let startPage: Int?
            let maxPages: Int?
        }
    }

    struct PipelineResponse: Decodable, Equatable {
        let asin: String
        let chunkId: String
        let rendererConfig: RendererConfig
        let chunkDir: String
        let metadataPath: String
        let chunkMetadata: ChunkMetadata
        let artifacts: Artifacts
        let steps: [PipelineStep]
        let ocr: OcrResult?

        struct RendererConfig: Decodable, Equatable {
            let startingPosition: String
            let numPage: String
            let skipPageCount: String
        }

        struct ChunkMetadata: Decodable, Equatable {
            let asin: String
            let updatedAt: String
            let ranges: [Range]

            struct Range: Decodable, Equatable {
                let id: String
                let start: RangeBound
                let end: RangeBound
                let pages: RangePages?
                let artifacts: RangeArtifacts
                let createdAt: String
                let updatedAt: String?
            }

            struct RangeBound: Decodable, Equatable {
                let raw: String
                let offset: Int
                let normalized: String?
            }

            struct RangePages: Decodable, Equatable {
                let count: Int
                let indexStart: Int?
                let indexEnd: Int?
            }

            struct RangeArtifacts: Decodable, Equatable {
                let extractDir: String?
                let pngDir: String?
                let combinedTextPath: String?
                let pagesDir: String?
                let audioPath: String?
                let contentTarPath: String?
                let ocrSummaryPath: String?
            }
        }

        struct Artifacts: Decodable, Equatable {
            let extractDir: String
            let pagesDir: String
            let combinedTextPath: String?
            let contentTarPath: String?
            let ocrSummaryPath: String?
        }

        struct OcrResult: Decodable, Equatable {
            let pages: [Page]
            let totalPages: Int
            let processedPages: Int
            let combinedTextPath: String?
            let ocrEnabled: Bool

            struct Page: Decodable, Equatable {
                let index: Int
                let png: String
            }
        }
    }

    enum PipelineStep: String, Codable, Equatable {
        case download
        case ocr
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
