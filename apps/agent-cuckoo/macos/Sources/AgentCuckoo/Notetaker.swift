import AppKit
import AVFoundation
import CoreGraphics
import CoreMedia
import ScreenCaptureKit

/**
 * Records the mic, plus system audio through ScreenCaptureKit only when Screen Recording is already granted
 * (preflight never prompts), and transcribes both on device.
 */
@MainActor
final class Notetaker: ObservableObject {
    static let finalWait: TimeInterval = 3

    @Published private(set) var recording = false
    @Published private(set) var startedAt: Date?
    @Published private(set) var withSystemAudio = false
    @Published private(set) var me = ""
    @Published private(set) var others = ""
    @Published private(set) var error: SpeechError?

    private var mic: MicTap?
    private var micTx: Transcriber?
    private var sysTx: Transcriber?
    private var stream: SCStream?
    private var sink: AudioSink?
    private var pendingFinals = 0
    private var quitObserver: NSObjectProtocol?

    init() {
        quitObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification, object: nil, queue: .main
        ) { [weak self] _ in MainActor.assumeIsolated { self?.discard() } }
    }

    deinit { quitObserver.map(NotificationCenter.default.removeObserver) }

    var transcript: String {
        let m = me.trimmingCharacters(in: .whitespacesAndNewlines), o = others.trimmingCharacters(in: .whitespacesAndNewlines)
        return o.isEmpty ? m : "Me:\n\(m)\n\nOthers:\n\(o)"
    }

    func start(locale: Locale) async {
        guard !recording else { return }
        (error, me, others, withSystemAudio) = (nil, "", "", false)
        guard await Transcriber.authorise() else { error = .noPermission; return }
        do {
            let tx = try Transcriber(locale: locale) { [weak self] t, final, _ in self?.heard(t, final: final) { $0.me = $1 } }
            let mic = MicTap()
            do { try mic.start { tx.append($0) } } catch { tx.cancel(); throw error }
            (self.mic, micTx, recording, startedAt) = (mic, tx, true, Date())
        } catch {
            self.error = .from(error)
            return
        }
        if CGPreflightScreenCaptureAccess() { await startSystemAudio(locale) }
    }

    /** Stops recording, waits briefly for the final transcription, and returns the transcript. */
    func stop() async -> String {
        guard recording else { return transcript }
        pendingFinals = (micTx == nil ? 0 : 1) + (sysTx == nil ? 0 : 1)
        mic?.stop()
        micTx?.finish()
        sysTx?.finish()
        if let s = stream { try? await s.stopCapture() }
        let deadline = Date().addingTimeInterval(Self.finalWait)
        while pendingFinals > 0, Date() < deadline { try? await Task.sleep(nanoseconds: 100_000_000) }
        micTx?.cancel()
        sysTx?.cancel()
        (mic, micTx, sysTx, stream, sink, recording) = (nil, nil, nil, nil, nil, false)
        return transcript
    }

    /** Stops mic and system audio at once and drops the transcript; used on quit, where nothing is saved. */
    func discard() {
        guard recording else { return }
        mic?.stop()
        micTx?.cancel()
        sysTx?.cancel()
        if let s = stream { Task { try? await s.stopCapture() } }
        (mic, micTx, sysTx, stream, sink, recording, me, others) = (nil, nil, nil, nil, nil, false, "", "")
    }

    private func heard(_ text: String?, final: Bool, _ apply: (Notetaker, String) -> Void) {
        if let text, !text.isEmpty { apply(self, text) }
        if final, pendingFinals > 0 { pendingFinals -= 1 }
    }

    private func startSystemAudio(_ locale: Locale) async {
        guard let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true),
              let display = content.displays.first,
              let tx = try? Transcriber(locale: locale, onText: { [weak self] t, final, _ in
                  self?.heard(t, final: final) { $0.others = $1 }
              })
        else { return }
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: config, delegate: nil)
        let sink = AudioSink { tx.append($0) }
        do {
            try stream.addStreamOutput(sink, type: .audio, sampleHandlerQueue: .global(qos: .userInitiated))
            try await stream.startCapture()
        } catch {
            tx.cancel()
            return
        }
        (self.stream, self.sink, sysTx, withSystemAudio) = (stream, sink, tx, true)
    }
}

final class AudioSink: NSObject, SCStreamOutput {
    private let onAudio: (CMSampleBuffer) -> Void
    init(_ onAudio: @escaping (CMSampleBuffer) -> Void) { self.onAudio = onAudio }

    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        if type == .audio, buffer.isValid { onAudio(buffer) }
    }
}
