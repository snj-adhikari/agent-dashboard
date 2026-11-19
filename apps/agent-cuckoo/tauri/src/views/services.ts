import { ArrowUpRight, RotateCw } from 'lucide';
import { errorText } from '../api';
import type { ApiError, SideDataResponse, SideId, SideItem, SideProvider, SideSettings } from '../types';
import { h, icon, type Child } from './cards';
import { t } from '../i18n';

export type Tone = SideItem['tone'];

/** What a side view needs from the shell; `action` posts an allow-listed side action and never sends mail or messages. */
export interface SideDeps {
  providers: SideProvider[] | null;
  settings: SideSettings | null;
  data: Partial<Record<SideId, SideDataResponse>>;
  refresh(id: SideId | null): Promise<void>;
  action(id: SideId, action: string, itemId?: string | null, text?: string | null): Promise<string | null>;
  render(): void;
}

/** Reason code a card can't list for, from the registry and the user's switch; null when it should list. */
export function blocked(providers: SideProvider[] | null, settings: SideSettings | null, id: SideId): string | null {
  if (!providers) return 'no_side';
  const p = providers.find((x) => x.id === id);
  if (!p) return 'not_installed';
  if (p.reason) return p.reason;
  if (!p.enabled || settings?.enabled[id] !== true) return 'disabled';
  return p.available ? null : 'not_installed';
}

/** `grant` explains how to allow the macOS permission this provider needs. */
export function reasonText(code: string, grant: string): string {
  switch (code) {
    case 'disabled': return t('services.turnOn');
    case 'not_installed': return t('services.notInstalled');
    case 'no_permission': return grant;
    case 'needs_key': return t('services.needsKey');
    case 'signed_out': return t('services.signedOut');
    case 'unsupported_os': return t('services.unsupported');
    case 'timeout': return t('services.timeout');
    case 'no_side': return t('services.noSideFeatures');
    case 'offline': return t('common.offline');
    default: return t('services.unavailable', { code });
  }
}

export function sections(items: SideItem[], groups: [key: string, title: string][]): { title: string; items: SideItem[] }[] {
  if (!groups.length) return [{ title: '', items }];
  const known = new Set(groups.map(([k]) => k));
  return [
    ...groups.map(([key, title]) => ({ title, items: items.filter((i) => i.group === key) })),
    { title: t('common.other'), items: items.filter((i) => !known.has(i.group ?? '')) },
  ].filter((s) => s.items.length);
}

/** Error code from a failed action, falling back to the readable message. */
export function failCode(e: unknown): string {
  const err = e as Partial<ApiError>;
  if (err?.kind === 'offline') return 'offline';
  return err?.error && err.error !== 'http' ? err.error : errorText(e);
}

export const notice = (text: string, tone: Tone = null): HTMLElement => h('p', { class: `side-notice ${tone ?? ''}` }, text);

export function sideRow(item: Pick<SideItem, 'title' | 'subtitle' | 'value' | 'tone'>, lead: Node | null, ...trailing: Child[]): HTMLElement {
  return h(
    'div',
    { class: `side-row ${item.tone ?? ''}` },
    lead ?? h('i', { class: 'side-dot' }),
    h('div', { class: 'side-text' }, h('span', { class: 'side-title' }, item.title), item.subtitle && h('span', { class: 'side-sub' }, item.subtitle)),
    item.value && h('span', { class: 'side-value' }, item.value),
    ...trailing,
  );
}

const iconButton = (node: Parameters<typeof icon>[0], label: string, disabled: boolean, onclick: () => void): HTMLElement =>
  h('button', { class: 'icon', type: 'button', title: label, 'aria-label': label, disabled, onclick }, icon(node, 11));

interface CardState { busy: boolean; result: string | null; failed: string | null }
const cards = new Map<SideId, CardState>();
const stateOf = (id: SideId): CardState => cards.get(id) ?? cards.set(id, { busy: false, result: null, failed: null }).get(id)!;

export type Run = (action: string, itemId?: string | null, text?: string | null) => void;

