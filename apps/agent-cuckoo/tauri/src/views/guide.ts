import { GUIDE_PAGES, guideStep } from '../gates';
import { h } from './cards';
import { t } from '../i18n';
import './guide.css';

export const openChatCombo = (): string => (/Mac/i.test(globalThis.navigator?.userAgent ?? '') ? 'Ctrl-Opt-C' : 'Ctrl-Alt-C');

export interface GuideHandlers { page(n: number): void; close(): void }

export function guideView(page: number, on: GuideHandlers): HTMLElement {
  const id = GUIDE_PAGES[guideStep(page, 0)];
  const last = page >= GUIDE_PAGES.length - 1;
  return h(
    'div',
    { class: 'panel guide' },
    h('div', { class: 'who' }, h('span', {}, t('guide.title')), h('span', { class: 'count' }, `${page + 1}/${GUIDE_PAGES.length}`)),
    h(
      'div',
      { class: 'guide-page' },
      h('h4', {}, t(`guide.${id}.title`)),
      h('p', {}, id === 'keys' ? t('guide.keys.body', { openChat: openChatCombo() }) : t(`guide.${id}.body`)),
    ),
    h(
      'div',
      { class: 'actions' },
      !last && h('button', { type: 'button', class: 'link', onclick: on.close }, t('guide.skip')),
      page > 0 && h('button', { type: 'button', onclick: () => on.page(guideStep(page, -1)) }, t('guide.back')),
      last ? h('button', { type: 'button', class: 'primary', onclick: on.close }, t('guide.done')) : h('button', { type: 'button', class: 'primary', onclick: () => on.page(guideStep(page, 1)) }, t('guide.next')),
    ),
  );
}
