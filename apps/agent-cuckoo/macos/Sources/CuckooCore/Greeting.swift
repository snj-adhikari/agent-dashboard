import Foundation

public enum Greeting {
    public static let fallback = "Hello!"

    /** Morning 5-11, afternoon 12-16, evening 17-20, night 21-4; nil or out-of-range hour gives the fallback. */
    public static func text(hour: Int?) -> String {
        guard let h = hour, (0..<24).contains(h) else { return fallback }
        switch h {
        case 5..<12: return "Good morning!"
        case 12..<17: return "Good afternoon!"
        case 17..<21: return "Good evening!"
        default: return "Up late?"
        }
    }

    public static func text(at date: Date, calendar: Calendar = .current) -> String {
        text(hour: calendar.dateComponents([.hour], from: date).hour)
    }
}
