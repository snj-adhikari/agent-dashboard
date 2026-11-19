import { h } from './cards';
import { sideCard, type SideDeps } from './services';
import { t } from '../i18n';

export const composeText = (draft: string): string | null => draft.trim() || null;

let input: HTMLInputElement | null = null;

/** WhatsApp unread count and a compose box; compose opens WhatsApp with the text filled in, the user sends it there. */
export function messagesView(deps: SideDeps, editable: Record<string, unknown> = {}): HTMLElement {
  input ??= h('input', { class: 'side-input', placeholder: t('messages.message'), ...editable }) as HTMLInputElement;
  const field = input;
  return sideCard(
    {
      id: 'whatsapp',
      title: 'WhatsApp',
      grant: t('messages.permission'),
      empty: t('messages.empty'),
      extra: (run, busy) =>
        h(
          'div',
          { class: 'inline' },
          field,
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              onclick: () => {
                const text = composeText(field.value);
                if (!text) return;
                run('compose', null, text);
                field.value = '';
              },
            },
            t('messages.openWhatsApp'),
          ),
        ),
    },
    deps,
  );
}
