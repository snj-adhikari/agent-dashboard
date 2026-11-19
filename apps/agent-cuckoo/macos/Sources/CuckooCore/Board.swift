import Foundation

public struct PillGroup: Equatable {
    public var space: String
    public var agents: [Agent]
}

public struct Pill: Equatable, Identifiable {
    public var agent: Agent
    public var shown: AgentState
    public var id: String { agent.id }
}

public enum Board {
    public static let hold: TimeInterval = 6

    public static func rank(_ s: AgentState) -> Int {
        switch s {
        case .waiting: return 3
        case .working: return 2
        case .done: return 1
        case .unknown: return 0
        }
    }

    /** Mains first, then space, then name; spaces appear in the order of their first agent so spaces with mains lead. */
    public static func groups(_ agents: [Agent]) -> [PillGroup] {
        let sorted = agents.sorted {
            if $0.isMain != $1.isMain { return $0.isMain }
            if $0.space != $1.space { return $0.space < $1.space }
            return $0.name < $1.name
        }
        var out: [PillGroup] = []
        for a in sorted {
            if let i = out.firstIndex(where: { $0.space == a.space }) { out[i].agents.append(a) }
            else { out.append(PillGroup(space: a.space, agents: [a])) }
        }
        return out
    }

    /** Most urgent first: shown-state rank, then mains, then name. */
    public static func compact(_ pills: [Pill], limit: Int) -> [Pill] {
        Array(pills.sorted {
            let r0 = rank($0.shown), r1 = rank($1.shown)
            if r0 != r1 { return r0 > r1 }
            if $0.agent.isMain != $1.agent.isMain { return $0.agent.isMain }
            return $0.agent.name < $1.agent.name
        }.prefix(limit))
    }
}

/** Keeps a pill's shown state for at least `Board.hold` seconds before dropping to a lower-rank state, so pills don't flicker. */
public struct PillHold {
    private var shown: [String: (state: AgentState, since: TimeInterval)] = [:]

    public init() {}

    public mutating func apply(_ agents: [Agent], now: TimeInterval) -> [Pill] {
        var next: [String: (state: AgentState, since: TimeInterval)] = [:]
        let pills = agents.map { a -> Pill in
            var entry = shown[a.id] ?? (a.state, now)
            if a.state != entry.state,
               Board.rank(a.state) >= Board.rank(entry.state) || now - entry.since >= Board.hold {
                entry = (a.state, now)
            }
            next[a.id] = entry
            return Pill(agent: a, shown: entry.state)
        }
        shown = next
        return pills
    }
}

public struct BoardPill: Equatable, Identifiable {
    public var key: String
    public var shown: Agent
    public var sessions: [Agent]
    public var urgency: Int
    public var id: String { key }

    public init(key: String, shown: Agent, sessions: [Agent], urgency: Int) {
        self.key = key; self.shown = shown; self.sessions = sessions; self.urgency = urgency
    }
}

public enum Slot: Equatable {
    case pill(BoardPill)
    case waiting(count: Int, first: String)
}

/**
 * One pill per CLI in `catalogue` order; each pill shows its most urgent session (waiting, failed turn = working
 * to unknown, just finished, last active), held `hold` seconds before an equal or lower one takes over.
 * Other waiting sessions pop out into `<key>#2`...
 */
public struct SessionBoard {
    public static let hold: TimeInterval = 6
    public static let finishedFor: TimeInterval = 5.2
    public static let errorFor: TimeInterval = 30
    public static let popOutMin: TimeInterval = 3
    public static let quietAfter: TimeInterval = 1800
    public static let catalogue = ["claude", "copilot", "codex", "gemini", "cursor-agent", "opencode", "antigravity", "agentastic"]

    private var lastState: [String: AgentState] = [:]
    private var doneAt: [String: TimeInterval] = [:]
    private var failedAt: [String: TimeInterval] = [:]
    private var poppedAt: [String: TimeInterval] = [:]
    private var shownBy: [String: (id: String, since: TimeInterval)] = [:]

    public init() {}

