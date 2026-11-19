import CuckooCore
import Foundation

/**
 * Screenshots to Claude through `/usr/sbin/screencapture` (argv only, never a shell), written into a fresh 0700
 * per-capture temp dir, uploaded as a chat context chip, then deleted whether or not the upload worked.
 * Exposes functions only; shortcuts are bound elsewhere behind the `captureShortcuts` setting.
 */
enum Capture {
    enum Mode: Equatable {
        case region
        case fullScreen
        case window(Int)
    }

    static let tool = URL(fileURLWithPath: "/usr/sbin/screencapture")

    /** `-x` silences the shutter; `-m` limits a full capture to the main screen; nil for an invalid window id. */
    static func args(_ mode: Mode, to file: URL) -> [String]? {
        switch mode {
        case .region: return ["-i", "-x", file.path]
        case .fullScreen: return ["-x", "-m", file.path]
        case .window(let id): return id > 0 ? ["-x", "-l\(id)", file.path] : nil
        }
    }

    /** Captures and uploads; nil when cancelled (Esc in region mode), when capture failed or the upload failed. */
    @MainActor
    static func take(_ mode: Mode, store: Store) async -> UploadResponse? {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("cuckoo-capture-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: dir) }
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        } catch {
            store.notice = t("error.screenshotPrep")
            return nil
        }
        let stamp = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate, .withTime])
        let file = dir.appendingPathComponent(t("drop.screenshotName", ["stamp": stamp]))
        guard let argv = args(mode, to: file), await run(argv) == 0, fm.fileExists(atPath: file.path) else { return nil }
        try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        return await store.upload(file, name: file.lastPathComponent, forChat: true)
    }

    private static func run(_ argv: [String]) async -> Int32 {
        await withCheckedContinuation { done in
            let p = Process()
            p.executableURL = tool
            p.arguments = argv
            p.terminationHandler = { done.resume(returning: $0.terminationStatus) }
            do { try p.run() } catch { done.resume(returning: -1) }
        }
    }
}
