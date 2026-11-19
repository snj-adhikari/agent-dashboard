import { describe, expect, it } from 'vitest';
import { desktopOutfit, desktopPose, islandSpot, outfitShown } from '../desktopMascot';
import { DesktopMascotLogic, SURPRISE_MS } from '../desktopMascotLogic';
import { idle, start } from '../timer';
import type { Music, RecapResponse } from '../types';
import { listeningBlinkMs, voiceAvailable } from './listening';
import { musicLabel, musicPose, musicReveal } from './music';
import { recapModel } from './recap';
import { parseTimer, timerPose } from './timer';
import { outfitLabel, outfitPrefs, wardrobeOptions } from './wardrobe';
import { wearsOutfit } from '../outfit';
import { scheduleWhatsNew, type WhatsNewEnv } from './whats-new';

const song: Music = { player: 'music', playing: true, title: 'Song', artist: 'Band', durationMs: null, positionMs: null };
const recap: RecapResponse = { ok: true, week: '2026-W47', sessions: 9, approvals: 4, finishes: 3, errors: 1, byCli: [{ cli: 'claude', count: 9 }], topProjects: [{ name: 'secret-proj', count: 5 }], activeDays: 4 };

describe('music view', () => {
  it('music label and dance pose', () => {
    expect(musicLabel(song)).toBe('Song · Band');
    expect(musicLabel({ ...song, artist: null })).toBe('Song');
    expect(musicPose(song, 0, false)).toBe('dance-a');
    expect(musicPose(song, 400, false)).toBe('dance-b');
    expect(musicPose(song, 400, true)).toBe('dance-a');
    expect(musicPose({ ...song, playing: false }, 0, false)).toBeNull();
    expect(musicPose(null, 0, false)).toBeNull();
  });

  it('music reveal on new track only', () => {
    expect(musicReveal(null, song)).toBe(true);
    expect(musicReveal(song, song)).toBe(false);
    expect(musicReveal(song, { ...song, title: 'Next' })).toBe(true);
    expect(musicReveal(song, { ...song, playing: false })).toBe(false);
  });
});

describe('timer view', () => {
  it('timer restore survives restart and rejects junk', () => {
    const s = start(idle(), 1_000);
    expect(parseTimer(JSON.stringify(s))).toEqual(s);
    expect(parseTimer(null)).toEqual(idle());
    expect(parseTimer('{bad')).toEqual(idle());
    expect(parseTimer(JSON.stringify({ ...s, phase: 'nap' }))).toEqual(idle());
    expect(timerPose(s)).toBe('clock');
    expect(timerPose(idle())).toBeNull();
  });
});

describe('recap view', () => {
  it('recap model hides projects when server hides them', () => {
    const m = recapModel(recap);
    expect(m.stats).toContainEqual(['Sessions', '9']);
    expect(m.projects).toEqual([['secret-proj', '5']]);
    expect(recapModel({ ...recap, topProjects: null }).projects).toBeNull();
  });
});

describe('wardrobe', () => {
  it('wardrobe lists Auto plus every outfit, southern summer by default', () => {
    const opts = wardrobeOptions('auto', new Date(2026, 0, 15));
    expect(opts[0]).toMatchObject({ choice: 'auto', selected: true, wearing: 'sunglasses' });
    expect(opts).toHaveLength(13);
    expect(wardrobeOptions('auto', new Date(2026, 0, 15), 'north')[0].wearing).toBe('none');
    expect(outfitLabel('party-hat')).toBe('Party hat');
  });

  it('outfit on main and desktop mascots, never minis', () => {
    expect([wearsOutfit('main'), wearsOutfit('desktop'), wearsOutfit('mini')]).toEqual([true, true, false]);
  });

  it('desktop outfit follows the wardrobe choice and seasons', () => {
    const jan = new Date(2026, 0, 15);
    expect(desktopOutfit(null, jan)).toBe('sunglasses');
    expect(desktopOutfit({ outfit: 'auto', hemisphere: 'north' }, jan)).toBe('none');
    expect(desktopOutfit({ outfit: 'crown' }, jan)).toBe('crown');
    expect(desktopOutfit({ outfit: '<img>' }, jan)).toBe('sunglasses');
    expect(outfitPrefs({ outfit: 'crown', hemisphere: 'x' })).toEqual({ choice: 'crown', hemisphere: 'south' });
  });
});

describe('listening', () => {
  it('listening blink range and voice detection', () => {
    expect(listeningBlinkMs(0)).toBe(3_000);
    expect(listeningBlinkMs(1)).toBe(4_500);
    expect(voiceAvailable({})).toBe(false);
    expect(voiceAvailable({ webkitSpeechRecognition: 1 })).toBe(true);
  });
});

describe('whats-new schedule', () => {
  const env = (over: Partial<WhatsNewEnv>) => {
    const calls: { ms: number; fn: () => void }[] = [];
    const log = { shown: 0, remembered: [] as string[] };
    const e: WhatsNewEnv = {
      version: '1.1',
      lastSeen: '1.0',
      idle: () => true,
      show: () => log.shown++,
      remember: (v) => log.remembered.push(v),
      set: (fn, ms) => calls.push({ fn, ms }),
      ...over,
    };
    scheduleWhatsNew(e);
    const run = () => calls.shift()!.fn();
    return { calls, log, run };
  };

  it('whats-new schedule skips first install and same version', () => {
    expect(env({ lastSeen: null }).log).toEqual({ shown: 0, remembered: ['1.1'] });
    expect(env({ lastSeen: '1.1' }).calls).toHaveLength(0);
  });

  it('whats-new schedule shows after 4 s when idle', () => {
    const t = env({});
    expect(t.calls[0].ms).toBe(4_000);
    t.run();
    expect(t.log).toEqual({ shown: 1, remembered: ['1.1'] });
  });

  it('whats-new schedule retries every 15 s then gives up after 12', () => {
    const t = env({ idle: () => false });
    t.run();
    let retries = 0;
    while (t.calls.length) {
      expect(t.calls[0].ms).toBe(15_000);
      retries++;
      t.run();
    }
    expect(retries).toBe(12);
    expect(t.log).toEqual({ shown: 0, remembered: ['1.1'] });
  });
});

describe('desktop mascot', () => {
  it('desktop poke pose sequence and island spot', () => {
    let now = 0;
    const l = new DesktopMascotLogic(() => now);
    expect(desktopPose(l, 'desktop', false)).toBe('idle');
    l.poke();
    l.poke();
    l.poke();
    expect(desktopPose(l, 'desktop', false)).toBe('dizzy');
    now = 10_000;
    l.alerts(true);
    expect(desktopPose(l, l.place(), false)).toBe('surprised');
    now += SURPRISE_MS;
    expect(l.place()).toBe('island');
    expect(desktopPose(l, 'island', false)).toBe('waiting');
    expect(desktopPose(l, 'desktop', true)).toBe('sleepy');
    expect(islandSpot(1440, 2)).toEqual({ x: 1320, y: 0 });
    expect(outfitShown()).toBe(true);
  });
});
