import CoreGraphics
import CuckooCore
import Foundation

var failures = 0
var passes = 0

func check(_ ok: Bool, _ name: String, line: Int = #line) {
    if ok { passes += 1 } else { failures += 1; print("FAIL [\(line)] \(name)") }
}

final class ManualScheduler: Scheduler {
    final class Job: Cancellable {
        let at: TimeInterval; let fire: () -> Void; var cancelled = false
        init(at: TimeInterval, fire: @escaping () -> Void) { self.at = at; self.fire = fire }
        func cancel() { cancelled = true }
    }
    var now: TimeInterval = 0
    var jobs: [Job] = []
    func schedule(after s: TimeInterval, _ fire: @escaping () -> Void) -> Cancellable {
        let j = Job(at: now + s, fire: fire); jobs.append(j); return j
    }
    func advance(_ s: TimeInterval) {
        let end = now + s
        while let j = jobs.filter({ !$0.cancelled && $0.at <= end }).min(by: { $0.at < $1.at }) {
            now = j.at; j.cancelled = true; j.fire()
        }
        now = end
    }
}

struct Fixture: Decodable {
    var state: CuckooState
    var usage: Usage
    var clis: [CLIInfo]
    var error: ActionResult
    var responses: [String: ActionResult]
}

struct SuperviseFixture: Decodable {
    struct Requests: Decodable { var supervise: SuperviseRequest; var superviseConfirm: SuperviseConfirmRequest; var stop: StopRequest }
    struct Responses: Decodable { var supervise: SuperviseResponse; var superviseConfirm: SuperviseResponse; var stop: StopResponse }
    var requests: Requests
    var responses: Responses
}

let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let fixtureURL = ProcessInfo.processInfo.environment["CUCKOO_FIXTURE"].map { URL(fileURLWithPath: $0) }
    ?? here.appendingPathComponent("../../../contract/fixture.json").standardized
do {
    let fx = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: fixtureURL))
    check(fx.state.v == 1, "state v1")
    check(fx.state.agents.count == 2, "two agents")
    check(fx.state.agents[0].isMain && fx.state.agents[0].codename == "eon", "main agent decoded")
    check(fx.state.agents[1].codename == nil && !fx.state.agents[1].canSend, "bare agent nulls")
    check(fx.state.approvals[0].options.count == 3, "approval options")
    check(fx.state.approvals[0].decisions == [.allow, .always, .deny], "3 options allow always")
    check(fx.state.replies[0].text == "done, PR #86 open", "reply text")
    check(fx.usage.claude?.fiveHour == 42, "usage five hour")
    check(fx.clis[0].signedIn == .unknown, "signedIn unknown")
    check(fx.error.error == "stale" && !fx.error.ok, "error envelope")
    check(fx.responses["approve"]?.sent == "1", "approve response")
    check(fx.responses["focus"]?.focused == true, "focus response")
    let bools = try JSONDecoder().decode([CLIInfo].self, from: Data(#"[{"cli":"a","path":"/x","version":null,"signedIn":true},{"cli":"b","path":"/y","signedIn":false}]"#.utf8))
    check(bools.map(\.signedIn) == [.yes, .no], "signedIn bools")
    let odd = try JSONDecoder().decode(Agent.self, from: Data(#"{"id":"x","name":"n","state":"zzz","host":"bare","space":"s","isMain":false,"canSend":false}"#.utf8))
    check(odd.state == .unknown, "unknown state string falls back")
    let main = fx.state.agents[0], bare = fx.state.agents[1]
    check(main.hostApp == "cmux" && main.pid == 4141 && main.sessionId == "5f0c1e2a-0000-4000-8000-000000000001"
          && main.lastActiveAt == 1763429990000 && main.canFocus == true, "fixtureDecodes agent new fields")
    check(bare.hostApp == nil && bare.pid == nil && bare.sessionId == nil && bare.lastActiveAt == nil
          && bare.canFocus == nil && bare.cli == "codex", "fixtureDecodes bare agent without new fields")
    check(fx.state.approvals.map(\.kind) == [.permission, .plan], "fixtureDecodes approval kind")
    check(fx.state.replies[0].kind == nil && fx.state.replies[1].kind == .ask && fx.state.replies[1].from == "hopper",
          "fixtureDecodes reply kind and from")
    check(fx.clis[1].chat == true && fx.clis[0].chat == nil, "fixtureDecodes cli chat")
    check(fx.responses["focus"]?.via == "cmux" && fx.responses["chat"]?.conversationId == "c-0001",
          "fixtureDecodes focus via and chat response")
    let oddApproval = try JSONDecoder().decode(Approval.self, from: Data(#"{"id":"a","agentId":"x","tool":"T","command":"","options":[],"receivedAt":0,"screenHash":"","kind":"teleport"}"#.utf8))
    check(oddApproval.kind == .permission, "fixtureDecodes unknown approval kind is permission")
    let oddReply = try JSONDecoder().decode(Reply.self, from: Data(#"{"id":"r","agentId":"x","text":"t","at":0,"kind":"shout"}"#.utf8))
    check(oddReply.kind == .reply, "fixtureDecodes unknown reply kind is reply")
    let sv = try JSONDecoder().decode(SuperviseFixture.self, from: Data(contentsOf: fixtureURL))
    check(sv.requests.supervise.text == "tell eon and hopper to run the checks" && sv.requests.supervise.conversationId == nil
          && sv.requests.supervise.cli == nil, "fixtureDecodes supervise request")
    check(sv.requests.superviseConfirm.confirmId == "k-0001" && sv.requests.superviseConfirm.cancel == false,
          "fixtureDecodes superviseConfirm request")
    check(sv.requests.stop.agentId == "herdr:main:w1:p2", "fixtureDecodes stop request")
    let pend = sv.responses.supervise
    check(pend.ok && pend.intent == "send" && pend.conversationId == "s-0001" && pend.targets.map(\.name) == ["eon", "hopper"]
          && pend.pending?.confirmId == "k-0001" && pend.pending?.expiresAt == 1763430120000 && pend.results.isEmpty,
          "fixtureDecodes supervise response pending")
    let done = sv.responses.superviseConfirm
    check(done.pending == nil && done.results.map(\.ok) == [true, false] && done.results[1].error == "stale"
          && done.results[0].error == nil, "fixtureDecodes superviseConfirm response results")
    check(sv.responses.stop.ok && sv.responses.stop.relayKey == "main-w1_p2", "fixtureDecodes stop response")
} catch {
    check(false, "fixture decode at \(fixtureURL.path): \(error)")
}

let notched = IslandGeometry(ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 1512, height: 982), safeAreaTop: 32,
                                           auxiliaryLeftWidth: 662, auxiliaryRightWidth: 662, menuBarHeight: 32))
check(notched.hasNotch, "notch detected")
check(notched.notchSize == CGSize(width: 188, height: 32), "notch size")
let flat = IslandGeometry(ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 1920, height: 1080)))
check(!flat.hasNotch && flat.notchSize == CGSize(width: 80, height: 24), "geometryNoNotchBar resting 80x24")
check(flat.size(for: .compact) == CGSize(width: 240, height: 24), "geometryNoNotchBar compact 240")
check(IslandGeometry(ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 1920, height: 1080), menuBarHeight: 22)).notchSize.height == 22,
      "geometryNoNotchBar height capped by menu bar")
check(IslandGeometry.panelSize == CGSize(width: 720, height: 520), "geometryPanel fixed 720x520 (island max)")
check(notched.panelFrame(on: CGRect(x: 0, y: 0, width: 1512, height: 982)) == CGRect(x: 396, y: 462, width: 720, height: 520),
      "geometryPanel top-centre")
check(notched.islandRect(for: .compact) == CGRect(x: 186, y: 488, width: 348, height: 32), "geometryPanel island inside panel")
check(notched.size(for: .compact) == CGSize(width: 188 + 160, height: 32), "geometryCompact notch+160")
check(notched.size(for: .home).width == 640 && flat.size(for: .home).width == 640, "geometryExpanded 640 wide")
check(notched.size(for: .home, view: .overview).height == 160, "geometryViewHeights overview 160")
check([IslandView.upload, .uploading, .choose].allSatisfy { $0.height == 176 }, "geometryViewHeights upload 176")
check(IslandView.mail.height == 240 && IslandView.whatsNew.height == 232 && IslandView.greeting.height == 150,
      "geometryViewHeights mail whatsNew greeting")
check(IslandView.question(picker: true).height == 200 && IslandView.question(picker: false).height == 160,
      "geometryViewHeights question picker")
check([0, 1, 2, 5].map { IslandView.chat(messages: $0).height } == [240, 280, 300, 300], "geometryChat min(300, 240+40n)")
check(IslandView.timer.height == 220 && IslandView.sessions.height == 260 && IslandView.mainAgents.height == 280
      && IslandView.settings.height == 300 && IslandView.wardrobe.height == 300 && IslandView.side.height == 160,
      "geometryViewHeights long views")
let allViews: [IslandView] = [.overview, .empty, .approval, .error, .finished, .confused, .settings, .launch, .sessions,
                              .mainAgents, .recap, .upload, .uploading, .choose, .mail, .whatsNew, .greeting, .listening,
                              .timer, .wardrobe, .side, .question(picker: true), .chat(messages: 9)]
check(allViews.allSatisfy { $0.height <= IslandGeometry.panelSize.height }, "geometryViewHeights within panel")
let tallNotch = IslandGeometry(ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 1512, height: 982), safeAreaTop: 38,
                                             auxiliaryLeftWidth: 662, auxiliaryRightWidth: 662))
