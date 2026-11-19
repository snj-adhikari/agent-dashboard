import CuckooCore
import SwiftUI

/** One row per space's main agent, a prompt box for the chosen mains, replies and relayed sub-agent asks. */
struct MainAgentsView: View {
    @ObservedObject var store: Store
    @ObservedObject var model: IslandModel
    @State private var target: String?
    @State private var text = ""
    @State private var sending = false

    private var mains: [Agent] {
        var seen = Set<String>()
        return store.agents.filter { $0.isMain && seen.insert($0.space).inserted }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let head = store.queue.head {
                ApprovalCard(store: store, approval: head, position: 1, total: store.queue.items.count)
            }
            if mains.isEmpty { Text(t("mains.none")).font(.system(size: 12)).foregroundColor(.gray) }
            ForEach(mains) { row($0) }
            HStack {
                TextField(target.flatMap { id in mains.first { $0.id == id }?.label }.map { t("mains.tell", ["name": $0]) }
                          ?? t("mains.tellAll", ["count": String(sendable.count)]),
                          text: $text, onEditingChanged: { model.typing = $0 })
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(send)
                Button(action: send) { Image(systemName: "paperplane.fill") }
                    .disabled(sending || targets.isEmpty || text.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityLabel(t("common.send"))
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(store.replies) { r in
                    if r.kind == .ask { AskCard(store: store, reply: r) } else { replyLine(r) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var sendable: [Agent] { mains.filter(\.canSend) }
    private var targets: [Agent] { target.map { id in sendable.filter { $0.id == id } } ?? sendable }

    private func row(_ a: Agent) -> some View {
        let on = target == a.id
        return Button { target = on ? nil : a.id } label: {
            HStack(spacing: 6) {
                StateBadge(reaction: store.reaction(a), size: 12)
                Text(a.label).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                MainFlag()
                Text(a.space).font(.system(size: 10)).foregroundColor(.gray)
                if !a.canSend { Image(systemName: "eye").font(.system(size: 9)).foregroundColor(.gray).help(t("mains.readOnly")) }
                Spacer()
                Text(a.lastLine ?? "").font(.system(size: 10, design: .monospaced)).foregroundColor(.gray).lineLimit(1)
            }
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.white.opacity(on ? 0.12 : 0)))
        }
        .buttonStyle(.plain)
        .disabled(!a.canSend)
    }

    private func replyLine(_ r: Reply) -> some View {
        Text(t("mains.here", ["name": r.codename ?? t("mains.agent"), "text": r.text])).font(.system(size: 11)).textSelection(.enabled)
    }

    private func send() {
        let t = text, to = targets
        guard !to.isEmpty else { return }
        sending = true
        Task {
            await store.say(t, to: to)
            text = ""
            sending = false
        }
    }
}

/** A sub-agent's question relayed by its main; the answer goes back to that main. */
struct AskCard: View {
    @ObservedObject var store: Store
    let reply: Reply
    @State private var answer = ""

    var body: some View {
        let main = store.agent(reply.agentId)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: "questionmark.bubble.fill").foregroundColor(.cyan)
                Text(t("mains.isAsking", ["name": reply.from ?? t("mains.subAgent")])).font(.system(size: 11, weight: .semibold))
                if let m = reply.codename { Text(t("mains.via", ["name": m])).font(.system(size: 10)).foregroundColor(.gray) }
            }
            Text(reply.text).font(.system(size: 13, weight: .semibold)).textSelection(.enabled)
            HStack {
                TextField(t("common.answer"), text: $answer).textFieldStyle(.roundedBorder).onSubmit(send)
                Button(t("common.reply"), action: send)
                    .disabled(main?.canSend != true || answer.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.cyan.opacity(0.12)))
    }

    private func send() {
        guard let m = store.agent(reply.agentId), m.canSend else { return }
        let t = reply.from.map { "@\($0) \(answer)" } ?? answer
        answer = ""
        Task { await store.say(t, to: [m]) }
    }
}
