import { describe, expect, it } from 'vitest';
import { blinkMs, doubleBlink, DANCE_FRAME_MS, danceFrame, emojiOf, firstBlinkMs, poseOf, reaction, SLEEP_MS, THINKING_MS } from './reaction';

const now = 1_000_000;

describe('reaction', () => {
  it('reaction maps working and goes thinking after a quiet spell', () => {
    expect(reaction({ state: 'working', lastActiveAt: now - 1000 }, { now })).toBe('working');
    expect(reaction({ state: 'working', lastActiveAt: now - THINKING_MS }, { now })).toBe('thinking');
    expect(reaction({ state: 'working', lastActiveAt: null }, { now })).toBe('working');
  });

  it('reaction maps waiting, done, celebrating and sleeping', () => {
    expect(reaction({ state: 'waiting', lastActiveAt: 0 }, { now })).toBe('waiting');
    expect(reaction({ state: 'done', lastActiveAt: now - 1 }, { now })).toBe('done');
    expect(reaction({ state: 'done', lastActiveAt: now - 1 }, { now, justFinished: true })).toBe('celebrating');
    expect(reaction({ state: 'done', lastActiveAt: now - SLEEP_MS }, { now })).toBe('sleeping');
    expect(reaction({ state: 'unknown', lastActiveAt: now }, { now })).toBe('sleeping');
    expect(reaction(null, { now })).toBe('sleeping');
  });

  it('reaction is error when agent-monitor is offline', () => {
    expect(reaction({ state: 'working', lastActiveAt: now }, { now, offline: true })).toBe('error');
    expect(reaction(null, { now, offline: true })).toBe('error');
  });

  it('reaction poses and emoji match the asset names', () => {
    expect(['working', 'thinking', 'waiting', 'done', 'error', 'sleeping', 'celebrating'].map((r) => poseOf(r as never))).toEqual([
      'working', 'thinking', 'waiting', 'happy', 'alarmed', 'sleepy', 'celebrate',
    ]);
    expect(emojiOf('celebrating')).toBe('celebrating');
  });
});

describe('reaction dance', () => {
  it('reaction dance alternates two frames while music plays', () => {
    expect(danceFrame(0, true, false)).toBe('dance-a');
    expect(danceFrame(DANCE_FRAME_MS, true, false)).toBe('dance-b');
    expect(danceFrame(DANCE_FRAME_MS * 2, true, false)).toBe('dance-a');
  });

  it('reaction dance is frozen under reduced motion and off when paused', () => {
    expect(danceFrame(DANCE_FRAME_MS, true, true)).toBe('dance-a');
    expect(danceFrame(DANCE_FRAME_MS, false, false)).toBeNull();
  });
});

describe('blink', () => {
  it('blink first 1.5-3.5 s, then 2.2-5.4 s', () => {
    expect([firstBlinkMs(0), firstBlinkMs(1)]).toEqual([1_500, 3_500]);
    expect([blinkMs(0), blinkMs(1)]).toEqual([2_200, 5_400]);
  });

  it('blink listening is 3.0-4.5 s', () => {
    expect([blinkMs(0, true), blinkMs(1, true)]).toEqual([3_000, 4_500]);
  });

  it('blink doubles 22% of the time', () => {
    expect([doubleBlink(0.21), doubleBlink(0.22)]).toEqual([true, false]);
  });
});
