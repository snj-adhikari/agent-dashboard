import CuckooCore
import SwiftUI

/** First-open guide in the island card: tabs, prompting, controlling agents, shortcuts. */
struct GuideView: View {
    @AppStorage(GuideGate.seenKey) private var seen = false
    @State private var gate = GuideGate(seen: false)
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let openChatLabel = "⌃⌥C"

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(t("guide.title")).font(.system(size: 11, weight: .semibold)).foregroundColor(Color(hex: "#9AA0AA"))
                Spacer()
                HStack(spacing: 5) {
                    ForEach(GuideGate.pages.indices, id: \.self) { i in
                        Circle().fill(Color.white.opacity(i == gate.page ? 0.9 : 0.2)).frame(width: 6, height: 6)
                    }
                }
                .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(t("guide.\(gate.key).title")).font(.system(size: 16, weight: .semibold))
                Text(t("guide.\(gate.key).body", ["openChat": Self.openChatLabel]))
                    .font(.system(size: 12.5)).foregroundColor(Color(hex: "#C9CDD4"))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .id(gate.page)
            .transition(reduceMotion ? .opacity : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                                              removal: .opacity))
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                if !gate.isLast { CardButton(title: t("guide.skip")) { go { $0.dismiss() } } }
                Spacer()
                if !gate.isFirst { CardButton(title: t("guide.back")) { go { $0.back() } } }
                CardButton(title: t(gate.isLast ? "guide.done" : "guide.next"), primary: true) { go { $0.next() } }
            }
        }
        .padding(14)
    }

    private func go(_ change: (inout GuideGate) -> Void) {
        withAnimation(Motion.current(reduceMotion: reduceMotion).open.animation) { change(&gate) }
        if gate.seen { seen = true }
    }
}
