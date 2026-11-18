import CuckooCore
import SwiftUI

extension Color {
    init(hex: String?) {
        let h = (hex ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard h.count == 6, let v = UInt32(h, radix: 16) else { self = .gray; return }
        self.init(red: Double(v >> 16 & 0xff) / 255, green: Double(v >> 8 & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }

    init(_ u: UsageColour) {
        switch u {
        case .green: self = .green
        case .amber: self = .orange
        case .red: self = .red
        case .unknown: self = .gray
        }
    }
}

extension AgentState {
    var symbol: String {
        switch self {
        case .working: return "circle.dotted"
        case .waiting: return "hand.raised.fill"
        case .done: return "checkmark.circle.fill"
        case .unknown: return "questionmark.circle"
        }
    }

    var tint: Color {
        switch self {
        case .working: return .blue
        case .waiting: return .orange
        case .done: return .green
        case .unknown: return .gray
        }
    }
}

struct IslandShape: Shape {
    var radius: CGFloat
    var animatableData: CGFloat { get { radius } set { radius = newValue } }

    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - radius))
        p.addQuadCurve(to: CGPoint(x: r.maxX - radius, y: r.maxY), control: CGPoint(x: r.maxX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX + radius, y: r.maxY))
        p.addQuadCurve(to: CGPoint(x: r.minX, y: r.maxY - radius), control: CGPoint(x: r.minX, y: r.maxY))
        p.closeSubpath()
        return p
    }
}

struct IslandRoot: View {
    @ObservedObject var store: Store
    let island: IslandController
    @ObservedObject var model: IslandModel

    var body: some View {
        ZStack(alignment: .top) {
            IslandShape(radius: model.mode == .home ? 22 : 10).fill(Color.black)
            switch model.mode {
            case .hidden: EmptyView()
            case .compact: CompactView(store: store, notch: model.notchSize.width).onTapGesture { island.open() }
            case .home: HomeView(store: store, island: island, model: model).padding(.top, model.notchSize.height)
            }
        }
        .foregroundColor(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .contentShape(Rectangle())
        .onTapGesture { if model.mode == .hidden { island.open() } }
    }
}

struct CompactView: View {
    @ObservedObject var store: Store
    let notch: CGFloat

    var body: some View {
        let top = Board.compact(store.pills, limit: 4)
        HStack(spacing: 0) {
            HStack(spacing: 4) {
                if store.offline { EmojiIcon(name: StateEmoji.offline, symbol: "wifi.slash", tint: .gray) }
                if store.queue.head != nil { Image(systemName: "exclamationmark.bubble.fill").foregroundColor(.orange) }
                ForEach(top.prefix(2)) { PillDot(pill: $0) }
            }.frame(maxWidth: .infinity, alignment: .trailing)
            Spacer().frame(width: notch)
            HStack(spacing: 4) {
                ForEach(top.dropFirst(2)) { PillDot(pill: $0) }
                UsageChip(window: store.usage)
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 10)
        .font(.system(size: 11, weight: .medium))
    }
}

struct PillDot: View {
    let pill: Pill
    var body: some View {
        EmojiIcon(name: StateEmoji.name(for: pill.shown), symbol: pill.shown.symbol, tint: pill.shown.tint)
            .overlay(Circle().stroke(Color(hex: pill.agent.colour), lineWidth: pill.agent.isMain ? 1.5 : 0).padding(-2))
            .help(pill.agent.label)
    }
}

struct UsageChip: View {
    let window: UsageWindow?
    var body: some View {
        let c = UsageColour(window: window)
        HStack(spacing: 2) {
            Image(systemName: "gauge.medium")
            Text(window?.fiveHour.map { "\($0)%" } ?? "–")
        }
        .foregroundColor(Color(c))
        .help("Claude usage: 5 h \(window?.fiveHour.map(String.init) ?? "unknown")%, 7 d \(window?.sevenDay.map(String.init) ?? "unknown")%")
    }
}

enum HomeTab: String, CaseIterable {
    case agents = "Agents", panel = "Super agent", launch = "Launch", settings = "Settings"
    var symbol: String {
        switch self {
        case .agents: return "rectangle.stack"
        case .panel: return "flag.fill"
        case .launch: return "play.circle"
        case .settings: return "gearshape"
        }
    }
}

struct HomeView: View {
    @ObservedObject var store: Store
    let island: IslandController
    @ObservedObject var model: IslandModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                ForEach(HomeTab.allCases, id: \.self) { t in
                    Button { model.tab = t; model.showAbout = false } label: { Label(t.rawValue, systemImage: t.symbol) }
                        .buttonStyle(.plain)
                        .opacity(model.tab == t ? 1 : 0.55)
                }
                Spacer()
                UsageChip(window: store.usage)
                Button { island.close() } label: { Image(systemName: "chevron.up") }.buttonStyle(.plain)
            }
            .font(.system(size: 12, weight: .semibold))
            if let head = store.queue.head {
                ApprovalCard(store: store, approval: head)
            }
            if store.offline { OfflineBanner(store: store) }
            Group {
                switch model.tab {
                case .agents: AgentsList(store: store)
                case .panel: SuperAgentPanel(store: store, model: model)
                case .launch: LauncherView(store: store, model: model)
                case .settings: SettingsView(settings: store.settings, model: model)
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            if let n = store.notice {
                Text(n).font(.caption).foregroundColor(.gray).lineLimit(2)
                    .onTapGesture { store.notice = nil }
            }
        }
        .padding(14)
    }
}

struct OfflineBanner: View {
    @ObservedObject var store: Store
    var body: some View {
        HStack {
            EmojiIcon(name: StateEmoji.offline, symbol: "wifi.slash", tint: .gray)
            Text("agent-monitor is offline")
            Spacer()
            Button("Start it") { store.startMonitor() }
        }
        .font(.caption)
        .padding(8)
        .background(Color.white.opacity(0.08))
        .cornerRadius(8)
    }
}

struct AgentsList: View {
    @ObservedObject var store: Store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if store.groups.isEmpty { Text("No agents found").foregroundColor(.gray) }
                ForEach(store.groups, id: \.space) { g in
                    Text(g.space.uppercased()).font(.system(size: 10, weight: .bold)).foregroundColor(.gray)
                    ForEach(g.agents) { AgentRow(store: store, agent: $0) }
                }
            }
        }
    }
}

