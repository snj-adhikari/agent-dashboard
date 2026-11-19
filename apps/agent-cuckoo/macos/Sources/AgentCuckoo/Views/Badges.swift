import AppKit
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

struct UsageChip: View {
    let window: UsageWindow?
    var body: some View {
        let c = UsageColour(window: window)
        HStack(spacing: 2) {
            Image(systemName: "gauge.medium")
            Text(window?.fiveHour.map { "\($0)%" } ?? "–")
        }
        .foregroundColor(Color(c))
        .help(t("usage.badge", ["five": window?.fiveHour.map(String.init) ?? t("common.unknown"), "seven": window?.sevenDay.map(String.init) ?? t("common.unknown")]))
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

extension Reaction {
    var symbol: String {
        switch self {
        case .working: return "circle.dotted"
        case .thinking: return "ellipsis.bubble"
        case .waiting: return "hand.raised.fill"
        case .done: return "checkmark.circle.fill"
        case .error: return "xmark.octagon.fill"
        case .sleeping: return "moon.zzz.fill"
        case .celebrating: return "sparkles"
        }
    }

    var wash: (colour: Color, alpha: Double) {
        switch self {
        case .working: return (Color(red: 34 / 255, green: 211 / 255, blue: 238 / 255), 0.38)
        case .thinking: return (Color(red: 99 / 255, green: 102 / 255, blue: 241 / 255), 0.5)
        case .waiting: return (Color(red: 245 / 255, green: 165 / 255, blue: 36 / 255), 0.42)
        case .done, .celebrating: return (Color(red: 52 / 255, green: 211 / 255, blue: 153 / 255), 0.5)
        case .error: return (Color(red: 244 / 255, green: 80 / 255, blue: 94 / 255), 0.55)
        case .sleeping: return (.white, 0.08)
        }
    }
}

struct StateBadge: View {
    let reaction: Reaction
    var size: CGFloat = 12
    var body: some View {
        EmojiIcon(name: reaction.emoji, symbol: reaction.symbol, tint: reaction.wash.colour, size: size)
            .font(.system(size: size * 0.8))
            .help(reaction.rawValue)
    }
}

struct CLIBadge: View {
    let cli: String?
    var size: CGFloat = 14
    var body: some View {
        if let cli {
            EmojiIcon(name: "cli-\(cli)", symbol: "terminal", tint: .gray, size: size)
                .font(.system(size: size * 0.8))
                .help(cli)
        }
    }
}

struct HostBadge: View {
    let agent: Agent
    var size: CGFloat = 14
    var body: some View {
        EmojiIcon(name: "host-\(agent.host)", symbol: "macwindow", tint: .gray, size: size)
            .font(.system(size: size * 0.8))
            .help(agent.hostApp ?? agent.terminalApp ?? agent.host)
    }
}
