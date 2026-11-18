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
} catch {
    check(false, "fixture decode at \(fixtureURL.path): \(error)")
}

let notched = IslandGeometry(ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 1512, height: 982), safeAreaTop: 32,
                                           auxiliaryLeftWidth: 662, auxiliaryRightWidth: 662, menuBarHeight: 32))
check(notched.hasNotch, "notch detected")
check(notched.notchSize == CGSize(width: 188, height: 32), "notch size")
let flat = IslandGeometry(ScreenMetrics(frame: CGRect(x: 0, y: 0, width: 1920, height: 1080)))
check(!flat.hasNotch && flat.notchSize == CGSize(width: 80, height: 24), "no-notch fallback 80x24")
let f = flat.frame(for: .hidden, on: CGRect(x: 0, y: 0, width: 1920, height: 1080))
check(f == CGRect(x: 920, y: 1056, width: 80, height: 24), "hidden frame centred at top")
check(flat.size(for: .compact).width == 80 + 240, "compact wings")
let second = flat.frame(for: .home, on: CGRect(x: 1920, y: 0, width: 1920, height: 1080))
check(second.midX == 1920 + 960 && second.maxY == 1080, "home frame on second screen")
check(DisplayResolver.index(preferredID: 7, screenIDs: [1, 7], notched: [true, false]) == 1, "preferred screen")
check(DisplayResolver.index(preferredID: 9, screenIDs: [1, 7], notched: [false, true]) == 1, "fallback to notched")
check(DisplayResolver.index(preferredID: nil, screenIDs: [1], notched: [false]) == 0, "fallback to first")

let sched = ManualScheduler()
let fsm = IslandFSM(scheduler: sched)
var transitions: [String] = []
fsm.onTransition = { transitions.append("\($0.rawValue)>\($1.rawValue)") }
fsm.send(.activity)
check(fsm.mode == .compact, "activity opens compact")
sched.advance(14)
check(fsm.mode == .compact, "compact before 15 s")
sched.advance(1)
check(fsm.mode == .hidden, "compact hides at 15 s")
fsm.send(.click)
check(fsm.mode == .home, "click opens home")
sched.advance(179)
check(fsm.mode == .home, "home before 180 s")
sched.advance(1)
check(fsm.mode == .compact, "home collapses at 180 s")
fsm.send(.hoverEnter)
sched.advance(100)
check(fsm.mode == .compact, "hover keeps open")
fsm.send(.hoverExit)
var held = true
fsm.isHeldOpen = { held }
sched.advance(15)
check(fsm.mode == .compact, "held open survives timeout")
held = false
sched.advance(15)
check(fsm.mode == .hidden, "released hold hides")
check(transitions == ["hidden>compact", "compact>hidden", "hidden>home", "home>compact", "compact>hidden"], "transitions \(transitions)")

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

print("CuckooChecks: \(passes) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)
