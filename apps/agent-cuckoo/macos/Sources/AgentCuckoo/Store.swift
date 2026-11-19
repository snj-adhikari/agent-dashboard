import AppKit
import CuckooCore
import Foundation

struct ChatMessage: Identifiable, Equatable {
    /** `agent` = a reply or ask streamed from an agent the supervisor sent to. */
    enum Role { case user, assistant, agent }
    let id = UUID()
    let role: Role
    let text: String
    var from: String?
    var agentId: String?
    var ask = false
}

@MainActor
final class Store: ObservableObject {
    @Published private(set) var groups: [PillGroup] = []
    @Published private(set) var pills: [Pill] = []
    /** Per-CLI board pills (most urgent session each, waiting pop-outs); feed to `SessionBoard.slots`. */
    @Published private(set) var boardPills: [BoardPill] = []
    @Published private(set) var queue = ApprovalQueue()
    @Published private(set) var replies: [Reply] = []
    @Published private(set) var usage: UsageWindow?
    @Published private(set) var clis: [CLIInfo] = []
    @Published private(set) var offline = true
    @Published var notice: String?

    /** Follows System Settings > Accessibility > Display > Reduce motion, live. */
    @Published private(set) var reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

    @Published private(set) var chatMessages: [ChatMessage] = []
    @Published private(set) var chatConversationId: String?
    @Published private(set) var chatBusy = false
    @Published private(set) var chatError: String?
    /** Mascot mood in the chat view: thinking while waiting, error for 30 s after a failed turn, else done (happy). */
    @Published private(set) var chatReaction: Reaction = .done
    /** Held multi-target send or approve/deny awaiting Confirm / Cancel. */
    @Published private(set) var supervisePending: SupervisePending?
    /** Set by the open-chat shortcut; the chat view focuses its input and clears it. */
    @Published var wantsChatFocus = false

    /** Error code of the last failed action (say, answer, focus, launch, chat, side, upload, notes); nil after a success. Match on this, not on `notice` text. */
    @Published private(set) var lastErrorCode: String?
    /** Now playing from `state.music`; nil when nothing plays or the server lacks music. */
    @Published private(set) var music: Music?
    /** False until `GET side` answers; stays false on 404 (server without side routes). */
    @Published private(set) var sideReady = false
    @Published private(set) var sideProviders: [SideProvider] = []
    @Published private(set) var sideSettings: SideSettings?
    /** Latest list per provider id, only for providers that are enabled and available. */
    @Published private(set) var sideData: [SideId: SideDataResponse] = [:]
    @Published private(set) var recap: RecapResponse?
    /** Uploads queued as context chips for the next chat turn (max 4). */
    @Published private(set) var chatAttachments: [UploadResponse] = []

    let settings: Settings
    /** Drives the island FSM: `.alert` for new approvals/questions, `.finished` when an agent completes, `.activity` otherwise. */
    var onIslandEvent: ((IslandEvent) -> Void)?
    private let sounds = Sounds()
    private var hold = PillHold()
    private var board = SessionBoard()
    private var lastStates: [String: AgentState] = [:]
    private var seenReplies = Set<String>()
    private var timer: Timer?
    private var ticks = 0
    private var inFlight = false
    private var chatErrorReset: Task<Void, Never>?
    private var feed = SuperviseFeed()
    private var motionObserver: NSObjectProtocol?

