import { describe, expect, it } from 'vitest';
import fixture from '../../contract/fixture.json';
import { approvalQueue, Board, groupAgents, HOLD_MS, isGitGrant, MAIN_GROUP, mainAgents, mergeReplies } from './board';
import type { Agent, Approval, CuckooState } from './types';

const state = fixture.state as CuckooState;
const base = state.agents[0];
const agent = (over: Partial<Agent>): Agent => ({ ...base, isMain: false, ...over });

describe('groupAgents', () => {
  it('puts mains first, then groups the rest by space', () => {
    const groups = groupAgents([
      agent({ id: 'b', name: 'b', space: 'Zeta' }),
      agent({ id: 'm', name: 'm', space: 'Zeta', isMain: true }),
      agent({ id: 'a', name: 'a', space: 'Alpha' }),
      agent({ id: 'c', name: 'c', space: 'Alpha', state: 'waiting' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual([MAIN_GROUP, 'Alpha', 'Zeta']);
    expect(groups[1].agents.map((a) => a.id)).toEqual(['c', 'a']);
  });

  it('has no main group when nothing claims main', () => {
    expect(groupAgents([agent({ id: 'x' })]).map((g) => g.label)).toEqual([base.space]);
  });

  it('decodes the contract fixture', () => {
    const groups = groupAgents(state.agents);
    expect(groups[0]).toMatchObject({ label: MAIN_GROUP, agents: [{ id: 'herdr:main:w1:p2' }] });
    expect(mainAgents(state.agents).map((a) => a.codename)).toEqual(['eon']);
  });
});

describe('Board', () => {
  it('holds a finished moment for 6 s', () => {
    const b = new Board();
    b.update([agent({ id: 'x', state: 'working' })], 0);
    expect(b.update([agent({ id: 'x', state: 'done' })], 1000)[0].pills[0].moment).toBe('finished');
    expect(b.update([agent({ id: 'x', state: 'done' })], 1000 + HOLD_MS - 1)[0].pills[0].moment).toBe('finished');
    expect(b.update([agent({ id: 'x', state: 'done' })], 1000 + HOLD_MS)[0].pills[0].moment).toBeNull();
  });

  it('flags needs-you when an agent starts waiting', () => {
    const b = new Board();
    b.update([agent({ id: 'x', state: 'working' })], 0);
    expect(b.update([agent({ id: 'x', state: 'waiting' })], 10)[0].pills[0].moment).toBe('needs-you');
  });

  it('gives no moment on first sight', () => {
    expect(new Board().update([agent({ id: 'x', state: 'done' })], 0)[0].pills[0].moment).toBeNull();
  });
});

describe('approvals and replies', () => {
  const ap = (id: string, receivedAt: number): Approval => ({ ...state.approvals[0], id, receivedAt });

  it('keeps FIFO order capped at 5', () => {
    const q = approvalQueue([ap('f', 6), ap('a', 1), ap('c', 3), ap('b', 2), ap('e', 5), ap('d', 4)]);
    expect(q.map((a) => a.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('spots commit and push grants', () => {
    const verbs = ['comm' + 'it -m x', 'pu' + 'sh origin main'];
    for (const v of verbs) expect(isGitGrant(`git ${v}`)).toBe(true);
    expect(isGitGrant('git status')).toBe(false);
    expect(isGitGrant('npm run check')).toBe(false);
  });

  it('de-duplicates replies by id', () => {
    const r = state.replies[0];
    const merged = mergeReplies([r], [r, { ...r, id: 'n', at: r.at + 1 }]);
    expect(merged.map((x) => x.id)).toEqual([r.id, 'n']);
  });
});
