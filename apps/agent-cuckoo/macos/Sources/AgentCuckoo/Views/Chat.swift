import AppKit
import Carbon.HIToolbox
import CuckooCore
import SwiftUI

/** Supervisor chat: text goes through the server's router (agents or the chosen CLI); replies from targeted agents stream in. */
struct ChatView: View {
    @ObservedObject var store: Store
    @ObservedObject var settings: Settings
    @ObservedObject var model: IslandModel
    var voice: VoiceWake?
    var close: () -> Void = {}
    @State private var text = ""
    @State private var keyMonitor: Any?
    @FocusState private var inputFocused: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            MascotView(reaction: store.chatReaction, size: 44).frame(width: 84, height: 60)
            VStack(alignment: .leading, spacing: 6) {
                history
                if let e = store.chatError {
                    Text(e).font(.system(size: 11)).foregroundColor(Color(red: 244 / 255, green: 80 / 255, blue: 94 / 255)).lineLimit(2)
                }
                confirmChip
                chips
                attachments
                input
            }
            .padding(.trailing, 16)
        }
        .padding(.top, 12)
        .padding(.bottom, 14)
        .onAppear {
            installKeys()
            if store.wantsChatFocus { focusInput() }
        }
        .onDisappear(perform: removeKeys)
        .onChange(of: store.wantsChatFocus) { if $0 { focusInput() } }
    }

    private func focusInput() {
        store.wantsChatFocus = false
        NSApp.windows.first { $0 is IslandPanel }?.makeKey()
        inputFocused = true
    }

    /** Enter sends (onSubmit); Shift-Enter inserts a newline at the caret; Esc closes the island even while typing. */
    private func installKeys() {
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
            guard e.window is IslandPanel, let editor = e.window?.firstResponder as? NSTextView, editor.isFieldEditor else { return e }
            switch Int(e.keyCode) {
            case kVK_Escape:
                close()
                return nil
            case kVK_Return where e.modifierFlags.contains(.shift):
                editor.insertNewlineIgnoringFieldEditor(nil)
                return nil
            default: return e
            }
        }
    }

    private func removeKeys() {
        if let m = keyMonitor { NSEvent.removeMonitor(m) }
        keyMonitor = nil
    }

    @ViewBuilder private var confirmChip: some View {
        if let p = store.supervisePending {
            HStack(spacing: 6) {
                Text(t("supervise.confirmSummary", ["summary": p.summary])).font(.system(size: 11.5)).lineLimit(2)
                Spacer(minLength: 4)
                CardButton(title: t("supervise.cancel")) { Task { await store.confirm(cancel: true) } }
                CardButton(title: t("supervise.confirm"), primary: true) { Task { await store.confirm() } }
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.indigo.opacity(0.25)))
            .disabled(store.chatBusy)
        }
    }

    private var history: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    if store.chatMessages.isEmpty { Bubble(text: store.greeting, mine: false) }
                    ForEach(store.chatMessages) { m in
                        Group {
                            if m.ask { AskBubble(store: store, message: m) } else { Bubble(message: m) }
                        }
                        .id(m.id)
                    }
                    if store.chatBusy { TypingDots().id("typing") }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .onChange(of: store.chatMessages.count) { _ in
                if let last = store.chatMessages.last { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            .onChange(of: store.chatBusy) { busy in if busy { proxy.scrollTo("typing", anchor: .bottom) } }
        }
    }

    private var chips: some View {
        HStack(spacing: 6) {
            Spacer()
            if !store.chatMessages.isEmpty {
                Button { Task { await store.endChat() } } label: {
                    Image(systemName: "square.and.pencil").font(.system(size: 10))
                }
                .buttonStyle(.plain).foregroundColor(Color(hex: "#7B8089")).help(t("chat.newChat")).accessibilityLabel(t("chat.newChat"))
            }
            Menu {
                ForEach(store.chatCLIs) { c in
                    Button(c.cli) { Task { await store.setChatCLI(c.cli) } }
                }
            } label: {
                HStack(spacing: 4) {
                    Circle().fill(Color.indigo).frame(width: 6, height: 6)
                    Text(settings.chatCLI).font(.system(size: 10.5)).foregroundColor(Color(hex: "#7B8089"))
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 8)).foregroundColor(Color(hex: "#7B8089"))
                }
                .padding(.horizontal, 8).frame(height: 20)
                .background(Capsule().fill(Color.white.opacity(0.06)))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .disabled(store.chatCLIs.isEmpty)
            .help(store.chatCLIs.isEmpty ? t("chat.noCli") : t("chat.cli"))
        }
    }

    @ViewBuilder private var attachments: some View {
        if !store.chatAttachments.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(store.chatAttachments, id: \.uploadId) { a in
                        HStack(spacing: 4) {
                            Image(systemName: a.mime.hasPrefix("image/") ? "photo" : "doc").font(.system(size: 9))
                            Text(a.name).font(.system(size: 10.5)).lineLimit(1).truncationMode(.middle).frame(maxWidth: 140)
                            Button { store.removeAttachment(a.uploadId) } label: {
                                Image(systemName: "xmark").font(.system(size: 8, weight: .bold))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(t("common.removeNamed", ["name": a.name]))
                        }
                        .padding(.horizontal, 8).frame(height: 20)
                        .background(Capsule().fill(Color.white.opacity(0.1)))
                    }
                }
            }
        }
    }

    private var input: some View {
        HStack(spacing: 6) {
            ChatMic(voice: voice) { heard in text = text.isEmpty ? heard : text + " " + heard }
            TextField(store.chatMessages.isEmpty ? t("supervise.placeholder") : t("chat.placeholderContinue"), text: $text,
                      axis: .vertical)
                .lineLimit(1...4)
                .textFieldStyle(.plain)
                .font(.system(size: 12.5))
                .focused($inputFocused)
                .onChange(of: inputFocused) { model.typing = $0 }
                .onSubmit(send)
            Button(action: send) {
                Image(systemName: "arrow.up").font(.system(size: 11, weight: .bold))
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(Color.white.opacity(canSend ? 0.9 : 0.15)))
                    .foregroundColor(.black)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel(t("common.send"))
        }
        .padding(.horizontal, 10).padding(.vertical, 5).frame(minHeight: 32)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.07)))
    }

    private var canSend: Bool {
        !store.chatBusy && !store.chatCLIs.isEmpty && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        guard canSend else { return }
        let t = text
        text = ""
        // Attachments only ride the plain chat route; the supervise request has no field for them.
        Task { if store.chatAttachments.isEmpty { await store.supervise(t) } else { await store.chat(t) } }
    }
}

