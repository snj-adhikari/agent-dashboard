import { describe, expect, it } from 'vitest';
import fixture from '../../contract/fixture.json';
import {
  approvalKind, approvalQueue, Board, ERROR_MS, FINISHED_MS, groupAgents, HOLD_MS, isGitGrant, mainGroup, mainAgents, mergeReplies,
  POP_MIN_MS, replyKind, SessionBoard,
} from './board';
import type {
  Agent, Approval, Cli, CuckooState, FocusResponse, Reply, StopRequest, StopResponse, SuperviseConfirmRequest, SuperviseConfirmResponse, SuperviseRequest, SuperviseResponse,
} from './types';

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
    expect(groups.map((g) => g.label)).toEqual([mainGroup(), 'Alpha', 'Zeta']);
    expect(groups[1].agents.map((a) => a.id)).toEqual(['c', 'a']);
  });

  it('has no main group when nothing claims main', () => {
    expect(groupAgents([agent({ id: 'x' })]).map((g) => g.label)).toEqual([base.space]);
  });

  it('decodes the contract fixture', () => {
    const groups = groupAgents(state.agents);
    expect(groups[0]).toMatchObject({ label: mainGroup(), agents: [{ id: 'herdr:main:w1:p2' }] });
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

describe('fixture decodes', () => {
  it('carries the new contract fields', () => {
    const [main, bare] = state.agents;
    expect(main).toMatchObject({ hostApp: 'cmux', pid: 4141, sessionId: '5f0c1e2a-0000-4000-8000-000000000001', lastActiveAt: 1763429990000, canFocus: true });
    expect(bare.hostApp).toBeUndefined();
    expect(state.approvals.map(approvalKind)).toEqual(['permission', 'plan']);
    expect(state.replies.map(replyKind)).toEqual(['reply', 'ask']);
    expect(state.replies[1].from).toBe('hopper');
    expect((fixture.clis as Cli[]).map((c) => [c.cli, c.signedIn, c.chat ?? null])).toEqual([['claude', 'unknown', null], ['codex', true, true]]);
    expect((fixture.responses.focus as FocusResponse).via).toBe('cmux');
  });

  it('carries the supervise, superviseConfirm and stop samples', () => {
    const req = fixture.requests as unknown as { supervise: SuperviseRequest; superviseConfirm: SuperviseConfirmRequest; stop: StopRequest };
    const res = fixture.responses as unknown as { supervise: SuperviseResponse; superviseConfirm: SuperviseConfirmResponse; stop: StopResponse };
    expect(req.supervise.text.length).toBeGreaterThan(0);
    expect(req.superviseConfirm.confirmId).toBe(res.supervise.pending?.confirmId);
    expect(req.stop.agentId).toBe(state.agents[0].id);
    expect(res.supervise).toMatchObject({ ok: true, intent: 'send', results: [] });
    expect(res.supervise.targets.map((x) => x.agentId)).toEqual(res.superviseConfirm.targets.map((x) => x.agentId));
    expect(typeof res.supervise.pending?.expiresAt).toBe('number');
    expect(res.superviseConfirm.pending).toBeNull();
    expect(res.superviseConfirm.results.map((r) => [r.ok, r.error])).toEqual([[true, null], [false, 'stale']]);
    expect(res.stop).toMatchObject({ ok: true, relayKey: expect.any(String) });
  });

  it('treats an unknown kind as permission or reply', () => {
    const odd = { ...state.approvals[0], kind: 'telepathy' } as unknown as Approval;
    const bare = { ...state.approvals[0], kind: undefined };
    expect([approvalKind(odd), approvalKind(bare)]).toEqual(['permission', 'permission']);
    const r = { ...state.replies[0], kind: 'shout' } as unknown as Reply;
    expect([replyKind(r), replyKind(state.replies[0])]).toEqual(['reply', 'reply']);
  });
});

describe('board', () => {
  const s = (id: string, over: Partial<Agent> = {}): Agent => agent({ id, name: id, cli: 'claude', state: 'working', lastActiveAt: 0, ...over });
  const shown = (b: SessionBoard, agents: Agent[], now: number, key = 'claude') => b.update(agents, now).pills.find((p) => p.key === key)?.shown.id;

  it('board shows the most urgent session per pill', () => {
    const b = new SessionBoard();
    expect(shown(b, [s('a', { lastActiveAt: 5 }), s('b', { lastActiveAt: 9 })], 0)).toBe('b');
    const slots = b.update([s('a'), s('b'), s('c', { cli: 'codex' })], 0);
    expect(slots.pills.map((p) => p.key)).toEqual(['claude', 'codex']);
  });

  it('board holds an equally urgent session 6 s', () => {
    const b = new SessionBoard();
    shown(b, [s('a', { lastActiveAt: 9 }), s('b', { lastActiveAt: 1 })], 0);
    const flipped = [s('a', { lastActiveAt: 1 }), s('b', { lastActiveAt: 9 })];
    expect(shown(b, flipped, HOLD_MS - 1)).toBe('a');
    expect(shown(b, flipped, HOLD_MS)).toBe('b');
  });

  it('board keeps finished 5.2 s and error 30 s', () => {
    const b = new SessionBoard();
    b.update([s('a'), s('x', { cli: 'codex' })], 0);
    const after = [s('a', { state: 'done' }), s('x', { cli: 'codex', state: 'unknown' })];
    const at = (now: number) => b.update(after, now).pills.map((p) => p.urgency);
    expect(at(1)).toEqual(['finished', 'error']);
    expect(at(FINISHED_MS)).toEqual(['finished', 'error']);
    expect(at(FINISHED_MS + 1)).toEqual(['active', 'error']);
    expect(at(ERROR_MS + 1)).toEqual(['active', 'active']);
  });

  it('board pops a waiting session out while a sibling works', () => {
    const b = new SessionBoard();
    b.update([s('a', { lastActiveAt: 9 }), s('b')], 0);
    const slots = b.update([s('a', { lastActiveAt: 9 }), s('b', { state: 'waiting' })], HOLD_MS - 1);
    expect(slots.pills.map((p) => `${p.key}=${p.shown.id}`)).toEqual(['claude=a', 'claude#2=b']);
    const answered = [s('a', { lastActiveAt: 9 }), s('b')];
    expect(b.update(answered, HOLD_MS).pills.map((p) => p.key)).toEqual(['claude', 'claude#2']);
    expect(b.update(answered, HOLD_MS - 1 + POP_MIN_MS).pills.map((p) => p.key)).toEqual(['claude']);
  });

  it('board folds waiting beyond 4 places into +N', () => {
    const clis = ['claude', 'copilot', 'codex', 'gemini', 'opencode', 'cursor-agent'];
    const b = new SessionBoard();
    const calm = b.update(clis.map((c) => s(c, { cli: c })), 0);
    expect([calm.pills.length, calm.waitingMore]).toEqual([4, 0]);
    const promoted = b.update(clis.map((c) => s(c, { cli: c, state: c === 'opencode' ? 'waiting' : 'working' })), 1);
    expect(promoted.pills.map((p) => p.key)).toContain('opencode');
    const busy = b.update(clis.map((c) => s(c, { cli: c, state: 'waiting' })), 2);
    expect(busy.pills.map((p) => p.key)).toEqual(['claude', 'copilot', 'codex']);
    expect(busy.waitingMore).toBe(3);
  });
});
