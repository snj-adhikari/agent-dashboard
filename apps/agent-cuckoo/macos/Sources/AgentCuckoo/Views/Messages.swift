import CuckooCore
import SwiftUI

/** WhatsApp unread count and a compose box; compose opens WhatsApp with the text filled in, the user sends it there. */
struct MessagesCard: View {
    @ObservedObject var store: Store
    @State private var draft = ""

    var body: some View {
        SideCard(
            store: store, id: .whatsapp, title: "WhatsApp",
            grant: t("messages.permission"),
            empty: t("messages.empty")
        ) { run, busy in
            HStack(spacing: 6) {
                TextField(t("messages.message"), text: $draft).textFieldStyle(.roundedBorder).font(.system(size: 12))
                CardButton(title: t("messages.openWhatsApp")) {
                    run("compose", nil, draft)
                    draft = ""
                }
                .disabled(busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        } trailing: { _, _, _ in EmptyView() }
    }
}
