import AppKit
import Combine
import CuckooCore
import SwiftUI

final class IslandPanel: NSPanel {
    var onEscape: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { onEscape?() }
}

final class TimerScheduler: CuckooCore.Scheduler {
    final class Handle: CuckooCore.Cancellable {
        let timer: Timer
        init(_ t: Timer) { timer = t }
        func cancel() { timer.invalidate() }
    }
    func schedule(after seconds: TimeInterval, _ fire: @escaping () -> Void) -> CuckooCore.Cancellable {
        Handle(Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { _ in fire() })
    }
}

final class IslandModel: ObservableObject {
    @Published var mode: IslandMode = .hidden
    @Published var notchSize = IslandGeometry.fallbackSize
    @Published var typing = false
    @Published var tab: HomeTab = .agents
    @Published var showAbout = false
    /** Expanded view shown; views set it so the island takes that view's height. */
    @Published var view: IslandView = .overview
    @Published var geometry = IslandGeometry(ScreenMetrics(frame: .zero))

    var islandSize: CGSize { geometry.size(for: mode, view: view) }
    var cornerRadius: CGFloat { geometry.cornerRadius(for: mode) }
}

extension Curve {
    var animation: Animation {
        switch self {
        case let .spring(response, damping): return .spring(response: response, dampingFraction: damping)
        case let .bezier(x1, y1, x2, y2, d): return .timingCurve(x1, y1, x2, y2, duration: d)
        case let .easeInOut(d), let .crossFade(d): return .easeInOut(duration: d)
        }
    }
}

/** Fills the fixed panel; the island is the top-centred `islandSize` box, animated by SwiftUI, never by the window frame. */
struct IslandContainer: View {
    @ObservedObject var store: Store
    @ObservedObject var model: IslandModel
    let island: IslandController

    var body: some View {
        IslandRoot(store: store, island: island, model: model)
            .frame(width: model.islandSize.width, height: model.islandSize.height)
            .clipped()
            .animation(store.motion.open.animation, value: model.view)
            .frame(width: IslandGeometry.panelSize.width, height: IslandGeometry.panelSize.height, alignment: .top)
    }
}

@MainActor
final class IslandController {
    let fsm = IslandFSM(scheduler: TimerScheduler())
    let model = IslandModel()
    /** Global shortcuts (capture, voice); bound by the shell from settings. */
    let hotKeys = HotKeys()
    private let panel: IslandPanel
    private let store: Store
    private var pollTimer: Timer?
    private var inside = false
    private var bag = Set<AnyCancellable>()

    init(store: Store) {
        self.store = store
        panel = IslandPanel(contentRect: CGRect(origin: .zero, size: IslandGeometry.panelSize),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.isMovable = false
        panel.ignoresMouseEvents = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.contentView = NSHostingView(rootView: IslandContainer(store: store, model: model, island: self))
        panel.onEscape = { [weak self] in self?.close() }

        fsm.isHeldOpen = { [weak self] in
            guard let self else { return false }
            return self.model.typing || self.store.queue.head != nil
        }
        fsm.onTransition = { [weak self] from, to in self?.transition(from, to) }
        store.onIslandEvent = { [weak self] in self?.fsm.send($0) }
        store.settings.$openOnHover.sink { [weak self] in self?.fsm.openOnHover = $0 }.store(in: &bag)
        store.settings.$autoClose.sink { [weak self] in self?.fsm.autoClose = $0 }.store(in: &bag)
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.place() }
        }
    }

    func show() {
        place()
        panel.orderFrontRegardless()
        schedulePoll(fast: false)
    }

    func open() { fsm.send(.click) }
    func close() { fsm.send(.close) }

    func openSettings() {
        model.tab = .settings
        model.showAbout = false
        open()
    }

    func about() {
        model.tab = .settings
        model.showAbout = true
        open()
    }

    private var screen: NSScreen {
        let screens = NSScreen.screens
        let ids = screens.map { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? Int) ?? 0 }
        let i = DisplayResolver.index(preferredID: store.settings.preferredScreen, screenIDs: ids,
                                      notched: screens.map { $0.safeAreaInsets.top > 0 })
        return screens.indices.contains(i) ? screens[i] : (NSScreen.main ?? screens[0])
    }

    /** Moves the fixed-size panel to the chosen screen; never animated. */
    private func place() {
        let s = screen
        model.geometry = IslandGeometry(ScreenMetrics(frame: s.frame, safeAreaTop: s.safeAreaInsets.top,
                                                      auxiliaryLeftWidth: s.auxiliaryTopLeftArea?.width,
                                                      auxiliaryRightWidth: s.auxiliaryTopRightArea?.width,
                                                      menuBarHeight: s.frame.maxY - s.visibleFrame.maxY))
        model.notchSize = model.geometry.notchSize
        let f = model.geometry.panelFrame(on: s.frame)
        if panel.frame != f { panel.setFrame(f, display: true) }
    }

    private func transition(_ from: IslandMode, _ to: IslandMode) {
        let m = store.motion
        withAnimation((to == .home ? m.open : m.close).animation) { model.mode = to }
        if to == .home {
            store.play(.open)
        } else {
            model.typing = false
            if from == .home { store.play(.close) } else if to == .compact, inside { store.play(.peek) }
        }
    }

    /** Island rect in screen coordinates for the target mode and view. */
    private var islandFrame: CGRect {
        model.geometry.islandRect(for: model.mode, view: model.view).offsetBy(dx: panel.frame.minX, dy: panel.frame.minY)
    }

    /** Polls the cursor instead of tracking areas so the island reacts even while another app is active; faster when the cursor is near. Outside the island the panel is click-through. */
    private func schedulePoll(fast: Bool) {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: fast ? 0.05 : 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        let p = NSEvent.mouseLocation
        let island = islandFrame
        let hit = island.insetBy(dx: -6, dy: -6).contains(p)
        let near = island.insetBy(dx: -120, dy: -80).contains(p)
        if hit != inside {
            inside = hit
            fsm.send(hit ? .hoverEnter : .hoverExit)
        }
        panel.ignoresMouseEvents = !island.contains(p)
        let fast = pollTimer?.timeInterval == 0.05
        if near != fast { schedulePoll(fast: near) }
    }
}
