import { describe, expect, it } from 'vitest';
import { countdown, idle, LONG_BREAK_MS, pause, remaining, SHORT_BREAK_MS, start, tick, WORK_MS, type TimerState } from './timer';

function finish(s: TimerState, now: number) {
  const started = start(s, now);
  return tick(started, started.endsAt!);
}

describe('timer', () => {
  it('timer work is 25 min then a 5 min break', () => {
    const s = start(idle(), 0);
    expect(remaining(s, 0)).toBe(WORK_MS);
    expect(tick(s, WORK_MS - 1).finished).toBeNull();
    const done = tick(s, WORK_MS);
    expect(done.finished).toBe('work');
    expect(done.state.phase).toBe('short');
    expect(remaining(done.state, WORK_MS)).toBe(SHORT_BREAK_MS);
  });

  it('timer long break of 15 min after every 4th work', () => {
    let s = idle();
    const phases: string[] = [];
    let longLeft = 0;
    for (let i = 0; i < 8; i++) {
      s = finish(s, 0).state;
      phases.push(s.phase);
      if (s.phase === 'long') longLeft = remaining(s, 0);
    }
    expect(phases).toEqual(['short', 'work', 'short', 'work', 'short', 'work', 'long', 'work']);
    expect(longLeft).toBe(LONG_BREAK_MS);
  });

  it('timer survives restart through JSON', () => {
    const s = start(idle(), 1_000);
    const restored = JSON.parse(JSON.stringify(s)) as TimerState;
    expect(remaining(restored, 61_000)).toBe(WORK_MS - 60_000);
    expect(tick(restored, 1_000 + WORK_MS + 999_999).finished).toBe('work');
  });

  it('timer pause keeps the remaining time', () => {
    const p = pause(start(idle(), 0), 60_000);
    expect(remaining(p, 999_999)).toBe(WORK_MS - 60_000);
    expect(start(p, 100_000).endsAt).toBe(100_000 + WORK_MS - 60_000);
  });

  it('timer countdown pill text', () => {
    expect(countdown(WORK_MS)).toBe('25:00');
    expect(countdown(61_001)).toBe('1:02');
    expect(countdown(0)).toBe('0:00');
  });
});