check(notched.headerY == 40 && tallNotch.headerY == 46 && flat.headerY == 32, "geometryHeader y = notch + 8")
check(notched.cardHeight(for: .overview) == 76 && notched.cardHeight(for: .settings) == 216
      && tallNotch.cardHeight(for: .settings) == 210, "geometryCard height = view - notch - 52")
check(tallNotch.cardHeight(for: .wardrobe) >= 206 && tallNotch.cardHeight(for: .timer) >= 126,
      "geometryCard wardrobe 3 rows and timer buttons fit under a 38 pt notch")
check(allViews.allSatisfy { notched.headerY + IslandGeometry.headerHeight + notched.cardHeight(for: $0)
                            + IslandGeometry.shellBottom == $0.height }, "geometryShell header + card fill the island")
check(allViews.allSatisfy { tallNotch.cardHeight(for: $0) >= $0.minCardHeight }, "geometryCard fixed content fits under a 38 pt notch")
check(notched.size(for: .home, view: .overview).height == 160 && tallNotch.size(for: .home, view: .overview).height == 166
      && flat.size(for: .home, view: .overview).height == 160 && tallNotch.size(for: .home, view: .settings).height == 300,
      "geometryHome grows by notch - 32, other views fixed")
check([notched, tallNotch].allSatisfy { g in [IslandView.overview, .empty].allSatisfy { g.cardHeight(for: $0) >= 76 } },
      "geometryHome card holds its 76 pt content under 32 and 38 pt notches")
check(IslandView.recap.height == 240 && IslandView.launch.height == 224, "geometryViewHeights recap and launcher hold their whole card")
check(notched.cornerRadius(for: .hidden) == 14 && notched.cornerRadius(for: .compact) == 14
      && notched.cornerRadius(for: .home) == 22, "geometryCorners 14/22")
let f = flat.frame(for: .hidden, on: CGRect(x: 0, y: 0, width: 1920, height: 1080))
check(f == CGRect(x: 920, y: 1056, width: 80, height: 24), "hidden frame centred at top")
let second = flat.frame(for: .home, on: CGRect(x: 1920, y: 0, width: 1920, height: 1080))
check(second.midX == 1920 + 960 && second.maxY == 1080, "home frame on second screen")
check(DisplayResolver.index(preferredID: 7, screenIDs: [1, 7], notched: [true, false]) == 1, "preferred screen")
check(DisplayResolver.index(preferredID: 9, screenIDs: [1, 7], notched: [false, true]) == 1, "fallback to notched")
check(DisplayResolver.index(preferredID: nil, screenIDs: [1], notched: [false]) == 0, "fallback to first")

