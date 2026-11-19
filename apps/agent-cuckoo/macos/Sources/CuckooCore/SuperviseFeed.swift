import Foundation

/** Replies and asks from agents the supervisor sent to, streamed into chat once each, only those after the send. */
public struct SuperviseFeed {
    public struct Item: Equatable, Identifiable {
        public let id: String
        public let agentId: String
        public let name: String
        public let text: String
        public let ask: Bool
        public let at: Double
    }

    /** Watched agent id → (name, send time in ms). */
    public private(set) var watches: [String: (name: String, since: Double)] = [:]
    private var seen = Set<String>()

    public init() {}

    /** Watches every target the server reports sent; a pending (unconfirmed) response watches nothing. */
    public mutating func watch(_ r: SuperviseResponse, at ms: Double) {
        guard r.pending == nil else { return }
        let sent = Set(r.results.filter(\.ok).map(\.agentId))
        for t in r.targets where sent.contains(t.agentId) { watches[t.agentId] = (t.name, ms) }
    }

    /** New items for watched agents at or after their send, oldest first; each reply id is returned once. */
    public mutating func take(_ replies: [Reply]) -> [Item] {
        let fresh = replies
            .filter { r in watches[r.agentId].map { r.at >= $0.since } ?? false }
            .filter { seen.insert($0.id).inserted }
            .sorted { $0.at < $1.at }
        return fresh.map { r in
            let ask = r.kind == .ask
            let name = (ask ? r.from : nil) ?? r.codename ?? watches[r.agentId]!.name
            return Item(id: r.id, agentId: r.agentId, name: name, text: r.text, ask: ask, at: r.at)
        }
    }
}
