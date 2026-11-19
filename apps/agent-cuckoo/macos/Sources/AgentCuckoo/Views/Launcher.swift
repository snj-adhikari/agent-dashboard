import CuckooCore
import SwiftUI

/** Starts a CLI in a folder; only CLIs whose status command says signed in are offered. */
struct LauncherView: View {
    @ObservedObject var store: Store
    @ObservedObject var settings: Settings
    @ObservedObject var model: IslandModel
    @State private var folder = ""
    @State private var prompt = ""

    var body: some View {
        let clis = store.signedInCLIs
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField(t("launch.folder"), text: $folder, onEditingChanged: { model.typing = $0 }).textFieldStyle(.roundedBorder)
                Menu(t("launch.recent")) {
                    ForEach(settings.recents, id: \.self) { p in Button(p) { folder = p } }
                }.frame(width: 80)
            }
            Picker(t("launch.cli"), selection: $settings.launchCLI) {
                ForEach(clis) { c in Text("\(c.cli) \(c.version ?? "")").tag(c.cli) }
            }
            HStack {
                TextField(t("launch.prompt"), text: $prompt, onEditingChanged: { model.typing = $0 }).textFieldStyle(.roundedBorder)
                Button {
                    let f = folder, p = prompt, c = settings.launchCLI
                    Task { await store.launch(cwd: f, prompt: p, cli: c); prompt = "" }
                } label: { Image(systemName: "play.fill") }
                    .disabled(folder.isEmpty || !clis.contains { $0.cli == settings.launchCLI })
                    .accessibilityLabel(t("launch.launch"))
            }
            if clis.isEmpty { Text(t("launch.noCli")).font(.caption).foregroundColor(.gray) }
        }
        .onAppear {
            if folder.isEmpty { folder = settings.recents.first ?? "" }
            pickSignedIn()
        }
        .onChange(of: store.signedInCLIs) { _ in pickSignedIn() }
    }

    private func pickSignedIn() {
        let clis = store.signedInCLIs
        if !clis.contains(where: { $0.cli == settings.launchCLI }), let first = clis.first { settings.launchCLI = first.cli }
    }
}
