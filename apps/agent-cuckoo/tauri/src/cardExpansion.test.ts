import { describe, expect, it } from 'vitest';
import { CardExpansion, HEADER_H, ISLAND_MAX_H, ISLAND_PAD_H, islandHeight, isLong } from './cardExpansion';

describe('island height', () => {
  it('island height follows content between base and max', () => {
    expect(islandHeight({ base: 160, content: 200, collapsed: false, max: 900 })).toBe(HEADER_H + 200 + ISLAND_PAD_H);
    expect(islandHeight({ base: 160, content: 40, collapsed: false, max: 900 })).toBe(160);
  });

  it('island height caps at 520 and at the window', () => {
    expect(islandHeight({ base: 160, content: 2000, collapsed: false, max: 900 })).toBe(ISLAND_MAX_H);
    expect(islandHeight({ base: 160, content: 2000, collapsed: false, max: 320 })).toBe(320);
  });

  it('island height collapsed is the header row only', () => {
    expect(islandHeight({ base: 160, content: 400, collapsed: true, max: 900 })).toBe(HEADER_H + ISLAND_PAD_H);
  });

  it('island height without measured content keeps the tab base', () => {
    expect(islandHeight({ base: 280, content: null, collapsed: false, max: 900 })).toBe(280);
  });
});

describe('card expansion', () => {
  it('card expansion toggles per id with a fallback', () => {
    const c = new CardExpansion();
    expect(c.isOpen('a')).toBe(false);
    expect(c.isOpen('b', true)).toBe(true);
    expect(c.toggle('a')).toBe(true);
    expect(c.toggle('b', true)).toBe(false);
    expect([c.isOpen('a'), c.isOpen('b', true)]).toEqual([true, false]);
  });

  it('card expansion forgets cards that disappear', () => {
    const c = new CardExpansion();
    c.toggle('a');
    c.toggle('b');
    c.prune(['b']);
    expect([c.isOpen('a'), c.isOpen('b')]).toEqual([false, true]);
  });

  it('card expansion clamps long text only', () => {
    expect(isLong('Allow?')).toBe(false);
    expect(isLong('x'.repeat(400))).toBe(true);
    expect(isLong('a\nb\nc\nd')).toBe(true);
    expect(isLong('a\nb\nc')).toBe(false);
  });
});
