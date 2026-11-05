import { expect, test } from 'claude-code/testing'
import { observe } from './extractors'

const id = { slackId: 'U000SELF', ghLogin: 'self-login', accountId: 'acc-self' }

const slackText = `Found 2 messages
From: Self Person <@U000SELF> (ID: U000SELF)
Time: 2026-10-01 10:00:00
Message_ts: 1790000000.000100
Channel: dev (ID: C000CHAN)
Text: hello there
second line
---
From: Other Person <@U000OTHR> (ID: U000OTHR)
Time: 2026-10-01 10:01:00
Message_ts: 1790000060.000200
Channel: dm (ID: D000DM)
Text: reply back
`

test('slack record blocks: self and other, dm vs channel', () => {
  const rows = observe('mcp__s__slack_read_channel', {}, slackText, id)
  expect(rows.length).toBe(2)
  expect(rows[0]).toMatchObject({ source: 'slack', author: 'self', authorId: 'U000SELF', audience: 'slack-channel', channel: 'C000CHAN', text: 'hello there\nsecond line' })
  expect(rows[1]).toMatchObject({ author: 'other', audience: 'slack-dm', target: 'D000DM:' })
  expect(rows[0].id).toBe('slack:C000CHAN:1790000000.000100')
  expect(rows[0].ts).toBe(new Date(1790000000000).toISOString())
})

test('jira comment json with ADF body', () => {
  const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'looks fine' }] }] }
  const json = JSON.stringify({ comments: [
    { id: '10', author: { accountId: 'acc-self' }, body, created: '2026-10-01T00:00:00.000Z' },
    { id: '11', author: { accountId: 'acc-other' }, body: 'plain', created: '2026-10-02T00:00:00.000Z' },
  ] })
  const rows = observe('executeRead', {}, json, id)
  expect(rows.map((r) => [r.id, r.author, r.text])).toEqual([['jira:10', 'self', 'looks fine'], ['jira:11', 'other', 'plain']])
})

test('github comments array', () => {
  const json = JSON.stringify([
    { id: 1, user: { login: 'self-login' }, body: 'nit', created_at: '2026-10-01T00:00:00Z', html_url: 'https://github.com/o/r/pull/7#issuecomment-1' },
    { id: 2, user: { login: 'someone' }, body: 'ok', created_at: '2026-10-01T01:00:00Z', html_url: 'https://github.com/o/r/pull/7#issuecomment-2' },
  ])
  const rows = observe('Bash', { command: 'gh api repos/o/r/issues/7/comments' }, json, id)
  expect(rows.map((r) => r.author)).toEqual(['self', 'other'])
  expect(rows[0]).toMatchObject({ source: 'github', repo: 'o/r', number: 7, target: 'o/r#7', audience: 'github-pr' })
})

test('slack-shaped json', () => {
  const json = JSON.stringify({ messages: [{ user: 'U000SELF', ts: '1790000000.000100', text: 'hi', channel: 'C000CHAN' }] })
  expect(observe('x', {}, json, id)[0]).toMatchObject({ source: 'slack', author: 'self', audience: 'slack-channel' })
})

test('generic json shape', () => {
  const json = JSON.stringify({ items: [{ id: 'a1', authorId: 'U000SELF', content: 'note', timestamp: '2026-10-01T00:00:00Z' }] })
  expect(observe('x', {}, json, id)).toMatchObject([{ id: 'generic:a1', source: 'generic', author: 'self', text: 'note' }])
})

test('skips: no identity, write tools, writing bash, oversize, prose', () => {
  expect(observe('x', {}, slackText, {})).toEqual([])
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) expect(observe(tool, {}, slackText, id)).toEqual([])
  expect(observe('Bash', { command: 'gh api -X POST repos/o/r/issues/1/comments -f body=hi' }, slackText, id)).toEqual([])
  expect(observe('Bash', { command: 'gh pr comment 1 --body hi' }, slackText, id)).toEqual([])
  expect(observe('x', {}, 'a'.repeat(1_200_000), id)).toEqual([])
  expect(observe('x', {}, '{"u":"' + 'a'.repeat(1_200_000) + '"}', id)).toEqual([])
  expect(observe('x', {}, 'Just some plain prose about nothing.', id)).toEqual([])
})
