import Combine
import Foundation

@MainActor
final class PlaybackCoordinator: ObservableObject {
    let audioController = AudioPlaybackController()
    @Published private(set) var progressErrorMessage: String?
    @Published private(set) var isSyncDisabled = false
    @Published private(set) var currentTitle: String?
    @Published private(set) var currentCoverImageURL: String?

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
        coverImageURL: String? = nil,
        timeline: BenchmarkTimeline,
        initialSeekTime: TimeInterval = 0
    ) {
        scheduler?.stop()
        scheduler = nil
        isSyncDisabled = true
        currentTitle = title
        currentCoverImageURL = coverImageURL
        audioController.load(url: audioURL, title: title, coverImageURL: coverImageURL)
        if initialSeekTime > 0 {
            audioController.seekTo(initialSeekTime)
        }
    }

    func configure(
        audioURL: URL,
        title: String,
        coverImageURL: String? = nil,
        timeline: BenchmarkTimeline,
        client: APIClient,
        sessionId: String,
        asin: String,
        initialSeekTime: TimeInterval = 0
    ) {
        scheduler?.stop()
        isSyncDisabled = false
        currentTitle = title
        currentCoverImageURL = coverImageURL

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

        audioController.onSeek = { [weak self] in
            self?.scheduler?.syncToCurrentTime()
        }

        audioController.load(url: audioURL, title: title, coverImageURL: coverImageURL)
        if initialSeekTime > 0 {
            audioController.seekTo(initialSeekTime)
        }
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
