import CoreGraphics
import Foundation

/** Desktop mascot rules; the panel ticks it with `now` (seconds). Poses for the view layer are the static names. */
public struct DesktopMascotLogic {
    public static let size: CGFloat = 120
    public static let pokeWindow: TimeInterval = 1.7
    public static let pokesToDizzy = 3
    public static let dizzyFor: TimeInterval = 3.3
    public static let surprisedFor: TimeInterval = 0.45
    public static let flyFor: TimeInterval = 0.45
    public static let returnDelay: TimeInterval = 0.6
    public static let landSpring: TimeInterval = 0.25
    public static let activeFPS: Double = 30
    public static let asleepFPS: Double = 10
    public static let sleepAfter: TimeInterval = 120
    public static let wakeDistance: CGFloat = 150
    public static let dizzyPose = "cuckoo-dizzy"
    public static let surprisedPose = "cuckoo-surprised"

    public enum Poke: Equatable { case annoyed, dizzy, ignored }
    public enum Move: Equatable { case stay, toIsland, toDesktop }

    public private(set) var atIsland = false
    public private(set) var dizzyUntil: TimeInterval?
    public var lastActivity: TimeInterval
    private var pokes: [TimeInterval] = []
    private var clearedAt: TimeInterval?

    public init(now: TimeInterval) { lastActivity = now }

    public func isDizzy(now: TimeInterval) -> Bool { dizzyUntil.map { now < $0 } ?? false }

    /** Single click. Ignored while dizzy; the third poke within `pokeWindow` makes it dizzy for `dizzyFor`. */
    public mutating func poke(now: TimeInterval) -> Poke {
        if isDizzy(now: now) { return .ignored }
        pokes = pokes.filter { now - $0 < Self.pokeWindow } + [now]
        guard pokes.count >= Self.pokesToDizzy else { return .annoyed }
        pokes = []
        dizzyUntil = now + Self.dizzyFor
        return .dizzy
    }

    /** `alertPending` = an approval or question waits. Flies up at once, back `returnDelay` after both clear. */
    public mutating func update(alertPending: Bool, now: TimeInterval) -> Move {
        if alertPending {
            clearedAt = nil
            lastActivity = now
            if atIsland { return .stay }
            atIsland = true
            return .toIsland
        }
        guard atIsland else { return .stay }
        let since = clearedAt ?? now
        clearedAt = since
        guard now - since >= Self.returnDelay else { return .stay }
        atIsland = false
        clearedAt = nil
        return .toDesktop
    }

    public func asleep(now: TimeInterval, pointerDistance: CGFloat) -> Bool {
        now - lastActivity >= Self.sleepAfter && pointerDistance > Self.wakeDistance
    }

    public func fps(now: TimeInterval, pointerDistance: CGFloat) -> Double {
        asleep(now: now, pointerDistance: pointerDistance) ? Self.asleepFPS : Self.activeFPS
    }

    /** Saved origin clamped into the visible frame (display removed or resized); nil saved means bottom-right. */
    public static func restore(_ saved: CGPoint?, visible: CGRect) -> CGPoint {
        let p = saved ?? CGPoint(x: visible.maxX - size, y: visible.minY)
        return CGPoint(x: min(max(p.x, visible.minX), visible.maxX - size),
                       y: min(max(p.y, visible.minY), visible.maxY - size))
    }
}
