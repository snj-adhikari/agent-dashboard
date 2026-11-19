import CuckooCore
import SwiftUI

/** Home card: focused session on the left (cuckoo, name, CLI and host badges, ticker, jump), pill grid on the right. */
struct OverviewView: View {
    @ObservedObject var store: Store
    @ObservedObject var board: BoardModel
    @Binding var focused: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject private var cards = CardState.shared
    @AppStorage(WardrobeKey.outfit) private var outfitSelection = Outfit.auto
    @AppStorage(WardrobeKey.southern) private var southern = true

    var body: some View {
        let slots = SessionBoard.slots(board.pills)
        let pill = board.pills.first { $0.key == focused } ?? board.top
        HStack(alignment: .top, spacing: 10) {
            leftCard(pill).frame(width: 322, alignment: .topLeading)
            grid(slots)
        }
        .padding(.top, 4)
        .padding(.trailing, 10)
    }

    private func leftCard(_ pill: BoardPill?) -> some View {
        let reaction = store.offline ? .sleeping : pill.map { board.reaction($0.shown, offline: false) } ?? .sleeping
        return HStack(alignment: .top, spacing: 0) {
            MascotView(reaction: reaction, size: 58, approvalId: store.queue.head?.id,
                       outfit: WardrobeKey.current(outfitSelection, southern: southern),
                       musicPlaying: store.music?.playing == true)
                .frame(width: 108, height: 72)
            if let pill {
                session(pill)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Text(Greeting.text(at: Date())).font(.system(size: 13, weight: .semibold))
                    Text(store.offline ? t("common.offline") : t("common.noAgentsRunning"))
                        .font(.system(size: 11)).foregroundColor(Color(hex: "#8E939C"))
                }
                .padding(.top, 6)
            }
        }
    }

    private func cardId(_ pill: BoardPill) -> String { "agent:\(pill.shown.id)" }

    /** Ticker hides lines: more than 3 sessions, or a single line past 2 rows. */
    private func long(_ pill: BoardPill) -> Bool {
        pill.sessions.count > 1
            ? pill.sessions.count > 3 || pill.sessions.contains { CardExpansion.needsChevron($0.lastLine ?? "", charsPerLine: 26, limit: 1) }
            : CardExpansion.needsChevron(pill.shown.lastLine ?? "", charsPerLine: 30, limit: 2)
    }

    private func session(_ pill: BoardPill) -> some View {
        let a = pill.shown
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Circle().fill(Color(hex: a.colour)).frame(width: 7, height: 7)
                Text(a.label).font(.system(size: 12, weight: .semibold)).foregroundColor(Color(hex: "#F5F6F8")).lineLimit(1)
                CLIBadge(cli: a.cli, size: 13)
                HostBadge(agent: a, size: 13)
                Spacer(minLength: 4)
                Button { Task { await store.focus(a) } } label: {
                    Image(systemName: "arrow.up.right").font(.system(size: 8, weight: .bold))
                        .frame(width: 16, height: 16)
                        .background(Circle().fill(Color.white.opacity(0.07)))
                }
                .buttonStyle(.plain)
                .disabled(a.canFocus == false)
                .help(t("common.jumpToTerminal"))
                .accessibilityLabel(t("common.jumpTo", ["name": a.label]))
                if long(pill) { CardChevron(id: cardId(pill)) }
            }
            ticker(pill).cardToggle(cardId(pill), reduceMotion: reduceMotion)
        }
        .padding(.top, 6)
    }

    @ViewBuilder private func ticker(_ pill: BoardPill) -> some View {
        let grey = Color(hex: "#6B7079")
        let open = cards.expansion.isExpanded(cardId(pill))
        if pill.sessions.count > 1 {
            let lines = pill.sessions.count > 3 && !open ? Array(pill.sessions.prefix(2)) : pill.sessions
            VStack(alignment: .leading, spacing: 2) {
                ForEach(lines) { s in
                    HStack(spacing: 5) {
                        Circle().fill(board.reaction(s, offline: store.offline).wash.colour).frame(width: 5, height: 5)
                        Text(s.codename ?? s.name).font(.system(size: 11, weight: s.id == pill.shown.id ? .semibold : .regular))
                        Text(s.lastLine ?? "").font(.system(size: 11)).foregroundColor(grey)
                    }
                    .lineLimit(open ? nil : 1)
                    .fixedSize(horizontal: false, vertical: open)
                }
                if pill.sessions.count > 3 && !open { Text("+\(pill.sessions.count - 2)").font(.system(size: 11)).foregroundColor(grey) }
            }
            .frame(minHeight: 44, maxHeight: open ? nil : 44, alignment: .topLeading)
        } else {
            let line = pill.shown.lastLine ?? ""
            ZStack(alignment: .topLeading) {
                Text(line).font(.system(size: 13, weight: .medium)).foregroundColor(Color(hex: "#C9CDD4")).lineLimit(open ? nil : 2)
                    .fixedSize(horizontal: false, vertical: open)
                    .id(line)
                    .transition(reduceMotion ? .opacity
                                : .asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity),
                                              removal: .move(edge: .top).combined(with: .opacity)))
            }
            .frame(minHeight: 44, maxHeight: open ? nil : 44, alignment: .topLeading)
            .clipped()
            .animation(reduceMotion ? .easeInOut(duration: Motion.crossFadeDuration)
                       : .timingCurve(0.4, 0, 0.2, 1, duration: 0.38), value: line)
        }
    }

    private func grid(_ slots: [Slot]) -> some View {
        let motion = Motion.current(reduceMotion: reduceMotion)
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 4), GridItem(.flexible())], spacing: 4) {
            ForEach(Array(slots.enumerated()), id: \.offset) { i, slot in
                Group {
                    switch slot {
                    case .pill(let p): pillButton(p)
                    case .waiting(let n, let first):
                        Button { focused = board.pills.first { $0.shown.id == first }?.key } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "hourglass")
                                Text(t("approval.plusWaiting", ["count": String(n)]))
                            }
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.orange)
                            .frame(maxWidth: .infinity, minHeight: 28)
                            .background(Capsule().fill(Color.orange.opacity(0.18)))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .transition(.opacity)
                .animation(motion.open.animation.delay(motion.stagger(i)), value: slots.count)
            }
        }
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func pillButton(_ p: BoardPill) -> some View {
        let on = p.key == focused
        let c = Color(hex: p.shown.colour)
        return Button { focused = p.key } label: {
            ZStack(alignment: .leading) {
                Text(p.shown.codename ?? p.shown.name)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(on ? c : Color(hex: "#6B7079"))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
                    .padding(.leading, 26)
                MiniMascot(agent: p.shown, reaction: board.reaction(p.shown, offline: store.offline)).padding(.leading, 8)
            }
            .frame(height: 28)
            .background(Capsule().fill(on ? c.opacity(0.18) : Color(hex: "#0E0F11")))
            .overlay(Capsule().stroke(c.opacity(on ? 0.55 : 0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .help(p.shown.label)
    }
}
