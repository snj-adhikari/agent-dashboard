import { expect, test } from 'claude-code/testing'
import {
  buildIndex, classify, classifyItem, containment, evaluate, evaluateBoth, finalLabel, humanScore, learnMarkers,
  needsJudge, normalise, paragraphs, parseMarkers, renderMarkers, similarity, updateMarkers,
} from './score'

const NOW = '2026-03-10T00:00:00Z'
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString()
const w = (text: string, ts = ago(1)) => ({ tool: 't', target: 'x', text, ts })
const BASE = 'the quick brown fox jumps over the lazy dog near the river bank'
const CASUAL = 'also checked it .. looks fine lol'
const FORMAL = 'Hello team, please review the attached report. Thanks.'

test('similarity: identical 1, symmetric, unrelated below 0.4', () => {
  expect(similarity(BASE, BASE)).toBe(1)
  expect(similarity(BASE, 'zzz qqq xxx')).toBe(similarity('zzz qqq xxx', BASE))
  expect(similarity(BASE, 'completely different words about invoices')).toBeLessThan(0.4)
})

test('normalise lifts a reformatted copy above 0.9', () => {
  const copy = `- **${BASE}** <@U123ABC> https://example.test/x`
  expect(normalise(copy)).toBe(BASE)
  expect(similarity(BASE, copy)).toBeGreaterThanOrEqual(0.9)
})

const AI = [
  'Hello team, the migration completed successfully. All services are healthy.',
  'The report is attached. Please review the summary and confirm the totals.',
  'Here is the plan. The first step updates the schema. The second step backfills data.',
  'Thanks for the update. I have reviewed the proposal and the scope is clear.',
  'The build passed. The deployment will proceed after approval from the owner.',
  'Summary of changes. The parser now handles empty input. Tests cover the edge cases.',
]
const USER_A = [
  'checked it .. looks fine lol',
  'yeah the thing works .. ship it haha',
  'ok restarted it .. back up lol',
  'also looked at the logs .. nothing odd',
  'tried again .. same result haha',
  'cool so that is sorted .. lol',
]
const USER_B = [
  'Thanks :tada: that worked??',
  'Looks good :smile: deploying now!!',
  'Nice one :rocket: merged!!',
  'Done :white_check_mark: what next??',
  'Ready :eyes: shall we go??',
  'Fixed :bug: can you check??',
]
const hasMarker = (m: { items: { kind: string; pattern: string }[] }, p: string) => m.items.some((i) => i.pattern === p)

test('no markers: a casual line is not human, nothing reaches the default threshold', () => {
  expect(humanScore(CASUAL).score).toBe(0.5)
  expect(classify(CASUAL, NOW, [], null).label).toBe('unsure')
})

test('built-in negatives still lower the score', () => {
  expect(humanScore('Hi team,\n- ABC-1 done\n- ABC-2 done\n- #3 merged').score).toBeLessThan(0.5)
  expect(humanScore('One thing \u2014 noted.').signals).toContain('em-dash-or-curly')
})

test('built-in AI tells veto markers: score capped at 0.5', () => {
  const m = { threshold: 0.6, humanN: 0, aiN: 0, items: [{ kind: 'feature' as const, pattern: 'laughter', weight: 0.3, h: 3, a: 0 }, { kind: 'feature' as const, pattern: 'padded-ellipsis', weight: 0.3, h: 3, a: 0 }] }
  expect(humanScore('ok .. lol', m).score).toBeGreaterThan(0.9)
  for (const t of ['ok .. lol \u2014 yes', 'ok .. lol\n- a\n- b\n- c', 'ok .. lol **yes**', 'ok .. lol `x`', 'ok .. lol __x__', 'Hello all .. lol']) {
    expect(humanScore(t, m).score).toBeLessThanOrEqual(0.5)
  }
})

test('learnt markers exclude plain words but keep symbol tokens', () => {
  const m = learnMarkers(['run the tests now \u{1F600}', 'run the build now \u{1F600}', 'run it now \u{1F600}'], AI)
  expect(m.items.filter((i) => i.kind === 'token').map((i) => i.pattern)).toEqual(['\u{1F600}'])
  expect(parseMarkers('## Markers\nthreshold: 0.6\n- token run 0.2 3 0\n- token :) 0.2 3 0\n')!.items.map((i) => i.pattern)).toEqual([':)'])
})

test('two users with different habits learn different markers and score their own lines human', () => {
  const a = learnMarkers(USER_A, AI)
  const b = learnMarkers(USER_B, AI)
  expect(hasMarker(a, 'padded-ellipsis')).toBe(true)
  expect(hasMarker(a, 'emoji-shortcode')).toBe(false)
  expect(hasMarker(b, 'emoji-shortcode')).toBe(true)
  expect(hasMarker(b, 'padded-ellipsis')).toBe(false)
  expect(classify('rebooted it .. all good lol', NOW, [], null, a).label).toBe('human')
  expect(classify('Merged :tada: all good??', NOW, [], null, b).label).toBe('human')
  expect(classify('rebooted it .. all good lol', NOW, [], null, b).label).toBe('unsure')
  expect(classify(AI[0], NOW, [], null, a).label).toBe('unsure')
  expect(a.threshold).toBeGreaterThanOrEqual(0.55)
})

test('render and parse round-trip, section embedded in a phrasebook', () => {
  const m = learnMarkers(USER_A, AI)
  expect(parseMarkers(renderMarkers(m))).toEqual(m)
  expect(parseMarkers(`# Phrasebook\n\nstuff\n\n${renderMarkers(m)}\n## Other\nx`)).toEqual(m)
  expect(parseMarkers('# nothing here')).toBeNull()
})

