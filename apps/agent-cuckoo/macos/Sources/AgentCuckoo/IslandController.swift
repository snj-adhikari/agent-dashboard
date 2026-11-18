import AppKit
import CuckooCore
import SwiftUI

final class IslandPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

final class TimerScheduler: Scheduler {
    final class Handle: Cancellable {
        let timer: Timer
        init(_ t: Timer) { timer = t }
        func cancel() { timer.invalidate() }
    }
    func schedule(after seconds: TimeInterval, _ fire: @escaping () -> Void) -> Cancellable {
        Handle(Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { _ in fire() })
    }
}

final class IslandModel: ObservableObject {
    @Published var mode: IslandMode = .hidden
    @Published var notchSize = IslandGeometry.fallbackSize
    @Published var typing = false
    @Published var tab: HomeTab = .agents
    @Published var showAbout = false
}

@MainActor
final class IslandController {
    let fsm = IslandFSM(scheduler: TimerScheduler())
    let model = IslandModel()
    private let panel: IslandPanel
    private let store: Store
    private var pollTimer: Timer?
    private var inside = false

    init(store: Store) {
        self.store = store
        panel = IslandPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.isMovable = false
        panel.contentView = NSHostingView(rootView: IslandRoot(store: store, island: self, model: model))

        fsm.isHeldOpen = { [weak self] in
            guard let self else { return false }
            return self.model.typing || self.store.queue.head != nil
        }
        fsm.onTransition = { [weak self] _, to in self?.apply(to) }
        store.onActivity = { [weak self] in self?.fsm.send(.activity) }
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.apply(self?.fsm.mode ?? .hidden) }
        }
    }

    func show() {
        apply(.hidden)
        panel.orderFrontRegardless()
        schedulePoll(fast: false)
    }

    func open() { fsm.send(.click) }
    func close() { fsm.send(.close) }

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

    private func geometry(_ s: NSScreen) -> IslandGeometry {
        IslandGeometry(ScreenMetrics(frame: s.frame, safeAreaTop: s.safeAreaInsets.top,
                                     auxiliaryLeftWidth: s.auxiliaryTopLeftArea?.width,
                                     auxiliaryRightWidth: s.auxiliaryTopRightArea?.width,
                                     menuBarHeight: s.frame.maxY - s.visibleFrame.maxY))
    }

    private func apply(_ mode: IslandMode) {
        let s = screen, g = geometry(s)
        model.notchSize = g.notchSize
        model.mode = mode
        if mode == .home { panel.makeKey() } else { model.typing = false }
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.18
            panel.animator().setFrame(g.frame(for: mode, on: s.frame), display: true)
        }
        panel.ignoresMouseEvents = mode == .hidden && !inside
    }

    /** Polls the cursor instead of tracking areas so the island reacts even while another app is active; faster when the cursor is near. */
    private func schedulePoll(fast: Bool) {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: fast ? 0.05 : 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        let p = NSEvent.mouseLocation
        let hit = panel.frame.insetBy(dx: -6, dy: -6).contains(p)
        let near = panel.frame.insetBy(dx: -120, dy: -80).contains(p)
        if hit != inside {
            inside = hit
            fsm.send(hit ? .hoverEnter : .hoverExit)
            panel.ignoresMouseEvents = !hit && fsm.mode == .hidden
        }
        let fast = pollTimer?.timeInterval == 0.05
        if near != fast { schedulePoll(fast: near) }
    }
}
