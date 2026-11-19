import AppKit
import Combine
import CuckooCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var store: Store!
    private var island: IslandController!
    private var statusItem: NSStatusItem!
    private var dockItem: NSMenuItem!
    private var bag = Set<AnyCancellable>()

    @MainActor func applicationDidFinishLaunching(_ note: Notification) {
        let settings = Settings()
        store = Store(settings: settings)
        island = IslandController(store: store)
        island.show()
        store.start()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "flag.fill", accessibilityDescription: "agent-cuckoo")
        let menu = NSMenu()
        menu.addItem(withTitle: t("menu.open"), action: #selector(openIsland), keyEquivalent: "").target = self
        menu.addItem(withTitle: t("common.settingsEllipsis"), action: #selector(openSettings), keyEquivalent: ",").target = self
        dockItem = menu.addItem(withTitle: t("menu.showInDock"), action: #selector(toggleDock), keyEquivalent: "")
        dockItem.target = self
        menu.addItem(withTitle: t("menu.about"), action: #selector(showAbout), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: t("menu.quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu

        settings.$showDockIcon.sink { [weak self] show in
            NSApp.setActivationPolicy(show ? .regular : .accessory)
            self?.dockItem.state = show ? .on : .off
        }.store(in: &bag)
    }

    @MainActor func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        island.open()
        return false
    }

    /** Best-effort chat end so the server kills the CLI child now rather than at its timeout. */
    @MainActor func applicationWillTerminate(_ note: Notification) {
        guard let id = store.chatConversationId else { return }
        let client = store.client, done = DispatchSemaphore(value: 0)
        Task.detached { _ = try? await client.chatEnd(id); done.signal() }
        _ = done.wait(timeout: .now() + 1)
    }

    @MainActor func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        menu.addItem(withTitle: t("menu.open"), action: #selector(openIsland), keyEquivalent: "").target = self
        let waiting = store.agents.filter { $0.state == .waiting }.prefix(5)
        if !waiting.isEmpty {
            menu.addItem(.separator())
            menu.addItem(withTitle: t("menu.waitingHeader"), action: nil, keyEquivalent: "").isEnabled = false
            for a in waiting {
                let item = menu.addItem(withTitle: a.codename ?? a.name, action: #selector(focusAgent(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = a.id
            }
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: t("common.settingsEllipsis"), action: #selector(openSettings), keyEquivalent: "").target = self
        menu.addItem(withTitle: t("menu.hideDock"), action: #selector(toggleDock), keyEquivalent: "").target = self
        return menu
    }

    @MainActor @objc private func focusAgent(_ item: NSMenuItem) {
        guard let a = store.agents.first(where: { $0.id == item.representedObject as? String }) else { return }
        Task { await store.focus(a) }
    }

    @MainActor @objc private func openIsland() { island.open() }
    @MainActor @objc private func openSettings() { island.openSettings() }
    @MainActor @objc private func showAbout() { island.about() }
    @MainActor @objc private func toggleDock() { store.settings.showDockIcon.toggle() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
