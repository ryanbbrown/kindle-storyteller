import SwiftUI
import WebKit

struct LoginWebView: UIViewRepresentable {
    @Binding var reloadTrigger: Int
    let initialURL: URL
    let onCookiesCaptured: ([HTTPCookie]) -> Void
    let onRenderingTokenCaptured: (String, String?) -> Void
    let onDeviceTokenCaptured: (String) -> Void
    let onStartingPositionCaptured: (String) -> Void
    let onGUIDCaptured: (String) -> Void
    let onASINCaptured: (String) -> Void
    let onDismissRequested: () -> Void

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: Coordinator.messageHandlerName)

        if let scriptSource = context.coordinator.loadUserScript(named: "webhooks") {
            let script = WKUserScript(source: scriptSource, injectionTime: .atDocumentStart, forMainFrameOnly: false)
            contentController.addUserScript(script)
        } else {
            assertionFailure("Failed to load webhooks.js from bundle")
        }

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        context.coordinator.register(webView: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if context.coordinator.handleReload(trigger: reloadTrigger, webView: webView) {
            return
        }

        if webView.url == nil {
            let request = URLRequest(url: initialURL)
            webView.load(request)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    private func captureCookies(visitedURL: URL?) {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            let amazonCookies = cookies.filter { cookie in
                cookie.domain.contains("amazon")
            }

            onCookiesCaptured(amazonCookies)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        private let parent: LoginWebView
        private weak var webView: WKWebView?
        private var lastReloadTrigger: Int = 0
        private var scriptCache: [String: String] = [:]
        private lazy var logFileURL: URL = {
            let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
            let folder = base.appendingPathComponent("Logs", isDirectory: true)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            return folder.appendingPathComponent("webview-network.log")
        }()

        init(parent: LoginWebView) {
            self.parent = parent
        }

        func register(webView: WKWebView) {
            self.webView = webView
        }

        func loadUserScript(named name: String) -> String? {
            if let cached = scriptCache[name] {
                return cached
            }

            guard
                let url = Bundle.main.url(forResource: name, withExtension: "js"),
                let data = try? Data(contentsOf: url),
                let source = String(data: data, encoding: .utf8)
            else {
                return nil
            }

            scriptCache[name] = source
            return source
        }

        func handleReload(trigger: Int, webView: WKWebView) -> Bool {
            defer { lastReloadTrigger = trigger }
            guard trigger != lastReloadTrigger else { return false }

            if let currentURL = webView.url, !currentURL.absoluteString.isEmpty {
                webView.reload()
            } else {
                let request = URLRequest(url: parent.initialURL)
                webView.load(request)
            }
            return true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.captureCookies(visitedURL: webView.url)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == Self.messageHandlerName else { return }
            guard let payload = message.body as? [String: Any] else { return }
            guard let type = payload["type"] as? String else { return }

            switch type {
            case "renderingToken":
                if let token = payload["value"] as? String, !token.isEmpty {
                    let sourceURL = payload["url"] as? String
                    parent.onRenderingTokenCaptured(token, sourceURL)
                }
            case "deviceToken":
                if let token = payload["value"] as? String, !token.isEmpty {
                    parent.onDeviceTokenCaptured(token)
                }
            case "startingPosition":
                if let position = payload["value"] as? String, !position.isEmpty {
                    parent.onStartingPositionCaptured(position)
                }
            case "guid":
                if let guid = payload["value"] as? String, !guid.isEmpty {
                    parent.onGUIDCaptured(guid)
                }
            case "asin":
                if let asin = payload["value"] as? String, !asin.isEmpty {
                    parent.onASINCaptured(asin)
                }
            case "debugRendererURL":
#if DEBUG
                if let url = payload["value"] as? String {
                    print("[KindleBridge] renderer URL: \(url)")
                }
                #endif
            case "debugRequest":
                if let line = payload["value"] as? String {
                    appendToLog(line)
                }
            default:
                break
            }
        }

        deinit {
            webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.messageHandlerName)
        }

        fileprivate static let messageHandlerName = "kindleBridge"

        private func appendToLog(_ entry: String) {
            let line = "[\(Date())] \(entry)\n"
            if !FileManager.default.fileExists(atPath: logFileURL.path) {
                FileManager.default.createFile(atPath: logFileURL.path, contents: nil)
            }

            do {
                let handle = try FileHandle(forWritingTo: logFileURL)
                defer { try? handle.close() }
                try handle.seekToEnd()
                if let data = line.data(using: .utf8) {
                    handle.write(data)
                }
            } catch {
                #if DEBUG
                print("[KindleBridge] Failed to write log entry: \(error)")
                #endif
            }
        }
    }
}
