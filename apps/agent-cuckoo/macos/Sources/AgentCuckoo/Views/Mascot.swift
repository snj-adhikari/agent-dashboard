import AppKit
import CuckooCore
import SwiftUI

enum MascotArt {
    private static var cache: [String: NSImage] = [:]

    /** Bundled pose PNG from Resources/mascot, preferring @2x; nil when the build did not bundle the art. */
    static func image(_ pose: String) -> NSImage? {
        if let hit = cache[pose] { return hit }
        guard let dir = Bundle.main.resourceURL?.appendingPathComponent("mascot"),
              let img = NSImage(contentsOf: dir.appendingPathComponent("\(pose)@2x.png"))
                ?? NSImage(contentsOf: dir.appendingPathComponent("\(pose).png")) else { return nil }
        cache[pose] = img
        return img
    }
}

/** Extra poses a caller can force over the reaction pose. */
enum MascotPose: String {
    case listening = "cuckoo-listening", box = "cuckoo-box", dizzy = "cuckoo-dizzy"
    case proud = "cuckoo-proud", surprised = "cuckoo-surprised"
}

/**
 * The cuckoo: eased pose change, random blink, bob while working, pop out of the clock on a new approval, a happy
 * jump when a turn finishes, a two-frame dance while music plays and an outfit layer sharing the pose's transform.
 * Under Reduce Motion it only cross-fades poses and the dance freezes on its first frame.
 */
struct MascotView: View {
    static let blinkEvery = 2.2...5.4
    static let firstBlink = 1.5...3.5
    static let blinkFor = 0.12

    let reaction: Reaction
    var size: CGFloat = 58
    var approvalId: String?
    var animated = true
    var outfit: Outfit = .none
    var forced: MascotPose?
    var musicPlaying = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var blinking = false
    @State private var bobUp = false
    @State private var jump: CGFloat = 0
    @State private var inClock = false
    @State private var pop: CGFloat = 1
    @State private var danceStart = Date()

    private var motion: Motion { .current(reduceMotion: reduceMotion) }
    private var live: Bool { animated && !reduceMotion }
    private var dancing: Bool { musicPlaying && forced == nil && !inClock }

    private func pose(at date: Date) -> String {
        if inClock { return "cuckoo-clock" }
        if let forced { return forced.rawValue }
        return Dance.pose(playing: dancing, reduceMotion: !live, elapsed: date.timeIntervalSince(danceStart)) ?? reaction.pose
    }

    var body: some View {
        TimelineView(.periodic(from: danceStart, by: dancing && live ? Dance.frameDuration : 3600)) { ctx in
            let pose = pose(at: dancing && live ? ctx.date : danceStart)
            ZStack {
                art(pose).id(pose).transition(.opacity)
                if blinking && forced == nil && !dancing { art("cuckoo-blink") }
                if outfit != .none, let img = MascotArt.image(outfit.asset) {
                    Image(nsImage: img).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
                        .id(outfit).transition(live ? .opacity.combined(with: .scale(scale: 0.8, anchor: .top)) : .opacity)
                }
            }
            .animation(motion.pose.animation, value: pose)
            .animation(.easeInOut(duration: Outfit.presenceTween), value: outfit)
        }
        .frame(width: size, height: size)
        .scaleEffect(pop, anchor: .bottom)
        .offset(y: jump + (bobUp ? -2 * motion.bobAmplitude : 0))
        .task(id: live) { await blinkLoop() }
        .onAppear(perform: updateBob)
        .onChange(of: reduceMotion) { _ in updateBob() }
        .onChange(of: musicPlaying) { on in
            if on { danceStart = Date() }
            updateBob()
        }
        .onChange(of: reaction) { [old = reaction] new in
            updateBob()
            if new == .celebrating || (new == .done && old != .celebrating) { happyJump() }
        }
        .onChange(of: approvalId) { id in if id != nil { popOut() } }
        .accessibilityLabel(t("mascot.a11y", ["reaction": reaction.rawValue]))
    }

    @ViewBuilder private func art(_ pose: String) -> some View {
        if let img = MascotArt.image(pose) {
            Image(nsImage: img).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
        } else {
            EmojiIcon(name: reaction.emoji, symbol: reaction.symbol, tint: reaction.wash.colour, size: size * 0.8)
        }
    }

    private func updateBob() {
        let bob = live && forced == nil && !musicPlaying && (reaction == .working || reaction == .thinking)
        if bob {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { bobUp = true }
        } else {
            var t = Transaction()
            t.disablesAnimations = true
            withTransaction(t) { bobUp = false }
        }
    }

    private func blinkLoop() async {
        blinking = false
        guard live else { return }
        try? await Task.sleep(nanoseconds: Self.ns(.random(in: Self.firstBlink)))
        while !Task.isCancelled {
            if reaction != .sleeping && !inClock {
                blinking = true
                try? await Task.sleep(nanoseconds: Self.ns(Self.blinkFor))
                blinking = false
            }
            try? await Task.sleep(nanoseconds: Self.ns(.random(in: Self.blinkEvery)))
        }
    }

    private func happyJump() {
        guard live else { return }
        withAnimation(.easeOut(duration: 0.12)) { jump = -size * 0.3 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            withAnimation(.spring(response: 0.36, dampingFraction: 0.55)) { jump = 0 }
        }
    }

    private func popOut() {
        guard live else { return }
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) { inClock = true; pop = 0.7 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            withAnimation(motion.open.animation) { inClock = false; pop = 1 }
        }
    }

    private static func ns(_ s: Double) -> UInt64 { UInt64(s * 1_000_000_000) }
}

/** Small static cuckoo for one session: agent-colour halo plus its state badge. */
struct MiniMascot: View {
    let agent: Agent
    let reaction: Reaction
    var size: CGFloat = 22

    var body: some View {
        MascotView(reaction: reaction, size: size, animated: false)
            .background(Circle().fill(Color(hex: agent.colour).opacity(0.35)))
            .overlay(alignment: .bottomTrailing) {
                StateBadge(reaction: reaction, size: max(7, size * 0.5)).offset(x: size * 0.15, y: size * 0.1)
            }
            .help(agent.label)
    }
}
