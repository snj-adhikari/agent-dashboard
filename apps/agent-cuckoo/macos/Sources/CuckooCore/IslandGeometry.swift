import CoreGraphics

public struct ScreenMetrics: Equatable {
    public var frame: CGRect
    public var safeAreaTop: CGFloat
    public var auxiliaryLeftWidth: CGFloat?
    public var auxiliaryRightWidth: CGFloat?
    public var menuBarHeight: CGFloat

    public init(frame: CGRect, safeAreaTop: CGFloat = 0, auxiliaryLeftWidth: CGFloat? = nil,
                auxiliaryRightWidth: CGFloat? = nil, menuBarHeight: CGFloat = 24) {
        self.frame = frame; self.safeAreaTop = safeAreaTop
        self.auxiliaryLeftWidth = auxiliaryLeftWidth; self.auxiliaryRightWidth = auxiliaryRightWidth
        self.menuBarHeight = menuBarHeight
    }
}

public enum IslandMode: String, CaseIterable {
    case hidden, compact, home
}

public struct IslandGeometry: Equatable {
    public static let fallbackSize = CGSize(width: 80, height: 24)
    public static let compactWing: CGFloat = 120
    public static let homeSize = CGSize(width: 560, height: 380)

    public let hasNotch: Bool
    public let notchSize: CGSize

    public init(_ m: ScreenMetrics) {
        if m.safeAreaTop > 0, let l = m.auxiliaryLeftWidth, let r = m.auxiliaryRightWidth,
           m.frame.width - l - r > 0 {
            hasNotch = true
            notchSize = CGSize(width: m.frame.width - l - r, height: m.safeAreaTop)
        } else {
            hasNotch = false
            notchSize = IslandGeometry.fallbackSize
        }
    }

    public func size(for mode: IslandMode) -> CGSize {
        switch mode {
        case .hidden: return notchSize
        case .compact: return CGSize(width: notchSize.width + 2 * Self.compactWing, height: notchSize.height)
        case .home: return CGSize(width: max(Self.homeSize.width, notchSize.width),
                                  height: Self.homeSize.height + notchSize.height)
        }
    }

    public func frame(for mode: IslandMode, on screen: CGRect) -> CGRect {
        let s = size(for: mode)
        return CGRect(x: (screen.midX - s.width / 2).rounded(), y: screen.maxY - s.height,
                      width: s.width, height: s.height)
    }
}

public enum DisplayResolver {
    /** Index of the screen to use: the preferred one if still connected, else the first with a notch, else 0. */
    public static func index(preferredID: Int?, screenIDs: [Int], notched: [Bool]) -> Int {
        if let p = preferredID, let i = screenIDs.firstIndex(of: p) { return i }
        return notched.firstIndex(of: true) ?? 0
    }
}
