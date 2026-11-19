import AppKit
import CuckooCore
import SwiftUI
import UniformTypeIdentifiers

/** A dropped file (path known) or a capture (upload only, its temp file is already gone). */
struct Dropped: Equatable {
    var path: String?
    var upload: UploadResponse
}

enum DropPaste {
    private static let plain = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@%+=:,./_-".unicodeScalars)

    /** Path as pasted into a terminal, single-quoted when a shell would split or expand it; nil (refused) unless absolute and free of control characters. */
    static func text(_ path: String) -> String? {
        guard path.hasPrefix("/"), !path.hasPrefix("-"),
              !path.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f }) else { return nil }
        if path.unicodeScalars.allSatisfy(plain.contains) { return path }
        return "'" + path.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    static func targets(_ agents: [Agent]) -> [Agent] { agents.filter(\.canSend) }

    /** Pastes the path into the agent's terminal through `say()`; false when the path is refused. */
    @MainActor @discardableResult
    static func send(_ path: String, to agent: Agent, store: Store) async -> Bool {
        guard let text = text(path) else {
            store.notice = t("drop.absoluteOnly")
            return false
        }
        await store.say(text, to: [agent])
        return true
    }
}

/** Drop tab: a file drop zone plus region and full-screen capture straight to the choose view. */
struct DropView: View {
    @ObservedObject var store: Store
    let onFile: (URL) -> Void
    let onCaptured: (Dropped) -> Void

    @State private var targeted = false
    @State private var busy = false

    var body: some View {
        HStack(spacing: 14) {
            VStack(spacing: 4) {
                Image(systemName: "tray.and.arrow.down").font(.system(size: 22))
                Text(t("drop.here")).font(.system(size: 13, weight: .semibold))
                Text(t("drop.hint")).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(RoundedRectangle(cornerRadius: 14).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5]))
                .foregroundStyle(targeted ? Color.accentColor : Color.secondary.opacity(0.5)))
            .onDrop(of: [.fileURL], isTargeted: $targeted) { providers in
                guard let p = providers.first else { return false }
                _ = p.loadObject(ofClass: URL.self) { url, _ in
                    guard let url, url.isFileURL else { return }
                    DispatchQueue.main.async { onFile(url) }
                }
                return true
            }
            .accessibilityLabel(t("drop.here"))

            VStack(spacing: 8) {
                captureButton(t("drop.captureArea"), icon: "viewfinder", mode: .region)
                captureButton(t("drop.wholeScreen"), icon: "rectangle.dashed", mode: .fullScreen)
            }
            .frame(width: 140)
        }
        .padding(12)
    }

    private func captureButton(_ title: String, icon: String, mode: Capture.Mode) -> some View {
        Button {
            busy = true
            Task {
                if let up = await Capture.take(mode, store: store) { onCaptured(Dropped(path: nil, upload: up)) }
                busy = false
            }
        } label: {
            Label(title, systemImage: icon).frame(maxWidth: .infinity)
        }
        .disabled(busy)
    }
}
