import CuckooCore
import SwiftUI

/** Crypto holdings and prices from side settings; tone ok = up, error = down. */
struct PortfolioCard: View {
    @ObservedObject var store: Store

    var body: some View {
        SideCard(
            store: store, id: .crypto, title: t("portfolio.title"),
            grant: t("portfolio.permission"),
            empty: t("portfolio.empty"),
            rowIcon: { item in
                switch item.tone {
                case "ok": return "arrow.up.right"
                case "error": return "arrow.down.right"
                default: return "minus"
                }
            }
        ) { _, _ in EmptyView() } trailing: { _, _, _ in EmptyView() }
    }
}
