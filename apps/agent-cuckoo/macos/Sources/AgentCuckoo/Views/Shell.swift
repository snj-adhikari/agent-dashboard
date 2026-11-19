import Carbon.HIToolbox
import Combine
import CuckooCore
import SwiftUI
import UniformTypeIdentifiers

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

enum HomeTab: String, CaseIterable {
    case agents = "home", chat, sessions, launch, panel = "mainAgents"
    case settings, drop
    case mail, messages, services, portfolio, music
    case timer, recap, whatsNew, wardrobe, notes

    var title: String { CuckooCore.t("tab.\(rawValue)") }

    static let header: [HomeTab] = [.agents, .chat, .sessions, .launch, .drop]
    /** Side cards reached from the header's more menu. */
    static let side: [HomeTab] = [.mail, .messages, .services, .portfolio, .music, .timer, .recap, .notes, .wardrobe, .whatsNew]

    var symbol: String {
        switch self {
        case .agents: return "house.fill"
        case .chat: return "bubble.left.fill"
        case .sessions: return "rectangle.stack"
        case .launch: return "terminal"
        case .panel: return "flag.fill"
        case .settings: return "gearshape"
        case .drop: return "plus"
        case .mail: return "envelope.fill"
        case .messages: return "message.fill"
        case .services: return "square.stack.3d.up.fill"
        case .portfolio: return "bitcoinsign.circle.fill"
        case .music: return "music.note"
        case .timer: return "timer"
        case .recap: return "chart.bar.fill"
        case .whatsNew: return "sparkles"
        case .wardrobe: return "tshirt.fill"
        case .notes: return "note.text"
        }
    }
}

/** The main mascot's mood, shared by the compact row and the desktop cuckoo. */
@MainActor
func mainMood(store: Store, board: BoardModel) -> Reaction {
    if store.offline { return .sleeping }
    if store.queue.head != nil { return .waiting }
    return board.top.map { board.reaction($0.shown, offline: false) } ?? .sleeping
}

/** Launch-time side features owned once by the island: voice wake, Notetaker, desktop cuckoo, drop flow, hotkeys, launch cards. */
@MainActor
final class SideRuntime: ObservableObject {
    enum DropStage: Equatable { case idle, uploading(URL), chosen(Dropped) }

    @Published var drop: DropStage = .idle
    @Published private(set) var listening = false
    let notetaker = Notetaker()
    private(set) var voice: VoiceWake!
    private var desktop: DesktopMascotController?
    private var island: IslandController?
    private var store: Store?
    private var recapLoop: Task<Void, Never>?
    private var bag = Set<AnyCancellable>()

    static let desktopToggle = HotKeys.Combo(keyCode: UInt32(kVK_ANSI_D), modifiers: UInt32(controlKey | optionKey))
    static let wardrobe = HotKeys.Combo(keyCode: UInt32(kVK_ANSI_G), modifiers: UInt32(controlKey | optionKey))

    init() {
        voice = VoiceWake(send: { [weak self] in self?.island?.fsm.send($0) },
                          onUtterance: { [weak self] in self?.utter($0) })
    }

    func start(store: Store, island: IslandController, board: BoardModel) {
        guard self.island == nil else { return }
        self.store = store
        self.island = island
        island.fsm.onListening = { [weak self] on in
            self?.listening = on
            if !on { self?.voice.cancelUtterance() }
        }
        desktop = DesktopMascotController(store: store) { [weak store, weak board] in
            guard let store, let board else { return .sleeping }
            return mainMood(store: store, board: board)
        }
        island.hotKeys.bind(.regionCapture) { [weak self] in self?.capture(.region) }
        island.hotKeys.bind(.fullCapture) { [weak self] in self?.capture(.fullScreen) }
        island.hotKeys.bind(Self.desktopToggle) {
            let d = UserDefaults.standard
            d.set(!d.bool(forKey: WardrobeKey.desktop), forKey: WardrobeKey.desktop)
        }
        island.hotKeys.bind(Self.wardrobe) { [weak self] in self?.show(.wardrobe) }
        island.hotKeys.bind(.openChat) { [weak self] in
            self?.store?.wantsChatFocus = true
            self?.show(.chat)
        }
        notetaker.$recording.removeDuplicates().dropFirst().sink { [weak self] on in
            if on { self?.voice.pause() } else { self?.voice.resume() }
        }.store(in: &bag)
        Task { await voice.sync() }
        Task { await WhatsNewLaunch.run(isIdle: { [weak self] in self?.idle ?? false },
                                        show: { [weak self] in self?.show(.whatsNew) }) }
        recapLoop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
                guard let self, let store = self.store else { return }
                if store.sideReady, self.idle, RecapWeek.due() {
                    RecapWeek.markShown()
                    self.show(.recap)
                }
            }
        }
    }

    /** Island closed, nothing waiting and not listening. */
    private var idle: Bool {
        guard let island, let store else { return false }
        return island.model.mode != .home && store.queue.head == nil && !listening
    }

    func show(_ tab: HomeTab) {
        guard let island else { return }
        island.model.tab = tab
        island.model.showAbout = false
        island.open()
    }

    func dropped(_ url: URL) {
        drop = .uploading(url)
        show(.drop)
    }

    private func capture(_ mode: Capture.Mode) {
        guard let store else { return }
        Task {
            guard let up = await Capture.take(mode, store: store) else { return }
            drop = .chosen(Dropped(path: nil, upload: up))
            show(.drop)
        }
    }

    private func utter(_ text: String) {
        guard let store else { return }
        island?.model.tab = .chat
        Task { await store.chat(text) }
    }
}

