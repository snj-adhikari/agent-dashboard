import CuckooCore
import SwiftUI

/** Notetaker: record, live on-device transcript, then save through `save` (POST notes) and show the summary. */
struct NotesCard: View {
    @ObservedObject var notetaker: Notetaker
    let save: (_ title: String, _ transcript: String) async -> NotesResponse?

    @State private var title = ""
    @State private var summary: String?
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TextField(t("notes.title"), text: $title).textFieldStyle(.roundedBorder)
                Button(action: toggle) {
                    Label(notetaker.recording ? t("common.stop") : t("notes.record"),
                          systemImage: notetaker.recording ? "stop.circle.fill" : "record.circle")
                }
                .tint(notetaker.recording ? .red : nil)
                .disabled(saving)
            }
            if notetaker.recording, let start = notetaker.startedAt {
                TimelineView(.periodic(from: start, by: 1)) { ctx in
                    Text(t("notes.mic", ["time": TimerText.clock(ctx.date.timeIntervalSince(start))])
                         + (notetaker.withSystemAudio ? " " + t("notes.systemAudio") : ""))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.red)
                }
            }
            ScrollView {
                Text(notetaker.transcript.isEmpty ? t("notes.hint") : notetaker.transcript)
                    .font(.callout)
                    .foregroundStyle(notetaker.transcript.isEmpty ? .secondary : .primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .frame(maxHeight: 90)
            if saving { ProgressView().controlSize(.small) }
            if let summary { Text(summary).font(.callout).textSelection(.enabled) }
            if let e = notetaker.error { Text(e.message).font(.caption).foregroundStyle(.red) }
        }
        .padding(12)
        .onDisappear { if notetaker.recording { toggle() } }
    }

    private func toggle() {
        if notetaker.recording {
            Task {
                let transcript = await notetaker.stop()
                guard !transcript.isEmpty else { return }
                saving = true
                let name = title.trimmingCharacters(in: .whitespaces)
                summary = await save(name.isEmpty ? Self.defaultTitle() : name, transcript)?.summary
                saving = false
            }
        } else {
            summary = nil
            Task { await notetaker.start(locale: .current) }
        }
    }

    private static func defaultTitle() -> String {
        let f = DateFormatter()
        f.dateFormat = "d MMM yyyy, h:mm a"
        return t("notes.defaultTitle", ["date": f.string(from: Date())])
    }
}
