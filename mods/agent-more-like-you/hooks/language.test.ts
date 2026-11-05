import { expect, test } from 'claude-code/testing'
import { decide, englishOnlyWrite, hasNepali, participantsOf, readLanguages } from './language'

const langs = readLanguages(
  JSON.stringify({ nepaliPeople: ['U0TEST1'], englishOnlyPeople: ['U0TEST3'], chats: [{ channel: 'C0TEST5', kind: 'group-dm', people: ['U0TEST1'] }] }),
)

test('hasNepali: Devanagari, two Roman hits incl. one sure; single token and English do not', () => {
  expect(hasNepali('नमस्ते')).toBe(true)
  expect(hasNepali('tapai ma garxu')).toBe(true)
  expect(hasNepali('chha')).toBe(false)
  expect(hasNepali('ma ho ko')).toBe(false)
  expect(hasNepali('Ho Chi Minh visited. See https://x.io/tapai/chha and `tapai chha` and src/tapai_chha.ts')).toBe(false)
})

test('decide: only listed direct chats go Roman Nepali; englishOnly slack-dm wins', () => {
  expect(decide('slack-dm', 'D0TEST1', ['U0TEST1'], langs)).toBe('roman-nepali')
  expect(decide('slack-dm', 'D0TEST1', ['U0TEST1', 'U0TEST3'], langs)).toBe('english')
  expect(decide('slack-dm', 'D0TEST1', null, langs)).toBe('english')
  expect(decide('jira', '', ['U0TEST1'], langs)).toBe('english')
  expect(decide('slack-channel', 'C0TEST5', ['U0TEST1'], { ...langs, englishOnly: ['slack-channel'] })).toBe('roman-nepali')
  expect(decide('slack-channel', 'C0TEST1', ['U0TEST1'], langs)).toBe('english')
  expect(decide('slack-channel', 'C0TEST5', ['U0TEST1'], { ...langs, englishOnly: ['slack-dm'] })).toBe('english')
  expect(decide('slack-dm', 'D0TEST1', ['U0TEST1'], { ...langs, englishOnly: ['slack-dm'] })).toBe('english')
})

const named = readLanguages(
  JSON.stringify({
    nepaliPeople: [{ name: 'Test One', slackId: 'U0TEST1' }, { name: 'Test Two', slackId: 'U0TEST2' }, { name: 'Test Four', slackId: 'U0TEST4' }],
    englishOnlyPeople: [{ name: 'Test Four', slackId: 'U0TEST4' }],
    chats: [
      { channel: 'D0TEST1', kind: 'dm', people: ['Test One'] },
      { channel: 'C0TEST5', kind: 'group-dm', people: ['Test One', 'Test Two'] },
      { channel: 'C0TEST6', kind: 'group-dm', people: ['Test One', 'Test Three'] },
      { channel: 'D0TEST4', kind: 'dm', people: ['Test Four'] },
    ],
  }),
)
const verdict = (channel: string, audience: 'slack-dm' | 'slack-channel' = 'slack-channel') =>
  decide(audience, channel, participantsOf(channel, undefined, named, []), named)

test('decide with { name, slackId } lists and chats[].people names', () => {
  expect(verdict('D0TEST1', 'slack-dm')).toBe('roman-nepali')
  expect(verdict('C0TEST5')).toBe('roman-nepali')
  expect(verdict('C0TEST6')).toBe('english')
  expect(verdict('D0TEST4', 'slack-dm')).toBe('english')
  expect(verdict('U0TEST2', 'slack-dm')).toBe('roman-nepali')
  expect(participantsOf('C0TEST5', 'U0TEST1', named, [])).toEqual(['Test Two'])
})

test('participantsOf: chats, then U id, then captures minus self, else null', () => {
  const caps = [{ channel: 'D0TEST9', authorId: 'U0TEST1' }, { channel: 'D0TEST9', authorId: 'U0SELF' }, { channel: 'G0TEST9', authorId: 'U0TEST1' }]
  expect(participantsOf('C0TEST5', undefined, langs, caps)).toEqual(['U0TEST1'])
  expect(participantsOf('U0TEST2', undefined, langs, [])).toEqual(['U0TEST2'])
  expect(participantsOf('D0TEST9', 'U0SELF', langs, caps)).toEqual(['U0TEST1'])
  expect(participantsOf('D0TEST9', undefined, langs, caps)).toBeNull()
  expect(participantsOf('G0TEST9', 'U0SELF', langs, caps)).toBeNull()
  expect(participantsOf('G0TEST8', undefined, langs, caps)).toBeNull()
})

test('englishOnlyWrite classifies the extra tools', () => {
  expect(englishOnlyWrite('Bash', { command: 'gh issue comment 1 --body hi' })).toBe('github-pr')
  expect(englishOnlyWrite('Bash', { command: 'gh pr view 1' })).toBeNull()
  expect(englishOnlyWrite('x__executeWrite', { name: 'createConfluencePage' })).toBe('confluence')
  expect(englishOnlyWrite('x__executeDestructive', { name: 'updateConfluencePage' })).toBe('confluence')
  expect(englishOnlyWrite('mcp__a__transitionJiraIssue', {})).toBe('jira')
  expect(englishOnlyWrite('mcp__a__addWorklogToJiraIssue', {})).toBe('jira')
  expect(englishOnlyWrite('mcp__a__getJiraIssue', {})).toBeNull()
  expect(englishOnlyWrite('mcp__a__getTransitionsForJiraIssue', {})).toBeNull()
  expect(englishOnlyWrite('Bash', { command: 'gh pr create --fill' })).toBeNull()
  expect(englishOnlyWrite('Bash', { command: 'gh issue create -t x' })).toBe('github-pr')
  expect(englishOnlyWrite('Bash', { command: 'gh pr merge 1 --body x' })).toBe('github-pr')
  expect(englishOnlyWrite('Bash', { command: 'gh pr create -F body.md' })).toBe('github-pr')
})
