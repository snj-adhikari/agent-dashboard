import { countdown, idle, remaining, running, TIMER_POSE, type Phase, type TimerState } from '../timer';
import { h } from './cards';
import './side-b.css';
import { t } from '../i18n';

export const TIMER_KEY = 'cuckoo.timer';

const PHASES: ReadonlySet<string> = new Set<Phase>(['work', 'short', 'long']);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Restores a saved timer; anything malformed becomes a fresh idle timer. */
export function parseTimer(raw: string | null): TimerState {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || !PHASES.has(v.phase) || !num(v.worksDone) || !(v.endsAt === null || num(v.endsAt)) || !(v.pausedLeft === null || num(v.pausedLeft))) return idle();
    return { phase: v.phase, endsAt: v.endsAt, pausedLeft: v.pausedLeft, worksDone: v.worksDone };
  } catch {
    return idle();
  }
}

export function loadTimer(): TimerState {
  try {
    return parseTimer(localStorage.getItem(TIMER_KEY));
  } catch {
    return idle();
  }
}

export function saveTimer(s: TimerState): void {
  try {
    localStorage.setItem(TIMER_KEY, JSON.stringify(s));
  } catch {}
}

const PHASE_KEY: Record<Phase, string> = { work: 'timer.focus', short: 'timer.shortBreak', long: 'timer.longBreak' };
export const phaseLabel = (p: Phase): string => t(PHASE_KEY[p]);

export const timerPose = (s: TimerState) => (running(s) ? TIMER_POSE : null);

export function timerPill(s: TimerState, now: number): HTMLElement {
  return h('span', { class: `timer-pill ${s.phase}` }, countdown(remaining(s, now)));
}

export interface TimerHandlers { start(): void; pause(): void; reset(): void }

export function timerView(s: TimerState, now: number, on: TimerHandlers): HTMLElement {
  const live = running(s);
  return h(
    'div',
    { class: 'panel timer' },
    h('span', { class: 'tag' }, phaseLabel(s.phase)),
    h('div', { class: 'timer-clock', role: 'timer' }, countdown(remaining(s, now))),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', onclick: on.reset }, t('common.reset')),
      h('button', { type: 'button', class: 'primary', onclick: live ? on.pause : on.start }, live ? t('common.pause') : t('common.start')),
    ),
  );
}
