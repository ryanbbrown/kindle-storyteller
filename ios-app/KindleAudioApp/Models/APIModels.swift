import Foundation

// MARK: - Session

struct SessionRequest: Encodable {
    let cookieString: String
    let deviceToken: String
    let renderingToken: String
    let rendererRevision: String
    let guid: String
    let tlsServerUrl: String?
    let tlsApiKey: String?
}

struct SessionResponse: Decodable {
    let sessionId: String
}

// MARK: - Books

struct BooksResponse: Decodable {
    let books: [Book]
}

struct Book: Decodable, Identifiable, Equatable {
    let asin: String
    let title: String

    var id: String { asin }
}

struct BookDetailsResponse: Decodable, Equatable {
    let title: String
    let coverImage: String
    let currentPosition: Int
    let length: Int
}

// MARK: - Text

struct TextResponse: Decodable, Equatable {
    let text: String
    let bytesRead: Int
    let hasMore: Bool
}

// MARK: - Pipeline

struct PipelineRequest: Encodable {
    let startingPosition: String
    let audioProvider: String
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

    var displayName: String {
        rawValue.capitalized
    }
}

// MARK: - Benchmarks

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

// MARK: - Progress

struct UpdateProgressRequest: Encodable {
    let position: Int
}

struct UpdateProgressResponse: Decodable, Equatable {
    let success: Bool
    let upstreamStatus: Int
}

// MARK: - Utility

struct EmptyResponse: Decodable {
    init() {}
}

// MARK: - Errors

struct APIError: LocalizedError {
    let statusCode: Int
    let message: String

    var errorDescription: String? {
        "HTTP \(statusCode): \(message)"
    }
}