func fsmRig(_ setup: (IslandFSM) -> Void = { _ in }) -> (IslandFSM, ManualScheduler) {
    let s = ManualScheduler(); let m = IslandFSM(scheduler: s); setup(m); return (m, s)
}
do {
    let (m, s) = fsmRig()
    m.send(.hoverEnter)
    check(m.mode == .compact, "fsmHoverPeek hidden to compact")
    s.advance(500)
    check(m.mode == .compact, "fsmHoverPeek stays while hovering")
}
do {
    let (m, s) = fsmRig { $0.openOnHover = true }
    m.send(.hoverEnter)
    check(m.mode == .home && m.openedByHover, "fsmOpenOnHover opens home")
    m.send(.hoverExit); s.advance(0.59)
    check(m.mode == .home, "fsmOpenOnHover open within 0.6 s grace")
    s.advance(0.01)
    check(m.mode == .compact, "fsmOpenOnHover folds after 0.6 s grace")
}
do {
    let (m, s) = fsmRig { $0.openOnHover = true }
    m.send(.hoverEnter); m.send(.click); m.send(.hoverExit); s.advance(1)
    check(m.mode == .home && !m.openedByHover, "fsmClickConvertsHover click keeps it open")
    s.advance(14)
    check(m.mode == .compact, "fsmClickConvertsHover then auto-close 15 s")
}
do {
    let (m, s) = fsmRig { $0.openOnHover = true; $0.isHeldOpen = { true } }
    m.send(.hoverEnter)
    check(m.mode == .compact, "fsmOpenOnHover not while held")
    _ = s
}
do {
    let (m, _) = fsmRig()
    m.send(.click)
    check(m.mode == .home, "fsmClickOpens from hidden")
    let (c, _) = fsmRig(); c.send(.activity); c.send(.click)
    check(c.mode == .home, "fsmClickOpens from compact")
}
do {
    let (m, _) = fsmRig()
    m.send(.click); m.send(.close)
    check(m.mode == .compact, "fsmEscCollapses home to compact")
    m.send(.close)
    check(m.mode == .hidden, "fsmEscCollapses compact to hidden")
}
do {
    let (m, s) = fsmRig()
    m.send(.click); s.advance(14.9)
    check(m.mode == .home, "fsmAutoClose open before 15 s")
    s.advance(0.1)
    check(m.mode == .compact, "fsmAutoClose folds at 15 s")
    let (e, es) = fsmRig { $0.autoClose = 30 }
    e.send(.click); es.advance(29)
    check(e.mode == .home, "fsmAutoClose editable")
}
do {
    let (m, s) = fsmRig()
    m.send(.hoverEnter); m.send(.hoverExit); s.advance(179)
    check(m.mode == .compact, "fsmAbsenceHide compact before 180 s")
    s.advance(1)
    check(m.mode == .hidden, "fsmAbsenceHide hides at 180 s")
}
do {
    var held = true
    let (m, s) = fsmRig { $0.isHeldOpen = { held } }
    m.send(.alert); s.advance(100)
    check(m.mode == .home, "fsmHeldOpen approval keeps home")
    held = false; s.advance(15)
    check(m.mode == .compact, "fsmHeldOpen released folds")
}
do {
    let (m, s) = fsmRig()
    m.send(.hoverEnter); m.send(.finished); m.send(.hoverExit); s.advance(5.1)
    check(m.mode == .home, "fsmFinishedPins open for 5.2 s")
    s.advance(0.15)
    check(m.mode == .compact, "fsmFinishedPins folds after 5.2 s")
}
do {
    let (m, _) = fsmRig()
    m.send(.alert)
    check(m.mode == .home, "fsmAlertForceExpand from hidden")
    let (c, _) = fsmRig(); c.send(.activity); c.send(.alert)
    check(c.mode == .home, "fsmAlertForceExpand from compact")
}
do {
    let (m, s) = fsmRig()
    var transitions: [String] = []
    m.onTransition = { transitions.append("\($0.rawValue)>\($1.rawValue)") }
    m.send(.activity)
    check(m.mode == .compact, "fsmNonAlertRevealOnly reveals compact")
    m.send(.activity)
    check(m.mode == .compact, "fsmNonAlertRevealOnly never expands")
    s.advance(180)
    check(m.mode == .hidden && transitions == ["hidden>compact", "compact>hidden"], "fsmNonAlertRevealOnly hides after absence")
}

let agents = [
    Agent(id: "a", name: "zeta", state: .working, space: "B"),
    Agent(id: "b", name: "alpha", state: .done, space: "C", isMain: true),
    Agent(id: "c", name: "beta", state: .waiting, space: "A"),
    Agent(id: "d", name: "alpha", state: .done, space: "B")
]
let groups = Board.groups(agents)
check(groups.map(\.space) == ["C", "A", "B"], "spaces with mains lead: \(groups.map(\.space))")
check(groups[2].agents.map(\.id) == ["d", "a"], "names sorted within space")
var hold = PillHold()
_ = hold.apply(agents, now: 0)
var later = agents
later[0].state = .done
check(hold.apply(later, now: 2).first { $0.id == "a" }?.shown == .working, "drop to lower rank held")
check(hold.apply(later, now: 6.5).first { $0.id == "a" }?.shown == .done, "drop after 6 s")
later[0].state = .waiting
check(hold.apply(later, now: 7).first { $0.id == "a" }?.shown == .waiting, "raise is immediate")
let top = Board.compact(hold.apply(later, now: 8), limit: 2)
check(top.map(\.id) == ["c", "a"], "compact ranks waiting first: \(top.map(\.id))")

check(UsageColour(percent: 49) == .green && UsageColour(percent: 50) == .amber, "green/amber edge")
check(UsageColour(percent: 79) == .amber && UsageColour(percent: 80) == .red, "amber/red edge")
check(UsageColour(percent: nil) == .unknown, "nil unknown")
check(UsageColour(window: UsageWindow(fiveHour: 10, sevenDay: 85, resetsAt: nil, stale: false)) == .red, "worst window")
check(UsageColour(window: UsageWindow(fiveHour: 10, sevenDay: 10, resetsAt: nil, stale: true)) == .unknown, "stale unknown")

var q = ApprovalQueue()
let ap = (0..<7).map { Approval(id: "p\($0)", agentId: "x", receivedAt: Double(10 - $0)) }
let added = q.sync(ap)
check(q.items.count == 5 && added.count == 5, "cap 5")
check(q.head?.id == "p6", "oldest first")
q.sync(Array(ap.dropLast()))
check(q.head?.id == "p5" && q.items.count == 5, "answered elsewhere removed, refilled")
q.remove("p5")
check(q.head?.id == "p4", "remove by id")
check(q.sync(Array(ap.dropLast())).count == 1, "re-sync adds only new")
let two = Approval(id: "t", agentId: "x", options: [ApprovalOption(key: "1", label: "Yes"), ApprovalOption(key: "2", label: "No")], receivedAt: 0)
check(two.decisions == [.allow, .deny], "2 options no always")
check(Approval(id: "g", agentId: "x", command: "git  push origin x", receivedAt: 0).isCommitOrPush, "git push flagged")
check(!Approval(id: "g", agentId: "x", command: "git status", receivedAt: 0).isCommitOrPush, "git status not flagged")

