import { describe, expect, it } from 'vitest';
import { UPLOAD_VIEW_H, uploadPct, uploadPhaseAt, uploadTimeline } from './uploadTimeline';

describe('upload timeline', () => {
  it('upload timeline morph 380, swallow 360, gulp 330 into the swallow', () => {
    const tl = uploadTimeline(0);
    expect(tl.slice(0, 4)).toEqual([
      { at: 0, kind: 'morph' },
      { at: 380, kind: 'swallow' },
      { at: 710, kind: 'gulp' },
      { at: 740, kind: 'upload' },
    ]);
    expect(UPLOAD_VIEW_H).toBe(176);
  });

  it('upload timeline ticks every 10% over 1.2-2.1 s then chooses', () => {
    const fast = uploadTimeline(0);
    const ticks = fast.filter((e) => e.kind === 'tick');
    expect(ticks).toHaveLength(10);
    expect(ticks[0]).toEqual({ at: 740 + 120, kind: 'tick', pct: 10 });
    expect(fast.at(-1)).toEqual({ at: 740 + 1_200, kind: 'choose' });
    expect(uploadTimeline(1).at(-1)).toEqual({ at: 740 + 2_100, kind: 'choose' });
  });

  it('upload timeline phase at a time', () => {
    const tl = uploadTimeline(0);
    expect([0, 379, 380, 739, 740, 1_939, 1_940].map((t) => uploadPhaseAt(t, tl, true))).toEqual([
      'morph', 'morph', 'swallow', 'swallow', 'upload', 'upload', 'choose',
    ]);
  });

  it('upload timeline holds at 100% until the real upload finishes', () => {
    const tl = uploadTimeline(0);
    expect(uploadPct(860, tl)).toBe(10);
    expect(uploadPhaseAt(9_999, tl, false)).toBe('upload');
    expect(uploadPct(9_999, tl)).toBe(100);
    expect(uploadPhaseAt(9_999, tl, true)).toBe('choose');
  });
});
