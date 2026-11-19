import AVFoundation

/** Bundled Kenney CC0 cues; file names match `assets/sounds/<name>.wav`. */
enum Cue: String, CaseIterable {
    case open, close, peek, blip, approval, question, finish, error, send, pop
    case gulp, tick, listen, timer, proud, poke, greeting
}

/** Preloaded pool of 3 players per cue so quick repeats overlap; a missing file (e.g. `swift run`) is silent. */
final class Sounds {
    private var pools: [Cue: [AVAudioPlayer]] = [:]
    private var next: [Cue: Int] = [:]

    init(bundle: Bundle = .main) {
        for cue in Cue.allCases {
            guard let url = bundle.url(forResource: cue.rawValue, withExtension: "wav", subdirectory: "sounds") else { continue }
            let players = (0..<3).compactMap { _ in try? AVAudioPlayer(contentsOf: url) }
            players.forEach { $0.prepareToPlay() }
            if !players.isEmpty { pools[cue] = players }
        }
    }

    func play(_ cue: Cue, volume: Double) {
        guard volume > 0, let pool = pools[cue] else { return }
        let i = next[cue, default: 0] % pool.count
        next[cue] = i + 1
        let p = pool[i]
        p.volume = Float(volume)
        p.currentTime = 0
        p.play()
    }
}