check(AgentState.allCases.map(StateEmoji.name) == ["working", "waiting", "done", "thinking"], "state emoji map")
check(StateEmoji.offline == "sleeping", "offline emoji")
check(Recents.add("/home/u", to: ["/a"], home: "/home/u") == ["/a"], "drop home")
check(Recents.add("/", to: [], home: "/h") == [], "drop root")
check(Recents.add("/a", to: ["/b", "/a"], home: "/h") == ["/a", "/b"], "dedupe to front")
check(Recents.add("/n", to: (0..<10).map { "/\($0)" }, home: "/h").count == 10, "max 10")

func sa(_ id: String, _ state: AgentState, cli: String = "claude", active: Double? = nil, main: Bool = false) -> Agent {
    Agent(id: id, name: id, state: state, space: "S", isMain: main, cli: cli, lastActiveAt: active.map { Int64($0 * 1000) })
}
do {
    var b = SessionBoard()
    let p = b.update([sa("a", .working, active: 90), sa("b", .working, active: 99), sa("c", .waiting, cli: "codex")], now: 100)
    check(p.map(\.key) == ["claude", "codex"] && p[0].shown.id == "b" && p[0].sessions.count == 2, "boardUrgent one pill per cli, last active shown")
    let w = b.update([sa("a", .waiting, active: 90), sa("b", .working, active: 99), sa("c", .waiting, cli: "codex")], now: 101)
    check(w[0].shown.id == "a" && w[0].urgency == 3, "boardUrgent waiting takes over at once")
}
do {
    var b = SessionBoard()
    _ = b.update([sa("a", .working, active: 99), sa("b", .working, active: 90)], now: 100)
    let p = b.update([sa("a", .working, active: 99), sa("b", .working, active: 104)], now: 105)
    check(p[0].shown.id == "a", "boardHold equal urgency held under 6 s")
    let q = b.update([sa("a", .working, active: 99), sa("b", .working, active: 104)], now: 106)
    check(q[0].shown.id == "b", "boardHold swaps after 6 s")
}
do {
    var b = SessionBoard()
    _ = b.update([sa("a", .working)], now: 0)
    check(b.update([sa("a", .done)], now: 1)[0].urgency == 1, "boardFinished shows as finished")
    check(b.update([sa("a", .done)], now: 6.1)[0].urgency == 1, "boardFinished still at 5.1 s")
    check(b.update([sa("a", .done)], now: 6.3)[0].urgency == 0, "boardFinished ends after 5.2 s")
    var c = SessionBoard()
    _ = c.update([sa("x", .done)], now: 0)
    check(c.update([sa("x", .done)], now: 1)[0].urgency == 0, "boardFinished not on first sight")
}
do {
    var b = SessionBoard()
    _ = b.update([sa("a", .working), sa("b", .working, active: 50)], now: 0)
    let e = b.update([sa("a", .unknown), sa("b", .working, active: 50)], now: 7)
    check(e[0].shown.id == "a" && e[0].urgency == 2, "boardError working to unknown shown")
    check(b.update([sa("a", .unknown), sa("b", .working, active: 50)], now: 36.9)[0].urgency == 2, "boardError still at 29.9 s")
    check(b.update([sa("a", .unknown), sa("b", .working, active: 50)], now: 37.1)[0].shown.id == "b", "boardError ends after 30 s")
}
do {
    var b = SessionBoard()
    _ = b.update([sa("a", .waiting, active: 1), sa("b", .working, active: 2)], now: 10)
    let p = b.update([sa("a", .waiting, active: 1), sa("b", .waiting, active: 2)], now: 11)
    check(p.map(\.key) == ["claude", "claude#2"] && p[1].shown.id == "b" && p[0].sessions.map(\.id) == ["a"],
          "boardPopOut waiting sibling pops out")
    let q = b.update([sa("a", .waiting, active: 1), sa("b", .working, active: 2)], now: 12)
    check(q.count == 2, "boardPopOut stays out 3 s")
    let r = b.update([sa("a", .waiting, active: 1), sa("b", .working, active: 2)], now: 14.1)
    check(r.count == 1 && r[0].sessions.count == 2, "boardPopOut folds back after answer")
}
do {
    var b = SessionBoard()
    let p = b.update([sa("a", .working, active: 0), sa("b", .working, active: 4000)], now: 4000)
    check(p[0].sessions.map(\.id) == ["b"], "boardQuiet siblings over 30 min ignored")
}
do {
    func bp(_ k: String, _ u: Int) -> BoardPill { BoardPill(key: k, shown: sa(k, u == 3 ? .waiting : .working), sessions: [], urgency: u) }
    let five = [bp("a", 0), bp("b", 0), bp("c", 0), bp("d", 0), bp("e", 3)]
    let keys = SessionBoard.slots(five).compactMap { if case .pill(let p) = $0 { return p.key }; return nil }
    check(keys == ["a", "b", "c", "e"], "boardWaitingPromoted into a place: \(keys)")
    let six = (0..<6).map { bp("w\($0)", 3) }
    let slots = SessionBoard.slots(six)
    check(slots.count == 4 && slots[3] == .waiting(count: 3, first: "w3"), "boardWaitingStack +N beyond 4")
    check(SessionBoard.slots(Array(five.prefix(3))).count == 3, "boardSlots under places unchanged")
}
do {
    var b = SessionBoard()
    let keys = b.update([sa("o", .working, cli: "opencode"), sa("z", .working, cli: "zed"), sa("x", .working, cli: "codex"),
                         sa("c", .working)], now: 0).map(\.key)
    check(keys == ["claude", "codex", "opencode", "zed"], "boardOrder catalogue then others: \(keys)")
}

check(Reaction.of(sa("a", .working, active: 95), now: 100) == .working, "reactionWorking")
check(Reaction.of(sa("a", .working, active: 85), now: 100) == .thinking, "reactionThinking quiet 10 s")
check(Reaction.of(sa("a", .waiting, active: 0), now: 100) == .waiting, "reactionWaiting")
check(Reaction.of(sa("a", .done, active: 97), now: 100) == .celebrating, "reactionCelebrating just finished")
check(Reaction.of(sa("a", .done, active: 50), now: 100) == .done, "reactionDone")
check(Reaction.of(sa("a", .done, active: 0), now: 200) == .sleeping, "reactionSleeping idle 120 s")
check(Reaction.of(sa("a", .unknown), now: 100) == .sleeping, "reactionSleeping unknown")
check(Reaction.of(sa("a", .working), now: 100, offline: true) == .sleeping, "reactionSleeping offline")
check(Reaction.of(sa("a", .unknown), now: 100, failed: true) == .error, "reactionError failed turn")
check(Reaction.of(sa("a", .done), now: 100) == .done, "reactionDone without lastActiveAt")
check(Reaction.allCases.map(\.pose) == ["cuckoo-working", "cuckoo-thinking", "cuckoo-waiting", "cuckoo-happy",
      "cuckoo-alarmed", "cuckoo-sleepy", "cuckoo-celebrate"], "reactionPose map")
