import Foundation

public protocol Cancellable { func cancel() }

public protocol Scheduler {
    func schedule(after seconds: TimeInterval, _ fire: @escaping () -> Void) -> Cancellable
}

public enum IslandEvent {
    case hoverEnter, hoverExit, click, close, activity
}

public final class IslandFSM {
    public static let compactTimeout: TimeInterval = 15
    public static let homeTimeout: TimeInterval = 180

    public private(set) var mode: IslandMode = .hidden
    public var onTransition: ((IslandMode, IslandMode) -> Void)?
    public var isHeldOpen: () -> Bool = { false }

    private let scheduler: Scheduler
    private var timer: Cancellable?
    private var hovering = false

    public init(scheduler: Scheduler) { self.scheduler = scheduler }

    public func send(_ event: IslandEvent) {
        switch (mode, event) {
        case (_, .hoverEnter):
            hovering = true
            if mode == .hidden { go(.compact) }
            timer?.cancel()
        case (_, .hoverExit):
            hovering = false
            arm()
        case (.home, .click):
            break
        case (_, .click):
            go(.home)
        case (.home, .close):
            go(.compact)
        case (_, .close):
            go(.hidden)
        case (.hidden, .activity):
            go(.compact)
        case (_, .activity):
            if !hovering { arm() }
        }
    }

    private func go(_ next: IslandMode) {
        guard next != mode else { return }
        let from = mode
        mode = next
        onTransition?(from, next)
        if hovering { timer?.cancel() } else { arm() }
    }

    private func arm() {
        timer?.cancel()
        guard mode != .hidden else { return }
        let wait = mode == .home ? Self.homeTimeout : Self.compactTimeout
        timer = scheduler.schedule(after: wait) { [weak self] in self?.expire() }
    }

    private func expire() {
        guard !hovering else { return }
        if isHeldOpen() { arm(); return }
        go(mode == .home ? .compact : .hidden)
    }
}