/** Session board plus a 1 s clock so time-based reactions (thinking, sleeping, finished, failed) refresh between polls. */
@MainActor
final class BoardModel: ObservableObject {
    @Published private(set) var pills: [BoardPill] = []
    @Published private(set) var now = Date().timeIntervalSince1970
    private var board = SessionBoard()
    private var timer: Timer?

    func start(_ agents: @escaping @MainActor () -> [Agent]) {
        guard timer == nil else { return }
        refresh(agents())
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh(agents()) }
        }
    }

    func refresh(_ agents: [Agent]) {
        now = Date().timeIntervalSince1970
        pills = board.update(agents, now: now)
    }

    func reaction(_ a: Agent, offline: Bool) -> Reaction {
        Reaction.of(a, now: now, offline: offline, failed: board.urgency(a, now: now) == 2)
    }

    /** Most urgent pill, ties to the first in board order. */
    var top: BoardPill? { pills.max { $0.urgency < $1.urgency } }
}

extension AnyTransition {
    static func content(_ m: Motion) -> AnyTransition {
        .asymmetric(
            insertion: .opacity.animation(.easeOut(duration: m.fadeIn).delay(m.fadeInDelay)),
            removal: .opacity.combined(with: .scale(scale: m.fadeOutScale)).animation(.easeIn(duration: m.fadeOut)))
    }
}

struct IslandRoot: View {
    @ObservedObject var store: Store
    let island: IslandController
    @ObservedObject var model: IslandModel
    @StateObject private var board = BoardModel()
    @StateObject private var side = SideRuntime()
    @ObservedObject private var cards = CardState.shared
    @AppStorage(IslandKey.collapsed) private var collapsed = false
    @AppStorage(GuideGate.seenKey) private var guideSeen = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(store: Store, island: IslandController, model: IslandModel) {
        _store = ObservedObject(wrappedValue: store)
        self.island = island
        _model = ObservedObject(wrappedValue: model)
    }

    var body: some View {
        let motion = Motion.current(reduceMotion: reduceMotion)
        let radius = model.mode == .home ? IslandGeometry.expandedRadius : IslandGeometry.restingRadius
        ZStack(alignment: .top) {
            IslandShape(radius: radius).fill(Color.black)
            switch model.mode {
            case .hidden: EmptyView()
            case .compact:
                CompactView(store: store, board: board, side: side, notch: model.notchSize.width)
                    .frame(height: model.notchSize.height)
                    .transition(.content(motion))
            case .home:
                ShellView(store: store, settings: store.settings, island: island, model: model, board: board, side: side)
                    .padding(.top, model.notchSize.height)
                    .transition(.content(motion))
            }
        }
        .frame(width: model.islandSize.width, height: model.islandSize.height, alignment: .top)
        .clipShape(IslandShape(radius: radius))
        .contentShape(IslandShape(radius: radius))
        .onTapGesture { if model.mode != .home { island.open() } }
        .onDrop(of: [.fileURL], isTargeted: nil) { providers in
            guard let p = providers.first else { return false }
            _ = p.loadObject(ofClass: URL.self) { url, _ in
                guard let url, url.isFileURL else { return }
                DispatchQueue.main.async { side.dropped(url) }
            }
            return true
        }
        .animation(model.mode == .home ? motion.open.animation : motion.close.animation, value: model.mode)
        .animation(motion.open.animation, value: model.tab)
        .foregroundColor(.white)
        .onAppear {
            board.start { [weak store] in store?.agents ?? [] }
            side.start(store: store, island: island, board: board)
            syncView()
        }
        .onChange(of: side.drop) { _ in syncView() }
        .onChange(of: side.listening) { _ in syncView() }
        .onChange(of: model.tab) { _ in syncView() }
        .onChange(of: store.queue.head == nil) { _ in syncView() }
        .onChange(of: store.offline) { _ in syncView() }
        .onChange(of: store.chatMessages.count) { _ in syncView() }
        .onChange(of: cards.homeContent) { _ in syncView() }
        .onChange(of: collapsed) { _ in syncView() }
        .onChange(of: guideSeen) { _ in syncView() }
        .onChange(of: store.queue.head?.id) { id in if id != nil { collapsed = false } }
        .onChange(of: liveCards) { cards.expansion.prune(keeping: $0) }
    }

