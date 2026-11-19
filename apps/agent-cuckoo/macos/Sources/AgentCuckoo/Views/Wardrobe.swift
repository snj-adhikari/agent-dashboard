import CuckooCore
import SwiftUI

/** UserDefaults keys for the wardrobe and the desktop cuckoo; read with `@AppStorage` wherever the outfit is drawn. */
enum WardrobeKey {
    static let outfit = "cuckooOutfit"
    static let southern = "cuckooSouthern"
    static let desktop = "cuckooOnDesktop"
    static let desktopX = "cuckooDesktopX"
    static let desktopY = "cuckooDesktopY"

    /** The outfit to draw now for a stored selection (`auto` follows the season). */
    static func current(_ selection: String, southern: Bool, now: Date = Date()) -> Outfit {
        Outfit.resolve(selection, on: now, calendar: .current, southern: southern)
    }
}

/** Outfit picker: Auto plus the 12 outfits, each previewed on a small cuckoo; hovering previews on the big one. */
struct WardrobeView: View {
    @AppStorage(WardrobeKey.outfit) private var selection = Outfit.auto
    @AppStorage(WardrobeKey.southern) private var southern = true
    @AppStorage(WardrobeKey.desktop) private var onDesktop = false
    @State private var hovered: String?
    var onPick: (() -> Void)?

    private let options = [Outfit.auto] + Outfit.allCases.map(\.rawValue)
    private let columns = Array(repeating: GridItem(.fixed(64), spacing: 6), count: 5)

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 6) {
                MascotView(reaction: .done, size: 96, outfit: WardrobeKey.current(hovered ?? selection, southern: southern))
                Text(title(hovered ?? selection)).font(.caption).foregroundStyle(.secondary)
                Toggle(t("settings.southernSeasons"), isOn: $southern).toggleStyle(.checkbox).font(.caption)
                Toggle(t("settings.cuckooOnDesktop"), isOn: $onDesktop).toggleStyle(.checkbox).font(.caption)
            }
            .frame(width: 130)
            LazyVGrid(columns: columns, spacing: 6) {
                ForEach(options, id: \.self) { option in
                    Button {
                        selection = option
                        onPick?()
                    } label: {
                        VStack(spacing: 2) {
                            MascotView(reaction: .done, size: 40, animated: false,
                                       outfit: WardrobeKey.current(option, southern: southern))
                            Text(title(option)).font(.system(size: 9)).lineLimit(1)
                        }
                        .frame(width: 64, height: 58)
                        .background(RoundedRectangle(cornerRadius: 8)
                            .fill(option == selection ? Color.accentColor.opacity(0.3) : Color.white.opacity(0.06)))
                    }
                    .buttonStyle(.plain)
                    .onHover { hovered = $0 ? option : nil }
                    .accessibilityLabel(t("wardrobe.outfitNamed", ["name": title(option)]))
                    .accessibilityAddTraits(option == selection ? .isSelected : [])
                }
            }
        }
        .padding(10)
    }

    private func title(_ option: String) -> String {
        option == Outfit.auto ? t("common.auto") : t("outfit.\(option)")
    }
}