check(Reaction.allCases.map(\.emoji) == ["working", "thinking", "waiting", "done", "error", "sleeping", "celebrating"],
      "reactionEmoji matches emoji.lock names")

check(Greeting.text(hour: 5) == "Good morning!" && Greeting.text(hour: 11) == "Good morning!", "greetingMorning 5-11")
check(Greeting.text(hour: 12) == "Good afternoon!" && Greeting.text(hour: 16) == "Good afternoon!", "greetingAfternoon 12-16")
check(Greeting.text(hour: 17) == "Good evening!" && Greeting.text(hour: 20) == "Good evening!", "greetingEvening 17-20")
check(Greeting.text(hour: 21) == "Up late?" && Greeting.text(hour: 4) == "Up late?", "greetingNight 21-4")
check(Greeting.text(hour: nil) == "Hello!" && Greeting.text(hour: 24) == "Hello!", "greetingFallback")
var utc = Calendar(identifier: .gregorian); utc.timeZone = TimeZone(identifier: "UTC")!
check(Greeting.text(at: Date(timeIntervalSince1970: 9 * 3600), calendar: utc) == "Good morning!", "greetingFromDate")

let std = Motion.current(reduceMotion: false), red = Motion.current(reduceMotion: true)
check(std.open == .spring(response: 0.5, damping: 0.72), "motionOpen spring 0.5/0.72")
check(std.close == .bezier(x1: 0.45, y1: 0, x2: 0.2, y2: 1, duration: 0.34), "motionClose curve 0.34 s")
check(std.fadeOut == 0.16 && std.fadeIn == 0.3 && std.fadeInDelay == 0.16 && std.fadeOutScale == 0.97 && std.fadeOutBlur == 8,
      "motionFade 160/300 ms")
check(std.stagger(0) == 0 && abs(std.stagger(2) - 0.07) < 1e-9, "motionStagger 35 ms")
check(std.pose == .easeInOut(duration: 0.4), "motionPose eased 0.4 s")
check([red.open, red.close, red.pose].allSatisfy { $0 == .crossFade(duration: 0.2) }, "motionReduced cross-fade only")
check(red.stagger(3) == 0 && red.bobAmplitude == 0 && red.fadeOutScale == 1 && red.fadeOutBlur == 0 && red.fadeInDelay == 0,
      "motionReduced no stagger, frozen bob, no scale or blur")

do {
    let (m, s) = fsmRig()
    var seen: [Bool] = []; m.onListening = { seen.append($0) }
    m.send(.voiceWoke)
    check(m.listening && m.mode == .compact && seen == [true], "fsmListening wake from hidden shows compact")
    s.advance(600)
    check(m.listening && m.mode == .compact, "fsmListening timers paused")
    m.send(.hoverEnter); m.send(.hoverExit)
    check(m.listening && m.mode == .compact, "fsmListening hover without open-on-hover and leave are no-ops")
    m.send(.voiceFinished)
    check(!m.listening && m.mode == .compact && seen == [true, false], "fsmListening finish from compact to compact")
}
do {
    let (m, _) = fsmRig(); m.send(.click); m.send(.voiceWoke)
    check(m.listening && m.mode == .home, "fsmListening wake from home")
    m.send(.voiceFinished)
    check(!m.listening && m.mode == .home, "fsmListening finish returns home")
    m.send(.voiceFinished)
    check(m.mode == .home, "fsmListening finish ignored when not listening")
}
do {
    let (m, _) = fsmRig(); m.send(.voiceWoke); m.send(.click)
    check(!m.listening && m.mode == .home, "fsmListening click opens home")
    let (h, _) = fsmRig { $0.openOnHover = true }; h.send(.voiceWoke); h.send(.hoverEnter)
    check(!h.listening && h.mode == .home && h.openedByHover, "fsmListening hover opens with open-on-hover")
    let (c, _) = fsmRig(); c.send(.click); c.send(.voiceWoke); c.send(.close)
    check(!c.listening && c.mode == .compact, "fsmListening close folds to compact")
    let (a, _) = fsmRig(); a.send(.voiceWoke); a.send(.alert)
    check(!a.listening && a.mode == .home, "fsmListening alert wins")
}
check(Blink.next(listening: true, random: 0) == 3.0 && Blink.next(listening: true, random: 1) == 4.5, "blinkListening 3.0-4.5 s")
check(Blink.next(listening: false, random: 0) == 2.2 && abs(Blink.next(listening: false, random: 1) - 5.4) < 1e-9, "blinkNormal 2.2-5.4 s")
check(Blink.next(first: true, listening: false, random: 0.5) == 2.5, "blinkFirst 1.5-3.5 s")
check(Blink.isDouble(random: 0.21) && !Blink.isDouble(random: 0.22), "blinkDouble 22%")

check(Dance.pose(playing: false, reduceMotion: false, elapsed: 1) == nil, "reactionDance off when not playing")
check(Dance.pose(playing: true, reduceMotion: false, elapsed: 0) == "cuckoo-dance-a"
      && Dance.pose(playing: true, reduceMotion: false, elapsed: 0.45) == "cuckoo-dance-b"
      && Dance.pose(playing: true, reduceMotion: false, elapsed: 0.85) == "cuckoo-dance-a", "reactionDance 2-frame loop 0.4 s")
check(Dance.pose(playing: true, reduceMotion: true, elapsed: 0.45) == "cuckoo-dance-a", "reactionDance frozen under Reduce Motion")

do {
    var t = CuckooTimer()
    check(t.remaining(now: 0) == 1500 && !t.running, "timerDefaults 25 min stopped")
    t.start(now: 100)
    check(t.remaining(now: 700) == 900, "timerCountdown")
    t.pause(now: 700); check(t.remaining(now: 5000) == 900 && !t.running, "timerPause holds")
    t.start(now: 5000); check(t.advance(now: 5899) == nil, "timerNotYet")
    check(t.advance(now: 5900) == .focus && t.phase == .shortBreak && t.remaining(now: 0) == 300, "timerShortBreak 5 min")
    var phases: [CuckooTimer.Phase] = []
    var now: TimeInterval = 6000
    for _ in 0..<6 { t.start(now: now); now += 2000; _ = t.advance(now: now); phases.append(t.phase) }
    check(phases == [.focus, .shortBreak, .focus, .shortBreak, .focus, .longBreak], "timerLongBreak every 4: \(phases)")
    check(t.remaining(now: 0) == 900, "timerLongBreak 15 min")
    var u = CuckooTimer(); u.start(now: 0)
    let saved = try! JSONEncoder().encode(u)
    var back = try! JSONDecoder().decode(CuckooTimer.self, from: saved)
    check(back.remaining(now: 60) == 1440 && back.advance(now: 1600) == .focus, "timerSurvivesRestart")
    back.reset(); check(back == CuckooTimer(), "timerReset")
}

