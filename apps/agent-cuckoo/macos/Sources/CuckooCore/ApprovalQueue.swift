public struct ApprovalQueue: Equatable {
    public static let cap = 5
    public private(set) var items: [Approval] = []

    public init() {}

    public var head: Approval? { items.first }

    /** Mirrors the server list: drops approvals answered elsewhere, appends new ones oldest first up to the cap. */
    @discardableResult
    public mutating func sync(_ server: [Approval]) -> [Approval] {
        let live = Set(server.map(\.id))
        items.removeAll { !live.contains($0.id) }
        var added: [Approval] = []
        for a in server.sorted(by: { $0.receivedAt < $1.receivedAt })
        where items.count < Self.cap && !items.contains(where: { $0.id == a.id }) {
            items.append(a)
            added.append(a)
        }
        return added
    }

    public mutating func remove(_ id: String) {
        items.removeAll { $0.id == id }
    }
}

public enum Recents {
    public static let max = 10

    public static func add(_ path: String, to list: [String], home: String) -> [String] {
        guard !path.isEmpty, path != "/", path != home else { return list }
        return Array(([path] + list.filter { $0 != path }).prefix(max))
    }
}
