import { describe, expect, it } from 'vitest';
import { COMPACT_HIDE_MS, HOME_CLOSE_MS, IslandFsm, type Timers } from './fsm';

function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      pending.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clear: (h) => void pending.delete(h as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      pending.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
  return { timers, advance };
}

describe('IslandFsm', () => {
  it('opens on hover and closes 15 s after leaving', () => {
    const t = fakeTimers();
    const seen: string[] = [];
    const fsm = new IslandFsm(t.timers, () => false, (f, to) => seen.push(`${f}>${to}`));
    fsm.hover(true);
    fsm.hover(false);
    t.advance(HOME_CLOSE_MS - 1);
    expect(fsm.mode).toBe('home');
    t.advance(1);
    expect(fsm.mode).toBe('compact');
    expect(seen).toEqual(['compact>home', 'home>compact']);
  });

  it('stays open while held', () => {
    const t = fakeTimers();
    let held = true;
    const fsm = new IslandFsm(t.timers, () => held);
    fsm.open();
    t.advance(HOME_CLOSE_MS * 3);
    expect(fsm.mode).toBe('home');
    held = false;
    t.advance(HOME_CLOSE_MS);
    expect(fsm.mode).toBe('compact');
  });

  it('hides after 180 s idle and wakes on activity', () => {
    const t = fakeTimers();
    const fsm = new IslandFsm(t.timers, () => false);
    t.advance(COMPACT_HIDE_MS - 1000);
    fsm.activity();
    t.advance(COMPACT_HIDE_MS - 1);
    expect(fsm.mode).toBe('compact');
    t.advance(1);
    expect(fsm.mode).toBe('hidden');
    fsm.activity();
    expect(fsm.mode).toBe('compact');
  });
});
