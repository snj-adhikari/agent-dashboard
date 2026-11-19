import AppKit
import CuckooCore
import SwiftUI

enum RecapWeek {
    /** ISO week key, e.g. `2026-W47`, as `GET recap?week=` expects. */
    static func key(_ date: Date = Date()) -> String {
        let c = Calendar(identifier: .iso8601)
        let d = c.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date)
        return String(format: "%04d-W%02d", d.yearForWeekOfYear ?? 0, d.weekOfYear ?? 0)
    }

    static let lastShownKey = "recapLastShown"

    /** Monday 08:00 gate; a first install only records the slot, so the first auto-open is the next Monday. */
    static func due(now: Date = Date()) -> Bool {
        guard UserDefaults.standard.object(forKey: lastShownKey) != nil else {
            markShown(now)
            return false
        }
        let t = UserDefaults.standard.double(forKey: lastShownKey)
        return RecapGate.due(now: now, lastShown: t > 0 ? Date(timeIntervalSince1970: t) : nil, calendar: .current)
    }

    static func markShown(_ now: Date = Date()) {
        UserDefaults.standard.set(now.timeIntervalSince1970, forKey: lastShownKey)
    }
}

/** Stats body shared by the card and the 1080x1920 export. `scale` 1 = island card. */
struct RecapStats: View {
    let recap: RecapResponse
    var scale: CGFloat = 1

    var body: some View {
        VStack(alignment: .leading, spacing: 8 * scale) {
            HStack(spacing: 14 * scale) {
                stat("\(recap.sessions)", t("recap.sessions"))
                stat("\(recap.approvals)", t("recap.approvals"))
                stat("\(recap.finishes)", t("recap.finished"))
                stat("\(recap.errors)", t("recap.errors"))
                stat("\(recap.activeDays)", t("recap.activeDays"))
            }
            if !recap.byCli.isEmpty {
                Text(recap.byCli.sorted { $0.count > $1.count }.prefix(4).map { "\($0.cli) \($0.count)" }.joined(separator: " · "))
                    .font(.system(size: 11 * scale)).foregroundColor(Color(hex: "#C9CDD4")).lineLimit(1)
            }
            if let p = recap.topProjects, !p.isEmpty {
                Text(t("recap.top", ["names": p.prefix(3).map(\.name).joined(separator: ", ")]))
                    .font(.system(size: 11 * scale)).foregroundColor(Color(hex: "#8E939C")).lineLimit(1)
            }
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.system(size: 20 * scale, weight: .bold, design: .rounded)).monospacedDigit()
            Text(label).font(.system(size: 9 * scale)).foregroundColor(.gray)
        }
    }
}

/** Weekly recap card with PNG export to ~/Downloads. */
struct RecapCard: View {
    @ObservedObject var store: Store
    var week = RecapWeek.key()
    @State private var saved: URL?
    @State private var failed = false

    private var recap: RecapResponse? { store.recap?.week == week ? store.recap : nil }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            MascotView(reaction: .celebrating, size: 44, forced: .proud).frame(width: 70)
            VStack(alignment: .leading, spacing: 6) {
                Text(t("recap.title", ["week": week])).font(.system(size: 12, weight: .semibold))
                if let r = recap { RecapStats(recap: r) } else { Text(t("common.loading")).font(.system(size: 11)).foregroundColor(.gray) }
                HStack(spacing: 6) {
                    CardButton(title: t("recap.saveImage"), primary: true) { export() }.disabled(recap == nil)
                    if let saved {
                        CardButton(title: t("recap.show")) { NSWorkspace.shared.activateFileViewerSelecting([saved]) }
                    }
                    if failed { Text(t("error.couldNotSave")).font(.system(size: 10)).foregroundColor(.red) }
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .task(id: week) {
            RecapWeek.markShown()
            _ = await store.loadRecap(week: week)
        }
    }

    @MainActor private func export() {
        guard let r = recap else { return }
        saved = RecapExport.save(r)
        failed = saved == nil
        store.play(failed ? .error : .pop)
    }
}

/** 1080x1920 portrait poster rendered off-screen for sharing. */
struct RecapPoster: View {
    static let size = CGSize(width: 1080, height: 1920)
    let recap: RecapResponse

    var body: some View {
        VStack(spacing: 60) {
            Spacer()
            if let img = MascotArt.image(MascotPose.proud.rawValue) {
                Image(nsImage: img).resizable().interpolation(.high).aspectRatio(contentMode: .fit).frame(width: 420, height: 420)
            }
            Text(t("recap.shareTitle")).font(.system(size: 64, weight: .bold, design: .rounded))
            Text(recap.week).font(.system(size: 40, weight: .medium)).foregroundColor(.gray)
            RecapStats(recap: recap, scale: 3.2)
            Spacer()
            Text("agent-cuckoo").font(.system(size: 30, weight: .medium)).foregroundColor(.gray)
        }
        .foregroundColor(.white)
        .padding(80)
        .frame(width: Self.size.width, height: Self.size.height)
        .background(LinearGradient(colors: [Color(hex: "#1B1D22"), Color(hex: "#0B0C0E")], startPoint: .top, endPoint: .bottom))
    }
}

enum RecapExport {
    /** Renders the poster and writes a new PNG; never replaces an existing file. */
    @MainActor static func save(_ recap: RecapResponse, to dir: URL? = nil) -> URL? {
        let renderer = ImageRenderer(content: RecapPoster(recap: recap))
        renderer.scale = 1
        renderer.proposedSize = ProposedViewSize(RecapPoster.size)
        guard let cg = renderer.cgImage,
              let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]),
              let folder = dir ?? FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first else { return nil }
        let base = "cuckoo-recap-\(recap.week)"
        for n in 1...999 {
            let url = folder.appendingPathComponent(n == 1 ? "\(base).png" : "\(base)-\(n).png")
            do {
                try png.write(to: url, options: .withoutOverwriting)
                return url
            } catch let e as CocoaError where e.code == .fileWriteFileExists {
                continue
            } catch {
                return nil
            }
        }
        return nil
    }
}
