import CuckooCore
import SwiftUI
import UniformTypeIdentifiers

/** Every agent grouped by host, then space. */
struct SessionsView: View {
    @ObservedObject var store: Store

    var body: some View {
        let byHost = Dictionary(grouping: store.agents, by: \.host)
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if store.agents.isEmpty { Text(t("common.noAgentsFound")).font(.system(size: 12)).foregroundColor(.gray) }
                ForEach(byHost.keys.sorted(), id: \.self) { host in
                    let agents = byHost[host] ?? []
                    HStack(spacing: 5) {
                        if let first = agents.first { HostBadge(agent: first, size: 12) }
                        Text(host.uppercased()).font(.system(size: 10, weight: .bold)).foregroundColor(.gray)
                    }
                    let bySpace = Dictionary(grouping: agents, by: \.space)
                    ForEach(bySpace.keys.sorted(), id: \.self) { space in
                        Text(space).font(.system(size: 10, weight: .semibold)).foregroundColor(Color(hex: "#6B7079"))
                            .padding(.leading, 8)
                        ForEach(bySpace[space] ?? []) { SessionRow(store: store, agent: $0).padding(.leading, 8) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
        }
    }
}

struct SessionRow: View {
    @ObservedObject var store: Store
    let agent: Agent
    @State private var targeted = false

    var body: some View {
        let r = store.reaction(agent)
        HStack(alignment: .top, spacing: 8) {
            StateBadge(reaction: r, size: 14)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Circle().fill(Color(hex: agent.colour)).frame(width: 7, height: 7)
                    Text(agent.label).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                    CLIBadge(cli: agent.cli, size: 12)
                    HostBadge(agent: agent, size: 12)
                    if agent.isMain { MainFlag() }
                    Text(r.rawValue).font(.system(size: 10)).foregroundColor(r.wash.colour)
                }
                if let l = agent.lastLine {
                    Text(l).font(.system(size: 10, design: .monospaced)).foregroundColor(.gray).lineLimit(1)
                }
            }
            Spacer()
            Button { Task { await store.focus(agent) } } label: { Image(systemName: "arrow.up.forward.app") }
                .buttonStyle(.plain)
                .disabled(agent.canFocus == false)
                .help(t("common.jumpToTerminal"))
                .accessibilityLabel(t("common.jumpTo", ["name": agent.label]))
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 6).stroke(Color.accentColor, lineWidth: targeted ? 1.5 : 0))
        .onDrop(of: [.fileURL], isTargeted: agent.canSend ? $targeted : nil) { providers in
            guard agent.canSend, let p = providers.first else { return false }
            _ = p.loadObject(ofClass: URL.self) { url, _ in
                guard let url, url.isFileURL else { return }
                Task { @MainActor in await DropPaste.send(url.path, to: agent, store: store) }
            }
            return true
        }
    }
}

struct MainFlag: View {
    var body: some View {
        Text(t("common.main")).font(.system(size: 9, weight: .heavy))
            .padding(.horizontal, 4).background(Color.purple.opacity(0.6)).cornerRadius(3)
    }
}
