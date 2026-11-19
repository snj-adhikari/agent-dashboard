import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_CURVE, closeEase, cssTransition, motion, OPEN_SPRING, prefersReducedMotion, springAt } from './motion';

afterEach(() => vi.unstubAllGlobals());

describe('motion', () => {
  it('motion uses the open spring and close curve', () => {
    const m = motion(false);
    expect(m.open).toEqual({ kind: 'spring', response: 0.5, damping: 0.72 });
    expect(m.close).toEqual({ kind: 'curve', bezier: [0.45, 0, 0.2, 1], ms: 340 });
    expect([m.contentOutMs, m.contentInMs, m.contentInDelayMs, m.staggerMs, m.bob]).toEqual([160, 300, 160, 35, true]);
  });

  it('motion reduced cross-fades with no spring, stagger or bob', () => {
    const m = motion(true);
    expect([m.open.kind, m.close.kind, m.staggerMs, m.bob]).toEqual(['fade', 'fade', 0, false]);
    expect(cssTransition(m.open)).toBe('opacity 200ms ease');
  });

  it('motion reduced follows prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }));
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });

  it('motion spring overshoots then settles', () => {
    const samples = Array.from({ length: 60 }, (_, i) => springAt(OPEN_SPRING, i / 60));
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(springAt(OPEN_SPRING, 2)).toBeCloseTo(1, 3);
  });

  it('motion close curve eases from 0 to 1', () => {
    expect([closeEase(0), closeEase(1)]).toEqual([0, 1]);
    expect(closeEase(0.25)).toBeLessThan(0.25);
    expect(closeEase(0.75)).toBeGreaterThan(0.75);
    expect(cssTransition(CLOSE_CURVE)).toBe('340ms cubic-bezier(0.45,0,0.2,1)');
  });
});
