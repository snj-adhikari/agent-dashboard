import Foundation

public protocol Cancellable { func cancel() }

public protocol Scheduler {
    func schedule(after seconds: TimeInterval, _ fire: @escaping () -> Void) -> Cancellable
}

/**
 * hoverEnter/hoverExit: pointer over the island. click: mouse-up on the island (also converts a hover-opened island).
 * close: Esc or the header x. activity: non-alert work, reveals compact only. alert: approval, question, error;
 * force-expands. finished: force-expands and pins for `finishedPin` before folding.
 * voiceWoke: any mode to listening. voiceFinished: back to home if listening started there, else compact.
 */
public enum IslandEvent {
    case hoverEnter, hoverExit, click, close, activity, alert, finished, voiceWoke, voiceFinished
}

public final class IslandFSM {
    public static let autoCloseDefault: TimeInterval = 15
    public static let absenceDefault: TimeInterval = 180
    public static let hoverGrace: TimeInterval = 0.6
    public static let finishedPin: TimeInterval = 5.2

    public private(set) var mode: IslandMode = .hidden
    public private(set) var openedByHover = false
    /** Listening overlays `mode` (hidden wakes to compact) so mode switches elsewhere stay exhaustive; timers pause. */
    public private(set) var listening = false
    public var onListening: ((Bool) -> Void)?
    public var onTransition: ((IslandMode, IslandMode) -> Void)?
    public var isHeldOpen: () -> Bool = { false }
    public var openOnHover = false
    public var autoClose: TimeInterval = IslandFSM.autoCloseDefault
    public var absence: TimeInterval = IslandFSM.absenceDefault

    private let scheduler: Scheduler
    private var timer: Cancellable?
    private var hovering = false
    private var pinned = false
    private var listenFromHome = false

    public init(scheduler: Scheduler) { self.scheduler = scheduler }

    public func send(_ event: IslandEvent) {
        switch event {
        case .hoverEnter:
            hovering = true
            timer?.cancel()
            if listening {
                if openOnHover, !isHeldOpen() { open(byHover: true) }
            } else if mode != .home, openOnHover, !isHeldOpen() {
                open(byHover: true)
            } else if mode == .hidden {
                go(.compact)
            }
        case .hoverExit:
            hovering = false
            if !pinned { arm() }
        case .click:
            if mode == .home, !listening { openedByHover = false; return }
            open(byHover: false)
        case .close:
            pinned = false
            if listening { setListening(false); go(.compact); return }
            go(mode == .home ? .compact : .hidden)
        case .activity:
            if mode == .hidden { go(.compact) } else if !hovering, !pinned { arm() }
        case .alert:
            open(byHover: false)
        case .finished:
            open(byHover: false)
            pinned = true
            timer?.cancel()
            timer = scheduler.schedule(after: Self.finishedPin) { [weak self] in self?.unpin() }
        case .voiceWoke:
            if !listening { listenFromHome = mode == .home }
            timer?.cancel()
            setListening(true)
            if mode == .hidden { go(.compact) }
        case .voiceFinished:
            guard listening else { return }
            setListening(false)
            go(listenFromHome ? .home : .compact)
        }
    }

    private func open(byHover: Bool) {
        setListening(false)
        openedByHover = byHover
        go(.home)
    }

    private func setListening(_ on: Bool) {
        guard on != listening else { return }
        listening = on
        onListening?(on)
    }

    private func unpin() {
        pinned = false
        if isHeldOpen() || hovering { arm(); return }
        go(.compact)
    }

    private func go(_ next: IslandMode) {
        if next != mode {
            let from = mode
            mode = next
            if next != .home { openedByHover = false }
            onTransition?(from, next)
        }
        if pinned { return }
        if hovering { timer?.cancel() } else { arm() }
    }

    private func arm() {
        timer?.cancel()
        if listening { return }
        let wait: TimeInterval
        switch mode {
        case .hidden: return
        case .compact: wait = absence
        case .home: wait = openedByHover ? Self.hoverGrace : autoClose
        }
        timer = scheduler.schedule(after: wait) { [weak self] in self?.expire() }
    }

    private func expire() {
        guard !hovering, !listening else { return }
        if isHeldOpen() { arm(); return }
        go(mode == .home ? .compact : .hidden)
    }
}