private func markdown(_ text: String) -> AttributedString {
    (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
        ?? AttributedString(text)
}

/** One chat line; replies (assistant or agent) collapse to three lines with a chevron, tap toggles. */
struct Bubble: View {
    let message: ChatMessage?
    let text: String
    let mine: Bool
    @ObservedObject private var cards = CardState.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(message m: ChatMessage) { message = m; text = m.text; mine = m.role == .user }
    init(text: String, mine: Bool) { message = nil; self.text = text; self.mine = mine }

    static func cardId(_ m: ChatMessage) -> String { "chat:\(m.id)" }

    var body: some View {
        let id = message.map(Self.cardId)
        let folds = !mine && id != nil && CardExpansion.needsChevron(text, charsPerLine: 60)
        let open = id.map { cards.expansion.isExpanded($0) } ?? true
        HStack(alignment: .top) {
            if mine { Spacer(minLength: 32) }
            VStack(alignment: .leading, spacing: 2) {
                if let from = message?.from {
                    Text(t("supervise.replyFrom", ["name": from])).font(.system(size: 10, weight: .semibold))
                        .foregroundColor(Color(hex: "#9AA0AA"))
                }
                Text(markdown(text)).font(.system(size: 12.5)).textSelection(.enabled)
                    .lineLimit(folds && !open ? CardExpansion.collapsedLines : nil)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: mine ? 12 : 8).fill(Color.white.opacity(mine ? 0.13 : 0.05)))
            .modifier(FoldToggle(id: folds ? id : nil, reduceMotion: reduceMotion))
            if folds, let id { CardChevron(id: id) }
            if !mine { Spacer(minLength: 0) }
        }
    }
}