    public func urgency(_ a: Agent, now: TimeInterval) -> Int {
        if a.state == .waiting { return 3 }
        if let t = failedAt[a.id], now - t < Self.errorFor { return 2 }
        if let t = doneAt[a.id], now - t < Self.finishedFor { return 1 }
        return 0
    }

    public mutating func update(_ agents: [Agent], now: TimeInterval) -> [BoardPill] {
        for a in agents {
            if let prev = lastState[a.id] {
                if a.state == .done, prev != .done { doneAt[a.id] = now }
                if a.state == .unknown, prev == .working { failedAt[a.id] = now }
            }
            lastState[a.id] = a.state
        }
        let live = Set(agents.map(\.id))
        lastState = lastState.filter { live.contains($0.key) }
        poppedAt = poppedAt.filter { live.contains($0.key) }
        failedAt = failedAt.filter { live.contains($0.key) }
        doneAt = doneAt.filter { live.contains($0.key) }

        var keys: [String] = []
        var byKey: [String: [Agent]] = [:]
        for a in agents {
            let k = a.cli ?? a.host
            if byKey[k] == nil { keys.append(k) }
            byKey[k, default: []].append(a)
        }
        keys.sort {
            let i0 = Self.catalogue.firstIndex(of: $0) ?? Self.catalogue.count
            let i1 = Self.catalogue.firstIndex(of: $1) ?? Self.catalogue.count
            return i0 != i1 ? i0 < i1 : $0 < $1
        }

        var out: [BoardPill] = []
        var nextShown: [String: (id: String, since: TimeInterval)] = [:]
        for k in keys {
            var group = byKey[k]!
            let awake = group.filter { urgency($0, now: now) > 0 || !isQuiet($0, now: now) }
            if !awake.isEmpty { group = awake }
            let best = group.max { score($0, now) < score($1, now) }!
            var shown = best
            if let cur = shownBy[k], cur.id != best.id, let held = group.first(where: { $0.id == cur.id }),
               urgency(best, now: now) <= urgency(held, now: now), now - cur.since < Self.hold {
                shown = held
            }
            nextShown[k] = shownBy[k]?.id == shown.id ? shownBy[k]! : (shown.id, now)

            var popped: [Agent] = []
            for a in group where a.id != shown.id {
                if a.state == .waiting {
                    if poppedAt[a.id] == nil { poppedAt[a.id] = now }
                    popped.append(a)
                } else if let t = poppedAt[a.id] {
                    if now - t < Self.popOutMin { popped.append(a) } else { poppedAt[a.id] = nil }
                }
            }
            let rest = group.filter { a in !popped.contains { $0.id == a.id } }
            out.append(BoardPill(key: k, shown: shown, sessions: rest, urgency: urgency(shown, now: now)))
            for (i, p) in popped.enumerated() {
                out.append(BoardPill(key: "\(k)#\(i + 2)", shown: p, sessions: [p], urgency: urgency(p, now: now)))
            }
        }
        shownBy = nextShown
        return out
    }

    /** Fits pills into `places`; waiting pills are promoted into view, and beyond `places` waiting the last place is "+N". */
    public static func slots(_ pills: [BoardPill], places: Int = 4) -> [Slot] {
        guard pills.count > places else { return pills.map(Slot.pill) }
        let waiting = pills.filter { $0.urgency == 3 }
        if waiting.count > places {
            let shown = waiting.prefix(places - 1)
            let rest = waiting.dropFirst(places - 1)
            return shown.map(Slot.pill) + [.waiting(count: rest.count, first: rest.first!.shown.id)]
        }
        let others = pills.filter { $0.urgency != 3 }.prefix(places - waiting.count)
        let keep = Set((waiting + others).map(\.key))
        return pills.filter { keep.contains($0.key) }.map(Slot.pill)
    }

    private func isQuiet(_ a: Agent, now: TimeInterval) -> Bool {
        guard let t = a.lastActiveAt else { return false }
        return now - Double(t) / 1000 >= Self.quietAfter
    }

    private func score(_ a: Agent, _ now: TimeInterval) -> (Int, Double) {
        (urgency(a, now: now), Double(a.lastActiveAt ?? 0))
    }
}
