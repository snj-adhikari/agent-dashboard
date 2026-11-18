import Foundation

final class Settings: ObservableObject {
    private let d = UserDefaults.standard

    @Published var monitorURL: String { didSet { d.set(monitorURL, forKey: "monitorURL") } }
    @Published var repoPath: String { didSet { d.set(repoPath, forKey: "repoPath") } }
    @Published var soundsOn: Bool { didSet { d.set(soundsOn, forKey: "soundsOn") } }
    @Published var preferredScreen: Int? { didSet { d.set(preferredScreen, forKey: "preferredScreen") } }
    @Published var recents: [String] { didSet { d.set(recents, forKey: "recents") } }
    @Published var launchCLI: String { didSet { d.set(launchCLI, forKey: "launchCLI") } }

    init() {
        var url = d.string(forKey: "monitorURL") ?? ""
        if URL(string: url)?.host == nil { url = "http://127.0.0.1:5818" }
        monitorURL = url
        repoPath = d.string(forKey: "repoPath") ?? Settings.defaultRepoPath()
        soundsOn = d.object(forKey: "soundsOn") as? Bool ?? true
        preferredScreen = d.object(forKey: "preferredScreen") as? Int
        recents = d.stringArray(forKey: "recents") ?? []
        launchCLI = d.string(forKey: "launchCLI") ?? "claude"
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
