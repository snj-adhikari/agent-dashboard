import { h } from './cards';
import { sideCard, type SideDeps } from './services';
import { t } from '../i18n';

export const mailGroups = (): [string, string][] => [['reply', t('mail.needsReply')], ['later', t('mail.later')], ['fyi', t('mail.fyi')]];

/** Mail triage (reply, later, fyi) and plans; the draft action opens a visible Mail composer and never sends. */
export function mailView(deps: SideDeps): HTMLElement {
  return sideCard(
    {
      id: 'mail',
      title: t('mail.title'),
      grant: t('mail.permission'),
      empty: t('mail.empty'),
      groups: mailGroups(),
      extra: (run, busy) =>
        h(
          'div',
          { class: 'side-actions' },
          h('button', { type: 'button', disabled: busy, onclick: () => run('triage') }, t('mail.triage')),
          h('button', { type: 'button', disabled: busy, onclick: () => run('plan') }, t('mail.planReplies')),
        ),
      trailing: (item, run, busy) =>
        item.actions.includes('draft') && h('button', { class: 'small', type: 'button', disabled: busy, onclick: () => run('draft', item.id) }, t('mail.draftReply')),
    },
    deps,
  );
}
