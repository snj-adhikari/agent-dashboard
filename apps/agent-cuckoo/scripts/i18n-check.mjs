#!/usr/bin/env node
/**
 * Checks every ac/i18n/<locale>.json has exactly en's keys with the same {placeholders}.
 * Without --keys-only it also flags view literals that equal an en.json value (use t() instead),
 * skipping values with under 3 letters outside {placeholders} or that look like a code id (routes, paths, classes, ids).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'i18n');
const keysOnly = process.argv.includes('--keys-only');
const errors = [];

const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const holders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const en = read('en.json');
const enKeys = Object.keys(en);

for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'en.json')) {
  const table = read(f);
  for (const k of enKeys) {
    if (!(k in table)) errors.push(`${f}: missing ${k}`);
    else if (holders(table[k]) !== holders(en[k])) errors.push(`${f}: ${k} placeholders {${holders(table[k])}} != {${holders(en[k])}}`);
  }
  for (const k of Object.keys(table)) if (!(k in en)) errors.push(`${f}: extra key ${k}`);
}

if (!keysOnly) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = Object.values(en)
    .filter((v) => (v.replace(/\{\w+\}/g, '').match(/\p{L}/gu) ?? []).length >= 3)
    .filter((v) => !/^[a-z][a-z-]*$/.test(v))
    .map((v) => new RegExp(`^${esc(v).replace(/\\\{\w+\\\}/g, '.+')}$`));
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  const files = [
    ...walk(join(root, 'macos/Sources/AgentCuckoo')).filter((f) => f.endsWith('.swift')),
    ...walk(join(root, 'tauri/src')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('i18n.ts')),
    ...['index.html', 'desktop-mascot.html'].map((f) => join(root, 'tauri', f)),
  ];
  for (const f of files) {
    const re = f.endsWith('.swift') ? /"((?:[^"\\\n]|\\.)*)"/g : f.endsWith('.html') ? />([^<>]+)<|(?:title|placeholder|aria-label)="([^"]*)"/g : /'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|"((?:[^"\\\n]|\\.)*)"/g;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*|import )/.test(line)) return;
      for (const m of line.matchAll(re)) {
        const s = (m[1] ?? m[2] ?? m[3] ?? '').trim();
        if (s && patterns.some((p) => p.test(s))) errors.push(`${relative(root, f)}:${i + 1}: literal UI string "${s}"`);
      }
    });
  }
}

for (const e of errors) console.log(e);
console.log(`i18n-check: ${enKeys.length} en keys, ${errors.length} problem(s)${keysOnly ? ' (keys only)' : ''}`);
process.exit(errors.length ? 1 : 0);
