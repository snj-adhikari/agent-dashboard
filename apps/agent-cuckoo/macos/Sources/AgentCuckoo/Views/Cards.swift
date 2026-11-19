import CuckooCore
import SwiftUI

struct OfflineBanner: View {
    @ObservedObject var store: Store
    var body: some View {
        HStack {
            EmojiIcon(name: StateEmoji.offline, symbol: "wifi.slash", tint: .gray)
            Text(t("common.offline"))
            Spacer()
            Button(t("common.startMonitor")) { store.startMonitor() }
        }
        .font(.caption)
        .padding(8)
        .background(Color.white.opacity(0.08))
        .cornerRadius(8)
    }
}

/** Home tab: approval or question first, then an error or finished card for the top session, else the overview. */
struct HomeCard: View {
    @ObservedObject var store: Store
    @ObservedObject var board: BoardModel
    @Binding var focused: String?
    @State private var dismissed: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if store.offline { OfflineBanner(store: store).padding(.horizontal, 12).padding(.top, 8) }
            if let head = store.queue.head {
                ApprovalCard(store: store, approval: head, position: 1, total: store.queue.items.count)
            } else if let o = outcome {
                OutcomeCard(store: store, agent: o.0, failed: o.1 == .error) { dismissed.insert(key(o.0, o.1)) }
            } else {
                OverviewView(store: store, board: board, focused: $focused)
            }
        }
    }

    private var outcome: (Agent, Reaction)? {
        guard !store.offline, let a = board.top?.shown else { return nil }
        let r = board.reaction(a, offline: false)
        guard r == .error || r == .celebrating, !dismissed.contains(key(a, r)) else { return nil }
        return (a, r)
    }

    private func key(_ a: Agent, _ r: Reaction) -> String { "\(a.id)|\(r.rawValue)|\(a.lastActiveAt ?? 0)" }
}

/** Per-card expansion and the home card's natural height; kept for the app's life so reopening keeps it. */
@MainActor
final class CardState: ObservableObject {
    static let shared = CardState()
    @Published var expansion = CardExpansion()
    @Published var homeContent: CGFloat = 0

    func toggle(_ id: String, reduceMotion: Bool) {
        withAnimation(Motion.current(reduceMotion: reduceMotion).open.animation) { expansion.toggle(id) }
    }
}

/** Wraps subviews onto new rows instead of clipping them. */
struct Flow: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let frames = CardExpansion.flow(subviews.map { $0.sizeThatFits(.unspecified) }, width: proposal.width ?? .infinity, spacing: spacing)
        return CGSize(width: frames.map(\.maxX).max() ?? 0, height: frames.map(\.maxY).max() ?? 0)
    }

    func placeSubviews(in b: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let frames = CardExpansion.flow(subviews.map { $0.sizeThatFits(.unspecified) }, width: b.width, spacing: spacing)
        for (v, f) in zip(subviews, frames) {
            v.place(at: CGPoint(x: b.minX + f.minX, y: b.minY + f.minY), proposal: ProposedViewSize(f.size))
        }
    }
}

/** Expand/collapse chevron for one card. */
struct CardChevron: View {
    let id: String
    @ObservedObject private var cards = CardState.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let open = cards.expansion.isExpanded(id)
        Button { cards.toggle(id, reduceMotion: reduceMotion) } label: {
            Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 9, weight: .bold))
                .frame(width: 16, height: 16)
                .background(Circle().fill(Color.white.opacity(0.07)))
        }
        .buttonStyle(.plain)
        .help(t(open ? "card.collapse" : "card.expand"))
        .accessibilityLabel(t(open ? "card.collapse" : "card.expand"))
    }
}

extension View {
    /** Click anywhere outside the card's buttons toggles it. */
    func cardToggle(_ id: String, reduceMotion: Bool) -> some View {
        contentShape(Rectangle()).onTapGesture { CardState.shared.toggle(id, reduceMotion: reduceMotion) }
    }
}

struct CardButton: View {
    let title: String
    var primary = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 12).frame(height: 26)
                .background(Capsule().fill(primary ? Color.white : Color.white.opacity(0.1)))
                .foregroundColor(primary ? .black : .white)
        }
        .buttonStyle(.plain)
    }
}

/** Permission, plan and question prompts; a click is bound to this approval's id. */
struct ApprovalCard: View {
    @ObservedObject var store: Store
    let approval: Approval
    var position = 1
    var total = 1
    @State private var inTerminal = false
    @State private var sending = false
    @ObservedObject private var cards = CardState.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(WardrobeKey.outfit) private var outfitSelection = Outfit.auto
    @AppStorage(WardrobeKey.southern) private var southern = true

    private var kind: ApprovalKind { approval.kind ?? .permission }
    private var agent: Agent? { store.agent(approval.agentId) }
    private var cardId: String { "approval:\(approval.id)" }

