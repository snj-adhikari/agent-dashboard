import Foundation

/** Dropped-file sequence: box morph, swallow (gulp cue), upload progress with a tick per 10%, then the choose view. */
public struct UploadTimeline {
    public static let morph: TimeInterval = 0.38
    public static let swallow: TimeInterval = 0.36
    public static let gulpAt: TimeInterval = 0.33
    public static let uploadMin: TimeInterval = 1.2
    public static let uploadMax: TimeInterval = 2.1
    public static let ticks = 10
    public static let morphSpring = (response: 0.36, damping: 0.72)
    public static let pose = "cuckoo-box"

    public enum Phase: Equatable { case morph, swallow, uploading(Double), choose }
    public enum Cue: Equatable { case gulp, tick(Int) }

    public let uploadFor: TimeInterval

    /** `random` uniform 0..<1 picks the upload length within 1.2-2.1 s. */
    public init(random: Double) {
        uploadFor = Self.uploadMin + (Self.uploadMax - Self.uploadMin) * min(max(random, 0), 1)
    }

    public var total: TimeInterval { Self.morph + Self.swallow + uploadFor }

    /** `t` = seconds since the drop. Holds at 100% until the real upload has `uploaded`. */
    public func phase(at t: TimeInterval, uploaded: Bool) -> Phase {
        if t < Self.morph { return .morph }
        if t < Self.morph + Self.swallow { return .swallow }
        let p = min(1, (t - Self.morph - Self.swallow) / uploadFor)
        return p >= 1 && uploaded ? .choose : .uploading(p)
    }

    /** Cues crossed in (from, to]: gulp `gulpAt` into the swallow, tick(n) at n x 10% of the upload. */
    public func cues(from a: TimeInterval, to b: TimeInterval) -> [Cue] {
        let up = Self.morph + Self.swallow
        let times = [(Self.morph + Self.gulpAt, Cue.gulp)]
            + (1...Self.ticks).map { (up + uploadFor * Double($0) / Double(Self.ticks), Cue.tick($0)) }
        return times.filter { $0.0 > a && $0.0 <= b }.map(\.1)
    }
}
