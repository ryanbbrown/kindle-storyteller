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
}
