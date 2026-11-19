import { describe, expect, it } from 'vitest';
import { lookup, resolveLocale, t, TABLES } from './i18n';

describe('i18n fallback', () => {
  const avail = ['en', 'de', 'pt-BR', 'zh-Hans', 'zh-Hant'];
  const tables = { en: { a: 'Hi {name}', b: 'Only en' }, de: { a: 'Hallo {name}' } };

  it('lookup order: override, system, language prefix, en, key', () => {
    expect(resolveLocale('de', ['zh-Hans-CN'], avail)).toBe('de');
    expect(resolveLocale(null, ['fr-FR', 'zh-Hant-TW'], avail)).toBe('zh-Hant');
    expect(resolveLocale(null, ['de-AT'], avail)).toBe('de');
    expect(resolveLocale(null, ['pt-PT'], avail)).toBe('pt-BR');
    expect(resolveLocale(null, ['zh-TW'], avail)).toBe('zh-Hant');
    expect(resolveLocale('xx', ['fr'], avail)).toBeNull();
    expect(lookup('b', {}, tables, 'de')).toBe('Only en');
    expect(lookup('zz', {}, tables, 'de')).toBe('zz');
  });

  it('fills placeholders and leaves unknown ones', () => {
    expect(lookup('a', { name: 'Eon' }, tables, 'de')).toBe('Hallo Eon');
    expect(lookup('a', {}, tables, null)).toBe('Hi {name}');
  });

  it('loads the shared en.json', () => {
    expect(TABLES.en['chat.placeholder']).toBe('Ask me anything...');
    expect(t('common.sentTo', { name: 'eon' })).toMatch(/eon/);
  });
});
