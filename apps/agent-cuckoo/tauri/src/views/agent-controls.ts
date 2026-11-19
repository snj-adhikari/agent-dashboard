import { ChevronDown, Send } from 'lucide';
import * as api from '../api';
import { replyKind } from '../board';
import { CardExpansion, cards, isLong } from '../cardExpansion';
import { rowControls, type RowAction } from '../rowControls';
import { play } from '../sounds';
import type { Agent, Approval, Decision, Reply } from '../types';
import { h, icon, type Kit } from './cards';
import { t } from '../i18n';
import './agent-controls.css';

export interface RowData { approvals: Approval[]; replies: Reply[] }
export interface RowContext { approval: Approval | null; ask: Reply | null; latest: Reply | null }

const answered = new Set<string>();
const drafts = new Map<string, string>();
const replies = new CardExpansion();
let expanded: string | null = null;

/** Pending approval, unanswered ask and newest non-ask reply for one agent. */
export function rowContext(agentId: string, d: RowData, done: ReadonlySet<string> = answered): RowContext {
  const mine = d.replies.filter((r) => r.agentId === agentId).sort((x, y) => y.at - x.at);
  return {
    approval: d.approvals.find((a) => a.agentId === agentId) ?? null,
    ask: mine.find((r) => replyKind(r) === 'ask' && !done.has(r.id)) ?? null,
    latest: mine.find((r) => replyKind(r) !== 'ask') ?? null,
  };
}

/** Bumps the shared card revision so the island re-renders, cross-fading `id` under Reduce Motion. */
function repaint(kit: Kit, id: string): void {
  cards.rev++;
  kit.render();
  if (!document.documentElement.classList.contains('reduced')) return;
  document.querySelector(`[data-card="${CSS.escape(id)}"]`)?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' });
}

export const isExpanded = (agentId: string): boolean => expanded === agentId;

/** Opens one row at a time; clicking the open row closes it. */
export function toggleRow(agentId: string, kit: Kit): void {
  expanded = expanded === agentId ? null : agentId;
  repaint(kit, `row:${agentId}`);
}

/** Click and Enter/Space handlers that expand a row header. */
export function rowToggle(agentId: string, kit: Kit): Record<string, unknown> {
  return {
    role: 'button',
    tabindex: 0,
    'aria-expanded': String(isExpanded(agentId)),
    onclick: () => toggleRow(agentId, kit),
    onkeydown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      toggleRow(agentId, kit);
    },
  };
}

/** Reply text clamped to 3 lines with a chevron when long; open state kept per reply id while it is on screen. */
export function replyText(r: Reply, kit: Kit, cls = 'ac-text'): { text: HTMLElement; toggle: HTMLElement | null } {
  const id = `reply:${r.id}`;
  const long = isLong(r.text);
  const open = !long || replies.isOpen(id);
  const flip = (e: Event) => {
    e.stopPropagation();
    replies.toggle(id);
    repaint(kit, id);
  };
  const label = t(open ? 'card.collapse' : 'card.expand');
  return {
    text: h('p', { class: `${cls}${open ? '' : ' clamped'}${long ? ' expandable' : ''}`, 'data-card': id, onclick: long ? flip : undefined }, r.text),
    toggle: long ? h('button', { class: open ? 'icon chev open' : 'icon chev', title: label, 'aria-label': label, 'aria-expanded': String(open), onclick: flip }, icon(ChevronDown, 12)) : null,
  };
}

export const pruneReplies = (live: Reply[]): void => replies.prune(live.map((r) => `reply:${r.id}`));

async function send(a: Agent, text: string, kit: Kit): Promise<boolean> {
  if (!text.trim()) return false;
  if (!(await kit.guarded(() => api.say(a.id, text.trim()), t('common.sent')))) return false;
  play('send');
  kit.render();
  return true;
}

async function decide(a: Agent, ctx: RowContext, d: Decision, kit: Kit): Promise<void> {
  const ok = ctx.approval
    ? await kit.guarded(() => api.approve(ctx.approval!.id, d), t('common.sent'))
    : ctx.ask && (await kit.guarded(() => api.say(a.id, d === 'deny' ? 'no' : 'yes'), t('common.sent')));
  if (ok && ctx.ask && !ctx.approval) answered.add(ctx.ask.id);
  kit.render();
}

const LABEL: Record<Exclude<RowAction, 'reply'>, string> = { continue: 'row.continue', approve: 'row.approve', deny: 'row.deny', stop: 'row.stop' };

/** Inline controls for an expanded Sessions or Main agents row. */
export function agentControls(a: Agent, d: RowData, kit: Kit): HTMLElement {
  const ctx = rowContext(a.id, d);
  const c = rowControls(a, ctx.approval, ctx.ask !== null);
  const off = (x: RowAction) => c.disabled.includes(x);
  const run: Record<Exclude<RowAction, 'reply'>, () => unknown> = {
    continue: () => send(a, 'continue', kit),
    approve: () => decide(a, ctx, 'allow', kit),
    deny: () => decide(a, ctx, 'deny', kit),
    stop: () => kit.guarded(() => api.stop(a.id), t('common.sent')),
  };
  const key = `row:${a.id}`;
  const go = async () => (await send(a, drafts.get(key) ?? '', kit)) && drafts.delete(key);
  const latest = ctx.latest && replyText(ctx.latest, kit);
  return h(
    'div',
    { class: 'agent-controls', 'data-card': key },
    c.reason && h('p', { class: 'ac-reason' }, t(`row.${c.reason}`)),
    h(
      'div',
      { class: 'inline' },
      h('input', {
        placeholder: t('row.reply'),
        'aria-label': t('row.reply'),
        value: drafts.get(key) ?? '',
        disabled: off('reply'),
        oninput: (e: Event) => drafts.set(key, (e.target as HTMLInputElement).value),
        onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && void go(),
        ...kit.editable,
      }),
      h('button', { class: 'primary', type: 'button', 'aria-label': t('common.send'), title: t('common.send'), disabled: off('reply'), onclick: () => void go() }, icon(Send)),
    ),
    h(
      'div',
      { class: 'actions ac-actions' },
      ...c.actions
        .filter((x): x is Exclude<RowAction, 'reply'> => x !== 'reply')
        .map((x) => h('button', { type: 'button', class: x === 'approve' ? 'primary' : x === 'stop' ? 'danger' : '', disabled: off(x), onclick: () => void run[x]() }, t(LABEL[x]))),
    ),
    latest && h('div', { class: 'ac-latest' }, h('div', { class: 'ac-latest-head' }, h('span', {}, t('row.latestReply')), latest.toggle), latest.text),
  );
}
