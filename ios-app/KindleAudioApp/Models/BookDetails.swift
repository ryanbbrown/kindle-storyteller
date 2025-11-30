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
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        let currentFormatted = formatter.string(from: NSNumber(value: currentPosition)) ?? "\(currentPosition)"
        let lengthFormatted = formatter.string(from: NSNumber(value: length)) ?? "\(length)"
        return "\(currentFormatted) / \(lengthFormatted)"
    }
}
