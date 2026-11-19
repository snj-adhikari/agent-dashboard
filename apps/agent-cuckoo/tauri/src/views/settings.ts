import { openUrl } from '@tauri-apps/plugin-opener';
import type { Settings } from '../api';
import type { Holding, SideId, SideProvider, SideSettings } from '../types';
import { outfitLabel, outfitPrefs } from './wardrobe';
import { HOME_CLOSE_MS, type FsmOptions } from '../fsm';
import { DEFAULT_VOLUME } from '../sounds';
import { h, type Child, type Kit } from './cards';
import { LANGUAGE_KEY, LOCALES, t } from '../i18n';

const INSPIRED_URL = 'https://github.com/Louis-CFM/coucou';
export const AUTO_CLOSE_SEC = [10, 15, 30] as const;
export const MAX_VOLUME = 0.2;

export function fsmOptions(s: Settings | null): Pick<FsmOptions, 'openOnHover' | 'autoCloseMs'> {
  const sec = AUTO_CLOSE_SEC.find((x) => x === s?.autoCloseSec);
  return { openOnHover: s?.openOnHover ?? false, autoCloseMs: sec ? sec * 1000 : HOME_CLOSE_MS };
}

export const soundOptions = (s: Settings | null): { enabled: boolean; volume: number } => ({
  enabled: s?.sounds ?? true,
  volume: Math.min(MAX_VOLUME, Math.max(0, s?.volume ?? DEFAULT_VOLUME)),
});

const brand = (name: string) => () => name;
export const SIDE_LABELS: [SideId, () => string][] = [
  ['mail', () => t('settings.featureMail')], ['whatsapp', brand('WhatsApp')], ['notes', () => t('settings.featureNotetaker')], ['phone', () => t('settings.featurePhone')],
  ['music', () => t('settings.featureMusic')], ['crypto', () => t('settings.crypto')], ['recap', () => t('settings.featureRecap')],
  ['github', brand('GitHub')], ['vercel', brand('Vercel')], ['stripe', brand('Stripe')], ['n8n', brand('n8n')], ['resend', brand('Resend')], ['notion', brand('Notion')], ['calcom', brand('Cal.com')],
];
export const PERSONAL: ReadonlySet<SideId> = new Set<SideId>(['mail', 'whatsapp', 'notes', 'phone']);
export const CURRENCIES = ['AUD', 'USD', 'EUR', 'GBP', 'NZD', 'JPY', 'CAD'] as const;

/** Personal-data providers stay off unless the server settings explicitly turn them on. */
export const sideOn = (s: SideSettings | null, id: SideId): boolean => s?.enabled[id] === true;

/** "BTC 0.5, eth 2" -> holdings; entries without a positive amount are dropped. */
export function parseHoldings(text: string): Holding[] {
  return text
    .split(/[,\n]/)
    .map((x) => x.trim().split(/\s+/))
    .filter((p) => p.length === 2 && /^[a-z0-9]{1,12}$/i.test(p[0]) && Number(p[1]) > 0)
    .map(([sym, amt]) => ({ symbol: sym.toUpperCase(), amount: Number(amt) }));
}
export const holdingsText = (h: Holding[]): string => h.map((x) => `${x.symbol} ${x.amount}`).join(', ');

export interface SideEnv {
  providers: SideProvider[] | null;
  settings: SideSettings | null;
  save(patch: Partial<SideSettings>): void;
  open(tab: 'wardrobe' | 'timer'): void;
  captureShortcuts(on: boolean): void;
}

export interface SettingsEnv { reduced: boolean; about: { name: string; version: string }; side?: SideEnv; showGuide?: () => void }

const toggle = (label: string, on: boolean, flip: () => void) =>
  h('button', { type: 'button', class: on ? 'switch on' : 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: flip });
const row = (label: string, ...rest: Child[]) => h('div', { class: 'srow-set' }, h('span', {}, label), ...rest);

function sideSections(s: Settings, side: SideEnv, kit: Kit, save: (next: Settings, ok?: string) => Promise<void>): Child[] {
  const ss = side.settings;
  const known = new Set(side.providers?.map((p) => p.id) ?? []);
  const prefs = outfitPrefs(s);
  let holdings = holdingsText(ss?.holdings ?? []);
  return [
    h('h4', {}, t('settings.sideFeatures')),
    h(
      'div',
      { class: 'side-switches' },
      ...SIDE_LABELS.filter(([id]) => !side.providers || known.has(id)).map(([id, labelOf]) => [id, labelOf()] as const).map(([id, label]) =>
        h('label', { class: 'side-switch' }, toggle(label, sideOn(ss, id), () => ss && side.save({ enabled: { ...ss.enabled, [id]: !sideOn(ss, id) } })), label, PERSONAL.has(id) && h('span', { class: 'muted' }, t('settings.personalTag'))),
      ),
    ),
    !ss && h('p', { class: 'muted' }, t('settings.sideLoading')),
    ss &&
      row(
        t('settings.crypto'),
        h('input', { class: 'holdings', placeholder: t('settings.cryptoPlaceholder'), value: holdings, oninput: (e: Event) => (holdings = (e.target as HTMLInputElement).value), ...kit.editable }),
        h('select', { 'aria-label': t('settings.currency'), onchange: (e: Event) => side.save({ currency: (e.target as HTMLSelectElement).value }) }, ...CURRENCIES.map((c) => h('option', { value: c, selected: ss.currency === c }, c))),
        h('button', { type: 'button', onclick: () => side.save({ holdings: parseHoldings(holdings) }) }, t('common.save')),
      ),
    ss && row(t('settings.hideProjectsShort'), toggle(t('settings.hideProjectsShort'), ss.hideProjects, () => side.save({ hideProjects: !ss.hideProjects }))),
    ss && row(t('settings.phonePushShort'), toggle(t('settings.phonePushShort'), ss.phonePush, () => side.save({ phonePush: !ss.phonePush }))),
    row(
      t('settings.outfit'),
      h('button', { type: 'button', class: 'capsule on', onclick: () => side.open('wardrobe') }, outfitLabel(prefs.choice)),
      ...(['south', 'north'] as const).map((x) => h('button', { type: 'button', class: x === prefs.hemisphere ? 'capsule on' : 'capsule', onclick: () => void save({ ...s, hemisphere: x }) }, x === 'south' ? t('settings.southern') : t('settings.northern'))),
    ),
    row(t('settings.timerShort'), h('button', { type: 'button', class: 'capsule', onclick: () => side.open('timer') }, t('settings.openClock'))),
    row(t('settings.desktopMascot'), toggle(t('settings.desktopMascot'), s.desktopMascot ?? false, () => void save({ ...s, desktopMascot: !s.desktopMascot }))),
    row(
      t('settings.captureKeys'),
      toggle(t('settings.captureShortcuts'), s.captureShortcuts ?? false, () => side.captureShortcuts(!s.captureShortcuts)),
      h('span', { class: 'muted' }, t('settings.shortcutsCapture')),
    ),
  ];
}

function storedLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}

function setLanguage(tag: string): void {
  try {
    if (tag) localStorage.setItem(LANGUAGE_KEY, tag);
    else localStorage.removeItem(LANGUAGE_KEY);
  } catch {
    return;
  }
}

/** System default plus each locale in its own name; picking one re-renders in that language. */
export function languageRow(kit: Pick<Kit, 'render'>): HTMLElement {
  const current = storedLanguage() ?? '';
  const options: [string, string][] = [['', t('settings.languageSystem')], ...LOCALES];
  return row(
    t('settings.language'),
    h(
      'select',
      { 'aria-label': t('settings.language'), onchange: (e: Event) => (setLanguage((e.target as HTMLSelectElement).value), kit.render()) },
      ...options.map(([tag, name]) => h('option', { value: tag, selected: tag === current, lang: tag || undefined }, name)),
    ),
  );
}

export function settingsView(s: Settings | null, env: SettingsEnv, kit: Kit, save: (next: Settings, ok?: string) => Promise<void>): HTMLElement {
  if (!s) return h('p', { class: 'muted panel' }, t('settings.loading'));
  const draft = { ...s };
  const autoSec = fsmOptions(s).autoCloseMs / 1000;
  return h(
    'form',
    {
      class: 'panel settings',
      onsubmit: (e: Event) => {
        e.preventDefault();
        void save(draft, t('status.settingsSaved'));
      },
    },
    h(
      'div',
      { class: 'srow-set' },
      h('span', {}, t('common.sound')),
      toggle(t('common.sound'), s.sounds, () => void save({ ...s, sounds: !s.sounds })),
      h('input', {
        type: 'range',
        min: 0,
        max: MAX_VOLUME,
        step: 0.01,
        value: soundOptions(s).volume,
        'aria-label': t('settings.volume'),
        disabled: !s.sounds,
        onchange: (e: Event) => void save({ ...s, volume: Number((e.target as HTMLInputElement).value) }),
      }),
    ),
    h(
      'div',
      { class: 'srow-set' },
      h('span', {}, t('settings.autoClose')),
      ...AUTO_CLOSE_SEC.map((sec) => h('button', { type: 'button', class: sec === autoSec ? 'capsule on' : 'capsule', onclick: () => void save({ ...s, autoCloseSec: sec }) }, t('common.secondsShort', { sec }))),
    ),
    h('div', { class: 'srow-set' }, h('span', {}, t('settings.openOnHover')), toggle(t('settings.openOnHover'), s.openOnHover ?? false, () => void save({ ...s, openOnHover: !s.openOnHover }))),
    h('div', { class: 'srow-set' }, h('span', {}, t('settings.reduceMotion')), h('span', { class: 'muted' }, t(env.reduced ? 'common.followsSystemOn' : 'common.followsSystemOff'))),
    languageRow(kit),
    env.showGuide && row(t('settings.showGuide'), h('button', { type: 'button', class: 'capsule', onclick: env.showGuide }, t('guide.title'))),
    ...(env.side ? sideSections(s, env.side, kit, save) : []),
    h('label', {}, t('settings.monitorURL'), h('input', { value: s.monitorUrl, oninput: (e: Event) => (draft.monitorUrl = (e.target as HTMLInputElement).value), ...kit.editable })),
    h(
      'label',
      {},
      t('settings.token'),
      h('input', { type: 'password', value: s.token ?? '', oninput: (e: Event) => (draft.token = (e.target as HTMLInputElement).value || null), ...kit.editable }),
    ),
    h('button', { class: 'primary', type: 'submit' }, t('common.save')),
    h(
      'p',
      { class: 'muted' },
      h('b', {}, env.about.name),
      ' ',
      t('about.versionBy', { version: env.about.version }),
      ' ',
      h('a', { href: INSPIRED_URL, onclick: (e: Event) => (e.preventDefault(), void openUrl(INSPIRED_URL).catch(() => kit.flash(t('error.openBrowser')))) }, t('about.inspired')),
    ),
  );
}
