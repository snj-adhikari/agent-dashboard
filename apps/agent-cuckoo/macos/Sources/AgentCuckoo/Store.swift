import CuckooCore
import Foundation

@MainActor
final class Store: ObservableObject {
    @Published private(set) var groups: [PillGroup] = []
    @Published private(set) var pills: [Pill] = []
    @Published private(set) var queue = ApprovalQueue()
    @Published private(set) var replies: [Reply] = []
    @Published private(set) var usage: UsageWindow?
    @Published private(set) var clis: [CLIInfo] = []
    @Published private(set) var offline = true
    @Published var notice: String?

    let settings: Settings
    var onActivity: (() -> Void)?
    private let sounds = Sounds()
    private var hold = PillHold()
    private var lastStates: [String: AgentState] = [:]
    private var seenReplies = Set<String>()
    private var timer: Timer?
    private var ticks = 0
    private var inFlight = false

    init(settings: Settings) { self.settings = settings }

    var client: MonitorClient {
        MonitorClient(base: URL(string: settings.monitorURL) ?? URL(string: "http://127.0.0.1:5818")!,
                      tokenURL: settings.tokenURL)
    }

    var agents: [Agent] { groups.flatMap(\.agents) }
    var mains: [Agent] { agents.filter { $0.isMain && $0.canSend } }
    func agent(_ id: String) -> Agent? { agents.first { $0.id == id } }

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
                }
            } catch {
                offline = true
            }
        }
    }

    private func apply(_ s: CuckooState) {
        groups = Board.groups(s.agents)
        pills = hold.apply(agents, now: Date().timeIntervalSince1970)
        var cue: Cue?
        for a in s.agents where lastStates[a.id] != nil && lastStates[a.id] != a.state {
            if a.state == .waiting { cue = cue ?? .waiting }
            if a.state == .done, cue == nil { cue = .done }
        }
        let changed = cue != nil
        lastStates = Dictionary(s.agents.map { ($0.id, $0.state) }, uniquingKeysWith: { a, _ in a })
        if !queue.sync(s.approvals).isEmpty { cue = .approval }
        let fresh = s.replies.filter { !seenReplies.contains($0.id) }
        fresh.forEach { seenReplies.insert($0.id) }
        replies = Array((fresh.reversed() + replies).prefix(30))
        if let cue, settings.soundsOn { sounds.play(cue) }
        if changed || cue == .approval || !fresh.isEmpty { onActivity?() }
    }

    func say(_ text: String, to targets: [Agent]) async {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        var failed: [String] = []
        for a in targets {
            do { _ = try await client.post("say", SayRequest(agentId: a.id, text: t)) }
            catch { failed.append("\(a.codename ?? a.name): \(error.localizedDescription)") }
        }
        notice = failed.isEmpty ? "Sent to \(targets.count) agent(s)" : failed.joined(separator: "\n")
    }

    func answer(_ approval: Approval, _ decision: Decision) async {
        guard !approval.isCommitOrPush else {
            notice = "Answer commit/push in the terminal"
            return
        }
        do {
            _ = try await client.post("approve", ApproveRequest(id: approval.id, decision: decision))
            queue.remove(approval.id)
        } catch let e as ClientError where e.code == "stale" {
            notice = "The prompt changed, check the terminal"
            queue.remove(approval.id)
        } catch let e as ClientError where e.code == "grant_in_terminal" {
            notice = "Answer commit/push in the terminal"
        } catch {
            notice = error.localizedDescription
        }
        poll()
    }

    func focus(_ a: Agent) async {
        do {
            let r = try await client.post("focus", FocusRequest(agentId: a.id))
            if r.focused == false { notice = "Couldn't focus \(a.name)" }
        } catch { notice = error.localizedDescription }
    }

    func launch(cwd: String, prompt: String, cli: String) async {
        do {
            _ = try await client.post("launch", LaunchRequest(cwd: cwd, prompt: prompt, cli: cli))
            settings.recents = Recents.add(cwd, to: settings.recents,
                                           home: FileManager.default.homeDirectoryForCurrentUser.path)
            notice = "Launched \(cli)"
        } catch { notice = error.localizedDescription }
    }

    func startMonitor() {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", #"cd "$CUCKOO_REPO" && { [ -f dist/index.js ] || npm run build; } && exec npm start"#]
        p.environment = ProcessInfo.processInfo.environment.merging(["CUCKOO_REPO": settings.repoPath]) { $1 }
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run(); notice = "Starting agent-monitor…" } catch { notice = error.localizedDescription }
    }
}
