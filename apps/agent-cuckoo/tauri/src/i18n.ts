/// <reference types="vite/client" />
type Table = Record<string, string>;

export const LANGUAGE_KEY = 'cuckoo.language';
export const SOURCE = 'en';
/** Locale tag and its own name, for the language picker. */
export const LOCALES: [string, string][] = [
  ['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['it', 'Italiano'],
  ['pt-BR', 'Português (Brasil)'], ['nl', 'Nederlands'], ['sv', 'Svenska'], ['da', 'Dansk'], ['nb', 'Norsk bokmål'],
  ['pl', 'Polski'], ['tr', 'Türkçe'], ['ja', '日本語'], ['ko', '한국어'], ['zh-Hans', '简体中文'], ['zh-Hant', '繁體中文'],
];

const ALIASES: Record<string, string> = { 'zh-cn': 'zh-Hans', 'zh-sg': 'zh-Hans', 'zh-tw': 'zh-Hant', 'zh-hk': 'zh-Hant', 'zh-mo': 'zh-Hant', no: 'nb', nn: 'nb' };

export const TABLES: Record<string, Table> = Object.fromEntries(
  Object.entries(import.meta.glob<Table>('../../i18n/*.json', { eager: true, import: 'default' })).map(([path, table]) => [path.replace(/^.*\/|\.json$/g, ''), table]),
);

/** First available table for the override, then each system locale; null means fall back to `en`. */
export function resolveLocale(override: string | null, system: readonly string[], available: Iterable<string>): string | null {
  const byLower = new Map([...available].map((a) => [a.toLowerCase(), a] as const));
  for (const raw of [override, ...system]) {
    if (!raw) continue;
    const tag = raw.replace(/_/g, '-').toLowerCase();
    const parts = tag.split('-');
    while (parts.length) {
      const c = parts.join('-');
      const hit = byLower.get(c) ?? (ALIASES[c] && byLower.get(ALIASES[c].toLowerCase()));
      if (hit) return hit;
      parts.pop();
    }
    const lang = tag.split('-')[0];
    const prefix = [...byLower.values()].sort().find((a) => a.toLowerCase().startsWith(`${lang}-`));
    if (prefix) return prefix;
  }
  return null;
}

export const fill = (text: string, args: Record<string, string | number> = {}) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in args ? String(args[k]) : m));

export function lookup(key: string, args: Record<string, string | number>, tables: Record<string, Table>, locale: string | null): string {
  return fill((locale && tables[locale]?.[key]) ?? tables[SOURCE]?.[key] ?? key, args);
}

function override(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}

export const currentLocale = () => resolveLocale(override(), typeof navigator === 'undefined' ? [] : navigator.languages ?? [], Object.keys(TABLES));

export const t = (key: string, args: Record<string, string | number> = {}) => lookup(key, args, TABLES, currentLocale());