    private var liveCards: Set<String> {
        Set(store.queue.items.map { "approval:\($0.id)" } + store.agents.flatMap { ["agent:\($0.id)", "outcome:\($0.id)"] }
            + store.chatMessages.map(Bubble.cardId))
    }

    private func syncView() {
        let v: IslandView
        if side.listening {
            if model.view != .listening { model.view = .listening }
            return
        }
        switch model.tab {
        case .agents: v = store.queue.head != nil ? .approval : store.offline ? .empty : .overview
        case .chat: v = .chat(messages: store.chatMessages.count)
        case .sessions: v = .sessions
        case .launch: v = .launch
        case .panel: v = .mainAgents
        case .settings: v = .settings
        case .drop:
            switch side.drop {
            case .idle: v = .upload
            case .uploading: v = .uploading
            case .chosen: v = .choose
            }
        case .mail: v = .mail
        case .timer: v = .timer
        case .recap: v = .recap
        case .whatsNew: v = .whatsNew
        case .wardrobe: v = .wardrobe
        case .messages, .services, .portfolio, .music, .notes: v = .side
        }
        let shown: IslandView = collapsed ? .collapsed : !guideSeen ? .settings
            : model.tab == .agents && cards.homeContent > 0 ? .fit(v, content: cards.homeContent) : v
        if model.view != shown { model.view = shown }
    }
}

enum IslandKey {
    static let collapsed = "islandCollapsed"
}

/** Natural height of the home card, so the island can grow to fit it. */
private struct HomeContentHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