    init(settings: Settings) {
        self.settings = settings
        motionObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
        }
    }

    var client: MonitorClient {
        MonitorClient(base: URL(string: settings.monitorURL) ?? URL(string: "http://127.0.0.1:5818")!,
                      tokenURL: settings.tokenURL)
    }

    var motion: Motion { Motion.current(reduceMotion: reduceMotion) }
    var greeting: String { Greeting.text(at: Date()) }

    var agents: [Agent] { groups.flatMap(\.agents) }
    var mains: [Agent] { agents.filter { $0.isMain && $0.canSend } }
    func agent(_ id: String) -> Agent? { agents.first { $0.id == id } }

    /** CLIs whose own status command says signed in; the only ones offered in the launcher. */
    var signedInCLIs: [CLIInfo] { clis.filter { $0.signedIn == .yes } }
    /** Signed-in CLIs that can run headless chat. */
    var chatCLIs: [CLIInfo] { signedInCLIs.filter { $0.chat != false } }

    func reaction(_ a: Agent) -> Reaction {
        let now = Date().timeIntervalSince1970
        return Reaction.of(a, now: now, offline: offline, failed: board.urgency(a, now: now) == 2 && a.state != .waiting)
    }

    func play(_ cue: Cue) {
        if settings.soundsOn { sounds.play(cue, volume: settings.soundVolume) }
    }

    func start() {
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.poll() }
        }
    }

    func poll() {
        guard !inFlight else { return }
        inFlight = true
        let c = client, slow = ticks % 15 == 0
        ticks += 1
        Task {
            defer { inFlight = false }
            do {
                apply(try await c.state())
                offline = false
                if slow {
                    usage = (try? await c.usage())?.claude
                    clis = (try? await c.clis()) ?? clis
                    await refreshSide()
                }
            } catch {
                offline = true
            }
        }
    }

    private func apply(_ s: CuckooState) {
        let now = Date().timeIntervalSince1970
        groups = Board.groups(s.agents)
        pills = hold.apply(agents, now: now)
        boardPills = board.update(s.agents, now: now)
        var cue: Cue?
        for a in s.agents where lastStates[a.id] != nil && lastStates[a.id] != a.state {
            if a.state == .done { cue = cue ?? .finish }
            if a.state == .unknown, lastStates[a.id] == .working { cue = .error }
        }
        let changed = s.agents.contains { lastStates[$0.id] != nil && lastStates[$0.id] != $0.state }
        lastStates = Dictionary(s.agents.map { ($0.id, $0.state) }, uniquingKeysWith: { a, _ in a })
        let added = queue.sync(s.approvals)
        if !added.isEmpty { cue = added.contains { $0.kind == .question } ? .question : .approval }
        let fresh = s.replies.filter { !seenReplies.contains($0.id) }
        fresh.forEach { seenReplies.insert($0.id) }
        replies = Array((fresh.reversed() + replies).prefix(30))
        for i in feed.take(s.replies) {
            chatMessages.append(ChatMessage(role: .agent, text: i.text, from: i.name, agentId: i.agentId, ask: i.ask))
        }
        let track = s.music.map { "\($0.player)|\($0.title)|\($0.playing)" }
        let musicChanged = s.music?.playing == true && track != music.map { "\($0.player)|\($0.title)|\($0.playing)" }
        music = s.music
        if let cue { play(cue) }
        if !added.isEmpty { onIslandEvent?(.alert) }
        else if cue == .finish { onIslandEvent?(.finished) }
        else if changed || !fresh.isEmpty || musicChanged { onIslandEvent?(.activity) }
    }

    private func fail(_ error: Error) -> String {
        lastErrorCode = (error as? ClientError)?.code ?? "offline"
        return error.localizedDescription
    }

    private static func isMissingRoute(_ error: Error) -> Bool {
        guard case let .server(status, code, _) = error as? ClientError else { return false }
        return status == 404 || code == "disabled" || code == "not_found"
    }

    /** Ids the server reports enabled and available and the user's side settings switch on; personal providers stay off until enabled. */
    var activeSideIds: [SideId] {
        guard let on = sideSettings?.enabled else { return [] }
        return sideProviders.compactMap { p in
            guard p.enabled, p.available, on[p.id] == true, let id = SideId(rawValue: p.id) else { return nil }
            return id
        }
    }

    func sideProvider(_ id: SideId) -> SideProvider? { sideProviders.first { $0.id == id.rawValue } }

    /** Reloads the registry, then lists for active providers; music rides `state` and recap has its own route. */
    func refreshSide() async {
        do {
            let r = try await client.side()
            sideProviders = r.providers
            sideSettings = r.settings
            sideReady = true
        } catch {
            if Self.isMissingRoute(error) { sideReady = false; sideProviders = []; sideSettings = nil; sideData = [:] }
            return
        }
        let active = Set(activeSideIds)
        sideData = sideData.filter { active.contains($0.key) }
        for id in active where ![.music, .recap, .notes].contains(id) { await refreshSideData(id) }
    }

    func refreshSideData(_ id: SideId) async {
        do { sideData[id] = try await client.sideData(id) }
        catch { if Self.isMissingRoute(error) { sideData[id] = nil } }
    }

    /** Runs an allow-listed provider action; returns its `result` text (plan, triage) or nil on failure. */
    @discardableResult
    func sideAction(_ id: SideId, _ action: String, itemId: String? = nil, text: String? = nil) async -> String? {
        lastErrorCode = nil
        do {
            let r = try await client.sideAction(SideActionRequest(id: id, action: action, itemId: itemId, text: text))
            if id != .music { await refreshSideData(id) }
            return r.result
        } catch {
            notice = fail(error)
            return nil
        }
    }

    func updateSideSettings(_ change: SideSettingsRequest) async {
        lastErrorCode = nil
        do {
            _ = try await client.sideSettings(change)
            await refreshSide()
        } catch { notice = fail(error) }
    }

    func setSideEnabled(_ id: SideId, _ on: Bool) async {
        var enabled = sideSettings?.enabled ?? [:]
        enabled[id.rawValue] = on
        await updateSideSettings(SideSettingsRequest(enabled: enabled))
    }

    /** `week` is `YYYY-Www` or `all`. */
    func loadRecap(week: String) async -> RecapResponse? {
        do {
            let r = try await client.recap(week: week)
            recap = r
            return r
        } catch {
            _ = fail(error)
            return nil
        }
    }

    /** Uploads a file; with `forChat` it becomes a context chip for the next chat turn. */
    @discardableResult
    func upload(_ file: URL, name: String? = nil, forChat: Bool = true) async -> UploadResponse? {
        lastErrorCode = nil
        do {
            let r = try await client.upload(file, name: name)
            if forChat { chatAttachments = Array((chatAttachments + [r]).suffix(4)) }
            play(.gulp)
            return r
        } catch {
            let message = fail(error)
            notice = lastErrorCode == "too_large" ? t("error.fileTooLarge") : message
            play(.error)
            return nil
        }
    }

    func removeAttachment(_ uploadId: String) { chatAttachments.removeAll { $0.uploadId == uploadId } }

    func saveNotes(title: String, transcript: String) async -> NotesResponse? {
        lastErrorCode = nil
        do { return try await client.notes(NotesRequest(title: title, transcript: transcript)) }
        catch {
            notice = fail(error)
            return nil
        }
    }

    func say(_ text: String, to targets: [Agent]) async {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        lastErrorCode = nil
        var failed: [String] = []
        for a in targets {
            do { _ = try await client.post("say", SayRequest(agentId: a.id, text: t)) }
            catch { failed.append(CuckooCore.t("error.agentFailed", ["name": a.codename ?? a.name, "error": fail(error)])) }
        }
        play(failed.isEmpty ? .send : .error)
        notice = failed.isEmpty ? CuckooCore.t("status.sentToCount", ["count": String(targets.count)]) : failed.joined(separator: "\n")
    }

    /** `option` is a question's chosen option label, sent alongside the decision. */
    func answer(_ approval: Approval, _ decision: Decision, option: String? = nil) async {
        lastErrorCode = nil
        guard !approval.isCommitOrPush else {
            lastErrorCode = "grant_in_terminal"
            notice = t("common.answerInTerminal")
            return
        }
        do {
            _ = try await client.approve(approval.id, decision, option: option)
            queue.remove(approval.id)
        } catch let e as ClientError where e.code == "stale" {
            _ = fail(e)
            notice = t("error.promptChanged")
            queue.remove(approval.id)
        } catch let e as ClientError where e.code == "grant_in_terminal" {
            _ = fail(e)
            notice = t("common.answerInTerminal")
        } catch {
            notice = fail(error)
        }
        poll()
    }

    func focus(_ a: Agent) async {
        lastErrorCode = nil
        guard a.canFocus != false else { notice = t("error.cantJump", ["name": a.name]); return }
        do {
            let r = try await client.focus(a.id)
            if r.focused == false { notice = t("error.cantFocus", ["name": a.name]) }
        } catch { notice = fail(error) }
    }

    func launch(cwd: String, prompt: String, cli: String) async {
        lastErrorCode = nil
        do {
            _ = try await client.launch(LaunchRequest(cwd: cwd, prompt: prompt, cli: cli))
            settings.recents = Recents.add(cwd, to: settings.recents,
                                           home: FileManager.default.homeDirectoryForCurrentUser.path)
            play(.send)
            notice = t("status.launched", ["cli": cli])
        } catch {
            play(.error)
            notice = fail(error)
        }
    }

    /** Sends one chat turn to `settings.chatCLI`, continuing the current conversation. */
    func chat(_ text: String) async {
        guard let t = beginTurn(text) else { return }
        defer { chatBusy = false }
        await chatTurn(t)
    }

    /** Routes the text through the server's supervisor; a server without the route falls back to plain chat. */
    func supervise(_ text: String) async {
        guard let t = beginTurn(text) else { return }
        defer { chatBusy = false }
        let sentAt = Self.nowMs
        do {
            superviseReply(try await client.supervise(SuperviseRequest(text: t, conversationId: chatConversationId,
                                                                        cli: settings.chatCLI)), sentAt: sentAt)
        } catch where Self.isMissingRoute(error) {
            await chatTurn(t)
        } catch { turnFailed(error) }
    }

    /** Runs (or with `cancel` drops) the held action; nothing executes before this. */
    func confirm(cancel: Bool = false) async {
        guard let p = supervisePending, !chatBusy else { return }
        supervisePending = nil
        guard cancel || Double(p.expiresAt) > Self.nowMs else {
            chatMessages.append(ChatMessage(role: .assistant, text: t("supervise.expired")))
            return
        }
        chatBusy = true
        chatReaction = .thinking
        lastErrorCode = nil
        defer { chatBusy = false }
        let sentAt = Self.nowMs
        do {
            superviseReply(try await client.superviseConfirm(SuperviseConfirmRequest(confirmId: p.confirmId,
                                                                                     cancel: cancel ? true : nil)),
                           sentAt: sentAt)
        } catch let e as ClientError where e.code == "stale" {
            _ = fail(e)
            chatMessages.append(ChatMessage(role: .assistant, text: t("supervise.expired")))
            chatReaction = .done
        } catch { turnFailed(error) }
    }

    /** Sends Escape to the agent through the server's `stop` route. */
    func stop(_ a: Agent) async {
        lastErrorCode = nil
        do {
            _ = try await client.stop(a.id)
            play(.send)
        } catch {
            play(.error)
            notice = fail(error)
        }
    }

    private static var nowMs: Double { Date().timeIntervalSince1970 * 1000 }

    private func superviseReply(_ r: SuperviseResponse, sentAt: Double) {
        chatConversationId = r.conversationId
        if !r.text.isEmpty { chatMessages.append(ChatMessage(role: .assistant, text: r.text)) }
        supervisePending = r.pending
        feed.watch(r, at: sentAt)
        let ok = Set(r.results.filter(\.ok).map(\.agentId))
        let names = r.targets.filter { ok.contains($0.agentId) }.map(\.name)
        if r.results.contains(where: { $0.error == "grant_in_terminal" }) {
            notice = t("supervise.answerInTerminal")
        } else if !names.isEmpty {
            notice = t("supervise.sentTo", ["names": names.joined(separator: ", ")])
        }
        chatReaction = .done
        play(r.results.contains { !$0.ok } ? .error : .pop)
    }

    private func beginTurn(_ text: String) -> String? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !chatBusy else { return nil }
        chatErrorReset?.cancel()
        chatMessages.append(ChatMessage(role: .user, text: t))
        chatBusy = true
        chatError = nil
        lastErrorCode = nil
        chatReaction = .thinking
        play(.send)
        return t
    }

    private func chatTurn(_ t: String) async {
        do {
            let ids = chatAttachments.map(\.uploadId)
            let r = try await client.chat(ChatRequest(cli: settings.chatCLI, text: t, conversationId: chatConversationId,
                                                      attachments: ids.isEmpty ? nil : ids))
            chatAttachments.removeAll { ids.contains($0.uploadId) }
            chatConversationId = r.conversationId ?? chatConversationId
            chatMessages.append(ChatMessage(role: .assistant, text: r.text ?? ""))
            chatReaction = .done
            play(.pop)
        } catch { turnFailed(error) }
    }

    private func turnFailed(_ error: Error) {
        _ = fail(error)
        chatError = Self.chatErrorText(error, cli: settings.chatCLI)
        chatReaction = .error
        play(.error)
        chatErrorReset = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(SessionBoard.errorFor * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.chatReaction = .done
            self?.chatError = nil
        }
    }

    /** Ends the conversation server-side (kills the CLI child) and clears local history. */
    func endChat() async {
        chatErrorReset?.cancel()
        let id = chatConversationId
        chatConversationId = nil
        chatMessages = []
        supervisePending = nil
        chatError = nil
        chatReaction = .done
        if let id { _ = try? await client.chatEnd(id) }
    }

    /** Switching CLI starts a fresh conversation. */
    func setChatCLI(_ cli: String) async {
        guard cli != settings.chatCLI else { return }
        await endChat()
        settings.chatCLI = cli
        play(.pop)
    }

    private static func chatErrorText(_ error: Error, cli: String) -> String {
        switch (error as? ClientError)?.code {
        case "signed_out": return t("error.cliNotSignedIn", ["cli": cli])
        case "timeout": return t("error.cliSlow", ["cli": cli])
        default: return error.localizedDescription
        }
    }

    func startMonitor() {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", #"cd "$CUCKOO_REPO" && { [ -f dist/index.js ] || npm run build; } && exec npm start"#]
        p.environment = ProcessInfo.processInfo.environment.merging(["CUCKOO_REPO": settings.repoPath]) { $1 }
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run(); notice = t("common.startingMonitor") } catch { notice = error.localizedDescription }
    }
}
