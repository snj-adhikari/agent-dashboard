import Foundation

/** UI string table. Lookup order: override setting, system locales, their language prefix, `en`, then the key itself. */
public enum Strings {
    public static let overrideKey = "language"
    public static let source = "en"
    /** Locale tag and its own name, for the language picker. */
    public static let locales: [(tag: String, name: String)] = [
        ("en", "English"), ("fr", "Français"), ("de", "Deutsch"), ("es", "Español"), ("it", "Italiano"),
        ("pt-BR", "Português (Brasil)"), ("nl", "Nederlands"), ("sv", "Svenska"), ("da", "Dansk"), ("nb", "Norsk bokmål"),
        ("pl", "Polski"), ("tr", "Türkçe"), ("ja", "日本語"), ("ko", "한국어"), ("zh-Hans", "简体中文"), ("zh-Hant", "繁體中文")
    ]

    private static let aliases = ["zh-cn": "zh-Hans", "zh-sg": "zh-Hans", "zh-tw": "zh-Hant", "zh-hk": "zh-Hant", "zh-mo": "zh-Hant", "no": "nb", "nn": "nb"]

    /** Picks the first available table for the override, then each system locale; nil means fall back to `en`. */
    public static func resolve(override: String?, system: [String], available: Set<String>) -> String? {
        let byLower = Dictionary(available.map { ($0.lowercased(), $0) }, uniquingKeysWith: { a, _ in a })
        for raw in ([override].compactMap { $0 } + system) where !raw.isEmpty {
            let tag = raw.replacingOccurrences(of: "_", with: "-").lowercased()
            var parts = tag.split(separator: "-").map(String.init)
            while !parts.isEmpty {
                let candidate = parts.joined(separator: "-")
                if let hit = byLower[candidate] ?? aliases[candidate].flatMap({ byLower[$0.lowercased()] }) { return hit }
                parts.removeLast()
            }
            let lang = String(tag.prefix { $0 != "-" })
            if let hit = available.sorted().first(where: { $0.lowercased().hasPrefix(lang + "-") }) { return hit }
        }
        return nil
    }

    public static func fill(_ template: String, _ args: [String: String]) -> String {
        args.reduce(template) { $0.replacingOccurrences(of: "{\($1.key)}", with: $1.value) }
    }

    public static func lookup(_ key: String, _ args: [String: String], tables: [String: [String: String]], locale: String?) -> String {
        let text = locale.flatMap { tables[$0]?[key] } ?? tables[source]?[key] ?? key
        return fill(text, args)
    }

    /** Reads every `<locale>.json` in `dir`; unreadable files are skipped. */
    public static func load(from dir: URL) -> [String: [String: String]] {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        var out: [String: [String: String]] = [:]
        for f in files where f.pathExtension == "json" {
            if let data = try? Data(contentsOf: f), let table = try? JSONDecoder().decode([String: String].self, from: data) {
                out[f.deletingPathExtension().lastPathComponent] = table
            }
        }
        return out
    }

    public static var bundledDirectory: URL {
        if let res = Bundle.main.resourceURL?.appendingPathComponent("i18n"), FileManager.default.fileExists(atPath: res.path) { return res }
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../i18n").standardized
    }

    public static var tables: [String: [String: String]] = load(from: bundledDirectory)

    public static var current: String? {
        resolve(override: UserDefaults.standard.string(forKey: overrideKey), system: Locale.preferredLanguages, available: Set(tables.keys))
    }
}

public func t(_ key: String, _ args: [String: String] = [:]) -> String {
    Strings.lookup(key, args, tables: Strings.tables, locale: Strings.current)
}
