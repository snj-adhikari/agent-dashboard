import { ChevronDown, createElement, type IconNode } from 'lucide';
import { cards, isLong } from '../cardExpansion';
import * as api from '../api';
import { approvalKind, isGitGrant } from '../board';
import type { Agent, ApiError, Approval, Decision } from '../types';
import type { MascotPose } from './mascot';
import { t } from '../i18n';

export type Child = Node | string | null | false | undefined;

export function h(tag: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'value') (el as HTMLInputElement).value = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export const icon = (node: IconNode, size = 14) => createElement(node, { width: size, height: size }) as unknown as Node;

export interface Kit {
  badge(name: string): Node | null;
  pose(a: Agent): MascotPose;
  stateBadge(a: Agent): Node | null;
  guarded<T>(work: () => Promise<T>, ok?: string): Promise<T | undefined>;
  flash(text: string): void;
  render(): void;
  focus(a: Agent): void;
  editable: Record<string, unknown>;
}

export interface CardButton { decision: Decision; label: string; primary: boolean }
export interface CardModel { title: string; question: boolean; buttons: CardButton[]; terminal: boolean; counter: string | null }

export function cardModel(a: Approval, index: number, total: number, who: string, blocked = false): CardModel {
  const kind = approvalKind(a);
  const terminal = blocked || isGitGrant(a.command);
  const title = t(kind === 'plan' ? 'approval.planReady' : kind === 'question' ? 'approval.asking' : 'approval.needsPermission', { name: who });
  const labels =
    kind === 'plan'
      ? { deny: t('approval.keepPlanning'), allow: t('approval.approvePlan') }
      : kind === 'question' && a.options.length === 2
        ? { deny: a.options[1].label, allow: a.options[0].label }
        : { deny: t('common.deny'), allow: t('common.allow') };
  const buttons: CardButton[] = terminal
    ? []
    : [
        { decision: 'deny', label: labels.deny, primary: false },
        ...(a.options.length === 3 ? [{ decision: 'always' as const, label: t('common.always'), primary: false }] : []),
        { decision: 'allow', label: labels.allow, primary: true },
      ];
  return { title, question: kind === 'question', buttons, terminal, counter: total > 1 ? t('approval.position', { index: index + 1, total }) : null };
}

const terminalOnly = new Set<string>();

/** Flips the card's stored state, re-renders, and cross-fades the new card when Reduce Motion is on. */
export function toggleCard(id: string, onToggle: () => void, fallback = false): void {
  cards.toggle(id, fallback);
  onToggle();
  if (!document.documentElement.classList.contains('reduced')) return;
  document.querySelector(`[data-card="${CSS.escape(id)}"]`)?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' });
}

/** Chevron toggle for an expandable card; flips the stored state for `id` and re-renders. */
export function chevron(id: string, open: boolean, onToggle: () => void, fallback = false): HTMLElement {
  const label = t(open ? 'card.collapse' : 'card.expand');
  return h(
    'button',
    {
      class: open ? 'icon chev open' : 'icon chev',
      title: label,
      'aria-label': label,
      'aria-expanded': String(open),
      onclick: (e: Event) => {
        e.stopPropagation();
        toggleCard(id, onToggle, fallback);
      },
    },
    icon(ChevronDown, 12),
  );
}

/** Wraps the full text; long text shows 3 lines until the card is opened. */
function cardText(tag: 'p' | 'code', cls: string, text: string, id: string, kit: Kit): { el: HTMLElement; toggle: HTMLElement | null } {
  const long = isLong(text);
  const open = !long || cards.isOpen(id);
  const el = h(tag, { class: `${cls}${open ? '' : ' clamped'}${long ? ' expandable' : ''}`, onclick: long ? () => toggleCard(id, () => kit.render()) : undefined }, text);
  return { el, toggle: long ? chevron(id, open, () => kit.render()) : null };
}

export function approvalCard(a: Approval, index: number, total: number, agent: Agent | undefined, kit: Kit, onDone: (id: string) => void): HTMLElement {
  const m = cardModel(a, index, total, agent?.codename ?? agent?.name ?? a.agentId, terminalOnly.has(a.id));
  const decide = (d: Decision) => async () => {
    try {
      await api.approve(a.id, d);
      onDone(a.id);
    } catch (e) {
      if ((e as Partial<ApiError>)?.error === 'grant_in_terminal') terminalOnly.add(a.id);
      kit.flash(api.errorText(e));
      kit.render();
    }
  };
  const canJump = !!agent && agent.canFocus !== false;
  const text = cardText(m.question ? 'p' : 'code', m.question ? 'question' : 'cmd', a.command, `approval:${a.id}`, kit);
  return h(
    'div',
    { class: `approval ${approvalKind(a)}`, 'data-card': `approval:${a.id}` },
    h('div', { class: 'who' }, h('span', {}, m.title), h('span', { class: 'who-end' }, m.counter && h('span', { class: 'count' }, m.counter), text.toggle)),
    text.el,
    m.terminal
      ? h('div', { class: 'actions' }, h('button', { class: 'primary', disabled: !canJump, onclick: () => agent && kit.focus(agent) }, t('approval.replyInTerminal')))
      : h('div', { class: 'actions' }, ...m.buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: decide(b.decision) }, b.label))),
  );
}
