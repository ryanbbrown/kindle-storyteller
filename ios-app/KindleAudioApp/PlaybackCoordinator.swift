import Combine
import Foundation

@MainActor
final class PlaybackCoordinator: ObservableObject {
    let audioController = AudioPlaybackController()
    @Published private(set) var progressErrorMessage: String?

    private var scheduler: ProgressUpdateScheduler?
    private var cancellables: Set<AnyCancellable> = []

    init() {
        audioController.objectWillChange
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)
    }

    func configure(
        audioURL: URL,
        title: String,
        timeline: BenchmarkTimeline,
        client: APIClient,
        sessionId: String,
        asin: String
    ) {
        scheduler?.stop()
        scheduler = ProgressUpdateScheduler(
            checkpoints: timeline.checkpoints,
            client: client,
            sessionId: sessionId,
            asin: asin,
            currentTimeProvider: { [weak audioController] in
                audioController?.currentTime ?? 0
            }
        )
        scheduler?.onStatusChange = { [weak self] message in
            self?.progressErrorMessage = message
        }

        audioController.load(url: audioURL, title: title)
    }

    func play() {
        audioController.play()
        scheduler?.start()
    }

    func pause() {
        audioController.pause()
        scheduler?.stop()
    }

    func stop() {
        audioController.reset()
        scheduler?.stop()
        scheduler = nil
        progressErrorMessage = nil
    }
}
