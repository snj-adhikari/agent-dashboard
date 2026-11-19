import { describe, expect, it } from 'vitest';
import { COMPACT_HIDE_MS, FINISHED_PIN_MS, HOME_CLOSE_MS, HOVER_GRACE_MS, IslandFsm, type FsmOptions, type Timers } from './fsm';

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

function make(held: () => boolean = () => false, options: Partial<FsmOptions> = {}) {
  const t = fakeTimers();
  const seen: string[] = [];
  const fsm = new IslandFsm(t.timers, held, (f, to) => seen.push(`${f}>${to}`), options);
  return { fsm, t, seen };
}

function hidden() {
  const m = make();
  m.t.advance(COMPACT_HIDE_MS);
  m.seen.length = 0;
  return m;
}

describe('fsm', () => {
  it('hover peeks from hidden to compact without opening', () => {
    const { fsm, seen } = hidden();
    fsm.hover(true);
    expect(fsm.mode).toBe('compact');
    expect(seen).toEqual(['hidden>compact']);
  });

  it('open on hover folds 0.6 s after leaving', () => {
    const { fsm, t } = make(undefined, { openOnHover: true });
    fsm.hover(true);
    expect(fsm.mode).toBe('home');
    fsm.hover(false);
    t.advance(HOVER_GRACE_MS - 1);
    expect(fsm.mode).toBe('home');
    t.advance(1);
    expect(fsm.mode).toBe('compact');
  });

  it('click inside a hover-opened island makes it a normal open', () => {
    const { fsm, t } = make(undefined, { openOnHover: true });
    fsm.hover(true);
    fsm.click();
    fsm.hover(false);
    t.advance(HOVER_GRACE_MS);
    expect(fsm.mode).toBe('home');
    t.advance(HOME_CLOSE_MS - HOVER_GRACE_MS);
    expect(fsm.mode).toBe('compact');
  });

  it('click opens and auto-closes 15 s after the pointer leaves', () => {
    const { fsm, t, seen } = make();
    fsm.hover(true);
    fsm.click();
    t.advance(HOME_CLOSE_MS * 2);
    expect(fsm.mode).toBe('home');
    fsm.hover(false);
    t.advance(HOME_CLOSE_MS - 1);
    expect(fsm.mode).toBe('home');
    t.advance(1);
    expect(seen).toEqual(['compact>home', 'home>compact']);
  });

  it('esc collapses home to compact', () => {
    const { fsm } = make();
    fsm.click();
    fsm.esc();
    expect(fsm.mode).toBe('compact');
    fsm.esc();
    expect(fsm.mode).toBe('compact');
  });

  it('absence hides compact after 180 s and activity wakes it', () => {
    const { fsm, t } = make();
    t.advance(COMPACT_HIDE_MS - 1000);
    fsm.activity();
    t.advance(COMPACT_HIDE_MS - 1);
    expect(fsm.mode).toBe('compact');
    t.advance(1);
    expect(fsm.mode).toBe('hidden');
    fsm.activity();
    expect(fsm.mode).toBe('compact');
  });

  it('held open while an approval waits', () => {
    let held = true;
    const { fsm, t } = make(() => held);
    fsm.open();
    t.advance(HOME_CLOSE_MS * 3);
    expect(fsm.mode).toBe('home');
    held = false;
    t.advance(HOME_CLOSE_MS);
    expect(fsm.mode).toBe('compact');
  });

  it('finished pins the island 5.2 s then collapses', () => {
    const { fsm, t } = hidden();
    fsm.finished();
    expect(fsm.mode).toBe('home');
    fsm.hover(true);
    fsm.hover(false);
    t.advance(FINISHED_PIN_MS - 1);
    expect(fsm.mode).toBe('home');
    t.advance(1);
    expect(fsm.mode).toBe('compact');
  });

  it('alerts force-expand even when hidden', () => {
    const { fsm } = hidden();
    fsm.alert();
    expect(fsm.mode).toBe('home');
  });

  it('non-alert work only reveals compact', () => {
    const { fsm } = hidden();
    fsm.reveal();
    expect(fsm.mode).toBe('compact');
    fsm.reveal();
    expect(fsm.mode).toBe('compact');
  });
});

describe('fsm listening', () => {
  it('fsm listening is a flag over the mode; from hidden it shows compact', () => {
    const { fsm } = hidden();
    fsm.voiceWoke();
    expect(fsm.listening).toBe(true);
    expect(fsm.mode).toBe('compact');
    fsm.voiceFinished();
    expect([fsm.listening, fsm.mode]).toEqual([false, 'compact']);
  });

  it('fsm listening finish returns to home when woken over home', () => {
    const { fsm } = make();
    fsm.click();
    fsm.voiceWoke();
    expect(fsm.mode).toBe('home');
    fsm.voiceFinished();
    expect([fsm.listening, fsm.mode]).toEqual([false, 'home']);
  });

  it('fsm listening timers pause while listening and resume after', () => {
    const { fsm, t } = make();
    fsm.click();
    fsm.voiceWoke();
    t.advance(HOME_CLOSE_MS * 2);
    expect(fsm.mode).toBe('home');
    fsm.voiceFinished();
    t.advance(HOME_CLOSE_MS);
    expect(fsm.mode).toBe('compact');
  });

  it('fsm listening click leaves listening and opens home', () => {
    const { fsm } = make();
    fsm.voiceWoke();
    fsm.click();
    expect([fsm.listening, fsm.mode]).toEqual([false, 'home']);
  });

  it('fsm listening hover leaves listening only with open-on-hover', () => {
    const plain = make();
    plain.fsm.voiceWoke();
    plain.fsm.hover(true);
    expect([plain.fsm.listening, plain.fsm.mode]).toEqual([true, 'compact']);
    const onHover = make(() => false, { openOnHover: true });
    onHover.fsm.voiceWoke();
    onHover.fsm.hover(true);
    expect([onHover.fsm.listening, onHover.fsm.mode]).toEqual([false, 'home']);
  });

  it('fsm listening leave is a no-op', () => {
    const { fsm, t } = make();
    fsm.voiceWoke();
    fsm.hover(true);
    fsm.hover(false);
    t.advance(COMPACT_HIDE_MS * 2);
    expect([fsm.listening, fsm.mode]).toEqual([true, 'compact']);
  });

  it('fsm listening esc ends listening and collapses', () => {
    const { fsm } = make();
    fsm.click();
    fsm.voiceWoke();
    fsm.esc();
    expect([fsm.listening, fsm.mode]).toEqual([false, 'compact']);
  });
});
