import CuckooCore
import SwiftUI

/** Mail triage (reply, later, fyi) and plans; "Draft reply" opens a visible Mail composer and never sends. */
struct MailCard: View {
    @ObservedObject var store: Store

    var body: some View {
        SideCard(
            store: store, id: .mail, title: t("mail.title"),
            grant: t("mail.permission"),
            empty: t("mail.empty"),
            groups: [("reply", t("mail.needsReply")), ("later", t("mail.later")), ("fyi", t("mail.fyi"))]
        ) { run, busy in
            HStack(spacing: 6) {
                CardButton(title: t("mail.triage")) { run("triage", nil, nil) }.disabled(busy)
                CardButton(title: t("mail.planReplies")) { run("plan", nil, nil) }.disabled(busy)
            }
        } trailing: { item, run, busy in
            if item.actions.contains("draft") {
                SideSmallButton(title: t("mail.draftReply"), disabled: busy) { run("draft", item.id, nil) }
            }
        }
    }
}
