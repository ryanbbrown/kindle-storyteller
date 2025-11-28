import Foundation

enum ValidationResult {
    case valid
    case missing(field: String, guidance: String)
}

enum ErrorClassification {
    case sessionExpired(reason: String)
    case networkError(message: String)
    case other(message: String)
}

@MainActor
final class SessionService {
    private var sessionId: String?
    private let sessionStore: SessionStore

    init(sessionStore: SessionStore) {
        self.sessionStore = sessionStore
    }

    var cookieString: String {
        sessionStore.cookies
            .map { "\($0.name)=\($0.value)" }
            .joined(separator: "; ")
    }

    /** Ensures a valid session exists, creating one if needed. */
    func ensureSession(client: APIClient) async throws -> String {
        if let sessionId, !sessionId.isEmpty {
            return sessionId
        }

        let request = try buildSessionRequest()
        let response = try await client.createSession(request: request)
        sessionId = response.sessionId
        return response.sessionId
    }

    /** Builds a session request from current store values. */
    func buildSessionRequest() throws -> SessionRequest {
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

        return SessionRequest(
            cookieString: cookieString,
            deviceToken: deviceToken,
            renderingToken: renderingToken,
            rendererRevision: rendererRevision,
            guid: guid,
            tlsServerUrl: nil,
            tlsApiKey: nil
        )
    }

    /** Validates all required session inputs are present. */
    func validateInputs() -> ValidationResult {
        if cookieString.isEmpty {
            return .missing(field: "session cookies", guidance: loginRefreshMessage(reason: "Session cookies are missing or expired."))
        }
        guard sessionStore.deviceToken?.trimmedNonEmpty() != nil else {
            return .missing(field: "device token", guidance: loginRefreshMessage(reason: "Device token is missing."))
        }
        guard sessionStore.renderingToken?.trimmedNonEmpty() != nil else {
            return .missing(field: "rendering token", guidance: loginRefreshMessage(reason: "Rendering token is missing."))
        }
        guard sessionStore.rendererRevision?.trimmedNonEmpty() != nil else {
            return .missing(field: "renderer revision", guidance: loginRefreshMessage(reason: "Renderer revision is missing."))
        }
        guard sessionStore.guid?.trimmedNonEmpty() != nil else {
            return .missing(field: "GUID", guidance: loginRefreshMessage(reason: "GUID is missing."))
        }
        return .valid
    }

    /** Validates book metadata (ASIN and starting position) is available. */
    func validateBookMetadata() -> (asin: String, startingPosition: String)? {
        guard let asin = sessionStore.asin?.trimmedNonEmpty() else {
            return nil
        }
        guard let startingPosition = sessionStore.startingPosition?.trimmedNonEmpty() else {
            return nil
        }
        return (asin: asin, startingPosition: startingPosition)
    }

    /** Classifies an error to determine appropriate user feedback. */
    func classifyError(_ error: Error) -> ErrorClassification {
        if let apiError = error as? APIError {
            if let reason = sessionExpiryReason(for: apiError) {
                return .sessionExpired(reason: reason)
            }
            return .other(message: normalizedApiMessage(from: apiError))
        }
        return .other(message: error.localizedDescription)
    }

    /** Invalidates the cached session. */
    func invalidateSession(reason: String? = nil) {
        sessionId = nil
    }

    /** Returns whether a session is currently cached. */
    var hasSession: Bool {
        sessionId != nil && !sessionId!.isEmpty
    }

    // MARK: - Private Helpers

    private func sessionExpiryReason(for apiError: APIError) -> String? {
        let normalized = normalizedApiMessage(from: apiError)
        let lower = normalized.lowercased()

        // API key errors are not session expiry - let them bubble up as-is
        if lower.contains("api key") {
            return nil
        }

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

    private func normalizedApiMessage(from apiError: APIError) -> String {
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

    private func loginRefreshMessage(reason: String) -> String {
        """
        \(reason)

        Please open the Login screen, sign into Amazon again, and tap the book you want so we can refresh the session.
        """
    }
}
