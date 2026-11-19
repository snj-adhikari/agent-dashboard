import Foundation

/** Cuckoo clock (focus timer). Codable with an absolute end time so it survives a restart; `now` is injected. */
public struct CuckooTimer: Codable, Equatable {
    public enum Phase: String, Codable { case focus, shortBreak, longBreak }

    public static let focusLength: TimeInterval = 25 * 60
    public static let shortBreakLength: TimeInterval = 5 * 60
    public static let longBreakLength: TimeInterval = 15 * 60
    public static let longBreakEvery = 4
    public static let pose = "cuckoo-clock"

    public private(set) var phase: Phase = .focus
    public private(set) var endsAt: TimeInterval?
    public private(set) var pausedRemaining: TimeInterval?
    public private(set) var focusDone = 0

    public init() {}

    public static func length(_ p: Phase) -> TimeInterval {
        switch p {
        case .focus: return focusLength
        case .shortBreak: return shortBreakLength
        case .longBreak: return longBreakLength
        }
    }

    public var running: Bool { endsAt != nil }

    public func remaining(now: TimeInterval) -> TimeInterval {
        if let e = endsAt { return max(0, e - now) }
        return pausedRemaining ?? Self.length(phase)
    }

    public mutating func start(now: TimeInterval) {
        guard endsAt == nil else { return }
        endsAt = now + remaining(now: now)
        pausedRemaining = nil
    }

    public mutating func pause(now: TimeInterval) {
        guard let e = endsAt else { return }
        pausedRemaining = max(0, e - now)
        endsAt = nil
    }

    public mutating func reset() { self = CuckooTimer() }

    /** Call on each tick and at launch. Returns the phase that just ended (play the finish sound, reveal); the next phase waits stopped. */
    public mutating func advance(now: TimeInterval) -> Phase? {
        guard let e = endsAt, now >= e else { return nil }
        let ended = phase
        endsAt = nil
        pausedRemaining = nil
        if ended == .focus {
            focusDone += 1
            phase = focusDone % Self.longBreakEvery == 0 ? .longBreak : .shortBreak
        } else {
            phase = .focus
        }
        return ended
    }
}
