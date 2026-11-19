/** Which controls an expanded Sessions / Main agents row shows, and why any are disabled. */
public struct RowControls: Equatable {
    public enum Action: String, CaseIterable { case reply, `continue`, approve, deny, stop }

    public let actions: [Action]
    /** `row.readOnly` or `row.answerInTerminal`; nil when every shown action is usable. */
    public let reason: String?
    private let disabled: Set<Action>

    public func enabled(_ a: Action) -> Bool { actions.contains(a) && !disabled.contains(a) }

    /** Approve/Deny only while the agent has a pending approval or ask; git commit/push must be answered in the terminal. */
    public static func of(_ agent: Agent, pending: Approval?) -> RowControls {
        let actions: [Action] = pending == nil ? [.reply, .continue, .stop] : [.reply, .continue, .approve, .deny, .stop]
        if !agent.canSend { return RowControls(actions: actions, reason: "row.readOnly", disabled: Set(actions)) }
        if pending?.isCommitOrPush == true {
            return RowControls(actions: actions, reason: "row.answerInTerminal", disabled: [.approve, .deny])
        }
        return RowControls(actions: actions, reason: nil, disabled: [])
    }
}
