import Foundation

public enum Curve: Equatable {
    case spring(response: Double, damping: Double)
    case bezier(x1: Double, y1: Double, x2: Double, y2: Double, duration: Double)
    case easeInOut(duration: Double)
    case crossFade(duration: Double)
}

/** Island motion values; `reduced` swaps springs and scale/blur for plain cross-fades and freezes the bob. */
public struct Motion: Equatable {
    public static let crossFadeDuration = 0.2

    public let open: Curve
    public let close: Curve
    public let pose: Curve
    public let fadeOut: Double
    public let fadeIn: Double
    public let fadeInDelay: Double
    public let fadeOutScale: Double
    public let fadeOutBlur: Double
    public let staggerStep: Double
    public let bobAmplitude: Double

    public static let standard = Motion(
        open: .spring(response: 0.5, damping: 0.72),
        close: .bezier(x1: 0.45, y1: 0, x2: 0.2, y2: 1, duration: 0.34),
        pose: .easeInOut(duration: 0.4),
        fadeOut: 0.16, fadeIn: 0.3, fadeInDelay: 0.16, fadeOutScale: 0.97, fadeOutBlur: 8,
        staggerStep: 0.035, bobAmplitude: 1)

    public static let reduced = Motion(
        open: .crossFade(duration: crossFadeDuration),
        close: .crossFade(duration: crossFadeDuration),
        pose: .crossFade(duration: crossFadeDuration),
        fadeOut: 0.16, fadeIn: 0.3, fadeInDelay: 0, fadeOutScale: 1, fadeOutBlur: 0,
        staggerStep: 0, bobAmplitude: 0)

    public static func current(reduceMotion: Bool) -> Motion { reduceMotion ? reduced : standard }

    public func stagger(_ index: Int) -> Double { staggerStep * Double(max(0, index)) }
}
