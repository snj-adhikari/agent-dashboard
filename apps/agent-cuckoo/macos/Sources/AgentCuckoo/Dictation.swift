import AVFoundation
import CoreMedia
import Speech
import SwiftUI
import CuckooCore

enum SpeechError: String, Error {
    case unsupported, noPermission = "no_permission", audio, failing

    var message: String {
        switch self {
        case .unsupported: return t("dictation.unavailable")
        case .noPermission: return t("dictation.permission")
        case .audio: return t("dictation.micFailed")
        case .failing: return t("dictation.stopped")
        }
    }

    static func from(_ error: Error) -> SpeechError { error as? SpeechError ?? .audio }
}

/** On-device recognition only: throws `unsupported` when the locale has no local model, so audio never leaves the Mac. */
final class Transcriber {
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?
    private var onText: (@MainActor (String?, Bool, Error?) -> Void)?

    /** `onText(text, final, error)`; text is nil when the task ended with `error` and no result. */
    init(locale: Locale, onText: @escaping @MainActor (String?, Bool, Error?) -> Void) throws {
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.supportsOnDeviceRecognition else {
            throw SpeechError.unsupported
        }
        self.onText = onText
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let final = result?.isFinal ?? (error != nil)
            Task { @MainActor [weak self] in self?.onText?(text, final, error) }
        }
    }

    /** Requests Speech Recognition then Microphone; macOS only prompts while undetermined. */
    static func authorise() async -> Bool {
        let speech = await withCheckedContinuation { c in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVCaptureDevice.requestAccess(for: .audio)
    }

    func append(_ buffer: AVAudioPCMBuffer) { request.append(buffer) }
    func append(_ buffer: CMSampleBuffer) { request.appendAudioSampleBuffer(buffer) }
    func finish() { request.endAudio() }

    @MainActor func cancel() {
        onText = nil
        task?.cancel()
    }
}

final class MicTap {
    private let engine = AVAudioEngine()
    private var running = false

    func start(_ sink: @escaping (AVAudioPCMBuffer) -> Void) throws {
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in sink(buffer) }
        engine.prepare()
        do { try engine.start() } catch { input.removeTap(onBus: 0); throw SpeechError.audio }
        running = true
    }

    func stop() {
        guard running else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        running = false
    }
}

@MainActor
final class Dictation: ObservableObject {
    @Published private(set) var recording = false
    @Published private(set) var text = ""
    @Published private(set) var error: SpeechError?
    private var mic: MicTap?
    private var transcriber: Transcriber?

    func start(locale: Locale) async {
        guard !recording else { return }
        error = nil
        text = ""
        guard await Transcriber.authorise() else { error = .noPermission; return }
        do {
            let tx = try Transcriber(locale: locale) { [weak self] t, _, _ in if let t { self?.text = t } }
            let mic = MicTap()
            do { try mic.start { tx.append($0) } } catch { tx.cancel(); throw error }
            (self.mic, transcriber, recording) = (mic, tx, true)
        } catch { self.error = .from(error) }
    }

    /** Stops the mic and returns what was heard so far. */
    func stop() -> String {
        mic?.stop()
        transcriber?.finish()
        transcriber?.cancel()
        (mic, transcriber, recording) = (nil, nil, false)
        return text
    }
}

/** Chat mic: click toggles on-device dictation (red while recording), right-click picks the language. */
struct DictationButton: View {
    static let localeKey = "cuckooDictationLocale"
    static let locales: [Locale] = SFSpeechRecognizer.supportedLocales()
        .filter { SFSpeechRecognizer(locale: $0)?.supportsOnDeviceRecognition == true }
        .sorted { $0.identifier < $1.identifier }

    let onText: (String) -> Void
    @StateObject private var dictation = Dictation()
    @AppStorage(DictationButton.localeKey) private var localeId = Locale.current.identifier

    var body: some View {
        Button {
            if dictation.recording {
                let t = dictation.stop().trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty { onText(t) }
            } else {
                Task { await dictation.start(locale: Locale(identifier: localeId)) }
            }
        } label: {
            Image(systemName: dictation.recording ? "mic.fill" : "mic")
                .foregroundStyle(dictation.recording ? Color.red : Color.secondary)
        }
        .buttonStyle(.plain)
        .help(dictation.error?.message ?? t("dictation.help"))
        .accessibilityLabel(dictation.recording ? t("dictation.stop") : t("dictation.dictate"))
        .contextMenu {
            ForEach(Self.locales, id: \.identifier) { l in
                Button {
                    localeId = l.identifier
                } label: {
                    let name = Locale.current.localizedString(forIdentifier: l.identifier) ?? l.identifier
                    Text(l.identifier == localeId ? t("dictation.selected", ["name": name]) : name)
                }
            }
        }
        .onDisappear { _ = dictation.stop() }
    }
}
