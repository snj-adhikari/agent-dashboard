import type { Agent, AgentState, Approval, Reply } from './types';

export const HOLD_MS = 6_000;
export const APPROVAL_CAP = 5;
export const MAIN_GROUP = '⚑ Main';

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
  return mains.length ? [{ label: MAIN_GROUP, agents: mains }, ...rest] : rest;
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