private struct FoldToggle: ViewModifier {
    let id: String?
    let reduceMotion: Bool
    func body(content: Content) -> some View {
        if let id { content.cardToggle(id, reduceMotion: reduceMotion) } else { content }
    }
}

/** An agent's question streamed into chat; the answer goes back to that agent via `say`. */
struct AskBubble: View {
    @ObservedObject var store: Store
    let message: ChatMessage
    @State private var answer = ""
    @State private var sent = false

    var body: some View {
        let agent = message.agentId.flatMap(store.agent)
        VStack(alignment: .leading, spacing: 6) {
            Text(t("supervise.askFrom", ["name": message.from ?? ""])).font(.system(size: 10, weight: .semibold))
                .foregroundColor(Color(hex: "#F5B544"))
            Bubble(message: { var m = message; m.from = nil; return m }())
            if !sent {
                HStack(spacing: 6) {
                    TextField(t("supervise.answer"), text: $answer).textFieldStyle(.plain).font(.system(size: 12))
                        .onSubmit(reply)
                    CardButton(title: t("supervise.answer"), primary: true, action: reply)
                        .disabled(agent?.canSend != true || answer.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.horizontal, 8).frame(height: 30)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.07)))
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: "#F5B544").opacity(0.4), lineWidth: 1))
    }

    private func reply() {
        guard let a = message.agentId.flatMap(store.agent), a.canSend else { return }
        let text = answer
        sent = true
        Task { await store.say(text, to: [a]) }
    }
}

/** Three dots pulsing in turn; static under Reduce Motion. */
struct TypingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var on = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { i in
                Circle().fill(Color(hex: "#6B7079")).frame(width: 5, height: 5)
                    .scaleEffect(reduceMotion ? 1 : on ? 1.2 : 0.6)
                    .animation(reduceMotion ? nil
                               : .easeInOut(duration: 0.45).repeatForever(autoreverses: true).delay(0.14 * Double(i)),
                               value: on)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .onAppear { on = true }
        .accessibilityLabel(t("chat.typing"))
    }
}

/** `DictationButton` behaviour with wake listening paused while the mic records. */
struct ChatMic: View {
    var voice: VoiceWake?
    let onText: (String) -> Void
    @StateObject private var dictation = Dictation()
    @AppStorage(DictationButton.localeKey) private var localeId = Locale.current.identifier
    @State private var paused = false

    var body: some View {
        Button(action: toggle) {
            Image(systemName: dictation.recording ? "mic.fill" : "mic")
                .foregroundStyle(dictation.recording ? Color.red : Color.secondary)
        }
        .buttonStyle(.plain)
        .help(dictation.error?.message ?? t("dictation.help"))
        .accessibilityLabel(dictation.recording ? t("dictation.stop") : t("dictation.dictate"))
        .contextMenu {
            ForEach(DictationButton.locales, id: \.identifier) { l in
                Button {
                    localeId = l.identifier
                } label: {
                    let name = Locale.current.localizedString(forIdentifier: l.identifier) ?? l.identifier
                    Text(l.identifier == localeId ? t("dictation.selected", ["name": name]) : name)
                }
            }
        }
        .onChange(of: dictation.recording) { on in if !on { release() } }
        .onDisappear {
            _ = dictation.stop()
            release()
        }
    }

    private func toggle() {
        if dictation.recording {
            let t = dictation.stop().trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { onText(t) }
            release()
        } else {
            if !paused { voice?.pause(); paused = true }
            Task {
                await dictation.start(locale: Locale(identifier: localeId))
                if !dictation.recording { release() }
            }
        }
    }

    private func release() {
        guard paused else { return }
        paused = false
        voice?.resume()
    }
}
