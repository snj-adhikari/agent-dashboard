import CoreGraphics

/** Which cards are expanded, in memory by card id; ids whose card has gone are dropped. */
public struct CardExpansion: Equatable {
    public static let collapsedLines = 3
    public private(set) var expanded: Set<String> = []

    public init() {}

    public func isExpanded(_ id: String) -> Bool { expanded.contains(id) }

    public mutating func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    public mutating func prune(keeping live: Set<String>) { expanded.formIntersection(live) }

    /** Wrapped line estimate from length and hard breaks. ponytail: char-width heuristic, measure the laid-out text if chevrons misfire. */
    public static func lineCount(_ text: String, charsPerLine: Int) -> Int {
        let per = max(1, charsPerLine)
        return text.split(separator: "\n", omittingEmptySubsequences: false)
            .reduce(0) { $0 + max(1, ($1.count + per - 1) / per) }
    }

    /** A chevron only shows when the collapsed text would hide something. */
    public static func needsChevron(_ text: String, charsPerLine: Int, limit: Int = collapsedLines) -> Bool {
        lineCount(text, charsPerLine: charsPerLine) > limit
    }

    /** Left-to-right rows that wrap at `width`; an item wider than a row is narrowed to it. */
    public static func flow(_ sizes: [CGSize], width: CGFloat, spacing: CGFloat) -> [CGRect] {
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
        return sizes.map { s in
            let w = min(s.width, width)
            if x > 0 && x + w > width { x = 0; y += row + spacing; row = 0 }
            defer { x += w + spacing; row = max(row, s.height) }
            return CGRect(x: x, y: y, width: w, height: s.height)
        }
    }
}
