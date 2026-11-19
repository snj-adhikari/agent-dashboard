import CoreGraphics
import Foundation

/** Mascot accessories. Each asset is a full 128x128 layer drawn with the pose's own transform, on the main mascot only. */
public enum Outfit: String, CaseIterable, Codable {
    case none, partyHat = "party-hat", beanie, crown, witchHat = "witch-hat", santaHat = "santa-hat"
    case bunnyEars = "bunny-ears", bow, sunglasses, roundGlasses = "round-glasses", scarf, pumpkin

    public static let auto = "auto"
    public static let presenceTween: TimeInterval = 0.35
    public static let poseFrame = CGSize(width: 128, height: 128)
    public static let headBox = CGRect(x: 24, y: 0, width: 80, height: 72)
    public static let eyeY: CGFloat = 60

    public var asset: String { "outfit-\(rawValue)" }

    /** `selection` is an outfit raw value or `auto`; unknown values fall back to none. */
    public static func resolve(_ selection: String, on date: Date, calendar: Calendar, southern: Bool) -> Outfit {
        selection == auto ? seasonal(on: date, calendar: calendar, southern: southern) : Outfit(rawValue: selection) ?? .none
    }

    /**
     * Witch hat 1 Oct-1 Nov, Santa hat 1-26 Dec, party hat 31 Dec-2 Jan, bunny ears Good Friday-Easter Monday,
     * sunglasses 21 Jun-31 Aug (north) or 1 Dec-end Feb (south). Holidays win over summer.
     */
    public static func seasonal(on date: Date, calendar: Calendar, southern: Bool) -> Outfit {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        guard let y = c.year, let m = c.month, let d = c.day else { return .none }
        let md = m * 100 + d
        if (1001...1101).contains(md) { return .witchHat }
        if (1201...1226).contains(md) { return .santaHat }
        if md >= 1231 || md <= 102 { return .partyHat }
        if let easter = easterSunday(year: y, calendar: calendar),
           let days = calendar.dateComponents([.day], from: easter, to: calendar.startOfDay(for: date)).day,
           (-2...1).contains(days) { return .bunnyEars }
        let summer = southern ? (md >= 1201 || md <= 229) : (621...831).contains(md)
        return summer ? .sunglasses : .none
    }

    /** Gregorian Easter Sunday (anonymous computus), local midnight in `calendar`. */
    public static func easterSunday(year: Int, calendar: Calendar) -> Date? {
        let a = year % 19, b = year / 100, c = year % 100, d = b / 4, e = b % 4
        let f = (b + 8) / 25, g = (b - f + 1) / 3, h = (19 * a + b - d - g + 15) % 30
        let i = c / 4, k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = (a + 11 * h + 22 * l) / 451
        let month = (h + l - 7 * m + 114) / 31, day = (h + l - 7 * m + 114) % 31 + 1
        return calendar.date(from: DateComponents(year: year, month: month, day: day))
    }
}