struct AgentRow: View {
    @ObservedObject var store: Store
    let agent: Agent

    var body: some View {
        let shown = store.pills.first { $0.id == agent.id }?.shown ?? agent.state
        HStack(alignment: .top, spacing: 8) {
            EmojiIcon(name: StateEmoji.name(for: shown), symbol: shown.symbol, tint: shown.tint, size: 16)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Circle().fill(Color(hex: agent.colour)).frame(width: 7, height: 7)
                    Text(agent.label).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                    if agent.isMain {
                        Text("⚑ MAIN").font(.system(size: 9, weight: .heavy))
                            .padding(.horizontal, 4).background(Color.purple.opacity(0.6)).cornerRadius(3)
                    }
                    if !agent.canSend { Image(systemName: "eye").font(.system(size: 9)).foregroundColor(.gray).help("Read only") }
                }
                if let l = agent.lastLine { Text(l).font(.system(size: 10, design: .monospaced)).foregroundColor(.gray).lineLimit(1) }
            }
            Spacer()
            Button { Task { await store.focus(agent) } } label: { Image(systemName: "arrow.up.forward.app") }
                .buttonStyle(.plain).help("Jump to terminal")
        }
    }
}

struct ApprovalCard: View {
    @ObservedObject var store: Store
    let approval: Approval

    var body: some View {
        let who = store.agent(approval.agentId)?.label ?? approval.agentId
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: "exclamationmark.shield.fill").foregroundColor(.orange)
                Text("\(who) wants to run \(approval.tool)").font(.system(size: 12, weight: .semibold)).lineLimit(1)
                Spacer()
                if store.queue.items.count > 1 { Text("+\(store.queue.items.count - 1)").font(.caption).foregroundColor(.gray) }
            }
            Text(approval.command).font(.system(size: 11, design: .monospaced)).lineLimit(3)
            if approval.isCommitOrPush {
                Text("Answer commit/push in the terminal").font(.caption).foregroundColor(.orange)
            } else {
                HStack {
                    ForEach(approval.decisions, id: \.self) { d in
                        Button(title(d)) { Task { await store.answer(approval, d) } }
                    }
                }
            }
        }
        .padding(10)
        .background(Color.orange.opacity(0.15))
        .cornerRadius(10)
    }

    private func title(_ d: Decision) -> String {
        switch d {
        case .allow: return "Allow"
        case .always: return "Always"
        case .deny: return "Deny"
        }
    }
}

