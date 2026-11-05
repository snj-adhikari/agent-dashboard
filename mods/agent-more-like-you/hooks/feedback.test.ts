import { expect, test } from 'claude-code/testing'
import { editPair, feedbackEntry, foldEdits, foldFeedback, rulesSection, type EditPair, type Feedback } from './feedback'

const fb = (instruction: string): Feedback => ({ ts: 't', audience: 'jira', instruction, before: 'x' })

test('repeated instruction with slightly different wording becomes one rule', () => {
  const md = foldFeedback([
    fb('Keep it shorter and drop the opening greeting'),
    fb('keep it shorter and drop the opening greeting.'),
    fb('Mention the ticket owner'),
  ])
  expect(md).toContain('## Jira')
  expect(md).toContain('(seen 2)')
  expect(md).not.toContain('ticket owner')
  expect(md.match(/^- /gm)?.length).toBe(1)
})

test('a single instruction is not a rule', () => {
  expect(foldFeedback([fb('Mention the ticket owner')])).toBe('')
})

test('edited version sets after, unrelated prompt does not', () => {
  const draft = { audience: 'slack-dm' as const, text: 'The deploy finished and the cache was cleared across all regions.' }
  expect(feedbackEntry('The deploy finished and the cache was cleared in all regions.', draft, 't').after).toBeDefined()
  expect(feedbackEntry('Please make it friendlier next time', draft, 't').after).toBeUndefined()
})

const long = [
  'Hi team,',
  'The migration finished overnight and every table was copied to the new cluster without errors being reported by the tooling at any stage of the run.',
  '- Orders table copied\n- Users table copied\n- Sessions table copied',
  'Let me know if you have any questions.',
].join('\n\n')

test('long draft vs short send gives low ratio and removed greeting and bullets', () => {
  const r = editPair(long, 'Migration done, all tables copied.')
  expect(r.lengthRatio).toBeLessThan(0.5)
  expect(r.removed).toContain('Hi team,')
  expect(r.removed.some((s) => s.includes('- Orders table copied'))).toBe(true)
  expect(r.added).toEqual(['Migration done, all tables copied.'])
})

test('foldEdits with 3 pairs gives target length and kinds; 2 pairs gives nothing', () => {
  const p = (): EditPair => ({ ts: 't', audience: 'jira', before: long, after: 'x', ...editPair(long, 'Migration done, all tables copied.') })
  const lines = foldEdits([p(), p(), p()]).jira ?? []
  expect(lines[0]).toMatch(/^Cut drafts to about \d+% of the draft length$/)
  expect(lines.join('\n')).toContain('greeting opener')
  expect(lines.join('\n')).toContain('bullet list')
  expect(foldEdits([p(), p()])).toEqual({})
})

test('rulesSection round-trips, including Edits', () => {
  const p = (): EditPair => ({ ts: 't', audience: 'jira', before: long, after: 'x', ...editPair(long, 'Migration done, all tables copied.') })
  const md = foldFeedback([fb('Be brief please'), fb('Be brief please')], [p(), p(), p()])
  const sec = rulesSection(md, 'jira')
  expect(sec).toContain('- Be brief please (seen 2)')
  expect(sec).toContain('### Edits')
  expect(rulesSection(md, 'confluence')).toBeNull()
})
