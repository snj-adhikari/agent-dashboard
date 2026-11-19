import Foundation

/** What the mascot and emoji show for an agent; derived on the client from state, `lastActiveAt` and offline. */
public enum Reaction: String, CaseIterable {
    case working, thinking, waiting, done, error, sleeping, celebrating

    public static let thinkingAfter: TimeInterval = 10
    public static let sleepAfter: TimeInterval = 120
    public static let celebrateFor: TimeInterval = 5.2

    /** `now` in seconds since epoch; `lastActiveAt` on the wire is ms. `failed` = the board's failed-turn flag. */
    public static func of(_ agent: Agent, now: TimeInterval, offline: Bool = false, failed: Bool = false) -> Reaction {
        if offline { return .sleeping }
        if failed { return .error }
        let quiet = agent.lastActiveAt.map { now - Double($0) / 1000 }
        switch agent.state {
        case .waiting: return .waiting
        case .working: return (quiet ?? 0) >= thinkingAfter ? .thinking : .working
        case .done:
            guard let q = quiet else { return .done }
            if q < celebrateFor { return .celebrating }
            return q >= sleepAfter ? .sleeping : .done
        case .unknown: return .sleeping
        }
    }

    public var emoji: String { rawValue }

    public var pose: String {
        switch self {
        case .working: return "cuckoo-working"
        case .thinking: return "cuckoo-thinking"
        case .waiting: return "cuckoo-waiting"
        case .done: return "cuckoo-happy"
        case .error: return "cuckoo-alarmed"
        case .sleeping: return "cuckoo-sleepy"
        case .celebrating: return "cuckoo-celebrate"
        }
    }
}

/** Two-frame dance while music plays; frozen on the first frame under Reduce Motion. */
public enum Dance {
    public static let frames = ["cuckoo-dance-a", "cuckoo-dance-b"]
    public static let frameDuration: TimeInterval = 0.4

    /** nil when nothing plays (use the reaction pose). `elapsed` = seconds since playback started. */
    public static func pose(playing: Bool, reduceMotion: Bool, elapsed: TimeInterval) -> String? {
        guard playing else { return nil }
        if reduceMotion { return frames[0] }
        return frames[Int(max(0, elapsed) / frameDuration) % frames.count]
    }
}

/** Blink scheduling; `random` is a uniform 0..<1 draw so callers and checks control it. */
public enum Blink {
    public static let first: ClosedRange<TimeInterval> = 1.5...3.5
    public static let normal: ClosedRange<TimeInterval> = 2.2...5.4
    public static let listening: ClosedRange<TimeInterval> = 3.0...4.5
    public static let doubleChance = 0.22

    public static func next(first isFirst: Bool = false, listening on: Bool, random: Double) -> TimeInterval {
        let r = isFirst ? first : on ? listening : normal
        return r.lowerBound + (r.upperBound - r.lowerBound) * min(max(random, 0), 1)
    }

    public static func isDouble(random: Double) -> Bool { random < doubleChance }
}