var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Australia/Sydney")!
func day(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12) -> Date { cal.date(from: DateComponents(year: y, month: m, day: d, hour: h))! }
func season(_ y: Int, _ m: Int, _ d: Int, south: Bool = false) -> Outfit { Outfit.seasonal(on: day(y, m, d), calendar: cal, southern: south) }
check(Outfit.allCases.count == 12 && Outfit.allCases.allSatisfy { $0.asset.hasPrefix("outfit-") }, "outfitIds 12 with assets")
check(FileManager.default.fileExists(atPath: here.appendingPathComponent("../../../assets/mascot/outfit-santa-hat.png").standardized.path)
      && Outfit.allCases.allSatisfy { FileManager.default.fileExists(atPath: here.appendingPathComponent("../../../assets/mascot/\($0.asset).png").standardized.path) },
      "outfitAssets exist")
check(season(2026, 10, 1) == .witchHat && season(2026, 11, 1) == .witchHat && season(2026, 11, 2) == .none, "outfitSeason witch hat 1 Oct-1 Nov")
check(season(2026, 12, 1) == .santaHat && season(2026, 12, 26) == .santaHat && season(2026, 12, 27) == .none, "outfitSeason Santa 1-26 Dec")
check(season(2026, 12, 31) == .partyHat && season(2027, 1, 2) == .partyHat && season(2027, 1, 3) == .none, "outfitSeason party 31 Dec-2 Jan")
check(season(2026, 4, 3) == .bunnyEars && season(2026, 4, 6) == .bunnyEars && season(2026, 4, 7) == .none && season(2026, 4, 2) == .none,
      "outfitSeason bunny ears Easter 2026 (5 Apr)")
check(Outfit.easterSunday(year: 2027, calendar: cal) == cal.date(from: DateComponents(year: 2027, month: 3, day: 28)), "outfitSeason Easter 2027")
check(season(2026, 6, 21) == .sunglasses && season(2026, 8, 31) == .sunglasses && season(2026, 6, 20) == .none, "outfitSeason north summer")
check(season(2026, 7, 1, south: true) == .none && season(2026, 12, 27, south: true) == .sunglasses
      && season(2027, 2, 28, south: true) == .sunglasses && season(2027, 3, 1, south: true) == .none, "outfitSeason south summer Dec-Feb")
check(season(2026, 12, 10, south: true) == .santaHat && season(2027, 1, 1, south: true) == .partyHat, "outfitSeason holidays beat summer")
check(Outfit.resolve("crown", on: day(2026, 12, 10), calendar: cal, southern: true) == .crown
      && Outfit.resolve("auto", on: day(2026, 10, 5), calendar: cal, southern: true) == .witchHat
      && Outfit.resolve("zzz", on: day(2026, 10, 5), calendar: cal, southern: true) == .none, "outfitResolve auto and fixed")
check(Outfit.presenceTween == 0.35 && Outfit.headBox == CGRect(x: 24, y: 0, width: 80, height: 72) && Outfit.eyeY == 60, "outfitConstants")

do {
    var d = DesktopMascotLogic(now: 0)
    check(d.poke(now: 0) == .annoyed && d.poke(now: 1) == .annoyed && d.poke(now: 1.8) == .annoyed, "desktopPoke spread out stays annoyed")
    check(d.poke(now: 2.5) == .dizzy && d.isDizzy(now: 5.7) && !d.isDizzy(now: 5.8), "desktopPokeDizzy 3 in 1.7 s for 3.3 s")
    check(d.poke(now: 3) == .ignored, "desktopPoke ignored while dizzy")
    check(d.poke(now: 6) == .annoyed, "desktopPoke counts restart after dizzy")
}
do {
    var d = DesktopMascotLogic(now: 0)
    check(d.update(alertPending: true, now: 1) == .toIsland && d.atIsland, "desktopReturn flies to island on alert")
    check(d.update(alertPending: true, now: 2) == .stay, "desktopReturn stays while waiting")
    check(d.update(alertPending: false, now: 3) == .stay && d.update(alertPending: false, now: 3.5) == .stay, "desktopReturn waits 0.6 s")
    check(d.update(alertPending: true, now: 3.55) == .stay && d.update(alertPending: false, now: 3.6) == .stay
          && d.update(alertPending: false, now: 4.1) == .stay, "desktopReturn new alert restarts delay")
    check(d.update(alertPending: false, now: 4.2) == .toDesktop && !d.atIsland, "desktopReturn back after 0.6 s clear")
    check(d.update(alertPending: false, now: 9) == .stay, "desktopReturn idle on desktop")
}
do {
    let d = DesktopMascotLogic(now: 0)
    check(d.fps(now: 119, pointerDistance: 500) == 30 && d.fps(now: 120, pointerDistance: 500) == 10
          && d.fps(now: 200, pointerDistance: 100) == 30, "desktopSleep 10 fps after 120 s, pointer wakes")
    let v = CGRect(x: 0, y: 0, width: 1000, height: 800)
    check(DesktopMascotLogic.restore(CGPoint(x: 5000, y: -50), visible: v) == CGPoint(x: 880, y: 0)
          && DesktopMascotLogic.restore(nil, visible: v) == CGPoint(x: 880, y: 0)
          && DesktopMascotLogic.restore(CGPoint(x: 300, y: 300), visible: v) == CGPoint(x: 300, y: 300), "desktopPosition restore clamps")
}

check(!RecapGate.due(now: day(2026, 11, 16, 7), lastShown: day(2026, 11, 9, 9), calendar: cal), "recapGate not before Monday 08:00")
check(RecapGate.due(now: day(2026, 11, 16, 8), lastShown: day(2026, 11, 9, 9), calendar: cal), "recapGate Monday 08:00")
check(!RecapGate.due(now: day(2026, 11, 18), lastShown: day(2026, 11, 16, 8), calendar: cal), "recapGate once per week")
check(RecapGate.due(now: day(2026, 11, 18), lastShown: day(2026, 11, 13), calendar: cal), "recapGate missed Monday shows later that week")
check(RecapGate.due(now: day(2026, 11, 22), lastShown: nil, calendar: cal)
      && RecapGate.latestSlot(atOrBefore: day(2026, 11, 22), calendar: cal) == day(2026, 11, 16, 8), "recapGate Sunday maps to last Monday")

