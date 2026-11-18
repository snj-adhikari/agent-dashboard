import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var store: Store!
    private var island: IslandController!
    private var statusItem: NSStatusItem!

    func applicationDidFinishLaunching(_ note: Notification) {
        store = Store(settings: Settings())
        island = IslandController(store: store)
        island.show()
        store.start()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "flag.fill", accessibilityDescription: "agent-cuckoo")
        let menu = NSMenu()
        menu.addItem(withTitle: "Open island", action: #selector(openIsland), keyEquivalent: "").target = self
        menu.addItem(withTitle: "About agent-cuckoo", action: #selector(showAbout), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit agent-cuckoo", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
    }

    @MainActor @objc private func openIsland() { island.open() }
    @MainActor @objc private func showAbout() { island.about() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
