import CuckooCore
import SwiftUI

/** Resting row: the cuckoo left of the notch; right of it the timer or music pill, else a 2 x 2 grid of session mini-cuckoos. */
struct CompactView: View {
    @ObservedObject var store: Store
    @ObservedObject var board: BoardModel
    @ObservedObject var side: SideRuntime
    let notch: CGFloat
    @AppStorage(WardrobeKey.outfit) private var outfit = Outfit.auto
    @AppStorage(WardrobeKey.southern) private var southern = true
    private let timer = StoredTimer()

    var body: some View {
        let slots = SessionBoard.slots(board.pills)
        let waiting = slots.contains { if case .waiting = $0 { return true } else { return false } }
        HStack(spacing: 0) {
            MascotView(reaction: mainMood(store: store, board: board), size: 20, approvalId: store.queue.head?.id,
                       outfit: WardrobeKey.current(outfit, southern: southern),
                       forced: side.listening ? .listening : nil, musicPlaying: store.music?.playing == true)
                .frame(maxWidth: .infinity)
                .contextMenu { wardrobeMenu }
            Spacer().frame(width: notch)
            Group {
                if !waiting, store.queue.head == nil, timer.value.running {
                    TimerPill(store: store)
                } else if !waiting, store.queue.head == nil, let m = store.music, m.playing {
                    MusicPill(music: m)
                } else {
                    LazyVGrid(columns: [GridItem(.fixed(13), spacing: 3), GridItem(.fixed(13))], spacing: 2) {
                        ForEach(Array(slots.enumerated()), id: \.offset) { _, slot in
                            switch slot {
                            case .pill(let p): MiniMascot(agent: p.shown, reaction: board.reaction(p.shown, offline: store.offline), size: 12)
                            case .waiting(let n, _):
                                Text("+\(n)").font(.system(size: 8, weight: .heavy)).foregroundColor(.orange)
                                    .help(t("approval.moreWaiting", ["count": String(n)]))
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 6)
    }

    @ViewBuilder private var wardrobeMenu: some View {
        ForEach([Outfit.auto] + Outfit.allCases.map(\.rawValue), id: \.self) { option in
            Button { outfit = option } label: {
                if option == outfit { Label(Self.title(option), systemImage: "checkmark") } else { Text(Self.title(option)) }
            }
        }
        Divider()
        Button(t("mascot.openWardrobe")) { side.show(.wardrobe) }
    }

    static func title(_ option: String) -> String {
        option == Outfit.auto ? t("common.auto") : t("outfit.\(option)")
    }
}
