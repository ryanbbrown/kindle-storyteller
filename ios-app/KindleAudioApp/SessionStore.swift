import Foundation

final class SessionStore: ObservableObject {
    @Published private(set) var cookies: [HTTPCookie] = []
    @Published private(set) var renderingToken: String?
    @Published private(set) var renderingTokenSourceURL: String?
    @Published private(set) var deviceToken: String?
    @Published private(set) var startingPosition: String?
    @Published private(set) var guid: String?
    @Published private(set) var asin: String?

    func updateCookies(_ cookies: [HTTPCookie]) {
        DispatchQueue.main.async {
            let relevantNames: Set<String> = [
                "ubid-main",
                "at-main",
                "x-main",
                "session-id"
            ]

            self.cookies = cookies.filter { cookie in
                guard cookie.domain.contains("amazon") else { return false }
                return relevantNames.contains(cookie.name)
            }
        }
    }

    func updateRenderingToken(_ token: String, sourceURL: String? = nil) {
        DispatchQueue.main.async {
            self.renderingToken = token
            if let url = sourceURL, !url.isEmpty {
                self.renderingTokenSourceURL = url
            }
        }
    }

    func updateDeviceToken(_ token: String) {
        DispatchQueue.main.async {
            self.deviceToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    func updateStartingPosition(_ position: String) {
        DispatchQueue.main.async {
            self.startingPosition = position.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    func updateGUID(_ guid: String) {
        DispatchQueue.main.async {
            self.guid = guid.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    func updateASIN(_ asin: String) {
        DispatchQueue.main.async {
            self.asin = asin.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }
}
