import Carbon.HIToolbox
import Foundation

/**
 * System-wide shortcuts via Carbon `RegisterEventHotKey`; needs no Accessibility permission.
 * Off by default (Cmd-Shift-S is Save As in most apps): bindings register only while the
 * `captureShortcuts` user default is true and unregister as soon as it turns false.
 */
@MainActor
final class HotKeys {
    struct Combo: Hashable {
        let keyCode: UInt32
        let modifiers: UInt32

        static let regionCapture = Combo(keyCode: UInt32(kVK_ANSI_S), modifiers: UInt32(cmdKey | shiftKey))
        static let fullCapture = Combo(keyCode: UInt32(kVK_ANSI_2), modifiers: UInt32(cmdKey | shiftKey))
        static let openChat = Combo(keyCode: UInt32(kVK_ANSI_C), modifiers: UInt32(controlKey | optionKey))
    }

    static let enabledKey = "captureShortcuts"
    private static let signature: OSType = 0x4355_434B

    private let defaults: UserDefaults
    private var wanted: [Combo: () -> Void] = [:]
    private var refs: [UInt32: EventHotKeyRef] = [:]
    private var actions: [UInt32: () -> Void] = [:]
    private var nextId: UInt32 = 1
    private var handler: EventHandlerRef?
    private var observer: NSObjectProtocol?

    var enabled: Bool { defaults.bool(forKey: Self.enabledKey) }
    /** Combos currently registered with the system. */
    private(set) var active: Set<Combo> = []

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let me = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, event, user in
            guard let event, let user else { return OSStatus(eventNotHandledErr) }
            var hk = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &hk)
            let keys = Unmanaged<HotKeys>.fromOpaque(user).takeUnretainedValue()
            MainActor.assumeIsolated { keys.actions[hk.id]?() }
            return noErr
        }, 1, &spec, me, &handler)
        observer = NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: defaults,
                                                          queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.sync() }
        }
    }

    /** Records the binding; it reaches the system only while shortcuts are enabled. */
    func bind(_ combo: Combo, _ action: @escaping () -> Void) {
        wanted[combo] = action
        sync(force: true)
    }

    func unbind(_ combo: Combo) {
        wanted[combo] = nil
        sync(force: true)
    }

    /** Registers every wanted combo when enabled, none otherwise; a combo another app holds is skipped. */
    func sync(force: Bool = false) {
        let target: Set<Combo> = enabled ? Set(wanted.keys) : []
        guard force || target != active else { return }
        refs.values.forEach { UnregisterEventHotKey($0) }
        refs = [:]
        actions = [:]
        active = []
        for combo in target {
            let id = nextId
            nextId += 1
            var ref: EventHotKeyRef?
            let status = RegisterEventHotKey(combo.keyCode, combo.modifiers, EventHotKeyID(signature: Self.signature, id: id),
                                             GetApplicationEventTarget(), 0, &ref)
            guard status == noErr, let ref, let action = wanted[combo] else { continue }
            refs[id] = ref
            actions[id] = action
            active.insert(combo)
        }
    }
}
