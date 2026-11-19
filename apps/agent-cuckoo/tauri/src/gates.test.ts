import { describe, expect, it } from 'vitest';
import { GUIDE_PAGES, guideDue, guideStep, recapAnchor, recapDue, whatsNew, whatsNewDelayMs, WHATS_NEW_MAX_RETRIES } from './gates';

describe('guide gate', () => {
  it('guide gate shows once until dismissed', () => {
    expect(guideDue(undefined)).toBe(true);
    expect(guideDue(false)).toBe(true);
    expect(guideDue(true)).toBe(false);
  });

  it('guide gate has 3-4 pages and clamps paging', () => {
    expect(GUIDE_PAGES.length).toBeGreaterThanOrEqual(3);
    expect(GUIDE_PAGES.length).toBeLessThanOrEqual(4);
    expect(guideStep(0, -1)).toBe(0);
    expect(guideStep(1, 1)).toBe(2);
    expect(guideStep(GUIDE_PAGES.length - 1, 1)).toBe(GUIDE_PAGES.length - 1);
  });
});

describe('recap gate', () => {
  it('recap gate anchors on Monday 08:00 local', () => {
    expect(recapAnchor(new Date(2026, 10, 16, 8, 0))).toEqual(new Date(2026, 10, 16, 8));
    expect(recapAnchor(new Date(2026, 10, 19, 1))).toEqual(new Date(2026, 10, 16, 8));
    expect(recapAnchor(new Date(2026, 10, 16, 7, 59))).toEqual(new Date(2026, 10, 9, 8));
  });

  it('recap gate shows once per week from Monday 08:00', () => {
    const shownMon = new Date(2026, 10, 16, 9).getTime();
    expect(recapDue(new Date(2026, 10, 16, 8), new Date(2026, 10, 10).getTime())).toBe(true);
    expect(recapDue(new Date(2026, 10, 18, 12), shownMon)).toBe(false);
    expect(recapDue(new Date(2026, 10, 23, 7, 59), shownMon)).toBe(false);
    expect(recapDue(new Date(2026, 10, 23, 8), shownMon)).toBe(true);
    expect(recapDue(new Date(2026, 10, 18), null)).toBe(true);
  });
});

describe('whats-new gate', () => {
  it('whats-new gate is version keyed and skips a first install', () => {
    expect(whatsNew('1.2.0', '1.2.0', 0, true)).toBe('skip');
    expect(whatsNew('1.2.0', '1.1.0', 0, true)).toBe('show');
    expect(whatsNew('1.2.0', null, 0, true)).toBe('skip');
  });

  it('whats-new gate waits 4 s then retries every 15 s up to 12 times while busy', () => {
    expect(whatsNewDelayMs(0)).toBe(4_000);
    expect(whatsNewDelayMs(1)).toBe(15_000);
    expect(whatsNew('2', '1', 0, false)).toBe('retry');
    expect(whatsNew('2', '1', WHATS_NEW_MAX_RETRIES - 1, false)).toBe('retry');
    expect(whatsNew('2', '1', WHATS_NEW_MAX_RETRIES, false)).toBe('give-up');
    expect(whatsNew('2', '1', WHATS_NEW_MAX_RETRIES, true)).toBe('show');
  });
});
