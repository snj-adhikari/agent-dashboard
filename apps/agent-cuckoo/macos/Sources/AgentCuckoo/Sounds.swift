import AVFoundation

enum Cue {
    case approval, waiting, done

    var notes: [(freq: Double, dur: Double)] {
        switch self {
        case .approval: return [(880, 0.09), (1175, 0.12)]
        case .waiting: return [(660, 0.10), (660, 0.10)]
        case .done: return [(523, 0.08), (659, 0.08), (784, 0.14)]
        }
    }
}

/** Tones synthesised on the fly so the app ships no audio files. */
final class Sounds {
    private let engine = AVAudioEngine()
    private var queue: [(freq: Double, frames: Int)] = []
    private var phase = 0.0
    private var left = 0
    private var freq = 0.0
    private let lock = NSLock()
    private var started = false

    private lazy var source: AVAudioSourceNode = AVAudioSourceNode { [unowned self] _, _, count, abl in
        let buffers = UnsafeMutableAudioBufferListPointer(abl)
        let rate = 44_100.0
        lock.lock(); defer { lock.unlock() }
        for i in 0..<Int(count) {
            if left == 0, !queue.isEmpty {
                let n = queue.removeFirst()
                freq = n.freq; left = n.frames
            }
            var v: Float = 0
            if left > 0 {
                let env = min(1, Double(left) / 800)
                v = freq > 0 ? Float(sin(phase) * 0.18 * env) : 0
                phase += 2 * .pi * freq / rate
                left -= 1
            }
            for b in buffers { b.mData?.assumingMemoryBound(to: Float.self)[i] = v }
        }
        return noErr
    }

    func play(_ cue: Cue) {
        if !started {
            let fmt = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)
            engine.attach(source)
            engine.connect(source, to: engine.mainMixerNode, format: fmt)
            started = (try? engine.start()) != nil
            if !started { return }
        }
        lock.lock()
        queue += cue.notes.flatMap { [($0.freq, Int($0.dur * 44_100)), (0, 1_500)] }
        lock.unlock()
    }
}