function runner(id: SideId, deps: SideDeps): Run {
  return (action, itemId = null, text = null) => {
    const s = stateOf(id);
    s.busy = true;
    s.failed = null;
    deps.render();
    deps.action(id, action, itemId, text).then(
      (r) => {
        if (r) s.result = r;
      },
      (e) => {
        s.failed = failCode(e);
      },
    ).finally(() => {
      s.busy = false;
      deps.render();
    });
  };
}

export interface SideCardOpts {
  id: SideId;
  title: string;
  grant: string;
  empty: string;
  groups?: [key: string, title: string][];
  lead?: (item: SideItem) => Node | null;
  extra?: (run: Run, busy: boolean) => Child;
  trailing?: (item: SideItem, run: Run, busy: boolean) => Child;
}

/** Generic side card shared by mail, messages and portfolio: header, action result, failure and the item list. Server text is plain text. */
export function sideCard(o: SideCardOpts, deps: SideDeps): HTMLElement {
  const why = blocked(deps.providers, deps.settings, o.id);
  const data = deps.data[o.id];
  const s = stateOf(o.id);
  const run = runner(o.id, deps);
  const head = h(
    'div',
    { class: 'side-head' },
    h('span', { class: 'side-name' }, o.title),
    !why && data?.summary && h('span', { class: 'side-sub' }, data.summary),
    !why && iconButton(RotateCw, t('common.refresh'), s.busy, () => void deps.refresh(o.id).finally(() => deps.render())),
  );
  if (why) return h('div', { class: `side-card ${o.id}` }, head, notice(reasonText(why, o.grant), why === 'disabled' ? null : 'warn'));
  const items = data?.items ?? [];
  const list = items.length
    ? h(
        'div',
        { class: 'side-list' },
        ...sections(items, o.groups ?? []).flatMap((sec) => [
          sec.title && h('h4', {}, sec.title),
          ...sec.items.map((item) =>
            sideRow(
              item,
              o.lead?.(item) ?? null,
              o.trailing?.(item, run, s.busy),
              item.actions.includes('open') && iconButton(ArrowUpRight, t('common.open'), s.busy, () => run('open', item.id)),
            ),
          ),
        ]),
      )
    : notice(o.empty);
  return h(
    'div',
    { class: `side-card ${o.id}` },
    head,
    o.extra?.(run, s.busy),
    s.failed && notice(reasonText(s.failed, o.grant), 'error'),
    s.result && h('div', { class: 'side-result' }, s.result),
    list,
  );
}

export const SERVICES: [SideId, string][] = [
  ['github', 'GitHub'], ['vercel', 'Vercel'], ['stripe', 'Stripe'], ['n8n', 'n8n'],
  ['resend', 'Resend'], ['notion', 'Notion'], ['calcom', 'Cal.com'],
];
const servicesGrant = () => t('services.allowConnector');

/** Per-service status rows with each connected service's items below. */
export function servicesView(deps: SideDeps): HTMLElement {
  const busy = SERVICES.some(([id]) => stateOf(id).busy);
  return h(
    'div',
    { class: 'side-card services' },
    h('div', { class: 'side-head' }, h('span', { class: 'side-name' }, t('services.title')), iconButton(RotateCw, t('common.refresh'), busy, () => void deps.refresh(null).finally(() => deps.render()))),
    h(
      'div',
      { class: 'side-list' },
      ...SERVICES.flatMap(([id, name]) => {
        const why = blocked(deps.providers, deps.settings, id);
        if (why) return [sideRow({ title: name, subtitle: reasonText(why, servicesGrant()), value: null, tone: why === 'disabled' ? null : 'warn' }, null)];
        const s = stateOf(id);
        const run = runner(id, deps);
        const data = deps.data[id];
        return [
          sideRow({ title: name, subtitle: data?.summary ?? t('common.connected'), value: null, tone: 'ok' }, null),
          s.failed && notice(reasonText(s.failed, servicesGrant()), 'error'),
          ...(data?.items ?? []).map((item) => {
            const row = sideRow(item, null, item.actions.includes('open') && iconButton(ArrowUpRight, t('common.open'), s.busy, () => run('open', item.id)));
            row.classList.add('nested');
            return row;
          }),
        ];
      }),
    ),
  );
}