struct SuperAgentPanel: View {
    @ObservedObject var store: Store
    @ObservedObject var model: IslandModel
    @State private var target = "all"
    @State private var text = ""
    @State private var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("To", selection: $target) {
                Text("All mains (\(store.mains.count))").tag("all")
                ForEach(store.mains) { Text("⚑ \($0.label)").tag($0.id) }
            }
            HStack {
                TextField("Instruction for your main agents", text: $text, onEditingChanged: { model.typing = $0 })
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(send)
                Button(action: send) { Image(systemName: "paperplane.fill") }
                    .disabled(sending || store.mains.isEmpty || text.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            Text("Replies").font(.system(size: 10, weight: .bold)).foregroundColor(.gray)
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(store.replies) { r in
                        Text("\(r.codename ?? "agent") here: \(r.text)").font(.system(size: 11)).textSelection(.enabled)
                    }
                }
            }
        }
    }

    private func send() {
        let targets = target == "all" ? store.mains : store.mains.filter { $0.id == target }
        let t = text
        sending = true
        Task {
            await store.say(t, to: targets)
            text = ""
            sending = false
        }
    }
}

struct LauncherView: View {
    @ObservedObject var store: Store
    @ObservedObject var model: IslandModel
    @State private var folder = ""
    @State private var prompt = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Folder", text: $folder, onEditingChanged: { model.typing = $0 }).textFieldStyle(.roundedBorder)
                Menu("Recent") {
                    ForEach(store.settings.recents, id: \.self) { p in Button(p) { folder = p } }
                }.frame(width: 80)
            }
            Picker("CLI", selection: Binding(get: { store.settings.launchCLI }, set: { store.settings.launchCLI = $0 })) {
                ForEach(store.clis) { c in
                    Text("\(c.cli) \(c.version ?? "") · \(signed(c.signedIn))").tag(c.cli)
                }
            }
            HStack {
                TextField("Prompt", text: $prompt, onEditingChanged: { model.typing = $0 }).textFieldStyle(.roundedBorder)
                Button {
                    let f = folder, p = prompt, c = store.settings.launchCLI
                    Task { await store.launch(cwd: f, prompt: p, cli: c); prompt = "" }
                } label: { Image(systemName: "play.fill") }
                    .disabled(folder.isEmpty || store.clis.isEmpty)
            }
            if store.clis.isEmpty { Text("No agent CLIs found").font(.caption).foregroundColor(.gray) }
        }
        .onAppear { if folder.isEmpty { folder = store.settings.recents.first ?? "" } }
    }

    private func signed(_ s: SignedIn) -> String {
        switch s {
        case .yes: return "signed in"
        case .no: return "signed out"
        case .unknown: return "installed, login unknown"
        }
    }
}

struct SettingsView: View {
    @ObservedObject var settings: Settings
    @ObservedObject var model: IslandModel

    var body: some View {
        if model.showAbout {
            AboutView { model.showAbout = false }
        } else {
            Form {
                TextField("agent-monitor URL", text: $settings.monitorURL)
                TextField("agent-monitor folder", text: $settings.repoPath)
                Toggle("Sounds", isOn: $settings.soundsOn)
                HStack {
                    Button("About agent-cuckoo") { model.showAbout = true }
                    Button("Quit agent-cuckoo") { NSApp.terminate(nil) }
                }
            }
            .font(.system(size: 12))
        }
    }
}

struct AboutView: View {
    static let inspiredBy = URL(string: "https://github.com/Louis-CFM/coucou")!
    let back: () -> Void

    private var version: String {
        let info = Bundle.main.infoDictionary
        return info?["CFBundleShortVersionString"] as? String ?? "dev build"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "flag.fill").foregroundColor(.purple)
                Text("agent-cuckoo").font(.system(size: 15, weight: .bold))
                Text(version).font(.system(size: 12)).foregroundColor(.gray)
            }
            Text("by Snj - nightwalker").font(.system(size: 12))
            Button("Inspired by coucou") { NSWorkspace.shared.open(Self.inspiredBy) }
                .buttonStyle(.link)
            Button("Back", action: back).padding(.top, 6)
        }
    }
}

/** Bundled Fluent emoji by name, falling back to an SF Symbol when the build skipped the emoji fetch. */
struct EmojiIcon: View {
    private static var cache: [String: NSImage] = [:]
    let name: String
    let symbol: String
    let tint: Color
    var size: CGFloat = 14

    static func image(_ name: String) -> NSImage? {
        if let hit = cache[name] { return hit }
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("emoji/\(name).png"),
              let img = NSImage(contentsOf: url) else { return nil }
        cache[name] = img
        return img
    }

    var body: some View {
        if let img = Self.image(name) {
            Image(nsImage: img).resizable().interpolation(.high).frame(width: size, height: size)
        } else {
            Image(systemName: symbol).foregroundColor(tint)
        }
    }
}
