import AppKit
import Combine
import CuckooCore
import SwiftUI

/** Never key or main, so clicking the cuckoo never takes focus from the app in front. */
final class DesktopMascotPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class DesktopMascotModel: ObservableObject {
    @Published var forced: MascotPose?
    @Published var asleep = false
    @Published var reaction: Reaction = .done
    @Published var musicPlaying = false
}

private struct DesktopMascotBody: View {
    @ObservedObject var model: DesktopMascotModel
    @AppStorage(WardrobeKey.outfit) private var selection = Outfit.auto
    @AppStorage(WardrobeKey.southern) private var southern = true

    var body: some View {
        MascotView(reaction: model.asleep ? .sleeping : model.reaction, size: DesktopMascotLogic.size,
                   outfit: WardrobeKey.current(selection, southern: southern), forced: model.forced,
                   musicPlaying: model.musicPlaying && !model.asleep)
            .frame(width: DesktopMascotLogic.size, height: DesktopMascotLogic.size)
    }
}

/** Takes every mouse event itself (SwiftUI never sees them): click = poke after the double-click interval, double-click = fly home, drag = move, right click = wardrobe. */
private final class DesktopMascotHitView: NSView {
    var onPoke: (() -> Void)?
    var onHome: (() -> Void)?
    var onMoved: (() -> Void)?
    var onMenu: ((NSEvent) -> Void)?
    private var pendingPoke: DispatchWorkItem?
    private var dragged = false

    override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) { dragged = false }

    override func mouseDragged(with event: NSEvent) {
        guard !dragged else { return }
        dragged = true
        pendingPoke?.cancel()
        window?.performDrag(with: event)
        onMoved?()
    }

    override func mouseUp(with event: NSEvent) {
        guard !dragged else { return }
        pendingPoke?.cancel()
        if event.clickCount >= 2 { onHome?(); return }
        let work = DispatchWorkItem { [weak self] in self?.onPoke?() }
        pendingPoke = work
        DispatchQueue.main.asyncAfter(deadline: .now() + NSEvent.doubleClickInterval, execute: work)
    }

    override func rightMouseDown(with event: NSEvent) { onMenu?(event) }
}

/**
 * The desktop cuckoo: a 120x120 floating, non-activating, transparent panel that is click-through except over the
 * bird's opaque pixels. Rules come from `DesktopMascotLogic`; on/off, outfit and position live in `WardrobeKey` defaults.
 */
@MainActor
final class DesktopMascotController {
    private let store: Store
    private let mood: () -> Reaction
    private let model = DesktopMascotModel()
    private let panel: DesktopMascotPanel
    private let hit = DesktopMascotHitView()
    private let sounds = Sounds()
    private var logic = DesktopMascotLogic(now: Date().timeIntervalSince1970)
    private var timer: Timer?
    private var bag: Set<AnyCancellable> = []
    private var poseReset: DispatchWorkItem?
    private var alphaCache: [String: NSBitmapImageRep] = [:]
    private let defaults = UserDefaults.standard