check(WhatsNewGate.shouldOffer(current: "1.2", lastSeen: "1.1") && !WhatsNewGate.shouldOffer(current: "1.2", lastSeen: "1.2")
      && !WhatsNewGate.shouldOffer(current: "1.2", lastSeen: nil), "whatsNewGate version-keyed")
do {
    var g = WhatsNewGate()
    check(g.attempt(idle: true) == .show, "whatsNewGate shows when idle")
    var b = WhatsNewGate()
    let steps = (0..<13).map { _ in b.attempt(idle: false) }
    check(steps.prefix(12).allSatisfy { $0 == .retry(after: 15) } && steps[12] == .giveUp, "whatsNewGate retry 15 s x12 then give up")
    check(WhatsNewGate.firstDelay == 4 && WhatsNewGate.pose == "cuckoo-proud", "whatsNewGate 4 s proud")
}

do {
    let u = UploadTimeline(random: 0)
    check(u.uploadFor == 1.2 && UploadTimeline(random: 1).uploadFor == 2.1, "uploadTimeline length 1.2-2.1 s")
    check(u.phase(at: 0.1, uploaded: false) == .morph && u.phase(at: 0.5, uploaded: false) == .swallow, "uploadTimeline morph 380 then swallow 360")
    if case .uploading(let p) = u.phase(at: 0.74 + 0.6, uploaded: true) { check(abs(p - 0.5) < 1e-9, "uploadTimeline progress") } else { check(false, "uploadTimeline progress") }
    check(u.phase(at: 5, uploaded: false) == .uploading(1) && u.phase(at: 5, uploaded: true) == .choose, "uploadTimeline choose after upload")
    check(u.cues(from: 0, to: 0.70) == [] && u.cues(from: 0.70, to: 0.72) == [.gulp], "uploadTimeline gulp at 330 ms into swallow")
    check(u.cues(from: 0.72, to: u.total) == (1...10).map { .tick($0) }, "uploadTimeline tick per 10%")
}
check(IslandView.upload.height == 176 && IslandView.uploading.height == 176 && IslandView.choose.height == 176
      && IslandGeometry(ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 1512, height: 982))).islandRect(for: .home, view: .upload).height == 176,
      "geometryUpload height 176")

do {
    let avail: Set = ["en", "de", "pt-BR", "zh-Hans", "zh-Hant"]
    check(Strings.resolve(override: "de", system: ["zh-Hans-CN"], available: avail) == "de", "stringsFallback override wins")
    check(Strings.resolve(override: nil, system: ["fr-FR", "zh-Hant-TW"], available: avail) == "zh-Hant", "stringsFallback next system locale")
    check(Strings.resolve(override: nil, system: ["de-AT"], available: avail) == "de"
          && Strings.resolve(override: nil, system: ["pt-PT"], available: avail) == "pt-BR"
          && Strings.resolve(override: nil, system: ["zh-TW"], available: avail) == "zh-Hant", "stringsFallback language prefix")
    check(Strings.resolve(override: "xx", system: ["fr"], available: avail) == nil, "stringsFallback none matches")
    let tables = ["en": ["a": "Hi {name}", "b": "Only en"], "de": ["a": "Hallo {name}"]]
    check(Strings.lookup("a", ["name": "Eon"], tables: tables, locale: "de") == "Hallo Eon", "stringsFallback placeholder fill")
    check(Strings.lookup("b", [:], tables: tables, locale: "de") == "Only en", "stringsFallback missing key uses en")
    check(Strings.lookup("zz", [:], tables: tables, locale: "de") == "zz", "stringsFallback unknown key returns key")
    check(Strings.tables["en"]?["chat.placeholder"] == "Ask me anything...", "stringsFallback bundled en.json loads")
}

do {
    let chrome = notched.headerY + IslandGeometry.headerHeight + IslandGeometry.shellBottom
    check(notched.chrome == 84 && tallNotch.chrome == 90, "islandHeightFollowsContent chrome = notch + 8 + 34 + 10")
    check(notched.height(for: .fit(.approval, content: 300)) == chrome + 300, "islandHeightFollowsContent grows with a long ask")
    check(notched.cardHeight(for: .fit(.approval, content: 300)) == 300, "islandHeightFollowsContent card holds the whole content")
    check(notched.height(for: .fit(.approval, content: 20)) == IslandView.approval.height, "islandHeightFollowsContent short content keeps the base height")
    check(notched.height(for: .fit(.overview, content: 10)) == notched.height(for: .overview)
          && tallNotch.height(for: .fit(.overview, content: 10)) == 166, "islandHeightFollowsContent base keeps the notch allowance")
    check(notched.height(for: .fit(.approval, content: 2000)) == 520 && tallNotch.height(for: .fit(.approval, content: 2000)) == 520,
          "islandHeightFollowsContent capped at 520 pt")
    check(notched.cardHeight(for: .fit(.approval, content: 2000)) == 520 - chrome, "islandHeightFollowsContent card scrolls past the cap")
    check(notched.height(for: .fit(.approval, content: 100.2)) == chrome + 101, "islandHeightFollowsContent rounds up so nothing clips")
    check(notched.size(for: .home, view: .fit(.approval, content: 2000)).height <= IslandGeometry.panelSize.height,
          "islandHeightFollowsContent max fits the panel")
    check(notched.islandRect(for: .home, view: .fit(.approval, content: 300)).maxY == IslandGeometry.panelSize.height,
          "islandHeightFollowsContent grows downward, header y fixed")
    check(notched.height(for: .collapsed) == chrome && notched.cardHeight(for: .collapsed) == 0, "cardExpansion island collapsed = header row only")
    check(IslandView.fit(.recap, content: 0).minCardHeight == IslandView.recap.minCardHeight, "islandHeightFollowsContent keeps base min card")
}
do {
    var e = CardExpansion()
    check(!e.isExpanded("a"), "cardExpansion collapsed by default")
    e.toggle("a"); e.toggle("b")
    check(e.isExpanded("a") && e.isExpanded("b"), "cardExpansion toggle expands")
    e.toggle("b")
    check(e.isExpanded("a") && !e.isExpanded("b"), "cardExpansion toggle collapses, per card")
    e.prune(keeping: ["b", "c"])
    check(!e.isExpanded("a") && e.expanded.isEmpty, "cardExpansion cleared when the card disappears")
    e.toggle("c"); e.prune(keeping: ["c"])
    check(e.isExpanded("c"), "cardExpansion live card keeps its state")
    check(CardExpansion.lineCount("", charsPerLine: 10) == 1 && CardExpansion.lineCount(String(repeating: "x", count: 21), charsPerLine: 10) == 3,
          "cardExpansion line estimate wraps")
    check(CardExpansion.lineCount("a\nb\n\nc", charsPerLine: 10) == 4, "cardExpansion line estimate counts hard breaks")
    check(!CardExpansion.needsChevron("short question?", charsPerLine: 68), "cardExpansion no chevron for short text")
    check(CardExpansion.needsChevron(String(repeating: "word ", count: 50), charsPerLine: 68), "cardExpansion chevron past 3 lines")
    check(CardExpansion.needsChevron("a\nb\nc\nd", charsPerLine: 68) && !CardExpansion.needsChevron("a\nb\nc", charsPerLine: 68),
          "cardExpansion chevron counts newlines")
    let chips = CardExpansion.flow([CGSize(width: 60, height: 20), CGSize(width: 60, height: 20), CGSize(width: 60, height: 24)],
                                   width: 130, spacing: 4)
    check(chips.map(\.origin) == [CGPoint(x: 0, y: 0), CGPoint(x: 64, y: 0), CGPoint(x: 0, y: 24)], "cardExpansion chips wrap onto a new line")
    check(chips.allSatisfy { $0.maxX <= 130 }, "cardExpansion chips stay inside the card")
    let wide = CardExpansion.flow([CGSize(width: 10, height: 10), CGSize(width: 500, height: 30)], width: 200, spacing: 4)
    check(wide[1] == CGRect(x: 0, y: 14, width: 200, height: 30), "cardExpansion over-wide chip narrowed to the row")
}

