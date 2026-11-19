import CuckooCore
import SwiftUI

/** Persists `CuckooTimer` as JSON under one defaults key so card and pill share it and it survives a restart. */
struct StoredTimer: DynamicProperty {
    static let key = "cuckooTimer"
    @AppStorage(StoredTimer.key) private var data = Data()

    var value: CuckooTimer {
        get { (try? JSONDecoder().decode(CuckooTimer.self, from: data)) ?? CuckooTimer() }
        nonmutating set { data = (try? JSONEncoder().encode(newValue)) ?? Data() }
    }

    /** Moves past a finished phase; plays the finish sound and reveals the island once per phase end. */
    @MainActor func tick(store: Store) {
        var t = value
        guard t.advance(now: Date().timeIntervalSince1970) != nil else { return }
        value = t
        store.play(.timer)
        store.onIslandEvent?(.finished)
    }
}

extension CuckooTimer.Phase {
    var label: String {
        switch self {
        case .focus: return t("timer.focus")
        case .shortBreak: return t("timer.shortBreak")
        case .longBreak: return t("timer.longBreak")
        }
    }

    var tint: Color {
        switch self {
        case .focus: return Color(red: 245 / 255, green: 165 / 255, blue: 36 / 255)
        case .shortBreak, .longBreak: return Color(red: 52 / 255, green: 211 / 255, blue: 153 / 255)
        }
    }
}

enum TimerText {
    static func clock(_ s: TimeInterval) -> String {
        let n = Int(s.rounded(.up))
        return String(format: "%d:%02d", n / 60, n % 60)
    }
}

/** Cuckoo clock: 25/5 focus timer with a ring, clock pose and start/pause/skip/reset. */
struct TimerCard: View {
    @ObservedObject var store: Store
    private let stored = StoredTimer()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let t = stored.value
            let now = ctx.date.timeIntervalSince1970
            let left = t.remaining(now: now)
            let progress = 1 - left / CuckooTimer.length(t.phase)
            HStack(spacing: 14) {
                ZStack {
                    Circle().stroke(Color.white.opacity(0.1), lineWidth: 6)
                    Circle().trim(from: 0, to: progress)
                        .stroke(t.phase.tint, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(reduceMotion ? nil : .linear(duration: 1), value: progress)
                    clockPose.frame(width: 52, height: 52)
                }
                .frame(width: 84, height: 84)
                VStack(alignment: .leading, spacing: 6) {
                    Text(t.phase.label).font(.system(size: 12, weight: .semibold)).foregroundColor(t.phase.tint)
                    Text(TimerText.clock(left)).font(.system(size: 28, weight: .semibold, design: .rounded)).monospacedDigit()
                    Text(CuckooCore.t("timer.untilLong", ["done": String(t.focusDone % CuckooTimer.longBreakEvery), "total": String(CuckooTimer.longBreakEvery)]))
                        .font(.system(size: 10)).foregroundColor(.gray)
                    HStack(spacing: 6) {
                        CardButton(title: t.running ? CuckooCore.t("common.pause") : CuckooCore.t("common.start"), primary: true) { toggle() }
                        CardButton(title: CuckooCore.t("common.skip")) { skip() }
                        CardButton(title: CuckooCore.t("common.reset")) { stored.value = CuckooTimer() }
                    }
                }
                Spacer(minLength: 0)
            }
            .onChange(of: Int(now)) { _ in stored.tick(store: store) }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .onAppear { stored.tick(store: store) }
    }

    @ViewBuilder private var clockPose: some View {
        if let img = MascotArt.image(CuckooTimer.pose) {
            Image(nsImage: img).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
        } else {
            Image(systemName: "clock").font(.system(size: 26)).foregroundColor(.white.opacity(0.7))
        }
    }

    private func toggle() {
        var t = stored.value
        let now = Date().timeIntervalSince1970
        if t.running { t.pause(now: now) } else { t.start(now: now) }
        stored.value = t
        store.play(.tick)
    }

    /** Ends the current phase now, without the finish sound. */
    private func skip() {
        var t = stored.value
        let now = Date().timeIntervalSince1970
        if !t.running { t.start(now: now) }
        _ = t.advance(now: now + t.remaining(now: now))
        stored.value = t
    }
}

/** Compact countdown pill; also keeps the timer ticking while the island is collapsed. Nil body when idle. */
struct TimerPill: View {
    @ObservedObject var store: Store
    private let stored = StoredTimer()

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let t = stored.value
            let now = ctx.date.timeIntervalSince1970
            Group {
                if t.running {
                    HStack(spacing: 4) {
                        Image(systemName: "clock.fill").font(.system(size: 9)).foregroundColor(t.phase.tint)
                        Text(TimerText.clock(t.remaining(now: now))).font(.system(size: 10, weight: .semibold)).monospacedDigit()
                    }
                    .padding(.horizontal, 6).frame(height: 20)
                    .background(Capsule().fill(Color.white.opacity(0.08)))
                    .accessibilityLabel(CuckooCore.t("timer.a11y", ["phase": t.phase.label, "time": TimerText.clock(t.remaining(now: now))]))
                }
            }
            .onChange(of: Int(now)) { _ in stored.tick(store: store) }
        }
        .onAppear { stored.tick(store: store) }
    }
}
