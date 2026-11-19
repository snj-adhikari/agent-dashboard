import CuckooCore
import SwiftUI

enum Side {
    static func toneColor(_ tone: String?) -> Color {
        switch tone {
        case "ok": return Color(hex: "#4ADE80")
        case "warn": return Color(hex: "#FBBF24")
        case "error": return Color(hex: "#F87171")
        default: return Color(hex: "#8E939C")
        }
    }

    /** Reason code a card can't list for, from the registry and the user's switch; nil when it should list. */
    @MainActor static func blocked(_ store: Store, _ id: SideId) -> String? {
        guard store.sideReady else { return "no_side" }
        guard let p = store.sideProvider(id) else { return "not_installed" }
        if let r = p.reason { return r }
        if !p.enabled || store.sideSettings?.enabled[id.rawValue] != true { return "disabled" }
        return p.available ? nil : "not_installed"
    }

    /** `grant` explains how to allow the macOS permission this provider needs. */
    static func reasonText(_ code: String, grant: String) -> String {
        switch code {
        case "disabled": return t("services.turnOn")
        case "not_installed": return t("services.notInstalledMac")
        case "no_permission": return grant
        case "needs_key": return t("services.needsKey")
        case "signed_out": return t("services.signedOut")
        case "unsupported_os": return t("services.unsupported")
        case "timeout": return t("services.timeout")
        case "no_side": return t("services.noSideFeatures")
        case "offline": return t("common.offline")
        default: return t("services.unavailable", ["code": code])
        }
    }
}

/** One list row; every string is shown verbatim, never parsed as markdown or links. */
struct SideRow<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    var value: String? = nil
    var tone: String? = nil
    var icon: String? = nil
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 8) {
            if let icon {
                Image(systemName: icon).font(.system(size: 10, weight: .bold)).foregroundColor(Side.toneColor(tone)).frame(width: 12)
            } else {
                Circle().fill(Side.toneColor(tone)).frame(width: 6, height: 6).frame(width: 12)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(verbatim: subtitle).font(.system(size: 10.5)).foregroundColor(Color(hex: "#8E939C")).lineLimit(2)
                }
            }
            Spacer(minLength: 4)
            if let value {
                Text(verbatim: value).font(.system(size: 11, weight: .medium).monospacedDigit()).foregroundColor(Side.toneColor(tone))
            }
            trailing()
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.05)))
        .accessibilityElement(children: .combine)
    }
}

extension SideRow where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil, value: String? = nil, tone: String? = nil, icon: String? = nil) {
        self.init(title: title, subtitle: subtitle, value: value, tone: tone, icon: icon) { EmptyView() }
    }
}

struct SideNotice: View {
    let text: String
    var tone: String? = nil
    var body: some View {
        Text(verbatim: text).font(.system(size: 11)).foregroundColor(tone == nil ? Color(hex: "#8E939C") : Side.toneColor(tone))
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SideSmallButton: View {
    let title: String
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 10.5, weight: .semibold)).padding(.horizontal, 8).frame(height: 20)
                .background(Capsule().fill(Color.white.opacity(0.1)))
        }
        .buttonStyle(.plain).disabled(disabled)
    }
}

/**
 * Generic side card shared by Mail, Messages and Portfolio: header, action result, failure and the item list.
 * `run(action, itemId, text)` posts an allow-listed side action; nothing here can send mail or messages.
 */
struct SideCard<Extra: View, Trailing: View>: View {
    @ObservedObject var store: Store
    let id: SideId
    let title: String
    let grant: String
    let empty: String
    var groups: [(key: String, title: String)] = []
    var rowIcon: (SideItem) -> String? = { _ in nil }
    @ViewBuilder var extra: (_ run: @escaping (String, String?, String?) -> Void, _ busy: Bool) -> Extra
    @ViewBuilder var trailing: (SideItem, _ run: @escaping (String, String?, String?) -> Void, _ busy: Bool) -> Trailing

    @State private var busy = false
    @State private var result: String?
    @State private var failed: String?

