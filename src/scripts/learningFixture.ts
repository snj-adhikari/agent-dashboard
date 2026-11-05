import fs from 'fs'
import path from 'path'

export type FixtureSecrets = string[]

const ID = (n: number) => `fx-id-${n}-zq`
const TEXT = (n: number) => `Fixture sentence ${n} zq`
const para = (n: number, label: string) => ({ text: `${TEXT(n)} p`, label, sim: 0, containment: 0, score: 0, signals: [] })

function classified(n: number, source: string, audience: string | null, author: string, labels: string[], ts: string) {
  return { id: ID(n), source, audience, ts, text: TEXT(n), author, label: 'unsure', sim: 0, score: 0, signals: [], paragraphs: labels.map((l, i) => para(n * 10 + i, l)) }
}

export function writeLearningFixture(dir: string, now: Date = new Date()): FixtureSecrets {
  const raw = path.join(dir, 'raw')
  fs.mkdirSync(raw, { recursive: true })
  const jsonl = (name: string, rows: unknown[], tail = '') => fs.writeFileSync(path.join(raw, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n' + tail)
  const file = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body)
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

  jsonl(
    '2026-10-01-classified.jsonl',
    [
      classified(1, 'slack', 'slack-dm', 'self', ['human', 'ai', 'unsure'], '2026-10-01T01:00:00Z'),
      classified(2, 'jira', 'jira', 'self', ['mixed', 'human'], '2026-10-01T02:00:00Z'),
      classified(3, 'slack', 'slack-channel', 'other', ['human'], '2026-10-01T03:00:00Z'),
      classified(4, 'slack', 'slack-dm', 'self', ['unsure'], '2026-10-01T04:00:00Z')
    ],
    'not json at all\n{"id":"fx-id-9-zq","source":"sl'
  )
  jsonl('2026-10-01-classified-2.jsonl', [classified(4, 'slack', 'slack-dm', 'self', ['human'], '2026-10-01T04:00:00Z')])
  jsonl('2026-10-01-judged.jsonl', [
    { pid: `${ID(1)}#2`, label: 'human', reason: 'fixture-reason-zq' },
    { pid: `${ID(1)}#1`, label: 'human', reason: 'fixture-reason-zq' },
    { pid: `${ID(2)}#0`, label: 'human', reason: 'fixture-reason-zq' }
  ])
  jsonl('2026-10-02-classified.jsonl', [
    classified(5, 'prompts', null, 'self', ['human', 'human'], '2026-10-02T01:00:00Z'),
    classified(6, 'transcript', null, 'self', ['ai'], '2026-10-02T02:00:00Z'),
    classified(7, 'github', 'github-pr', 'self', ['human'], '2026-10-02T03:00:00Z'),
    classified(8, 'notes', null, 'self', ['unsure'], '2026-10-02T04:00:00Z'),
    classified(10, 'email', null, 'self', ['human'], '2026-10-02T05:00:00Z')
  ])
  jsonl('2026-10-03-classified.jsonl', [classified(11, 'confluence', 'confluence', 'self', ['human'], '2026-10-03T01:00:00Z')])

  const pull = (n: number, ts: string, source = 'slack') => ({
    id: ID(n), source, ts, text: TEXT(n), authorId: 'U0FIXTURE1', author: 'self', channel: 'C0FIXTURE1', thread: 'T0FIXTURE1',
    repo: 'fixture-org/fixture-repo', permalink: 'https://fixture.example/p/zq1'
  })
  jsonl('2026-10-01-slack-pull.jsonl', [pull(21, '2026-10-01T05:00:00Z'), pull(24, 'garbage')])
  jsonl('2026-10-01-pull.jsonl', [pull(22, '2026-10-01T06:00:00Z')])
  jsonl('2026-10-02-jira-pull.jsonl', [pull(23, '2026-10-02T05:00:00Z', 'jira')])
  jsonl('2026-10-02-observed.jsonl', [pull(31, '2026-10-02T06:00:00Z'), pull(32, '2026-10-02T07:00:00Z')])
  jsonl('2026-10-01-prompts.jsonl', [pull(41, '2026-10-01T07:00:00Z'), pull(42, '2026-10-03T07:00:00Z')])
  jsonl('2026-10-02-feedback.jsonl', [{ ts: '2026-10-02T08:00:00Z', audience: 'jira', prompt: TEXT(51), after: TEXT(52) }])
  jsonl('2026-10-03-edits.jsonl', [{ ts: '2026-10-03T08:00:00Z', audience: 'jira', before: TEXT(61), after: TEXT(62) }])
  jsonl('2026-10-02-nepali-learnt.jsonl', [
    { section: 'learnt', phrase: 'fixture-namaste-zq' },
    { section: 'learnt', phrase: 'fixture-dhanyabad-zq' },
    { section: 'seen', phrase: 'fixture-seen-zq' }
  ])

  file(
    'phrasebook.md',
    [
      '## Markers',
      'threshold: 0.5',
      'humanN: 10',
      'aiN: 10',
      '- feature contractions 2.5 10 2',
      '- feature short-sentences 1.5 8 3',
      '- feature oxford-comma -1.0 1 9',
      '- feature em-dash 0.5 5 5',
      '- token @@#7 1.2 4 0',
      '- token wordy 0.9 3 0',
      '- structure slack-dm:bullets 2.0 6 1',
      '- structure slack-dm:short-paras 1.8 5 1',
      '- structure slack-dm:questions 0.2 2 1',
      '- structure jira:headings 0.7 3 1',
      ''
    ].join('\n')
  )
  file(
    'style-profile.md',
    [
      '---',
      'samples: 42',
      'samples.jira: 7',
      'precision: 0.81',
      '---',
      '## Slack DM',
      'Fixture profile body zq',
      '## Slack channel',
      'insufficient samples',
      '## Jira',
      'Fixture jira profile zq',
      '## Confluence',
      ''
    ].join('\n')
  )
  file('rules.md', ['# Rules', '- Fixture rule one zq (seen 2)', '- Fixture rule two zq (seen 5)', '- not a counted rule', '### Edits', '- Fixture edit rule one zq', '- Fixture edit rule two zq', ''].join('\n'))
  file('perspective.md', ['# Perspective', '- Fixture view one zq', '- Fixture view two zq', '- Fixture view three zq', 'plain line', ''].join('\n'))
  file('nepali-glossary.md', ['# Glossary', '## Learnt', '- fixture-gloss-one-zq', '- fixture-gloss-two-zq', '- fixture-gloss-three-zq', ''].join('\n'))
  file(
    'changelog.md',
    [
      '# Changelog',
      '## 2026-09-20 learn first pass',
      '- fixture line',
      '## 2026-09-27 refresh local',
      'precision(human) = 0.70  recall(human) = 0.60',
      '## 2026-10-02 learn weekly',
      'precision(human) = 0.80  recall(human) = 0.75',
      '## 2026-10-03 tidyfixturezq notes',
      ''
    ].join('\n')
  )
  file('cursor.json', JSON.stringify({ version: 1, identity: { slackId: 'U0FIXTUREID' }, coverageFrom: '2026-08-01T00:00:00.000Z', updatedAt: '2026-10-02T08:00:00.000Z' }, null, 2) + '\n')
  file('.learn.lock', JSON.stringify({ startedAt: ago(5 * 60_000) }))

  return [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 21, 22, 23, 24, 31, 32, 41, 42].flatMap((n) => [ID(n), TEXT(n)]),
    TEXT(51),
    TEXT(62),
    'C0FIXTURE1',
    'T0FIXTURE1',
    'U0FIXTURE1',
    'U0FIXTUREID',
    'fixture-org/fixture-repo',
    'https://fixture.example/p/zq1',
    '@@#7',
    'fixture-namaste-zq',
    'fixture-dhanyabad-zq',
    'fixture-gloss-one-zq',
    'fixture-reason-zq',
    'Fixture rule one zq',
    'Fixture edit rule one zq',
    'Fixture view one zq',
    'Fixture profile body zq',
    'Fixture jira profile zq',
    'tidyfixturezq'
  ]
}

if (require.main === module) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('usage: node dist/scripts/learningFixture.js <dir>')
    process.exit(1)
  }
  writeLearningFixture(dir)
  console.log(`wrote fixture to ${dir}`)
}
