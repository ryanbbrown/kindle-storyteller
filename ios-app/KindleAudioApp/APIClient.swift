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

    func fetchBookContent(sessionId: String, asin: String, renderOptions: RenderRequest) async throws -> BookContent {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        let body = try JSONEncoder().encode(renderOptions)
        return try await send(
            path: "books/\(encodedASIN)/content",
            method: "POST",
            headers: ["Authorization": "Bearer \(sessionId)", "Content-Type": "application/json"],
            body: body
        )
    }

    func runOcr(sessionId: String, asin: String, request: OcrRequest?) async throws -> OcrResponse {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        let body: Data?
        if let request {
            body = try JSONEncoder().encode(request)
        } else {
            body = nil
        }
        return try await send(
            path: "books/\(encodedASIN)/ocr",
            method: "POST",
            headers: ["Authorization": "Bearer \(sessionId)", "Content-Type": "application/json"],
            body: body
        )
    }

    func fetchText(sessionId: String, asin: String, start: Int, length: Int) async throws -> TextResponse {
        let encodedASIN = asin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? asin
        let path = "books/\(encodedASIN)/text?start=\(start)&length=\(length)"
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

    struct BookContent: Decodable, Equatable {
        let textLength: Int
        let textPreview: String
        let cached: Bool
    }

    struct OcrResponse: Decodable, Equatable {
        let asin: String
        let pages: [Page]
        let totalPages: Int
        let processedPages: Int
        let combinedTextPath: String?
        let ocrEnabled: Bool
        let cached: Bool

        struct Page: Decodable, Equatable {
            let index: Int
            let png: String
            let textPath: String?
        }
    }

    struct TextResponse: Decodable, Equatable {
        let text: String
        let bytesRead: Int
        let hasMore: Bool
    }

    struct RenderRequest: Encodable {
        let renderOptions: RenderOptions

        struct RenderOptions: Encodable {
            let startingPosition: String
            let numPage: Int
            let skipPageCount: Int
        }
    }

    struct OcrRequest: Encodable {
        let maxPages: Int?
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
