export interface SpringSpec { kind: 'spring'; response: number; damping: number }
export interface CurveSpec { kind: 'curve'; bezier: [number, number, number, number]; ms: number }
export interface FadeSpec { kind: 'fade'; ms: number }
export type Transition = SpringSpec | CurveSpec | FadeSpec;

export interface Motion {
  open: Transition;
  close: Transition;
  contentOutMs: number;
  contentInMs: number;
  contentInDelayMs: number;
  staggerMs: number;
  bob: boolean;
}

export const OPEN_SPRING: SpringSpec = { kind: 'spring', response: 0.5, damping: 0.72 };
export const CLOSE_CURVE: CurveSpec = { kind: 'curve', bezier: [0.45, 0, 0.2, 1], ms: 340 };
export const CROSS_FADE_MS = 200;

export function motion(reduced: boolean): Motion {
  if (reduced) {
    const fade: FadeSpec = { kind: 'fade', ms: CROSS_FADE_MS };
    return { open: fade, close: fade, contentOutMs: 0, contentInMs: CROSS_FADE_MS, contentInDelayMs: 0, staggerMs: 0, bob: false };
  }
  return { open: OPEN_SPRING, close: CLOSE_CURVE, contentOutMs: 160, contentInMs: 300, contentInDelayMs: 160, staggerMs: 35, bob: true };
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Position of a SwiftUI-style spring from 0 to 1 at time `t` seconds: omega = 2π / response, zeta = damping, 240 Hz sub-steps. */
export function springAt(spec: Pick<SpringSpec, 'response' | 'damping'>, t: number): number {
  const omega = (2 * Math.PI) / spec.response;
  const dt = 1 / 240;
  let x = 0;
  let v = 0;
  for (let s = 0; s < t; s += dt) {
    const step = Math.min(dt, t - s);
    v += (-omega * omega * (x - 1) - 2 * spec.damping * omega * v) * step;
    x += v * step;
  }
  return x;
}

/** CSS-style cubic-bezier easing: progress for linear time `t` in 0..1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

export const closeEase = cubicBezier(...CLOSE_CURVE.bezier);

export function cssTransition(t: Transition): string {
  if (t.kind === 'fade') return `opacity ${t.ms}ms ease`;
  if (t.kind === 'curve') return `${t.ms}ms cubic-bezier(${t.bezier.join(',')})`;
  return `${Math.round(t.response * 1000)}ms cubic-bezier(.3,1.2,.4,1)`;
}
