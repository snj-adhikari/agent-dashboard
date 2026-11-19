import { describe, expect, it } from 'vitest';
import fixture from '../../../contract/fixture.json';
import type { Settings } from '../api';
import type { Agent, Approval, Cli, CuckooState, Reply } from '../types';
import { cardModel } from './cards';
import { chatClis, chatPose } from './chat';
import { mainRows, splitReplies } from './main-agents';
import { groupSessions, hostLabel, launchClis } from './sessions';
import { fsmOptions, soundOptions } from './settings';

const state = fixture.state as CuckooState;
const [permission, plan] = state.approvals as Approval[];
const base = state.agents[0];
const agent = (over: Partial<Agent>): Agent => ({ ...base, isMain: false, canSend: true, ...over });
const cli = (over: Partial<Cli>): Cli => ({ cli: 'x', path: '/x', version: null, signedIn: true, ...over });
const settings: Settings = { monitorUrl: 'http://127.0.0.1:5818', token: null, sounds: true, recents: [] };

describe('approval card', () => {
  it('approval card shows Always only when offered and counts 1/N', () => {
    const m = cardModel(permission, 0, 3, 'eon');
    expect(m.title).toBe('eon needs permission');
    expect(m.buttons.map((b) => b.decision)).toEqual(['deny', 'always', 'allow']);
    expect(m.counter).toBe('1/3');
    const two = cardModel({ ...permission, options: permission.options.slice(0, 2) }, 0, 1, 'eon');
    expect(two.buttons.map((b) => b.decision)).toEqual(['deny', 'allow']);
    expect(two.counter).toBeNull();
  });

  it('approval card plan variant', () => {
    const m = cardModel(plan, 1, 2, 'eon');
    expect(m.title).toBe('eon has a plan ready');
    expect(m.buttons.map((b) => b.label)).toEqual(['Keep planning', 'Approve plan']);
    expect(m.counter).toBe('2/2');
  });

  it('approval card question variant uses option labels', () => {
    const q: Approval = { ...permission, kind: 'question', tool: 'ask', command: 'Which port?', options: [{ key: '1', label: '3000' }, { key: '2', label: '4000' }] };
    const m = cardModel(q, 0, 1, 'eon');
    expect(m.question).toBe(true);
    expect(m.title).toBe('eon is asking');
    expect(m.buttons.map((b) => [b.decision, b.label])).toEqual([['deny', '4000'], ['allow', '3000']]);
  });

  it('approval card reply in terminal on git grant or grant_in_terminal', () => {
    const grant = ['git', 'commit', '-m', 'x'].join(' ');
    expect(cardModel({ ...permission, command: grant }, 0, 1, 'eon')).toMatchObject({ terminal: true, buttons: [] });
    expect(cardModel(permission, 0, 1, 'eon', true)).toMatchObject({ terminal: true, buttons: [] });
  });
});

describe('chat', () => {
  it('chat chip lists chat-capable signed-in CLIs only', () => {
    const list = [cli({ cli: 'a', chat: true }), cli({ cli: 'b', chat: true, signedIn: 'unknown' }), cli({ cli: 'c' }), cli({ cli: 'd', chat: true, signedIn: false })];
    expect(chatClis(list).map((c) => c.cli)).toEqual(['a']);
    expect(chatClis(fixture.clis as Cli[]).map((c) => c.cli)).toEqual(['codex']);
  });

  it('chat mascot mood poses', () => {
    expect([chatPose('idle'), chatPose('thinking'), chatPose('happy'), chatPose('error')]).toEqual([null, 'thinking', 'happy', 'alarmed']);
  });
});

describe('sessions', () => {
  it('sessions group by host then space', () => {
    const g = groupSessions([
      agent({ id: '1', name: 'b', host: 'cmux', hostApp: null, space: 'two' }),
      agent({ id: '2', name: 'a', host: 'cmux', hostApp: null, space: 'one' }),
      agent({ id: '3', name: 'c', host: 'bare', hostApp: 'Terminal', space: 'one' }),
      agent({ id: '4', name: 'd', host: 'cmux', hostApp: null, space: 'one' }),
    ]);
    expect(g.map((x) => x.host)).toEqual(['cmux', 'Terminal']);
    expect(g[0].spaces.map((s) => [s.space, s.agents.map((a) => a.id)])).toEqual([['one', ['2', '4']], ['two', ['1']]]);
    expect(hostLabel(agent({ host: 'herdr-app', hostApp: null }))).toBe('Herdr');
  });

  it('launcher offers signed-in CLIs only', () => {
    expect(launchClis([cli({ cli: 'a' }), cli({ cli: 'b', signedIn: 'unknown' }), cli({ cli: 'c', signedIn: false })]).map((c) => c.cli)).toEqual(['a']);
  });
});

describe('main agents', () => {
  it('main agents one row per space', () => {
    const rows = mainRows([
      agent({ id: 'm1', isMain: true, space: 's1', name: 'a' }),
      agent({ id: 'm2', isMain: true, space: 's1', name: 'b' }),
      agent({ id: 'm3', isMain: true, space: 's2', name: 'c' }),
      agent({ id: 'w', isMain: false, space: 's2' }),
      agent({ id: 'ro', isMain: true, canSend: false, space: 's3' }),
    ]);
    expect(rows.map((a) => a.id)).toEqual(['m1', 'm3']);
  });

  it('main agents split sub-agent asks from replies', () => {
    const replies = state.replies as Reply[];
    const { asks, replies: rest } = splitReplies(replies, new Set());
    expect(asks.map((r) => r.from)).toEqual(['hopper']);
    expect(rest.map((r) => r.id)).toEqual([replies[0].id]);
    expect(splitReplies(replies, new Set([asks[0].id])).asks).toEqual([]);
  });
});

describe('settings', () => {
  it('settings feed open-on-hover and auto-close to the fsm', () => {
    expect(fsmOptions(null)).toEqual({ openOnHover: false, autoCloseMs: 15_000 });
    expect(fsmOptions({ ...settings, openOnHover: true, autoCloseSec: 30 })).toEqual({ openOnHover: true, autoCloseMs: 30_000 });
    expect(fsmOptions({ ...settings, autoCloseSec: 7 }).autoCloseMs).toBe(15_000);
  });

  it('settings volume clamps to 0-0.2', () => {
    expect(soundOptions({ ...settings, volume: 0.9 })).toEqual({ enabled: true, volume: 0.2 });
    expect(soundOptions({ ...settings, sounds: false, volume: -1 })).toEqual({ enabled: false, volume: 0 });
    expect(soundOptions(null).volume).toBe(0.12);
  });
});
