import Foundation

enum ValidationError: LocalizedError {
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
            return "The app's base URL is invalid. Update the code with a reachable API host and try again."
        case .missing(let field):
            return """
            \(field.capitalized) is missing or expired.

            Please open the Login screen, sign into Amazon again, and tap your book so we can refresh the session.
            """
        }
    }
}

struct AppAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}
