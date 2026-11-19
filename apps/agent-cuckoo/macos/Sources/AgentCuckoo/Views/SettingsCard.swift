import AppKit
import CuckooCore
import SwiftUI

struct SettingsCard: View {
    @ObservedObject var store: Store
    @ObservedObject var settings: Settings
    @ObservedObject var model: IslandModel
    @ObservedObject var side: SideRuntime
    @AppStorage(WardrobeKey.outfit) private var outfit = Outfit.auto
    @AppStorage(WardrobeKey.southern) private var southern = true
    @AppStorage(WardrobeKey.desktop) private var onDesktop = false
    @AppStorage(Strings.overrideKey) private var language = ""
    @State private var holdings: [Holding] = []
    @State private var newSymbol = ""
    @State private var newAmount = ""

    static let currencies = ["AUD", "USD", "EUR", "GBP", "NZD", "CAD", "JPY"]

    var body: some View {
        if model.showAbout {
            AboutView { model.showAbout = false }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Picker(t("settings.language"), selection: $language) {
                        Text(t("settings.languageSystem")).tag("")
                        ForEach(Strings.locales, id: \.tag) { Text($0.name).tag($0.tag) }
                    }
                    Toggle(t("settings.sounds"), isOn: $settings.soundsOn)
                    HStack {
                        Text(t("settings.volume"))
                        Slider(value: $settings.soundVolume, in: 0...Settings.maxVolume) { editing in
                            if !editing { store.play(.pop) }
                        }
                        .disabled(!settings.soundsOn)
                    }
                    Picker(t("settings.autoClose"), selection: $settings.autoClose) {
                        ForEach(Settings.autoClosePresets, id: \.self) { Text(t("common.secondsShort", ["sec": String(Int($0))])).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Toggle(t("settings.openOnHover"), isOn: $settings.openOnHover)
                    Toggle(t("settings.showDockIcon"), isOn: $settings.showDockIcon)
                    VStack(alignment: .leading, spacing: 2) {
                        Toggle(t("settings.globalShortcuts"), isOn: $settings.captureShortcuts)
                        Text(t("settings.shortcutsMac"))
                            .font(.caption).foregroundColor(.gray)
                    }
                    HStack {
                        Text(t("settings.reduceMotion"))
                        Spacer()
                        Text(store.reduceMotion ? t("common.followsSystemOn") : t("common.followsSystemOff")).foregroundColor(.gray)
                    }
                    section(t("settings.voiceNotes"))
                    VoiceToggle(voice: side.voice)
                    Button(t("settings.openNotetaker")) { model.tab = .notes }
                    section(t("settings.cuckoo"))
                    Picker(t("settings.outfit"), selection: $outfit) {
                        ForEach([Outfit.auto] + Outfit.allCases.map(\.rawValue), id: \.self) { Text(CompactView.title($0)).tag($0) }
                    }
                    Picker(t("settings.hemisphere"), selection: $southern) {
                        Text(t("settings.southern")).tag(true)
                        Text(t("settings.northern")).tag(false)
                    }
                    .pickerStyle(.segmented)
                    Toggle(t("settings.cuckooOnDesktop"), isOn: $onDesktop)
                    HStack {
                        Button(t("tab.wardrobe")) { model.tab = .wardrobe }
                        Button(t("settings.timer")) { model.tab = .timer }
                    }
                    sideSections
                    section("agent-monitor")
                    TextField(t("settings.monitorURL"), text: $settings.monitorURL).textFieldStyle(.roundedBorder)
                    TextField(t("settings.monitorFolder"), text: $settings.repoPath).textFieldStyle(.roundedBorder)
                    HStack {
                        Button(t("settings.showGuide")) {
                            UserDefaults.standard.set(false, forKey: GuideGate.seenKey)
                            model.tab = .agents
                        }
                        Button(t("about.title")) { model.showAbout = true }
                        Button(t("menu.quit")) { NSApp.terminate(nil) }
                    }
                }
                .font(.system(size: 12))
                .toggleStyle(.switch)
            }
        }
    }
}

extension SettingsCard {
    private func section(_ title: String) -> some View {
        Text(title.uppercased()).font(.system(size: 10, weight: .bold)).foregroundColor(.gray).padding(.top, 6)
    }

