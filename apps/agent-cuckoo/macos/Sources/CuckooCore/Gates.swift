import Foundation

/** Weekly recap: due once per week from Monday 08:00 local, if not shown since that slot. */
public enum RecapGate {
    public static let weekday = 2
    public static let hour = 8

    public static func due(now: Date, lastShown: Date?, calendar: Calendar) -> Bool {
        guard let slot = latestSlot(atOrBefore: now, calendar: calendar) else { return false }
        return lastShown.map { $0 < slot } ?? true
    }

    public static func latestSlot(atOrBefore now: Date, calendar: Calendar) -> Date? {
        let back = (calendar.component(.weekday, from: now) - weekday + 7) % 7
        guard let day = calendar.date(byAdding: .day, value: -back, to: calendar.startOfDay(for: now)),
              let slot = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) else { return nil }
        return slot <= now ? slot : calendar.date(byAdding: .day, value: -7, to: slot)
    }
}

/** Whats-new card: once per new version (not on first install), first try `firstDelay` after launch, retries while busy. */
public struct WhatsNewGate {
    public static let firstDelay: TimeInterval = 4
    public static let retryEvery: TimeInterval = 15
    public static let maxRetries = 12
    public static let pose = "cuckoo-proud"

    public enum Step: Equatable { case show, retry(after: TimeInterval), giveUp }

    public private(set) var attempts = 0

    public init() {}

    public static func shouldOffer(current: String, lastSeen: String?) -> Bool {
        lastSeen.map { $0 != current } ?? false
    }

    public mutating func attempt(idle: Bool) -> Step {
        attempts += 1
        if idle { return .show }
        return attempts > Self.maxRetries ? .giveUp : .retry(after: Self.retryEvery)
    }
}
