import AppKit
import CuckooCore
import SwiftUI

/**
 * Dropped-file sequence from `UploadTimeline`: box morph, swallow with the gulp cue, upload progress with a tick per
 * 10%, then `onChosen`. The real upload runs alongside and the bar holds at 100% until it lands; `onFailed` if it fails.
 */
struct UploadView: View {
    @ObservedObject var store: Store
    let file: URL
    let onChosen: (Dropped) -> Void
    let onFailed: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var timeline = UploadTimeline(random: .random(in: 0..<1))
    @State private var t: TimeInterval = 0
    @State private var grown = false
    @State private var landed = false

    private var phase: UploadTimeline.Phase { timeline.phase(at: t, uploaded: landed) }

    var body: some View {
        HStack(spacing: 16) {
            MascotView(reaction: .working, size: 62, animated: !reduceMotion, forced: .box)
                .scaleEffect(reduceMotion ? 1 : scale)
                .opacity(reduceMotion && !grown ? 0 : 1)
                .frame(width: 90)
            VStack(alignment: .leading, spacing: 6) {
                Text(file.lastPathComponent).font(.system(size: 13, weight: .semibold)).lineLimit(1).truncationMode(.middle)
                if case .uploading(let p) = phase {
                    ProgressView(value: p).progressViewStyle(.linear)
                    Text(CuckooCore.t("upload.progress", ["percent": String(Int(p * 100))])).font(.system(size: 11)).foregroundStyle(.secondary).monospacedDigit()
                } else {
                    Text(CuckooCore.t("upload.swallowing")).font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 20)
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: UploadTimeline.morphSpring.response,
                                                                       dampingFraction: UploadTimeline.morphSpring.damping),
                   value: step)
        .accessibilityElement(children: .combine)
        .task { await run() }
    }

    private var step: Int {
        switch phase {
        case .morph: return grown ? 1 : 0
        case .swallow: return 2
        case .uploading: return 3
        case .choose: return 4
        }
    }

    private var scale: CGFloat {
        switch phase {
        case .morph: return grown ? 1 : 0.6
        case .swallow: return 0.8
        case .uploading, .choose: return 0.5
        }
    }

    @MainActor private func run() async {
        let start = Date()
        grown = true
        var result: UploadResponse?
        var finished = false
        let job = Task { @MainActor in
            result = await store.upload(file, name: file.lastPathComponent, forChat: true)
            finished = true
        }
        defer { job.cancel() }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 33_000_000)
            let now = Date().timeIntervalSince(start)
            for cue in timeline.cues(from: t, to: now) {
                switch cue {
                case .gulp: store.play(.gulp)
                case .tick: store.play(.tick)
                }
            }
            t = now
            landed = finished
            if finished, result == nil { return onFailed() }
            if case .choose = timeline.phase(at: now, uploaded: finished), let up = result {
                return onChosen(Dropped(path: file.path, upload: up))
            }
        }
    }
}

/** Choose view after an upload: ask about it in chat, reveal it in Finder, or paste its path into a session. */
struct ChooseView: View {
    @ObservedObject var store: Store
    let dropped: Dropped
    let onAsk: () -> Void
    let onDone: () -> Void

    private var targets: [Agent] {
        guard let path = dropped.path, DropPaste.text(path) != nil else { return [] }
        return DropPaste.targets(store.agents)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            MascotView(reaction: .done, size: 52, forced: .proud).frame(width: 60)
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(dropped.upload.name).font(.system(size: 13, weight: .semibold)).lineLimit(1).truncationMode(.middle)
                    Text(dropped.upload.mime).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                HStack(spacing: 8) {
                    Button(action: onAsk) { Label(t("upload.ask"), systemImage: "bubble.left.fill") }
                        .buttonStyle(.borderedProminent)
                    Button(action: reveal) { Label(t("upload.revealFinder"), systemImage: "folder") }
                        .disabled(dropped.path == nil)
                }
                if !targets.isEmpty {
                    Text(t("upload.intoSession")).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(targets, id: \.id) { a in
                                Button(a.codename ?? a.name) { into(a) }.help(a.cwd ?? "")
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func reveal() {
        guard let path = dropped.path else { return }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }

    private func into(_ a: Agent) {
        guard let path = dropped.path else { return }
        Task {
            store.removeAttachment(dropped.upload.uploadId)
            if await DropPaste.send(path, to: a, store: store) { onDone() }
        }
    }
}
