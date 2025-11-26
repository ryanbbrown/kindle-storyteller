import Foundation

struct BookDetails {
    let title: String
    let coverImage: String
    let currentPosition: Int
    let length: Int

    var progressPercent: Double {
        guard length > 0 else { return 0 }
        return (Double(currentPosition) / Double(length)) * 100
    }

    var currentPositionLabel: String {
        return "\(currentPosition) / \(length)"
    }
}
