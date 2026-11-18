public enum StateEmoji {
    public static let offline = "sleeping"

    public static func name(for state: AgentState) -> String {
        switch state {
        case .working: return "working"
        case .waiting: return "waiting"
        case .done: return "done"
        case .unknown: return "thinking"
        }
    }
}