    var body: some View {
        let who = agent?.label ?? approval.agentId
        let long = CardExpansion.needsChevron(approval.command, charsPerLine: 68)
        let open = cards.expansion.isExpanded(cardId)
        HStack(alignment: .top, spacing: 10) {
            MascotView(reaction: .waiting, size: 44, approvalId: approval.id,
                       outfit: WardrobeKey.current(outfitSelection, southern: southern)).frame(width: 70)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    let parts = t(headlineKey).components(separatedBy: "{name}")
                    (Text(parts[0]).foregroundColor(Color(hex: "#8E939C")) + Text(who).fontWeight(.semibold)
                        + Text(parts.dropFirst().joined(separator: who)).foregroundColor(Color(hex: "#8E939C")))
                        .font(.system(size: 12)).lineLimit(1)
                    Spacer()
                    if total > 1 { Text(t("approval.position", ["index": String(position), "total": String(total)])).font(.system(size: 11, weight: .medium)).foregroundColor(.gray) }
                    if long { CardChevron(id: cardId) }
                }
                Text(approval.command)
                    .font(.system(size: kind == .question ? 13 : 11, weight: kind == .question ? .semibold : .regular,
                                  design: kind == .question ? .default : .monospaced))
                    .lineLimit(open ? nil : CardExpansion.collapsedLines)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.white.opacity(kind == .question ? 0 : 0.06)))
                    .cardToggle(cardId, reduceMotion: reduceMotion)
                if kind == .question && !approval.options.isEmpty {
                    Flow {
                        ForEach(approval.options, id: \.key) { o in
                            Text(o.label).font(.system(size: 10)).lineLimit(2)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Capsule().fill(Color.white.opacity(0.08)))
                        }
                    }
                }
                buttons
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .onChange(of: approval.id) { _ in inTerminal = false }
    }

    private var headlineKey: String {
        switch kind {
        case .permission: return "approval.needsPermission"
        case .plan: return "approval.planReady"
        case .question: return "approval.asking"
        }
    }

    @ViewBuilder private var buttons: some View {
        Flow(spacing: 6) {
            if inTerminal || approval.isCommitOrPush {
                CardButton(title: t("approval.replyInTerminal"), primary: true) { if let a = agent { Task { await store.focus(a) } } }
            } else {
                ForEach(order, id: \.self) { d in
                    CardButton(title: title(d), primary: d == .allow) { answer(d) }.disabled(sending)
                }
                if kind == .question {
                    CardButton(title: t("approval.replyInTerminal")) { if let a = agent { Task { await store.focus(a) } } }
                }
            }
        }
    }

    private var order: [Decision] { [.deny, .allow, .always].filter(approval.decisions.contains) }

    private func title(_ d: Decision) -> String {
        switch (kind, d) {
        case (.plan, .deny): return t("approval.changePlan")
        case (.plan, .allow): return t("approval.autoMode")
        case (.plan, .always): return t("approval.manual")
        case (.question, .allow): return t("common.approve")
        case (_, .allow): return t("common.allow")
        case (_, .always): return t("common.always")
        case (_, .deny): return t("common.deny")
        }
    }

    private func answer(_ d: Decision) {
        let id = approval.id
        sending = true
        Task {
            await store.answer(approval, d)
            sending = false
            if store.queue.items.contains(where: { $0.id == id }), store.notice == t("common.answerInTerminal") {
                inTerminal = true
            }
        }
    }
}

/** Error (red) or finished (green) card for one session. */
struct OutcomeCard: View {
    @ObservedObject var store: Store
    let agent: Agent
    let failed: Bool
    let dismiss: () -> Void
    @ObservedObject private var cards = CardState.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(WardrobeKey.outfit) private var outfitSelection = Outfit.auto
    @AppStorage(WardrobeKey.southern) private var southern = true

    var body: some View {
        let id = "outcome:\(agent.id)"
        let line = agent.lastLine ?? ""
        let limit = failed ? 2 : 1
        let open = cards.expansion.isExpanded(id)
        HStack(alignment: .top, spacing: 10) {
            MascotView(reaction: failed ? .error : .celebrating, size: 44,
                       outfit: WardrobeKey.current(outfitSelection, southern: southern)).frame(width: 70)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(failed ? t("done.error", ["name": agent.label]) : t("done.finished", ["name": agent.label]))
                        .font(.system(size: 12, weight: .semibold)).lineLimit(1)
                    Spacer(minLength: 4)
                    if CardExpansion.needsChevron(line, charsPerLine: 56, limit: limit) { CardChevron(id: id) }
                }
                Text(line).font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color(hex: "#C9CDD4")).lineLimit(open ? nil : limit)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .cardToggle(id, reduceMotion: reduceMotion)
                Flow(spacing: 6) {
                    CardButton(title: t("done.openTerminal"), primary: true) { Task { await store.focus(agent) } }
                        .disabled(agent.canFocus == false)
                    CardButton(title: t("common.ok"), action: dismiss)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }
}
