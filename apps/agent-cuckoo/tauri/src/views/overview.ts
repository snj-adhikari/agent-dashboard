import type { SessionPill, Slots } from '../board';
import type { Agent } from '../types';
import { miniMascot, type MascotPose } from './mascot';
import { chevron, toggleCard } from './cards';
import { cards } from '../cardExpansion';
import { t } from '../i18n';

export const MAX_STEPS = 20;
const ROLL_EASE = 'cubic-bezier(0.4,0,0.2,1)';

const SOURCE: Record<string, string> = {
  claude: 'Claude Code',
  copilot: 'Copilot',
  codex: 'Codex',
  gemini: 'Gemini',
  'cursor-agent': 'Cursor',
  opencode: 'opencode',
  antigravity: 'Antigravity',
  agentastic: 'Agentastic',
};

export const sourceLabel = (a: Agent): string => (a.cli ? SOURCE[a.cli] ?? a.cli : t('common.agentFallback'));

/** Keeps the last distinct lines per agent so the ticker can roll done steps up. */
export class Steps {
  private lines = new Map<string, string[]>();
  private rolled = new Set<string>();

  track(agents: Agent[]): void {
    const live = new Set(agents.map((a) => a.id));
    for (const id of [...this.lines.keys()]) if (!live.has(id)) this.lines.delete(id);
    for (const a of agents) {
      const line = a.lastLine?.trim();
      if (!line) continue;
      const list = this.lines.get(a.id) ?? [];
      if (list[list.length - 1] === line) continue;
      this.lines.set(a.id, [...list, line].slice(-MAX_STEPS));
      if (list.length) this.rolled.add(a.id);
    }
  }

  of(id: string): string[] {
    return this.lines.get(id) ?? [];
  }

  takeRoll(id: string): boolean {
    return this.rolled.delete(id);
  }
}

export interface OverviewDeps {
  slots: Slots;
  focused: SessionPill | null;
  steps: Steps;
  animate: boolean;
  pose: (a: Agent) => MascotPose;
  badge: (name: string) => Node | null;
  onPick: (key: string) => void;
  onJump: (a: Agent) => void;
  onToggle: () => void;
  icon: (name: 'jump' | 'wait' | 'check' | 'chev') => Node;
}

function el(tag: string, cls: string, ...kids: (Node | string | null | false)[]): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  for (const k of kids) if (k) e.append(k);
  return e;
}

function ticker(agent: Agent, d: OverviewDeps): HTMLElement {
  const rows = d.steps.of(agent.id).slice(-3);
  const box = el('div', 'ticker');
  if (!rows.length) {
    box.append(el('div', 'row idle', agent.state));
    return box;
  }
  const active = agent.state === 'working';
  rows.forEach((text, i) => {
    const current = i === rows.length - 1;
    const row = el('div', current ? `row current${active ? ' shimmer' : ''}` : 'row done', d.icon(current ? 'chev' : 'check'), el('span', 'text', text));
    box.append(row);
  });
  if (d.animate && d.steps.takeRoll(agent.id)) {
    box.animate([{ transform: 'translateY(22px)' }, { transform: 'translateY(0)' }], { duration: 380, easing: ROLL_EASE });
  }
  return box;
}

function sessionLines(p: SessionPill): HTMLElement {
  const list = el('div', 'lines');
  const shown = p.sessions.length > 3 ? p.sessions.slice(0, 2) : p.sessions;
  for (const a of shown) {
    list.append(el('div', `line${a.id === p.shown.id ? ' on' : ''}`, el('i', `dot ${a.state}`), el('span', 'title', a.codename ?? a.name), el('span', 'step', a.lastLine ?? '')));
  }
  if (p.sessions.length > 3) list.append(el('div', 'line more', `+${p.sessions.length - 2}`));
  return list;
}

function leftCard(d: OverviewDeps): HTMLElement {
  const p = d.focused;
  if (!p) return el('div', 'left empty', el('div', 'title', el('span', 'name', t('common.noAgentsRunning'))), el('div', 'ticker', el('div', 'row idle', t('launch.startOne'))));
  const a = p.shown;
  const steps = d.steps.of(a.id).length;
  const title = el(
    'div',
    'title',
    el('i', 'dot', null),
    el('span', 'name', a.codename ? t('common.agentWithCodename', { codename: a.codename, name: a.name }) : a.name),
    d.badge(`cli-${a.cli ?? ''}`),
    el('span', 'source', sourceLabel(a)),
    d.badge(`host-${a.host}`),
    a.isMain && el('span', 'main-badge', t('common.main')),
    p.sessions.length === 1 && steps > 1 && el('span', 'count', t('approval.position', { index: steps, total: steps })),
  );
  (title.firstChild as HTMLElement).style.background = a.colour ?? 'var(--muted)';
  const id = `agent:${p.key}`;
  const open = cards.isOpen(id, true);
  title.append(chevron(id, open, d.onToggle, true));
  title.addEventListener('click', () => toggleCard(id, d.onToggle, true));
  const card = el('div', open ? 'left' : 'left collapsed', title, open && (p.sessions.length > 1 ? sessionLines(p) : ticker(a, d)));
  card.dataset.card = id;
  if (a.canFocus !== false) {
    const jump = el('button', 'jump', d.icon('jump'));
    jump.title = t('common.jumpToTerminal');
    jump.addEventListener('click', (e) => {
      e.stopPropagation();
      d.onJump(a);
    });
    card.append(jump);
  }
  return card;
}

function pillButton(p: SessionPill, d: OverviewDeps): HTMLElement {
  const a = p.shown;
  const b = el('button', `spill ${p.urgency}${d.focused?.key === p.key ? ' on' : ''}`, miniMascot(d.pose(a), a.colour, d.badge(p.urgency === 'active' ? '' : p.urgency === 'waiting' ? 'waiting' : p.urgency === 'error' ? 'error' : 'done'), 22), el('span', 'label', p.key));
  if (a.colour) b.style.setProperty('--tint', a.colour);
  b.title = [a.name, a.cwd, a.lastLine].filter(Boolean).join('\n');
  b.addEventListener('click', () => d.onPick(p.key));
  return b;
}

/** Overview: focused session card on the left, two-column pill grid on the right with an amber "+N" stack. */
export function overview(d: OverviewDeps): HTMLElement {
  const grid = el('div', 'grid', ...d.slots.pills.map((p) => pillButton(p, d)));
  if (d.slots.waitingMore > 0) {
    const more = el('button', 'spill waiting-more', d.icon('wait'), el('span', 'label', `+${d.slots.waitingMore}`));
    more.title = t('approval.moreWaiting', { count: d.slots.waitingMore });
    more.addEventListener('click', () => {
      const first = d.slots.pills.find((p) => p.urgency === 'waiting');
      if (first) d.onPick(first.key);
    });
    grid.append(more);
  }
  return el('div', 'overview', leftCard(d), el('div', 'right', grid));
}
