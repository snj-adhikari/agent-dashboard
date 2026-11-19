import { expect, test } from 'claude-code/testing'
import { xpOf } from './balances'
import { kudosPromptSubmit, kudosToolCall, kudosTurnComplete, nearIdentical, score, taskKey } from './kudos'
import type { LedgerEvent } from './ledger'

const LEDGER = '/h/.claude/demerits/ledger.jsonl'

function world(files: Record<string, string> = {}) {
  const fs = new Map(Object.entries(files))
  const $ = {
    session: { id: async () => 's1', cwd: async () => '/work' },
    env: { get: async (k: string) => (k === 'HOME' ? '/h' : undefined) },
    clock: { now: async () => 1000 },
    fs: {
      exists: async (p: string) => fs.has(p),
      read: async (p: string) => fs.get(p) ?? '',
      write: async (p: string, t: string) => void fs.set(p, t),
    },
    process: {
      run: async (argv: string[]) => {
        if (argv[0] === '/bin/sh') fs.set(argv[5], `${fs.get(argv[5]) ?? ''}${argv[4]}\n`)
        else if (argv[0] === 'mv') {
          fs.set(argv[3], fs.get(argv[2]) ?? '')
          fs.delete(argv[2])
        } else if (argv[0] === 'git') return { exitCode: 1, stdout: '', stderr: '' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  } as never
  const events = () =>
    (fs.get(LEDGER) ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l) as LedgerEvent)
  return { $, fs, events }
}

type W = ReturnType<typeof world>
const next = (e: unknown) => e
const human = (w: W, text: string) => kudosPromptSubmit(w.$, { text, origin: { kind: 'composer' } }, next, {})
const call = (w: W, e: object, ran: object = { result: {} }) => kudosToolCall(w.$, e, () => ran, {})
const turn = (w: W, answer: string) => kudosTurnComplete(w.$, { answer }, next, {})
const merge = (w: W, ran?: object) => call(w, { tool: 'Bash', command: 'gh pr merge 12 --squash' }, ran)

test('score table', () => {
  const c = { blocks: 0, rework: 0, redirections: 0, humanPrompts: 3 }
  expect(score(c).points).toBe(18)
  expect(score({ ...c, blocks: 1 }).points).toBe(13)
  expect(score({ ...c, rework: 2 }).points).toBe(13)
  expect(score({ ...c, redirections: 1 }).points).toBe(15)
  expect(score({ ...c, redirections: 2 }).points).toBe(13)
  expect(score({ ...c, redirections: 3 }).points).toBe(12)
  expect(score({ ...c, humanPrompts: 4 }).points).toBe(15)
  expect(score({ blocks: 1, rework: 1, redirections: 9, humanPrompts: 9 }).points).toBe(-7)
})

test('a merge finishes the task once: one auto event plus a zero-point verified-task', async () => {
  const w = world()
  await human(w, 'build the thing')
  await merge(w)
  const [good, verified] = w.events()
  expect(w.events().length).toBe(2)
  expect(good).toMatchObject({ source: 'auto', rule: 'good-work', points: 18, scope: 'agent' })
  expect(good.evidence).toMatchObject({ blocks: 0, rework: 0, redirections: 0, humanPrompts: 1, trigger: 'gh-pr-merge' })
  expect(good.evidence.heuristics).toBeTruthy()
  expect(verified).toMatchObject({ rule: 'verified-task', points: 0 })
  expect(xpOf(verified)).toBe(1)
  expect(xpOf(good)).toBe(18)
})

test('a second trigger in the same task awards nothing', async () => {
  const w = world()
  await merge(w)
  await human(w, 'thanks')
  await merge(w)
  expect(w.events().length).toBe(2)
})

test('a failed or denied merge does not finish', async () => {
  const w = world()
  await merge(w, { result: {}, isError: true })
  await merge(w, { result: { exitCode: 1 } })
  await merge(w, { deny: 'no' })
  expect(w.events().length).toBe(0)
})

test('factory DONE finishes only after an approving human prompt', async () => {
  const w = world()
  await turn(w, 'all good\nFACTORY: DONE')
  expect(w.events().length).toBe(0)
  await human(w, 'approved, go ahead')
  await turn(w, 'FACTORY: DONE')
  expect(w.events()[0].evidence.trigger).toBe('factory-done')
})

test('a thanks prompt finishes without counting itself', async () => {
  const w = world()
  await human(w, 'do x')
  await human(w, 'lgtm, thanks')
  expect(w.events()[0].evidence).toMatchObject({ trigger: 'thanks', humanPrompts: 1 })
})

test('blocks, rework and redirections are counted and drive a negative net', async () => {
  const w = world()
  await call(w, { tool: 'Bash', command: 'git push' }, { deny: 'push gate' })
  await human(w, 'no, that is wrong')
  await human(w, 'I said do it properly')
  await human(w, 'not that one')
  await human(w, 'please redo the migration')
  await human(w, 'thanks')
  const [e] = w.events()
  expect(e.evidence).toMatchObject({ blocks: 1, rework: 1, redirections: 3, humanPrompts: 4 })
  expect(e.points).toBe(0 + 0 + -1 + 3 - 3 + 0)
  expect(e.rule).toBe('redirections')
})

test('near-identical repeats count as redirections, other agents and relays do not', async () => {
  expect(nearIdentical('add the kudos hook to the file now', 'add the kudos hook to the file now please')).toBe(true)
  expect(nearIdentical('yes', 'yes')).toBe(false)
  const w = world()
  await human(w, 'add the kudos hook to the file now')
  await human(w, 'add the kudos hook to the file now')
  await kudosPromptSubmit(w.$, { text: 'no wrong', origin: { kind: 'plugin' } }, next, {})
  await kudosPromptSubmit(w.$, { text: '[main t1] no wrong', origin: { kind: 'composer' } }, next, {})
  await merge(w)
  expect(w.events()[0].evidence).toMatchObject({ redirections: 1, humanPrompts: 2 })
})

test('factory CONTINUE after QA gaps counts as rework', async () => {
  const w = world()
  await turn(w, 'QA found gaps. FACTORY: CONTINUE')
  await merge(w)
  expect(w.events()[0].evidence).toMatchObject({ rework: 1 })
})

test('task key adds the task.md hash when present', async () => {
  expect(await taskKey(world().$)).toBe('s1')
  const key = await taskKey(world({ '/work/ai/factory/task.md': 'abc' }).$)
  expect(key).toMatch(/^s1-[0-9a-f]{12}$/)
  expect(key).not.toBe(await taskKey(world({ '/work/ai/factory/task.md': 'abd' }).$))
})