do {
    func resp(_ json: String) -> SuperviseResponse { try! JSONDecoder().decode(SuperviseResponse.self, from: Data(json.utf8)) }
    func reply(_ id: String, _ agent: String, at: Double, kind: String? = nil, from: String? = nil) -> Reply {
        var o: [String: Any] = ["id": id, "agentId": agent, "text": "t-\(id)", "at": at]
        o["kind"] = kind
        o["from"] = from
        return try! JSONDecoder().decode(Reply.self, from: JSONSerialization.data(withJSONObject: o))
    }
    let pending = resp(#"{"ok":true,"conversationId":"s","intent":"send","text":"?","targets":[{"agentId":"a","name":"eon"},{"agentId":"b","name":"hopper"}],"pending":{"confirmId":"k","summary":"s","expiresAt":1},"results":[]}"#)
    let sent = resp(#"{"ok":true,"conversationId":"s","intent":"send","text":"ok","targets":[{"agentId":"a","name":"eon"},{"agentId":"b","name":"hopper"}],"pending":null,"results":[{"agentId":"a","ok":true,"error":null},{"agentId":"b","ok":false,"error":"stale"}]}"#)
    var feed = SuperviseFeed()
    feed.watch(pending, at: 100)
    check(feed.watches.isEmpty, "superviseFeed pending watches nothing until confirmed")
    feed.watch(sent, at: 100)
    check(Set(feed.watches.keys) == ["a"], "superviseFeed watches only targets sent ok")
    let batch = [reply("r3", "a", at: 300), reply("old", "a", at: 50), reply("x", "c", at: 200), reply("r2", "a", at: 100),
                 reply("q", "a", at: 250, kind: "ask", from: "hopper")]
    let got = feed.take(batch)
    check(got.map(\.id) == ["r2", "q", "r3"], "superviseFeed filters by target and since, oldest first")
    check(feed.take(batch).isEmpty, "superviseFeed dedupes across polls")
    check(got.map(\.ask) == [false, true, false], "superviseFeed ask vs reply")
    check(got[0].name == "eon" && got[1].name == "hopper", "superviseFeed tags agent name, ask uses from")
    check(feed.take([reply("r4", "b", at: 400)]).isEmpty, "superviseFeed failed target not streamed")
}

do {
    var g = GuideGate(seen: false)
    check(g.showing && g.isFirst && g.key == "tabs", "guideGate shown on first open at page one")
    check(GuideGate.pages.count >= 3 && GuideGate.pages.count <= 4, "guideGate 3-4 pages")
    g.back()
    check(g.page == 0, "guideGate back clamps at first page")
    g.next(); g.next(); g.next()
    check(g.isLast && g.key == "keys" && g.showing, "guideGate next walks to last page")
    g.next()
    check(g.seen && !g.showing, "guideGate done on last page marks seen")
    check(!GuideGate(seen: true).showing, "guideGate hidden once seen")
    var s = GuideGate(seen: false)
    s.next(); s.dismiss()
    check(s.seen && s.page == 0, "guideGate skip marks seen")
    s.reopen()
    check(s.showing && s.page == 0, "guideGate reopen from settings starts at page one")
    check(GuideGate.seenKey == "guideSeen", "guideGate UserDefaults key guideSeen")
}

do {
    let live = Agent(id: "a", name: "eon", state: .working, space: "s")
    let ro = Agent(id: "b", name: "ro", state: .working, space: "s", canSend: false)
    let ask = Approval(id: "p", agentId: "a", receivedAt: 0, kind: .question)
    let gitCmd = Approval(id: "q", agentId: "a", command: ["git", "commit", "-m", "x"].joined(separator: " "), receivedAt: 0)
    let idle = RowControls.of(live, pending: nil)
    check(idle.actions == [.reply, .continue, .stop] && idle.reason == nil, "rowControls no approve/deny without pending")
    let waiting = RowControls.of(live, pending: ask)
    check(waiting.actions == [.reply, .continue, .approve, .deny, .stop] && waiting.enabled(.approve) && waiting.enabled(.deny),
          "rowControls approve/deny while pending")
    let git = RowControls.of(live, pending: gitCmd)
    check(!git.enabled(.approve) && !git.enabled(.deny) && git.enabled(.reply) && git.reason == "row.answerInTerminal",
          "rowControls git commit answer in terminal")
    let readOnly = RowControls.of(ro, pending: ask)
    check(RowControls.Action.allCases.allSatisfy { !readOnly.enabled($0) } && readOnly.reason == "row.readOnly"
          && readOnly.actions.count == 5, "rowControls canSend false shows controls disabled with reason")
}

print("CuckooChecks: \(passes) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)
