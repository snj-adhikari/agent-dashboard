import CuckooCore
import Foundation
import SwiftUI

/** Release notes from the bundled `whats-new.json` (`{ "version": "…", "notes": ["…"] }`); empty when missing. */
struct WhatsNewNotes: Decodable {
    var version: String?
    var notes: [String]

    static func bundled() -> WhatsNewNotes {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("whats-new.json"),
              let data = try? Data(contentsOf: url),
              let n = try? JSONDecoder().decode(WhatsNewNotes.self, from: data) else { return WhatsNewNotes(version: nil, notes: []) }
        return n
    }
}

enum WhatsNewLaunch {
    static let seenKey = "whatsNewSeen"

    static var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    /**
     * Call once at launch. Waits `firstDelay`, then shows when `isIdle` is true, retrying while busy.
     * A first install only records the version, so the card starts with the next update.
     */
    @MainActor static func run(isIdle: @escaping () -> Bool, show: @escaping () -> Void) async {
        let d = UserDefaults.standard
        let current = currentVersion
        let lastSeen = d.string(forKey: seenKey)
        guard WhatsNewGate.shouldOffer(current: current, lastSeen: lastSeen) else {
            if lastSeen == nil { d.set(current, forKey: seenKey) }
            return
        }
        var gate = WhatsNewGate()
        var wait = WhatsNewGate.firstDelay
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            switch gate.attempt(idle: isIdle()) {
            case .show:
                d.set(current, forKey: seenKey)
                show()
                return
            case .retry(let after): wait = after
            case .giveUp: return
            }
        }
    }
}

/** Two pages: own release notes, then all-time stats from `recap?week=all`. Proud pose and sound on appear. */
struct WhatsNewCard: View {
    @ObservedObject var store: Store
    var close: () -> Void = {}
    @State private var page = 0
    @State private var notes = WhatsNewNotes.bundled()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var allTime: RecapResponse? { store.recap?.week == "all" ? store.recap : nil }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            MascotView(reaction: .celebrating, size: 44, forced: .proud).frame(width: 70)
            VStack(alignment: .leading, spacing: 6) {
                Group {
                    if page == 0 { notesPage } else { statsPage }
                }
                .id(page)
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .trailing)))
                HStack(spacing: 6) {
                    Text(t("whatsNew.page", ["page": String(page + 1)])).font(.system(size: 10)).foregroundColor(.gray)
                    Spacer()
                    if page == 0 {
                        CardButton(title: t("common.next"), primary: true) { turn(1) }
                    } else {
                        CardButton(title: t("common.back")) { turn(0) }
                        CardButton(title: t("common.done"), primary: true, action: close)
                    }
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .onAppear { store.play(.proud) }
        .task { _ = await store.loadRecap(week: "all") }
    }

    private var notesPage: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(t("whatsNew.newIn", ["version": notes.version ?? WhatsNewLaunch.currentVersion])).font(.system(size: 12, weight: .semibold))
            if notes.notes.isEmpty {
                Text(t("whatsNew.thanks")).font(.system(size: 11)).foregroundColor(Color(hex: "#C9CDD4"))
            }
            ForEach(Array(notes.notes.prefix(4).enumerated()), id: \.offset) { _, line in
                Text("• \(line)").font(.system(size: 11)).foregroundColor(Color(hex: "#C9CDD4")).lineLimit(2)
            }
        }
    }

    private var statsPage: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(t("whatsNew.soFarLong")).font(.system(size: 12, weight: .semibold))
            if let r = allTime { RecapStats(recap: r) } else { Text(t("common.loading")).font(.system(size: 11)).foregroundColor(.gray) }
        }
    }

    private func turn(_ p: Int) {
        withAnimation(reduceMotion ? .linear(duration: Motion.crossFadeDuration) : .easeInOut(duration: 0.25)) { page = p }
    }
}
