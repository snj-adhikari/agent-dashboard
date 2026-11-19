import AppKit
import CuckooCore
import Foundation

/**
 * Opt-in "OK Cuckoo" wake listening, recognised on device only. Off until `enabledKey` is set; pauses while the
 * screen is locked or asleep. Drives the island with `voiceWoke`/`voiceFinished` and hands the utterance to `onUtterance`.
 */
@MainActor
final class VoiceWake: ObservableObject {
    static let enabledKey = "cuckooVoiceWake"
    static let silence: TimeInterval = 1.5
    static let firstWords: TimeInterval = 4
    static let maxIdleChars = 300
    static let maxFailures = 5

    /** Retry delay after the nth consecutive recogniser failure: 1 s doubling, capped at 30 s. */
    nonisolated static func backoff(_ failures: Int) -> TimeInterval { min(30, pow(2, Double(max(failures, 1) - 1))) }

    /** Speech framework's "no speech detected" ends idle tasks in a quiet room; it isn't a failure. */
    nonisolated static func isNoSpeech(_ error: Error) -> Bool {
        let e = error as NSError
        return e.domain == "kAFAssistantErrorDomain" && e.code == 1110
    }

    @Published private(set) var heard = ""
    @Published private(set) var error: SpeechError?
    @Published private(set) var running = false

    private let send: (IslandEvent) -> Void
    private let onUtterance: (String) -> Void
    private var mic: MicTap?
    private var transcriber: Transcriber?
    private var woke = false
    private var quiet: Task<Void, Never>?
    private var retry: Task<Void, Never>?
    private var failures = 0
    private var locked = false
    private var asleep = false
    private var pauses = 0
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []

    init(send: @escaping (IslandEvent) -> Void, onUtterance: @escaping (String) -> Void) {
        self.send = send
        self.onUtterance = onUtterance
        let dnc = DistributedNotificationCenter.default()
        let ws = NSWorkspace.shared.notificationCenter
        watch(dnc, "com.apple.screenIsLocked") { $0.locked = true }
        watch(dnc, "com.apple.screenIsUnlocked") { $0.locked = false }
        watch(ws, NSWorkspace.willSleepNotification.rawValue) { $0.asleep = true }
        watch(ws, NSWorkspace.screensDidSleepNotification.rawValue) { $0.asleep = true }
        watch(ws, NSWorkspace.didWakeNotification.rawValue) { $0.asleep = false }
        watch(ws, NSWorkspace.screensDidWakeNotification.rawValue) { $0.asleep = false }
    }

    deinit { observers.forEach { $0.0.removeObserver($0.1) } }

    var enabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }
    private var canListen: Bool { enabled && !locked && !asleep && pauses == 0 }

    /** Releases the mic while another feature (dictation, Notetaker) records; nests, so each pause needs a resume. */
    func pause() {
        pauses += 1
        stop()
    }

    func resume() {
        guard pauses > 0 else { return }
        pauses -= 1
        Task { await sync() }
    }

    /** Starts or stops to match the setting and lock/sleep state; call after the setting changes. */
    func sync() async {
        guard canListen else { stop(); return }
        guard !running, retry == nil else { return }
        failures = 0
        guard await Transcriber.authorise() else { error = .noPermission; return }
        guard canListen, !running else { return }
        listen()
    }

    /** Drops a half-heard utterance, e.g. when the island leaves listening by click or close. */
    func cancelUtterance() {
        guard woke else { return }
        woke = false
        heard = ""
        quiet?.cancel()
        restart()
    }

    /** Text after the first "OK Cuckoo" (or "okay cuckoo"), or nil when the phrase isn't there. */
    nonisolated static func afterWake(_ text: String) -> String? {
        guard let r = text.range(of: #"\b(ok|okay)[\s,.]+cuckoo\b[\s,.!?]*"#,
                                 options: [.regularExpression, .caseInsensitive]) else { return nil }
        return String(text[r.upperBound...])
    }

    private func watch(_ center: NotificationCenter, _ name: String, _ apply: @escaping (VoiceWake) -> Void) {
        let token = center.addObserver(forName: Notification.Name(name), object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                apply(self)
                await self.sync()
            }
        }
        observers.append((center, token))
    }

    private func listen() {
        do {
            let hear: @MainActor (String?, Bool, Error?) -> Void = { [weak self] in self?.hear($0, final: $1, error: $2) }
            let tx: Transcriber
            do { tx = try Transcriber(locale: .current, onText: hear) }
            catch { tx = try Transcriber(locale: Locale(identifier: "en-US"), onText: hear) }
            let mic = MicTap()
            do { try mic.start { tx.append($0) } } catch { tx.cancel(); throw error }
            (self.mic, transcriber, running, error) = (mic, tx, true, nil)
        } catch {
            self.error = .from(error)
            running = false
        }
    }

    private func hear(_ text: String?, final: Bool, error: Error?) {
        if let error, text == nil, !Self.isNoSpeech(error) { fail(); return }
        let text = text ?? ""
        if !woke {
            guard let after = Self.afterWake(text) else {
                if final || text.count > Self.maxIdleChars { restart() }
                return
            }
            woke = true
            heard = after
            send(.voiceWoke)
        } else if let after = Self.afterWake(text) {
            heard = after
        }
        quiet?.cancel()
        if final { finish(); return }
        let wait = heard.isEmpty ? Self.firstWords : Self.silence
        quiet = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.finish()
        }
    }

    private func finish() {
        quiet?.cancel()
        let said = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        woke = false
        heard = ""
        restart()
        if !said.isEmpty { failures = 0; onUtterance(said) }
        send(.voiceFinished)
    }

    private func restart() {
        teardown()
        if canListen { listen() }
    }

    /** Tears down, then relistens after `backoff`; gives up after `maxFailures` in a row so a stuck error can't spin. */
    private func fail() {
        quiet?.cancel()
        if woke { woke = false; heard = ""; send(.voiceFinished) }
        teardown()
        failures += 1
        guard failures < Self.maxFailures else { error = .failing; return }
        let wait = Self.backoff(failures)
        retry = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            guard !Task.isCancelled, let self else { return }
            self.retry = nil
            if self.canListen { self.listen() }
        }
    }

    private func stop() {
        quiet?.cancel()
        retry?.cancel()
        retry = nil
        let wasWoke = woke
        woke = false
        heard = ""
        teardown()
        if wasWoke { send(.voiceFinished) }
    }

    private func teardown() {
        mic?.stop()
        transcriber?.cancel()
        (mic, transcriber, running) = (nil, nil, false)
    }
}
