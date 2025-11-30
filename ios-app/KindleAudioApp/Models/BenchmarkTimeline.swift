import Foundation

struct BenchmarkTimeline {
    let duration: TimeInterval
    let checkpoints: [Checkpoint]

    struct Checkpoint {
        let time: TimeInterval
        let kindlePositionIdStart: Int
    }
}

extension BenchmarkTimeline {
    init(response: BenchmarkResponse) {
        self.duration = response.totalDurationSeconds
        self.checkpoints = response.benchmarks.map { entry in
            BenchmarkTimeline.Checkpoint(time: entry.timeSeconds, kindlePositionIdStart: entry.kindlePositionIdStart)
        }
    }

    /** Finds the seek time for a given position ID, biasing towards earlier timestamps to avoid skipping content. */
    func seekTime(forPositionId targetPositionId: Int) -> TimeInterval {
        // Find the last checkpoint at or before the target position
        var bestCheckpoint: Checkpoint?
        for checkpoint in checkpoints {
            if checkpoint.kindlePositionIdStart <= targetPositionId {
                bestCheckpoint = checkpoint
            } else {
                break
            }
        }
        return bestCheckpoint?.time ?? 0
    }
}
