import Foundation
import QuartzCore
import UIKit

struct BenchmarkTimeline {
    let duration: TimeInterval
    let checkpoints: [Checkpoint]

    struct Checkpoint {
        let time: TimeInterval
        let kindlePositionIdStart: Int
    }
}

extension BenchmarkTimeline {
    init(response: APIClient.BenchmarkResponse) {
        self.duration = response.totalDurationSeconds
        self.checkpoints = response.benchmarks.map { entry in
            BenchmarkTimeline.Checkpoint(time: entry.timeSeconds, kindlePositionIdStart: entry.kindlePositionIdStart)
        }
    }
}

@MainActor
final class ProgressUpdateScheduler: NSObject {
    typealias TimeProvider = () -> TimeInterval

    private struct PendingCheckpoint {
        let index: Int
        let checkpoint: BenchmarkTimeline.Checkpoint
    }

    private enum SchedulerError: LocalizedError {
        case upstream(Int)

        var errorDescription: String? {
            switch self {
            case .upstream(let status):
                return "Progress update failed (HTTP \(status))."
            }
        }
    }

    private let checkpoints: [BenchmarkTimeline.Checkpoint]
    private let client: APIClient
    private let sessionId: String
    private let asin: String
    private let currentTimeProvider: TimeProvider

    private var displayLink: CADisplayLink?
    private var nextCheckpointIndex = 0
    private var isSendingUpdate = false
    private var pendingCheckpoint: PendingCheckpoint?
    private var retryAvailableAt: Date?

    var onStatusChange: ((String?) -> Void)?

    init(
        checkpoints: [BenchmarkTimeline.Checkpoint],
        client: APIClient,
        sessionId: String,
        asin: String,
        currentTimeProvider: @escaping TimeProvider
    ) {
        self.checkpoints = checkpoints
        self.client = client
        self.sessionId = sessionId
        self.asin = asin
        self.currentTimeProvider = currentTimeProvider
        super.init()
    }

    func start() {
        guard displayLink == nil else { return }
        guard !checkpoints.isEmpty else { return }

        let link = CADisplayLink(target: self, selector: #selector(handleDisplayLink(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    func stop() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func handleDisplayLink(_ link: CADisplayLink) {
        guard !isSendingUpdate else { return }

        guard var context = pendingCheckpoint ?? makeCheckpointContext() else {
            stop()
            return
        }

        if pendingCheckpoint == nil {
            let currentTime = currentTimeProvider()
            guard currentTime >= context.checkpoint.time else { return }
        } else if let retryAvailableAt, Date() < retryAvailableAt {
            return
        }

        isSendingUpdate = true
        Task { [weak self] in
            await self?.sendUpdate(for: context)
        }
    }

    private func makeCheckpointContext() -> PendingCheckpoint? {
        guard nextCheckpointIndex < checkpoints.count else { return nil }
        let checkpoint = checkpoints[nextCheckpointIndex]
        return PendingCheckpoint(index: nextCheckpointIndex, checkpoint: checkpoint)
    }

    private func markCheckpointComplete(at index: Int) {
        if index >= nextCheckpointIndex {
            nextCheckpointIndex = index + 1
        }
        pendingCheckpoint = nil
        retryAvailableAt = nil
        if nextCheckpointIndex >= checkpoints.count {
            stop()
        }
    }

    private func scheduleRetry(for context: PendingCheckpoint) {
        pendingCheckpoint = context
        retryAvailableAt = Date().addingTimeInterval(1)
    }

    private func sendUpdate(for context: PendingCheckpoint) async {
        defer { isSendingUpdate = false }
        do {
            let response = try await client.updateProgress(
                sessionId: sessionId,
                asin: asin,
                position: context.checkpoint.kindlePositionIdStart
            )

            guard response.success else {
                throw SchedulerError.upstream(response.upstreamStatus)
            }

            onStatusChange?(nil)
            markCheckpointComplete(at: context.index)
        } catch {
            onStatusChange?(errorMessage(for: error))
            scheduleRetry(for: context)
        }
    }

    private func errorMessage(for error: Error) -> String {
        if let schedulerError = error as? SchedulerError {
            return schedulerError.localizedDescription ?? "Progress update failed."
        }
        if let apiError = error as? APIClient.APIError {
            return apiError.localizedDescription ?? "Progress update failed."
        }
        return error.localizedDescription
    }
}