test('updateMarkers adds counts and shifts weights', () => {
  const m = learnMarkers(USER_A, AI)
  const find = (x: typeof m) => x.items.find((i) => i.pattern === 'padded-ellipsis')
  const more = ['fine .. sure lol', 'done .. yep haha', 'sorted .. ok lol', 'noted .. cool lol']
  const u = updateMarkers(m, more)
  expect(u.humanN).toBe(m.humanN + 4)
  expect(find(u)!.h).toBe(find(m)!.h + 4)
  const plain = Array.from({ length: 60 }, (_, i) => `plain line number ${i} without habits`)
  expect(find(updateMarkers(m, plain))?.weight ?? 0).toBeLessThan(find(m)!.weight)
})

test('updateMarkers adds ai counts, keeps threshold, keeps items above min support', () => {
  const m = learnMarkers(USER_A, AI)
  const u = updateMarkers(m, [], ['x .. y lol', 'x .. y lol'])
  expect(u.aiN).toBe(m.aiN + 2)
  expect(u.threshold).toBe(m.threshold)
  expect(u.items.length).toBe(m.items.length)
})

test('containment: copied assistant paragraph is ai with no draft candidate', () => {
  const idx = buildIndex([{ text: AI[2], ts: ago(2) }])
  expect(containment(AI[2], idx)).toBe(1)
  expect(containment('completely unrelated words about tea and biscuits today', idx)).toBe(0)
  expect(classifyItem(AI[2], NOW, [], idx, null).label).toBe('ai')
  const tiny = buildIndex([{ text: 'sounds good to me', ts: ago(2) }])
  expect(containment('Sounds good.', tiny)).toBe(1)
})

test('typed line plus pasted indexed paragraph is mixed with per-paragraph labels', () => {
  const m = learnMarkers(USER_A, AI)
  const idx = buildIndex([{ text: AI[2], ts: ago(2) }])
  const r = classifyItem(`rebooted it .. all good lol\n\n${AI[2]}`, NOW, [], idx, null, m)
  expect(r.label).toBe('mixed')
  expect(r.paragraphs.map((p) => p.label)).toEqual(['human', 'ai'])
})

test('paragraphs splits on blank lines and bullets, joins tiny ones', () => {
  expect(paragraphs('first para here ok\n\nsecond para here ok')).toHaveLength(2)
  expect(paragraphs('intro line goes here\n- one two three\n- four five six')).toHaveLength(3)
  expect(paragraphs('first para here ok\n\nok\n\nsecond para here ok')).toHaveLength(2)
})

test('finalLabel: provenance > judge > heuristic, judge unsure stays unsure', () => {
  const p = (label: 'human' | 'ai' | 'mixed' | 'unsure') => ({ text: 'x', label, sim: 0, containment: 0, score: 0.5, signals: [] })
  const j = (label: 'human' | 'ai' | 'unsure') => ({ pid: 'r#0', label, reason: 'r' })
  expect(finalLabel(p('ai'), j('human'))).toBe('ai')
  expect(finalLabel(p('mixed'), j('human'))).toBe('mixed')
  expect(finalLabel(p('unsure'), j('human'))).toBe('human')
  expect(finalLabel(p('human'), j('unsure'))).toBe('unsure')
  expect(finalLabel(p('human'), undefined)).toBe('human')
})

test('needsJudge: only unmatched and uncertain or unsure', () => {
  const p = (label: 'human' | 'ai' | 'mixed' | 'unsure', score: number) => ({ text: 'x', label, sim: 0, containment: 0, score, signals: [] })
  expect(needsJudge(p('ai', 0.5))).toBe(false)
  expect(needsJudge(p('mixed', 0.5))).toBe(false)
  expect(needsJudge(p('human', 0.9))).toBe(false)
  expect(needsJudge(p('human', 0.7))).toBe(true)
  expect(needsJudge(p('unsure', 0.1))).toBe(true)
})

test('classify: draft match ai, partial mixed, older candidate ignored', () => {
  expect(classify(BASE, NOW, [w(BASE)], null).label).toBe('ai')
  const partial = 'the quick brown fox jumps over the lazy dog and then went home'
  expect(classify(partial, NOW, [w(BASE)], null).label).toBe('mixed')
  expect(classify(BASE, NOW, [w(BASE, ago(8))], null).sim).toBe(0)
})

test('before coverageFrom needs humanScore >= 0.8', () => {
  const m = { threshold: 0.6, humanN: 0, aiN: 0, items: [{ kind: 'feature' as const, pattern: 'lowercase-start', weight: 0.2, h: 3, a: 0 }] }
  expect(classify('checked the build', ago(1), [], ago(5), m).label).toBe('human')
  expect(classify('checked the build', ago(10), [], ago(5), m).label).toBe('unsure')
})

test('evaluate and evaluateBoth output shape', () => {
  const m = learnMarkers(USER_A, AI)
  const rows = [
    { text: 'rebooted it .. all good lol', label: 'human' as const },
    { text: FORMAL, label: 'human' as const, judged: 'human' as const },
    { text: FORMAL, label: 'ai' as const },
  ]
  expect(evaluate(rows, m)).toContain('actual human    1           1')
  const both = evaluateBoth(rows, m).split('\n')
  expect(both[0]).toBe('heuristic only')
  expect(both[5]).toBe('heuristic + judge')
  expect(both[7]).toBe('actual human    2           0')
  expect(both[9]).toContain('precision(human) = 1.00')
})