    private var blocked: String? { Side.blocked(store, id) }
    private var data: SideDataResponse? { store.sideData[id] }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(title).font(.system(size: 13, weight: .semibold))
                if let s = data?.summary, blocked == nil {
                    Text(verbatim: s).font(.system(size: 11)).foregroundColor(Color(hex: "#8E939C")).lineLimit(1)
                }
                Spacer()
                if blocked == nil {
                    Button { Task { await store.refreshSideData(id) } } label: {
                        Image(systemName: "arrow.clockwise").font(.system(size: 11))
                    }
                    .buttonStyle(.plain).disabled(busy).accessibilityLabel(t("common.refresh"))
                }
            }
            if let blocked {
                SideNotice(text: Side.reasonText(blocked, grant: grant), tone: blocked == "disabled" ? nil : "warn")
                Spacer(minLength: 0)
            } else {
                extra(run, busy)
                if let failed { SideNotice(text: Side.reasonText(failed, grant: grant), tone: "error") }
                if let result, !result.isEmpty {
                    ScrollView {
                        Text(verbatim: result).font(.system(size: 11)).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 56)
                }
                list
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    @ViewBuilder private var list: some View {
        let items = data?.items ?? []
        if items.isEmpty {
            SideNotice(text: empty)
            Spacer(minLength: 0)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(sections(items), id: \.title) { s in
                        if !s.title.isEmpty {
                            Text(s.title.uppercased()).font(.system(size: 9.5, weight: .bold)).foregroundColor(Color(hex: "#6B7079"))
                                .padding(.top, 2)
                        }
                        ForEach(s.items) { item in
                            SideRow(title: item.title, subtitle: item.subtitle, value: item.value, tone: item.tone, icon: rowIcon(item)) {
                                trailing(item, run, busy)
                                if item.actions.contains("open") {
                                    Button { run("open", item.id, nil) } label: {
                                        Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold))
                                    }
                                    .buttonStyle(.plain).disabled(busy).accessibilityLabel(t("common.open"))
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func sections(_ items: [SideItem]) -> [(title: String, items: [SideItem])] {
        guard !groups.isEmpty else { return [("", items)] }
        var out = groups.map { g in (title: g.title, items: items.filter { $0.group == g.key }) }
        let known = Set(groups.map(\.key))
        out.append((title: t("common.other"), items: items.filter { !known.contains($0.group ?? "") }))
        return out.filter { !$0.items.isEmpty }
    }

    private func run(_ action: String, _ itemId: String?, _ text: String?) {
        busy = true
        failed = nil
        Task {
            let r = await store.sideAction(id, action, itemId: itemId, text: text)
            if let code = store.lastErrorCode { failed = code } else if let r { result = r }
            busy = false
        }
    }
}

/** Per-service status rows (GitHub, Vercel, Stripe, n8n, Resend, Notion, Cal.com) with each service's items below. */
struct ServicesCard: View {
    @ObservedObject var store: Store
    @State private var busy = false
    @State private var failed: String?

    static let services: [(id: SideId, name: String)] = [
        (.github, "GitHub"), (.vercel, "Vercel"), (.stripe, "Stripe"), (.n8n, "n8n"),
        (.resend, "Resend"), (.notion, "Notion"), (.calcom, "Cal.com"),
    ]
    private static var grant: String { t("services.allowConnector") }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(t("services.title")).font(.system(size: 13, weight: .semibold))
                Spacer()
                Button { Task { await store.refreshSide() } } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 11))
                }
                .buttonStyle(.plain).disabled(busy).accessibilityLabel(t("common.refresh"))
            }
            if let failed { SideNotice(text: Side.reasonText(failed, grant: Self.grant), tone: "error") }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(Self.services, id: \.id) { s in section(s.id, s.name) }
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    @ViewBuilder private func section(_ id: SideId, _ name: String) -> some View {
        let blocked = Side.blocked(store, id)
        let data = store.sideData[id]
        if let blocked {
            SideRow(title: name, subtitle: Side.reasonText(blocked, grant: Self.grant), tone: blocked == "disabled" ? nil : "warn")
        } else {
            SideRow(title: name, subtitle: data?.summary ?? t("common.connected"), tone: "ok")
            ForEach(data?.items ?? []) { item in
                SideRow(title: item.title, subtitle: item.subtitle, value: item.value, tone: item.tone) {
                    if item.actions.contains("open") {
                        Button { open(id, item.id) } label: {
                            Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold))
                        }
                        .buttonStyle(.plain).disabled(busy).accessibilityLabel(t("common.open"))
                    }
                }
                .padding(.leading, 14)
            }
        }
    }

    private func open(_ id: SideId, _ itemId: String) {
        busy = true
        failed = nil
        Task {
            await store.sideAction(id, "open", itemId: itemId)
            failed = store.lastErrorCode
            busy = false
        }
    }
}
