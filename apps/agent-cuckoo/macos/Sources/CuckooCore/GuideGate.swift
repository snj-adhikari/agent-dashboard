/** First-open guide: shown until dismissed once (`guideSeen`), re-opened from Settings at page one. */
public struct GuideGate: Equatable {
    public static let seenKey = "guideSeen"
    public static let pages = ["tabs", "prompt", "control", "keys"]

    public private(set) var seen: Bool
    public private(set) var page = 0

    public init(seen: Bool) { self.seen = seen }

    public var showing: Bool { !seen }
    public var isFirst: Bool { page == 0 }
    public var isLast: Bool { page == Self.pages.count - 1 }
    public var key: String { Self.pages[page] }

    public mutating func next() { if isLast { dismiss() } else { page += 1 } }
    public mutating func back() { page = max(0, page - 1) }
    /** Skip and Done both persist as seen. */
    public mutating func dismiss() { seen = true; page = 0 }
    public mutating func reopen() { seen = false; page = 0 }
}
