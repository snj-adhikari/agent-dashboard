public enum UsageColour: String, Equatable {
    case green, amber, red, unknown

    public init(percent: Int?) {
        guard let p = percent else { self = .unknown; return }
        self = p < 50 ? .green : p < 80 ? .amber : .red
    }

    public init(window: UsageWindow?) {
        guard let w = window, !w.stale else { self = .unknown; return }
        let worst = [w.fiveHour, w.sevenDay].compactMap { $0 }.max()
        self.init(percent: worst)
    }
}
