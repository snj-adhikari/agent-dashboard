import { describe, expect, it } from 'vitest';
import {
  DesktopMascotLogic, DIZZY_MS, restorePosition, FPS_ACTIVE, FPS_ASLEEP, hitBody, POKE_WINDOW_MS, RETURN_DELAY_MS, SLEEP_AFTER_MS, SURPRISE_MS,
} from './desktopMascotLogic';

function make() {
  const clock = { t: 0 };
  return { clock, m: new DesktopMascotLogic(() => clock.t) };
}

describe('desktop poke', () => {
  it('desktop poke 3 within 1.7 s makes dizzy for 3.3 s', () => {
    const { clock, m } = make();
    expect(m.poke()).toBe('poke');
    clock.t = 800;
    expect(m.poke()).toBe('poke');
    clock.t = 1_600;
    expect(m.poke()).toBe('dizzy');
    expect(m.dizzy).toBe(true);
    clock.t = 1_600 + DIZZY_MS - 1;
    expect(m.poke()).toBe('ignored');
    clock.t = 1_600 + DIZZY_MS;
    expect(m.dizzy).toBe(false);
    expect(m.poke()).toBe('poke');
  });

  it('desktop poke spread over more than 1.7 s stays a poke', () => {
    const { clock, m } = make();
    m.poke();
    clock.t = 900;
    m.poke();
    clock.t = POKE_WINDOW_MS;
    expect(m.poke()).toBe('poke');
  });

  it('desktop poke position restore clamps on screen, default bottom-right', () => {
    const screen = { x: 0, y: 0, w: 1440, h: 900 };
    expect(restorePosition(null, screen)).toEqual({ x: 1320, y: 780, onDesktop: false });
    expect(restorePosition({ x: 5000, y: -40, onDesktop: true }, screen)).toEqual({ x: 1320, y: 0, onDesktop: true });
    expect(restorePosition({ x: 300, y: 200, onDesktop: true }, screen)).toEqual({ x: 300, y: 200, onDesktop: true });
  });

  it('desktop poke hit test is the rounded body only', () => {
    expect(hitBody(60, 60)).toBe(true);
    expect(hitBody(1, 1)).toBe(false);
    expect(hitBody(28.8, 2)).toBe(true);
    expect(hitBody(121, 60)).toBe(false);
  });
});

describe('desktop return', () => {
  it('desktop return flies to the island after surprise and back 0.6 s after clear', () => {
    const { clock, m } = make();
    expect(m.place()).toBe('desktop');
    m.alerts(true);
    expect(m.surprised).toBe(true);
    expect(m.place()).toBe('desktop');
    clock.t = SURPRISE_MS;
    expect(m.place()).toBe('island');
    clock.t = 5_000;
    m.alerts(false);
    expect(m.place()).toBe('island');
    clock.t = 5_000 + RETURN_DELAY_MS;
    expect(m.place()).toBe('desktop');
  });

  it('desktop return sleeps after 2 min with the pointer away', () => {
    const { clock, m } = make();
    clock.t = SLEEP_AFTER_MS;
    expect(m.fps(151)).toBe(FPS_ASLEEP);
    expect(m.fps(100)).toBe(FPS_ACTIVE);
    m.alerts(true);
    expect(m.fps(500)).toBe(FPS_ACTIVE);
  });
});
