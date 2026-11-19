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

/** Expanded views and their island heights, notch included; long views stay within the panel and scroll inside the card. */
public enum IslandView: Equatable {
    case overview, empty, approval, error, finished, confused, settings, launch, sessions, mainAgents
    case recap, upload, uploading, choose, mail, whatsNew, greeting, listening, timer, wardrobe, side
    case question(picker: Bool)
    case chat(messages: Int)
    /** Header row only. */
    case collapsed
    /** `base` grown to fit `content` (the card's natural height) up to `IslandGeometry.maxHeight`. */
    indirect case fit(IslandView, content: CGFloat)

    public var height: CGFloat {
        switch self {
        case .upload, .uploading, .choose: return 176
        case .mail: return 240
        case .whatsNew: return 232
        case .greeting: return 150
        case .question(let picker): return picker ? 200 : 160
        case .chat(let n): return min(300, 240 + 40 * CGFloat(max(0, n)))
        case .recap: return 240
        case .launch: return 224
        case .timer: return 220
        case .sessions: return 260
        case .mainAgents: return 280
        case .settings, .wardrobe: return 300
        case .fit(let base, _): return base.height
        case .collapsed: return 0
        default: return 160
        }
    }

    /** Fixed content that must fit the card under the tallest notch (38 pt); 0 = scrolls or fits any card. */
    public var minCardHeight: CGFloat {
        switch self {
        case .overview, .empty: return 76
        case .recap: return 150
        case .launch: return 134
        case .fit(let base, _): return base.minCardHeight
        default: return 0
        }
    }
}

public struct IslandGeometry: Equatable {
    /** Tallest island; content past it scrolls inside the card. */
    public static let maxHeight: CGFloat = 520
    public static let panelSize = CGSize(width: 720, height: maxHeight)
    public static let fallbackSize = CGSize(width: 80, height: 24)
    public static let noNotchCompactWidth: CGFloat = 240
    public static let compactExtra: CGFloat = 160
    public static let expandedWidth: CGFloat = 640
    public static let restingRadius: CGFloat = 14
    public static let expandedRadius: CGFloat = 22
    /** Shell chrome around the card: 8 pt top inset, 34 pt header, 10 pt bottom. */
    public static let shellTop: CGFloat = 8
    public static let headerHeight: CGFloat = 34
    public static let shellBottom: CGFloat = 10

    public let hasNotch: Bool
    public let notchSize: CGSize

    public init(_ m: ScreenMetrics) {
        if m.safeAreaTop > 0, let l = m.auxiliaryLeftWidth, let r = m.auxiliaryRightWidth,
           m.frame.width - l - r > 0 {
            hasNotch = true
            notchSize = CGSize(width: m.frame.width - l - r, height: m.safeAreaTop)
        } else {
            hasNotch = false
            notchSize = CGSize(width: Self.fallbackSize.width, height: min(Self.fallbackSize.height, m.menuBarHeight))
        }
    }

    public func size(for mode: IslandMode, view: IslandView = .overview) -> CGSize {
        switch mode {
        case .hidden: return notchSize
        case .compact:
            return CGSize(width: hasNotch ? notchSize.width + Self.compactExtra : Self.noNotchCompactWidth,
                          height: notchSize.height)
        case .home: return CGSize(width: Self.expandedWidth, height: height(for: view))
        }
    }

    /** Home grows by the notch beyond 32 pt so its fixed card never clips; other views keep their coucou height. */
    public func height(for view: IslandView) -> CGFloat {
        switch view {
        case .overview, .empty: return view.height + max(0, notchSize.height - 32)
        case .collapsed: return chrome
        case let .fit(base, content): return min(Self.maxHeight, max(height(for: base), chrome + content.rounded(.up)))
        default: return view.height
        }
    }

    /** Island height around the card: notch, header and insets. */
    public var chrome: CGFloat { headerY + Self.headerHeight + Self.shellBottom }

    /** Header top in island coordinates: the same for every view. */
    public var headerY: CGFloat { notchSize.height + Self.shellTop }

    /** Card height for an expanded view; content taller than this scrolls inside the card. */
    public func cardHeight(for view: IslandView) -> CGFloat {
        max(0, height(for: view) - chrome)
    }

    public func cornerRadius(for mode: IslandMode) -> CGFloat {
        mode == .home ? Self.expandedRadius : Self.restingRadius
    }

    /** Fixed panel, top-centre of the screen; the island shape animates inside it. */
    public func panelFrame(on screen: CGRect) -> CGRect {
        CGRect(x: (screen.midX - Self.panelSize.width / 2).rounded(), y: screen.maxY - Self.panelSize.height,
               width: Self.panelSize.width, height: Self.panelSize.height)
    }

    /** Island rect in panel coordinates (origin bottom-left), centred on the top edge. */
    public func islandRect(for mode: IslandMode, view: IslandView = .overview) -> CGRect {
        let s = size(for: mode, view: view)
        return CGRect(x: ((Self.panelSize.width - s.width) / 2).rounded(), y: Self.panelSize.height - s.height,
                      width: s.width, height: s.height)
    }

    public func frame(for mode: IslandMode, view: IslandView = .overview, on screen: CGRect) -> CGRect {
        let s = size(for: mode, view: view)
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