    /** `mood` = the reaction the main mascot shows (same rule as the compact island). */
    init(store: Store, mood: @escaping () -> Reaction) {
        self.store = store
        self.mood = mood
        let size = DesktopMascotLogic.size
        panel = DesktopMascotPanel(contentRect: CGRect(x: 0, y: 0, width: size, height: size),
                                   styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isMovable = true
        panel.isMovableByWindowBackground = false
        panel.ignoresMouseEvents = true

        let host = NSHostingView(rootView: DesktopMascotBody(model: model))
        host.frame = CGRect(x: 0, y: 0, width: size, height: size)
        hit.frame = host.frame
        let root = NSView(frame: host.frame)
        root.addSubview(host)
        root.addSubview(hit)
        panel.contentView = root

        hit.onPoke = { [weak self] in self?.poke() }
        hit.onHome = { [weak self] in self?.defaults.set(false, forKey: WardrobeKey.desktop) }
        hit.onMoved = { [weak self] in self?.savePosition() }
        hit.onMenu = { [weak self] e in self?.showWardrobe(e) }

        store.$queue.map { !$0.items.isEmpty }.removeDuplicates()
            .sink { [weak self] _ in self?.tick() }.store(in: &bag)
        store.$pills.sink { [weak self] _ in self?.logic.lastActivity = Date().timeIntervalSince1970 }.store(in: &bag)
        NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.syncVisible() }.store(in: &bag)
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in self?.restorePosition() }.store(in: &bag)
        syncVisible()
    }

    private var enabled: Bool { defaults.bool(forKey: WardrobeKey.desktop) }
    private var reduceMotion: Bool { store.reduceMotion }
    private var now: TimeInterval { Date().timeIntervalSince1970 }

    private func syncVisible() {
        if enabled && timer == nil {
            restorePosition()
            panel.alphaValue = 1
            panel.orderFrontRegardless()
            schedule(DesktopMascotLogic.activeFPS)
        } else if !enabled && timer != nil {
            timer?.invalidate()
            timer = nil
            fly(to: islandOrigin, hideAfter: true)
        }
    }

    private func schedule(_ fps: Double) {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1 / fps, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    private func tick() {
        guard enabled else { return }
        let t = now
        let mouse = NSEvent.mouseLocation
        let f = panel.frame
        let distance = hypot(mouse.x - f.midX, mouse.y - f.midY)
        switch logic.update(alertPending: !store.queue.items.isEmpty, now: t) {
        case .toIsland: flyToIsland()
        case .toDesktop: flyBack()
        case .stay: break
        }
        model.reaction = mood()
        model.musicPlaying = store.music?.playing == true
        model.asleep = logic.asleep(now: t, pointerDistance: distance)
        if model.forced == .dizzy && !logic.isDizzy(now: t) { model.forced = nil }
        panel.ignoresMouseEvents = logic.atIsland || !bodyContains(mouse)
        let fps = logic.fps(now: t, pointerDistance: distance)
        if let timer, abs(timer.timeInterval - 1 / fps) > 0.001 { schedule(fps) }
    }

    private func poke() {
        logic.lastActivity = now
        switch logic.poke(now: now) {
        case .ignored: return
        case .annoyed: show(.surprised, for: DesktopMascotLogic.surprisedFor)
        case .dizzy: show(.dizzy, for: DesktopMascotLogic.dizzyFor)
        }
        if defaults.object(forKey: "soundsOn") as? Bool ?? true {
            sounds.play(.poke, volume: min(Settings.maxVolume, defaults.object(forKey: "soundVolume") as? Double ?? 0.12))
        }
    }

    private func show(_ pose: MascotPose, for seconds: TimeInterval) {
        poseReset?.cancel()
        model.forced = pose
        let work = DispatchWorkItem { [weak self] in if self?.model.forced == pose { self?.model.forced = nil } }
        poseReset = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func flyToIsland() {
        show(.surprised, for: DesktopMascotLogic.surprisedFor)
        let delay = reduceMotion ? 0 : DesktopMascotLogic.surprisedFor
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.logic.atIsland else { return }
            self.fly(to: self.islandOrigin, hideAfter: true)
        }
    }

    private func flyBack() {
        restorePosition(at: islandOrigin)
        panel.alphaValue = reduceMotion ? 1 : 0
        panel.orderFrontRegardless()
        fly(to: savedOrigin, hideAfter: false)
    }

    /** Eased flight of the panel; under Reduce Motion it only fades in place. */
    private func fly(to origin: CGPoint, hideAfter: Bool) {
        let target = CGRect(origin: origin, size: panel.frame.size)
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = hideAfter ? DesktopMascotLogic.flyFor : DesktopMascotLogic.flyFor + DesktopMascotLogic.landSpring
            ctx.timingFunction = CAMediaTimingFunction(name: hideAfter ? .easeIn : .easeOut)
            if !reduceMotion { panel.animator().setFrame(target, display: true) }
            panel.animator().alphaValue = hideAfter ? 0 : 1
        }, completionHandler: { [weak self] in
            guard let self, hideAfter else { return }
            MainActor.assumeIsolated {
                self.panel.orderOut(nil)
                self.panel.setFrameOrigin(self.savedOrigin)
            }
        })
    }

    private var visibleFrame: CGRect { (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? .zero }

    private var islandOrigin: CGPoint {
        let s = (NSScreen.main ?? NSScreen.screens.first)?.frame ?? .zero
        return CGPoint(x: s.midX - DesktopMascotLogic.size / 2, y: s.maxY - DesktopMascotLogic.size)
    }

    private var savedOrigin: CGPoint {
        guard let x = defaults.object(forKey: WardrobeKey.desktopX) as? Double,
              let y = defaults.object(forKey: WardrobeKey.desktopY) as? Double else {
            return DesktopMascotLogic.restore(nil, visible: visibleFrame)
        }
        return DesktopMascotLogic.restore(CGPoint(x: x, y: y), visible: visibleFrame)
    }

    private func restorePosition(at origin: CGPoint? = nil) {
        guard !logic.atIsland || origin != nil else { return }
        panel.setFrameOrigin(origin ?? savedOrigin)
    }

    private func savePosition() {
        let p = DesktopMascotLogic.restore(panel.frame.origin, visible: visibleFrame)
        panel.setFrameOrigin(p)
        defaults.set(Double(p.x), forKey: WardrobeKey.desktopX)
        defaults.set(Double(p.y), forKey: WardrobeKey.desktopY)
        logic.lastActivity = now
    }

    /** True when the screen point lands on an opaque pixel of the current body pose. */
    private func bodyContains(_ screenPoint: CGPoint) -> Bool {
        let f = panel.frame
        guard f.contains(screenPoint) else { return false }
        let pose = model.forced?.rawValue ?? (model.asleep ? Reaction.sleeping.pose : model.reaction.pose)
        guard let rep = alphaRep(pose) else { return true }
        let x = Int((screenPoint.x - f.minX) / f.width * CGFloat(rep.pixelsWide))
        let y = Int((f.maxY - screenPoint.y) / f.height * CGFloat(rep.pixelsHigh))
        guard x >= 0, y >= 0, x < rep.pixelsWide, y < rep.pixelsHigh else { return false }
        return (rep.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.1
    }

    private func alphaRep(_ pose: String) -> NSBitmapImageRep? {
        if let hit = alphaCache[pose] { return hit }
        guard let cg = MascotArt.image(pose)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let rep = NSBitmapImageRep(cgImage: cg)
        alphaCache[pose] = rep
        return rep
    }

    /** Right click: outfit menu with each option drawn on the cuckoo, plus "Fly home". */
    private func showWardrobe(_ event: NSEvent) {
        let menu = NSMenu()
        let selection = defaults.string(forKey: WardrobeKey.outfit) ?? Outfit.auto
        let southern = defaults.object(forKey: WardrobeKey.southern) as? Bool ?? true
        for option in [Outfit.auto] + Outfit.allCases.map(\.rawValue) {
            let title = option == Outfit.auto ? t("common.auto") : t("outfit.\(option)")
            let item = NSMenuItem(title: title, action: #selector(MenuTarget.pick(_:)), keyEquivalent: "")
            item.representedObject = option
            item.target = MenuTarget.shared
            item.state = option == selection ? .on : .off
            item.image = preview(WardrobeKey.current(option, southern: southern))
            menu.addItem(item)
        }
        menu.addItem(.separator())
        let home = NSMenuItem(title: t("mascot.flyHome"), action: #selector(MenuTarget.home(_:)), keyEquivalent: "")
        home.target = MenuTarget.shared
        menu.addItem(home)
        NSMenu.popUpContextMenu(menu, with: event, for: hit)
    }

    private func preview(_ outfit: Outfit) -> NSImage? {
        guard let body = MascotArt.image(Reaction.done.pose) else { return nil }
        let side: CGFloat = 28
        return NSImage(size: CGSize(width: side, height: side), flipped: false) { r in
            body.draw(in: r)
            if outfit != .none { MascotArt.image(outfit.asset)?.draw(in: r) }
            return true
        }
    }
}

private final class MenuTarget: NSObject {
    static let shared = MenuTarget()
    @objc func pick(_ sender: NSMenuItem) {
        if let raw = sender.representedObject as? String { UserDefaults.standard.set(raw, forKey: WardrobeKey.outfit) }
    }
    @objc func home(_ sender: NSMenuItem) { UserDefaults.standard.set(false, forKey: WardrobeKey.desktop) }
}
