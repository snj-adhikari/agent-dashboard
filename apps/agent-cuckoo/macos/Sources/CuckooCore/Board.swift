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
