import { expect, test } from 'claude-code/testing'
import { audienceOf, profileSection, targetOf } from './audience'

test('slack channel ids D and U are DMs, others are channels', () => {
  expect(audienceOf('mcp__x__slack_send_message_draft', { channel_id: 'D0AAA' })).toBe('slack-dm')
  expect(audienceOf('slack_send_message_draft', { channel_id: 'U0AAA' })).toBe('slack-dm')
  expect(audienceOf('mcp__y__slack_send_message_draft', { channel_id: 'C0AAA' })).toBe('slack-channel')
  expect(targetOf('slack_send_message_draft', { channel_id: 'C0AAA', thread_ts: '1.2' })).toBe('C0AAA:1.2')
  expect(targetOf('slack_send_message_draft', { channel_id: 'D0AAA' })).toBe('D0AAA:')
})

test('jira and confluence comments map directly and via executeWrite', () => {
  expect(audienceOf('mcp__a__addOrEditJiraIssueComment', { issueIdOrKey: 'ABC-1' })).toBe('jira')
  expect(targetOf('addOrEditJiraIssueComment', { issueIdOrKey: 'ABC-1' })).toBe('ABC-1')
  expect(audienceOf('mcp__a__executeWrite', { name: 'addOrEditJiraIssueComment', inputs: { issueIdOrKey: 'ABC-2' } })).toBe('jira')
  expect(targetOf('executeWrite', { name: 'addOrEditJiraIssueComment', inputs: { issueIdOrKey: 'ABC-2' } })).toBe('ABC-2')
  expect(audienceOf('createConfluenceFooterComment', { pageId: '123' })).toBe('confluence')
  expect(audienceOf('executeWrite', { name: 'createConfluenceInlineComment', inputs: { pageId: '456' } })).toBe('confluence')
  expect(targetOf('executeWrite', { name: 'createConfluenceInlineComment', inputs: { pageId: '456' } })).toBe('456')
})

test('non-comment writes are not gated', () => {
  for (const name of ['createJiraIssue', 'editJiraIssue', 'createConfluenceContent', 'updateConfluenceContent']) {
    expect(audienceOf(name, {})).toBe(null)
    expect(audienceOf('executeWrite', { name, inputs: {} })).toBe(null)
    expect(targetOf(name, {})).toBe(null)
  }
  expect(audienceOf('Read', { file_path: '/x' })).toBe(null)
})

test('gh comment and body forms map to github-pr with owner/repo#number', () => {
  const cmds = [
    'gh pr comment 12 -R acme/widgets --body "hi"',
    'gh pr review 12 --repo acme/widgets -b x',
    'gh pr comment https://github.com/acme/widgets/pull/12 -b x',
    'gh api repos/acme/widgets/issues/12/comments -f body=hi',
    'gh api repos/acme/widgets/issues/12/comments -F body=hi',
    'gh api repos/acme/widgets/pulls/12/comments --field body=hi',
    'gh api repos/acme/widgets/pulls/12/comments --raw-field body=hi',
    'gh api repos/acme/widgets/issues/12/comments --body hi',
  ]
  for (const command of cmds) {
    expect(audienceOf('Bash', { command })).toBe('github-pr')
    expect(targetOf('Bash', { command })).toBe('acme/widgets#12')
  }
})

test('other gh commands are not gated', () => {
  for (const command of ['gh pr view 12', 'gh pr create --title t', 'gh api repos/acme/widgets/pulls/12', 'git status']) {
    expect(audienceOf('Bash', { command })).toBe(null)
  }
})

test('profileSection returns the body, null when missing or insufficient', () => {
  const md = '# Style profile\n## Slack DM\n- Length: short\n- Casing: lower\n## Slack channel\ninsufficient samples\n## Jira\n- Length: mid\n'
  expect(profileSection(md, 'slack-dm')).toBe('- Length: short\n- Casing: lower')
  expect(profileSection(md, 'jira')).toBe('- Length: mid')
  expect(profileSection(md, 'slack-channel')).toBe(null)
  expect(profileSection(md, 'confluence')).toBe(null)
  expect(profileSection('', 'github-pr')).toBe(null)
})

test('slack_send_message maps like the draft tool', () => {
  expect(audienceOf('mcp__claude_ai_Slack__slack_send_message', { channel_id: 'D0AAA' })).toBe('slack-dm')
  expect(audienceOf('slack_send_message', { channel_id: 'C0AAA' })).toBe('slack-channel')
  expect(targetOf('slack_send_message', { channel_id: 'C0AAA', thread_ts: '1.2' })).toBe('C0AAA:1.2')
})
