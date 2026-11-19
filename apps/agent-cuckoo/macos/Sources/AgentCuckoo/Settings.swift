import Foundation

final class Settings: ObservableObject {
    private let d = UserDefaults.standard

    @Published var monitorURL: String { didSet { d.set(monitorURL, forKey: "monitorURL") } }
    @Published var repoPath: String { didSet { d.set(repoPath, forKey: "repoPath") } }
    @Published var soundsOn: Bool { didSet { d.set(soundsOn, forKey: "soundsOn") } }
    @Published var preferredScreen: Int? { didSet { d.set(preferredScreen, forKey: "preferredScreen") } }
    @Published var recents: [String] { didSet { d.set(recents, forKey: "recents") } }
    @Published var launchCLI: String { didSet { d.set(launchCLI, forKey: "launchCLI") } }
    @Published var chatCLI: String { didSet { d.set(chatCLI, forKey: "chatCLI") } }
    @Published var soundVolume: Double { didSet { d.set(soundVolume, forKey: "soundVolume") } }
    @Published var openOnHover: Bool { didSet { d.set(openOnHover, forKey: "openOnHover") } }
    @Published var autoClose: Double { didSet { d.set(autoClose, forKey: "autoClose") } }
    @Published var showDockIcon: Bool { didSet { d.set(showDockIcon, forKey: "showDockIcon") } }
    /** Global shortcuts (capture, desktop cuckoo, wardrobe); off by default since Cmd-Shift-S is Save As elsewhere. */
    @Published var captureShortcuts: Bool { didSet { d.set(captureShortcuts, forKey: "captureShortcuts") } }

    static let maxVolume = 0.2
    static let autoClosePresets: [Double] = [10, 15, 30]

    init() {
        var url = d.string(forKey: "monitorURL") ?? ""
        if URL(string: url)?.host == nil { url = "http://127.0.0.1:5818" }
        monitorURL = url
        repoPath = d.string(forKey: "repoPath") ?? Settings.defaultRepoPath()
        soundsOn = d.object(forKey: "soundsOn") as? Bool ?? true
        preferredScreen = d.object(forKey: "preferredScreen") as? Int
        recents = d.stringArray(forKey: "recents") ?? []
        launchCLI = d.string(forKey: "launchCLI") ?? "claude"
        chatCLI = d.string(forKey: "chatCLI") ?? "claude"
        soundVolume = min(Settings.maxVolume, max(0, d.object(forKey: "soundVolume") as? Double ?? 0.12))
        openOnHover = d.object(forKey: "openOnHover") as? Bool ?? false
        let ac = d.object(forKey: "autoClose") as? Double ?? 15
        autoClose = Settings.autoClosePresets.contains(ac) ? ac : 15
        showDockIcon = d.object(forKey: "showDockIcon") as? Bool ?? true
        captureShortcuts = d.bool(forKey: "captureShortcuts")
    }

    var tokenURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/agent-monitor/token")
    }

    /** First LaunchAgent whose label mentions agent-monitor and sets a WorkingDirectory, else the conventional checkout under home. */
    static func defaultRepoPath() -> String {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser
        let agents = home.appendingPathComponent("Library/LaunchAgents")
        for name in (try? fm.contentsOfDirectory(atPath: agents.path)) ?? [] where name.contains("agent-monitor") {
            if let plist = NSDictionary(contentsOf: agents.appendingPathComponent(name)),
               let dir = plist["WorkingDirectory"] as? String { return dir }
        }
        return home.appendingPathComponent("Drive").appendingPathComponent("agent-monitor").path
    }
}