struct ShellView: View {
    @ObservedObject var store: Store
    @ObservedObject var settings: Settings
    let island: IslandController
    @ObservedObject var model: IslandModel
    @ObservedObject var board: BoardModel
    @ObservedObject var side: SideRuntime
    @State private var focused: String?
    @AppStorage(IslandKey.collapsed) private var collapsed = false
    @AppStorage(GuideGate.seenKey) private var guideSeen = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            header.frame(height: IslandGeometry.headerHeight).zIndex(1)
            if model.view != .collapsed {
                card
                    .frame(height: model.geometry.cardHeight(for: model.view))
                    .overlay(alignment: .bottom) {
                        if let n = store.notice {
                            Text(n).font(.caption).foregroundColor(.gray).lineLimit(2)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Capsule().fill(Color.black.opacity(0.8)))
                                .padding(.bottom, 6)
                                .onTapGesture { store.notice = nil }
                        }
                    }
                    .transition(.content(.current(reduceMotion: reduceMotion)))
            }
            Spacer(minLength: 0)
        }
        .padding(.top, IslandGeometry.shellTop)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var header: some View {
        HStack(spacing: 5) {
            ForEach(HomeTab.header, id: \.self) { t in
                Button { model.tab = t; model.showAbout = false } label: {
                    Image(systemName: t.symbol).font(.system(size: 12, weight: .semibold))
                        .frame(width: 34, height: 24)
                        .background(Capsule().fill(Color.white.opacity(model.tab == t ? 0.16 : 0.06)))
                }
                .buttonStyle(.plain)
                .opacity(model.tab == t ? 1 : 0.6)
                .help(t.title)
            }
            Menu {
                ForEach(HomeTab.side, id: \.self) { t in
                    Button { model.tab = t; model.showAbout = false } label: { Label(t.title, systemImage: t.symbol) }
                }
            } label: {
                Image(systemName: HomeTab.side.contains(model.tab) ? model.tab.symbol : "square.grid.2x2.fill")
                    .font(.system(size: 12, weight: .semibold))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .frame(width: 34, height: 24)
            .background(Capsule().fill(Color.white.opacity(HomeTab.side.contains(model.tab) ? 0.16 : 0.06)))
            .opacity(HomeTab.side.contains(model.tab) ? 1 : 0.6)
            .help(t("tab.more"))
            .accessibilityLabel(t("tab.moreCards"))
            Spacer()
            HStack(spacing: 14) {
                if model.tab == .agents { UsageChip(window: store.usage).font(.system(size: 11, weight: .medium)) }
                icon(collapsed ? "chevron.down" : "chevron.up", t(collapsed ? "island.expand" : "island.collapse")) { collapsed.toggle() }
                icon("gearshape.fill", t("common.settings")) { model.tab = .settings; model.showAbout = false }
                icon(settings.soundsOn ? "speaker.wave.2.fill" : "speaker.slash.fill",
                     settings.soundsOn ? t("common.mute") : t("common.unmute")) { settings.soundsOn.toggle() }
                icon("xmark", t("common.close")) { island.close() }
            }
            .padding(.trailing, 16)
        }
        .padding(.leading, 14)
    }

    private func icon(_ symbol: String, _ help: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: 14)) }
            .buttonStyle(.plain)
            .help(help)
            .accessibilityLabel(help)
    }

    private var mood: Reaction {
        if store.offline { return .sleeping }
        if store.queue.head != nil { return .waiting }
        let pill = board.pills.first { $0.key == focused } ?? board.top
        return pill.map { board.reaction($0.shown, offline: false) } ?? .sleeping
    }

    private var card: some View {
        let wash = mood.wash
        return Group {
            if !guideSeen {
                GuideView()
            } else if side.listening {
                ListeningCard(voice: side.voice) { island.close() }
            } else {
                tabCard
            }
        }
        .id(!guideSeen ? "guide" : side.listening ? "listening" : model.tab.rawValue)
        .transition(.content(.current(reduceMotion: reduceMotion)))
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color(hex: "#141518"))
                .overlay(RoundedRectangle(cornerRadius: 20).fill(RadialGradient(
                    gradient: Gradient(stops: [.init(color: wash.colour.opacity(wash.alpha), location: 0),
                                               .init(color: wash.colour.opacity(0), location: 0.7)]),
                    center: UnitPoint(x: 0.5, y: 1.3), startRadius: 0, endRadius: 280)))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.white.opacity(0.035), lineWidth: 1))
                .animation(.easeInOut(duration: 0.4), value: mood)
        )
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .padding(.horizontal, 10)
    }

    @ViewBuilder private var dropCard: some View {
        switch side.drop {
        case .idle:
            DropView(store: store, onFile: { side.drop = .uploading($0) }, onCaptured: { side.drop = .chosen($0) })
        case .uploading(let url):
            UploadView(store: store, file: url, onChosen: { side.drop = .chosen($0) }, onFailed: { side.drop = .idle })
                .id(url)
        case .chosen(let d):
            ChooseView(store: store, dropped: d, onAsk: { side.drop = .idle; model.tab = .chat },
                       onDone: { side.drop = .idle })
        }
    }

    @ViewBuilder private var tabCard: some View {
        Group {
            switch model.tab {
            case .agents:
                ScrollView {
                    HomeCard(store: store, board: board, focused: $focused)
                        .background(GeometryReader { Color.clear.preference(key: HomeContentHeight.self, value: $0.size.height) })
                }
                .onPreferenceChange(HomeContentHeight.self) { h in
                    if abs(h - CardState.shared.homeContent) > 0.5 { CardState.shared.homeContent = h }
                }
            case .chat: ChatView(store: store, settings: settings, model: model, voice: side.voice) { island.close() }
            case .panel: ScrollView { MainAgentsView(store: store, model: model).padding(12) }
            case .sessions: SessionsView(store: store)
            case .launch: LauncherView(store: store, settings: settings, model: model).padding(12)
            case .settings: SettingsCard(store: store, settings: settings, model: model, side: side).padding(12)
            case .drop: dropCard
            case .mail: MailCard(store: store)
            case .messages: MessagesCard(store: store)
            case .services: ServicesCard(store: store)
            case .portfolio: PortfolioCard(store: store)
            case .music: MusicCard(store: store)
            case .timer: ScrollView { TimerCard(store: store) }
            case .recap: RecapCard(store: store)
            case .whatsNew: WhatsNewCard(store: store) { model.tab = .agents }
            case .wardrobe: ScrollView { WardrobeView() }
            case .notes: NotesCard(notetaker: side.notetaker) { await store.saveNotes(title: $0, transcript: $1) }
            }
        }
    }
}
