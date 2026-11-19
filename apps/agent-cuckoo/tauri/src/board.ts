import type { Agent, AgentState, Approval, ApprovalKind, Reply, ReplyKind } from './types';
import { t } from './i18n';

export const HOLD_MS = 6_000;
export const APPROVAL_CAP = 5;
export const mainGroup = () => t('common.mainShort');

export type Moment = 'finished' | 'needs-you' | null;

export interface Pill { agent: Agent; moment: Moment }
export interface Group { label: string; pills: Pill[] }

const RANK: Record<AgentState, number> = { waiting: 0, working: 1, done: 2, unknown: 3 };

export function compareAgents(a: Agent, b: Agent): number {
  if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
  return RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function groupAgents(agents: Agent[]): { label: string; agents: Agent[] }[] {
  const mains = agents.filter((a) => a.isMain).sort(compareAgents);
  const bySpace = new Map<string, Agent[]>();
  for (const a of agents) {
    if (a.isMain) continue;
    const list = bySpace.get(a.space) ?? [];
    list.push(a);
    bySpace.set(a.space, list);
  }
  const rest = [...bySpace.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([label, list]) => ({ label, agents: list.sort(compareAgents) }));
  return mains.length ? [{ label: mainGroup(), agents: mains }, ...rest] : rest;
}

export class Board {
  private last = new Map<string, AgentState>();
  private moments = new Map<string, { moment: Exclude<Moment, null>; until: number }>();

  update(agents: Agent[], now: number): Group[] {
    for (const a of agents) {
      const prev = this.last.get(a.id);
      if (prev && prev !== a.state) {
        if (a.state === 'done' && prev === 'working') this.moments.set(a.id, { moment: 'finished', until: now + HOLD_MS });
        else if (a.state === 'waiting') this.moments.set(a.id, { moment: 'needs-you', until: now + HOLD_MS });
      }
      this.last.set(a.id, a.state);
    }
    const live = new Set(agents.map((a) => a.id));
    for (const id of [...this.last.keys()]) if (!live.has(id)) this.last.delete(id);
    for (const [id, m] of [...this.moments]) if (m.until <= now || !live.has(id)) this.moments.delete(id);
    return groupAgents(agents).map((g) => ({
      label: g.label,
      pills: g.agents.map((agent) => ({ agent, moment: this.moments.get(agent.id)?.moment ?? null })),
    }));
  }
}

export function approvalQueue(approvals: Approval[]): Approval[] {
  return [...approvals].sort((a, b) => a.receivedAt - b.receivedAt || a.id.localeCompare(b.id)).slice(0, APPROVAL_CAP);
}

export function isGitGrant(command: string): boolean {
  return /\bgit\s+(commit|push)\b/.test(command);
}

export function mergeReplies(seen: Reply[], incoming: Reply[], cap = 50): Reply[] {
  const ids = new Set(seen.map((r) => r.id));
  const fresh = incoming.filter((r) => !ids.has(r.id));
  return [...seen, ...fresh].sort((a, b) => a.at - b.at).slice(-cap);
}

export function mainAgents(agents: Agent[]): Agent[] {
  return agents.filter((a) => a.isMain && a.canSend).sort(compareAgents);
}

export function approvalKind(a: Approval): ApprovalKind {
  return a.kind === 'plan' || a.kind === 'question' ? a.kind : 'permission';
}

export function replyKind(r: Reply): ReplyKind {
  return r.kind === 'ask' || r.kind === 'summary' ? r.kind : 'reply';
}

export const FINISHED_MS = 5_200;
export const ERROR_MS = 30_000;
export const POP_MIN_MS = 3_000;
export const PLACES = 4;
export const CATALOGUE = ['claude', 'copilot', 'codex', 'gemini', 'cursor-agent', 'opencode', 'antigravity', 'agentastic'];

export type Urgency = 'waiting' | 'error' | 'finished' | 'active';
const URGENCY: Record<Urgency, number> = { waiting: 0, error: 1, finished: 2, active: 3 };

export interface SessionPill { key: string; shown: Agent; urgency: Urgency; sessions: Agent[] }
export interface Slots { pills: SessionPill[]; waitingMore: number }

const pillKey = (a: Agent): string => a.cli ?? 'agent';
const catalogueIndex = (key: string): number => {
  const i = CATALOGUE.indexOf(key.split('#')[0]);
  return i < 0 ? CATALOGUE.length : i;
};

/** One pill per CLI showing its most urgent session; waiting sessions pop out to `<cli>#2` while a sibling is busy. */
export class SessionBoard {
  private last = new Map<string, AgentState>();
  private moments = new Map<string, { urgency: 'finished' | 'error'; until: number }>();
  private shown = new Map<string, { id: string; since: number }>();
  private popped = new Map<string, number>();

  update(agents: Agent[], now: number, places = PLACES): Slots {
    for (const a of agents) {
      const prev = this.last.get(a.id);
      if (prev === 'working' && a.state === 'done') this.moments.set(a.id, { urgency: 'finished', until: now + FINISHED_MS });
      if (prev === 'working' && a.state === 'unknown') this.moments.set(a.id, { urgency: 'error', until: now + ERROR_MS });
      this.last.set(a.id, a.state);
    }
    const live = new Set(agents.map((a) => a.id));
    for (const id of [...this.last.keys()]) if (!live.has(id)) this.last.delete(id);
    for (const [id, m] of [...this.moments]) if (m.until <= now || !live.has(id)) this.moments.delete(id);
    for (const [id, since] of [...this.popped]) {
      const a = agents.find((x) => x.id === id);
      if (!a || (a.state !== 'waiting' && now - since >= POP_MIN_MS)) this.popped.delete(id);
    }

    const urgency = (a: Agent): Urgency => (a.state === 'waiting' ? 'waiting' : this.moments.get(a.id)?.urgency ?? 'active');
    const byUrgency = (x: Agent, y: Agent) =>
      URGENCY[urgency(x)] - URGENCY[urgency(y)] || (y.lastActiveAt ?? 0) - (x.lastActiveAt ?? 0) || x.id.localeCompare(y.id);

    const groups = new Map<string, Agent[]>();
    for (const a of agents) {
      if (this.popped.has(a.id)) continue;
      const list = groups.get(pillKey(a)) ?? [];
      list.push(a);
      groups.set(pillKey(a), list);
    }

    const pills: SessionPill[] = [];
    for (const [key, all] of groups) {
      const cur = this.shown.get(key);
      const curAgent = cur && all.find((a) => a.id === cur.id);
      if (curAgent && curAgent.state !== 'waiting') {
        for (const a of all) if (a.id !== curAgent.id && a.state === 'waiting') this.popped.set(a.id, now);
      }
      const list = all.filter((a) => !this.popped.has(a.id));
      const best = [...list].sort(byUrgency)[0];
      let shown = best;
      if (cur && curAgent && curAgent.id !== best.id && URGENCY[urgency(best)] >= URGENCY[urgency(curAgent)] && now - cur.since < HOLD_MS) shown = curAgent;
      if (!cur || cur.id !== shown.id) this.shown.set(key, { id: shown.id, since: now });
      pills.push({ key, shown, urgency: urgency(shown), sessions: list });
    }
    for (const key of [...this.shown.keys()]) if (!groups.has(key)) this.shown.delete(key);

    const counts = new Map<string, number>();
    for (const id of this.popped.keys()) {
      const a = agents.find((x) => x.id === id)!;
      const n = (counts.get(pillKey(a)) ?? 1) + 1;
      counts.set(pillKey(a), n);
      pills.push({ key: `${pillKey(a)}#${n}`, shown: a, urgency: urgency(a), sessions: [a] });
    }

    const order = (x: SessionPill, y: SessionPill) => catalogueIndex(x.key) - catalogueIndex(y.key) || x.key.localeCompare(y.key);
    pills.sort(order);
    if (pills.length <= places) return { pills, waitingMore: 0 };
    const waiting = pills.filter((p) => p.urgency === 'waiting');
    if (waiting.length > places) return { pills: waiting.slice(0, places - 1), waitingMore: waiting.length - (places - 1) };
    const rest = pills.filter((p) => p.urgency !== 'waiting');
    return { pills: [...waiting, ...rest].slice(0, places).sort(order), waitingMore: 0 };
  }
}
