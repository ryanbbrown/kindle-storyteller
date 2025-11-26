import Foundation

extension String {
    /** Returns a truncated string with ellipsis if longer than maxLength. */
    func truncated(maxLength: Int) -> String {
        guard count > maxLength else { return self }
        let endIndex = index(startIndex, offsetBy: maxLength)
        return String(self[..<endIndex]) + "..."
    }

    /** Returns nil if empty after trimming whitespace, otherwise the trimmed string. */
    func trimmedNonEmpty() -> String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
