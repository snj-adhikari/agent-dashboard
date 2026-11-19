import SwiftUI
import CuckooCore

/** Shown while the island is `listening`: listening pose plus what has been heard after the wake phrase. */
struct ListeningCard: View {
    @ObservedObject var voice: VoiceWake
    let onStop: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            MascotView(reaction: .working, size: 58, forced: .listening).frame(width: 64)
            VStack(alignment: .leading, spacing: 4) {
                Text(t("listening.title")).font(.headline)
                Text(voice.heard.isEmpty ? t("listening.prompt") : voice.heard)
                    .font(.callout)
                    .foregroundStyle(voice.heard.isEmpty ? .secondary : .primary)
                    .lineLimit(3)
            }
            Spacer(minLength: 0)
            Button(action: onStop) { Image(systemName: "xmark.circle.fill") }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel(t("listening.stop"))
        }
        .padding(.horizontal, 12)
    }
}

/** Opt-in switch for wake listening; off by default, stored per Mac. */
struct VoiceToggle: View {
    @ObservedObject var voice: VoiceWake
    @AppStorage(VoiceWake.enabledKey) private var on = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(t("listening.wake"), isOn: $on)
                .onChange(of: on) { _ in Task { await voice.sync() } }
            Text(voice.error?.message ?? t("listening.privacy"))
                .font(.caption)
                .foregroundStyle(voice.error == nil ? .secondary : Color.red)
        }
    }
}
