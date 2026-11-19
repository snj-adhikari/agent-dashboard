import CuckooCore
import SwiftUI

/** Now playing from `state.music`: art when the music provider lists an image url, play/pause/next/prev, dancing cuckoo. */
struct MusicCard: View {
    @ObservedObject var store: Store
    @State private var busy = false

    private var artURL: URL? {
        guard let s = store.sideData[.music]?.items.first?.url, let u = URL(string: s),
              ["https", "file"].contains(u.scheme ?? "") else { return nil }
        return u
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            MascotView(reaction: .done, size: 52, musicPlaying: store.music?.playing == true).frame(width: 64)
            art
            if let m = store.music {
                VStack(alignment: .leading, spacing: 4) {
                    Text(m.title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    Text([m.artist, m.player == "spotify" ? "Spotify" : t("tab.music")].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 11)).foregroundColor(Color(hex: "#8E939C")).lineLimit(1)
                    if let d = m.durationMs, d > 0, let p = m.positionMs {
                        ProgressView(value: min(Double(p), Double(d)), total: Double(d)).progressViewStyle(.linear).tint(.white)
                    }
                    controls(playing: m.playing)
                }
            } else {
                Text(t("music.empty")).font(.system(size: 12)).foregroundColor(.gray)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    @ViewBuilder private var art: some View {
        Group {
            if let u = artURL {
                AsyncImage(url: u) { img in img.resizable().aspectRatio(contentMode: .fill) } placeholder: { note }
            } else { note }
        }
        .frame(width: 56, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var note: some View {
        RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.08))
            .overlay(Image(systemName: "music.note").font(.system(size: 22)).foregroundColor(.white.opacity(0.6)))
    }

    private func controls(playing: Bool) -> some View {
        HStack(spacing: 14) {
            button("backward.fill", "prev", t("common.previous"))
            button(playing ? "pause.fill" : "play.fill", playing ? "pause" : "play", playing ? t("common.pause") : t("common.play"))
            button("forward.fill", "next", t("common.next"))
        }
        .padding(.top, 2)
    }

    private func button(_ symbol: String, _ action: String, _ label: String) -> some View {
        Button {
            busy = true
            Task {
                await store.sideAction(.music, action)
                busy = false
                store.poll()
            }
        } label: {
            Image(systemName: symbol).font(.system(size: 13)).frame(width: 24, height: 22)
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityLabel(label)
    }
}

/** Compact music pill: tiny dancing cuckoo plus the track title. */
struct MusicPill: View {
    let music: Music

    var body: some View {
        HStack(spacing: 4) {
            MascotView(reaction: .done, size: 16, animated: true, musicPlaying: music.playing)
            Text(music.title).font(.system(size: 10, weight: .medium)).lineLimit(1)
        }
        .padding(.horizontal, 6).frame(height: 20)
        .background(Capsule().fill(Color.white.opacity(0.08)))
        .help([music.title, music.artist].compactMap { $0 }.joined(separator: " – "))
    }
}
