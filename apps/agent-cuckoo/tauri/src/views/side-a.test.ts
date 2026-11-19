import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide';
import { describe, expect, it } from 'vitest';
import fixture from '../../../contract/fixture.json';
import type { Agent, SideItem, SideProvider, SideSettings } from '../types';
import { uploadTimeline } from '../uploadTimeline';
import { pastePath, sessionTargets } from './drop';
import { mailGroups } from './mail';
import { composeText } from './messages';
import { trendIcon } from './portfolio';
import { blocked, failCode, reasonText, sections } from './services';
import { baseName, soundFor } from './upload';

const provider = (over: Partial<SideProvider>): SideProvider => ({ id: 'mail', available: true, enabled: true, via: 'applescript', reason: null, ...over });
const settings = (on: boolean): SideSettings => ({ enabled: { mail: on } as SideSettings['enabled'], holdings: [], currency: 'AUD', hideProjects: false, phonePush: false });
const item = (id: string, group: string | null): SideItem => ({ id, title: id, subtitle: null, value: null, url: null, tone: null, group, actions: [] });

describe('side reason states', () => {
  it('blocked follows registry reason, then the user switch, then availability', () => {
    expect(blocked(null, null, 'mail')).toBe('no_side');
    expect(blocked([], settings(true), 'mail')).toBe('not_installed');
    expect(blocked([provider({ reason: 'no_permission' })], settings(true), 'mail')).toBe('no_permission');
    expect(blocked([provider({ reason: 'needs_key' })], settings(true), 'mail')).toBe('needs_key');
    expect(blocked([provider({})], settings(false), 'mail')).toBe('disabled');
    expect(blocked([provider({ enabled: false })], settings(true), 'mail')).toBe('disabled');
    expect(blocked([provider({ available: false })], settings(true), 'mail')).toBe('not_installed');
    expect(blocked([provider({})], settings(true), 'mail')).toBeNull();
  });

  it('reason texts match the macOS cards', () => {
    expect(reasonText('disabled', 'g')).toBe('Turn on in Settings');
    expect(reasonText('needs_key', 'g')).toBe('Needs a key, skipped');
    expect(reasonText('no_permission', 'Allow Automation')).toBe('Allow Automation');
    expect(reasonText('weird', 'g')).toBe('Unavailable (weird)');
  });

  it('failCode keeps the server error code', () => {
    expect(failCode({ kind: 'http', status: 403, error: 'no_permission', message: 'x' })).toBe('no_permission');
    expect(failCode({ kind: 'offline', status: 0, error: 'offline', message: 'x' })).toBe('offline');
  });
});

describe('side lists', () => {
  it('mail groups in reply, later, fyi order with the rest under Other', () => {
    const out = sections([item('a', 'fyi'), item('b', 'reply'), item('c', null), item('d', 'later')], mailGroups());
    expect(out.map((s) => [s.title, s.items.map((i) => i.id)])).toEqual([['Needs a reply', ['b']], ['Later', ['d']], ['FYI', ['a']], ['Other', ['c']]]);
    expect(sections([item('a', null)], [])).toEqual([{ title: '', items: [item('a', null)] }]);
  });

  it('whatsapp compose needs text', () => {
    expect(composeText('  ')).toBeNull();
    expect(composeText(' hi ')).toBe('hi');
  });

  it('portfolio trend icon by tone', () => {
    expect(trendIcon('ok')).toBe(ArrowUpRight);
    expect(trendIcon('error')).toBe(ArrowDownRight);
    expect(trendIcon(null)).toBe(Minus);
  });
});

describe('drop and upload', () => {
  it('upload sounds: one gulp and a tick per 10%', () => {
    const sounds = uploadTimeline(0.5).map(soundFor).filter(Boolean);
    expect(sounds.filter((s) => s === 'gulp')).toHaveLength(1);
    expect(sounds.filter((s) => s === 'tick')).toHaveLength(10);
  });

  it('baseName handles both separators', () => {
    expect(baseName('/Users/x/a b.png')).toBe('a b.png');
    expect(baseName('C:\\tmp\\c.txt')).toBe('c.txt');
  });

  it('pastePath quotes anything a shell would split or expand', () => {
    expect(pastePath('/tmp/a.png')).toBe('/tmp/a.png');
    expect(pastePath('/tmp/a b.png')).toBe("'/tmp/a b.png'");
    expect(pastePath("/tmp/it's $HOME")).toBe(`'/tmp/it'\\''s $HOME'`);
    expect(pastePath('/tmp/$(rm -rf ~).png')).toBe(`'/tmp/$(rm -rf ~).png'`);
    expect(pastePath('/tmp/`id`.png')).toBe("'/tmp/`id`.png'");
    expect(pastePath('/tmp/-rf')).toBe('/tmp/-rf');
  });

  it('pastePath refuses relative paths, leading dashes and control characters', () => {
    expect(pastePath('-rf')).toBeNull();
    expect(pastePath('--help.png')).toBeNull();
    expect(pastePath('a.png')).toBeNull();
    expect(pastePath('./a.png')).toBeNull();
    expect(pastePath('/tmp/a\nrm -rf ~')).toBeNull();
    expect(pastePath('/tmp/a\r.png')).toBeNull();
  });

  it('only sendable sessions are drop targets', () => {
    const base = fixture.state.agents[0] as Agent;
    const out = sessionTargets([{ ...base, id: 'a', canSend: false }, { ...base, id: 'b', canSend: true }]);
    expect(out.map((a) => a.id)).toEqual(['b']);
  });
});