    private func sideBinding(_ get: @escaping (SideSettings) -> Bool, _ set: @escaping (Bool) -> SideSettingsRequest) -> Binding<Bool> {
        Binding(get: { store.sideSettings.map(get) ?? false },
                set: { v in Task { await store.updateSideSettings(set(v)) } })
    }

    @ViewBuilder private var sideSections: some View {
        section(t("settings.sideFeatures"))
        if !store.sideReady {
            Text(t("settings.noSideFeatures")).foregroundColor(.gray)
        } else {
            ForEach(store.sideProviders) { p in
                HStack {
                    Toggle(p.id.capitalized, isOn: Binding(
                        get: { store.sideSettings?.enabled[p.id] ?? false },
                        set: { v in if let id = SideId(rawValue: p.id) { Task { await store.setSideEnabled(id, v) } } }))
                    Spacer()
                    if let r = p.reason, r != "disabled" {
                        Text(Side.reasonText(r, grant: t("settings.grantAccess"))).font(.caption).foregroundColor(.gray)
                    }
                }
            }
            Text(t("settings.personalOff")).font(.caption).foregroundColor(.gray)
            Toggle(t("settings.hideProjects"), isOn: sideBinding({ $0.hideProjects }, { .init(hideProjects: $0) }))
            Toggle(t("settings.phonePush"), isOn: sideBinding({ $0.phonePush }, { .init(phonePush: $0) }))
            section(t("settings.crypto"))
            Picker(t("settings.currency"), selection: Binding(
                get: { store.sideSettings?.currency ?? "AUD" },
                set: { c in Task { await store.updateSideSettings(.init(currency: c)) } })) {
                ForEach(Self.currencies, id: \.self) { Text($0).tag($0) }
            }
            ForEach(holdings, id: \.symbol) { h in
                HStack {
                    Text(h.symbol).font(.system(size: 12, weight: .semibold))
                    Text(String(h.amount)).foregroundColor(.gray)
                    Spacer()
                    Button { saveHoldings(holdings.filter { $0.symbol != h.symbol }) } label: { Image(systemName: "minus.circle") }
                        .buttonStyle(.plain)
                        .accessibilityLabel(t("common.removeNamed", ["name": h.symbol]))
                }
            }
            HStack {
                TextField(t("settings.symbol"), text: $newSymbol, onEditingChanged: { model.typing = $0 }).textFieldStyle(.roundedBorder)
                TextField(t("settings.amount"), text: $newAmount, onEditingChanged: { model.typing = $0 }).textFieldStyle(.roundedBorder)
                Button(t("common.add"), action: addHolding)
                    .disabled(Double(newAmount) == nil || newSymbol.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .onAppear { holdings = store.sideSettings?.holdings ?? [] }
            .onChange(of: store.sideSettings?.holdings ?? []) { holdings = $0 }
        }
    }

    private func addHolding() {
        let symbol = newSymbol.trimmingCharacters(in: .whitespaces).uppercased()
        guard !symbol.isEmpty, let amount = Double(newAmount), amount >= 0 else { return }
        saveHoldings(holdings.filter { $0.symbol != symbol } + [Holding(symbol: symbol, amount: amount)])
        newSymbol = ""
        newAmount = ""
    }

    private func saveHoldings(_ list: [Holding]) {
        holdings = list
        Task { await store.updateSideSettings(.init(holdings: list)) }
    }
}

struct AboutView: View {
    static let inspiredBy = URL(string: "https://github.com/Louis-CFM/coucou")!
    let back: () -> Void

    private var version: String {
        let info = Bundle.main.infoDictionary
        return info?["CFBundleShortVersionString"] as? String ?? t("about.devBuild")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "flag.fill").foregroundColor(.purple)
                Text("agent-cuckoo").font(.system(size: 15, weight: .bold))
                Text(version).font(.system(size: 12)).foregroundColor(.gray)
            }
            Text(t("about.by")).font(.system(size: 12))
            Button(t("about.inspired")) { NSWorkspace.shared.open(Self.inspiredBy) }
                .buttonStyle(.link)
            Button(t("common.back"), action: back).padding(.top, 6)
        }
    }
}
