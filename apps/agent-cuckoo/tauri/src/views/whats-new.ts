import { WHATS_NEW_POSE, whatsNew, whatsNewDelayMs } from '../gates';
import type { RecapResponse } from '../types';
import { h } from './cards';
import { recapModel } from './recap';
import './side-b.css';
import { t } from '../i18n';

export const whatsNewPose = WHATS_NEW_POSE;

export interface WhatsNewEnv {
  version: string;
  lastSeen: string | null;
  idle(): boolean;
  show(): void;
  remember(version: string): void;
  set(fn: () => void, ms: number): unknown;
}

/** Runs the version gate: first try 4 s after launch, then every 15 s while busy, up to 12 retries. The version is stored whatever the outcome. */
export function scheduleWhatsNew(env: WhatsNewEnv): void {
  const attempt = (n: number) => {
    const d = whatsNew(env.version, env.lastSeen, n, env.idle());
    if (d === 'retry') {
      env.set(() => attempt(n + 1), whatsNewDelayMs(n + 1));
      return;
    }
    if (d === 'show') env.show();
    env.remember(env.version);
  };
  if (whatsNew(env.version, env.lastSeen, 0, true) === 'skip') {
    env.remember(env.version);
    return;
  }
  env.set(() => attempt(0), whatsNewDelayMs(0));
}

export function whatsNewView(version: string, notes: string[], stats: RecapResponse | null, page: 1 | 2, on: { page(p: 1 | 2): void; close(): void }): HTMLElement {
  const body =
    page === 1
      ? h('ul', { class: 'wn-notes' }, ...notes.map((n) => h('li', {}, n)))
      : stats
        ? h('div', { class: 'recap-rows' }, ...recapModel(stats).stats.map(([k, v]) => h('div', { class: 'recap-row' }, h('span', {}, k), h('b', {}, v))))
        : h('p', { class: 'muted' }, t('whatsNew.statsPending'));
  return h(
    'div',
    { class: 'panel whats-new' },
    h('div', { class: 'who' }, h('span', {}, page === 1 ? t('whatsNew.title') : t('whatsNew.soFar')), h('span', { class: 'count' }, version)),
    body,
    h(
      'div',
      { class: 'actions' },
      page === 2 && h('button', { type: 'button', onclick: () => on.page(1) }, t('common.back')),
      page === 1 ? h('button', { type: 'button', class: 'primary', onclick: () => on.page(2) }, t('common.next')) : h('button', { type: 'button', class: 'primary', onclick: on.close }, t('common.done')),
    ),
  );
}
