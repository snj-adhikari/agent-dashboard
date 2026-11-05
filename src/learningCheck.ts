import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { bucket, buildLearning, mergeDays, parseEval, readFolder, readLearning, readSnapshotFile, refreshInto, readStats, resolveLearningFolder, upsertSnapshots, type LearningDayDoc } from './services/learning'
import { writeLearningFixture } from './scripts/learningFixture'

const NOW = new Date('2026-10-03T12:00:00Z')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mly-'))
const dirs: string[] = []
const fixture = () => {
  const dir = tmp()
  dirs.push(dir)
  return { dir, secrets: writeLearningFixture(dir, NOW) }
}

void (async () => {
  try {
    const { dir, secrets } = fixture()
    const built = await buildLearning(dir, NOW)
    const { current, days, runs } = built

    assert.strictEqual(current.empty, false)
    assert.deepStrictEqual({ human: current.totals.human, ai: current.totals.ai, unsure: current.totals.unsure }, { human: 9, ai: 3, unsure: 1 }, 'totals')
    assert.deepStrictEqual(days.map((d) => [d.date, d.learnt.human, d.learnt.ai, d.learnt.unsure]), [['2026-10-01', 4, 2, 0], ['2026-10-02', 4, 1, 1], ['2026-10-03', 1, 0, 0]], 'per-day learnt')
    assert.deepStrictEqual(current.totals.captures, { pull: 3, observed: 2, prompts: 2, feedback: 1, edits: 1 }, 'captures bucketed by ts, bad ts skipped')
    assert.deepStrictEqual(days.map((d) => d.captures.pull), [2, 1, 0], 'plain and <source>-pull files both read')
    assert.deepStrictEqual(current.learnt, { feature: 4, structure: 4, token: 1, nepali: 2, perspective: 3, 'feedback-rule': 2, 'edit-rule': 2 }, 'learnt kinds')
    assert.deepStrictEqual(current.structureByAudience, { 'slack-dm': 3, 'slack-channel': 0, jira: 1, confluence: 0, 'github-pr': 0 })
    assert.deepStrictEqual(current.sources, { slack: 2, jira: 1, confluence: 0, github: 0, prompts: 3, notes: 1, observed: 2, 'edits-feedback': 2 }, 'sources: inputs only, no double counting')
    assert.deepStrictEqual(days.map((d) => d.sources.slack + d.sources.jira), [2, 1, 0], 'pull sources by row date')
    const aud = (a: string) => current.audiences.find((x) => x.audience === a)!
    assert.deepStrictEqual([aud('slack-dm').humanSamples, aud('slack-dm').lastUpdated, aud('slack-dm').profile, aud('slack-dm').frontmatterSamples], [3, '2026-10-01', 'active', 42])
    assert.deepStrictEqual(aud('slack-dm').topMarkers, ['contractions', 'bullets', 'short-paras'], 'top markers by weight')
    assert.deepStrictEqual(aud('jira').topMarkers, ['contractions', 'short-sentences', 'headings'])
    assert.strictEqual(aud('jira').frontmatterSamples, 7)
    assert.strictEqual(aud('slack-channel').profile, 'insufficient')
    assert.strictEqual(aud('confluence').profile, 'insufficient', 'empty section')
    assert.strictEqual(aud('github-pr').profile, 'insufficient', 'missing section')
    assert.strictEqual(aud('github-pr').lastUpdated, '2026-10-02')
    assert.deepStrictEqual(current.runs, [{ date: '2026-09-20', kind: 'learn' }, { date: '2026-09-27', kind: 'refresh' }, { date: '2026-10-02', kind: 'learn' }, { date: '2026-10-03', kind: 'other' }])
    assert.deepStrictEqual(runs.map((r) => r._id), ['run:2026-09-20:1', 'run:2026-09-27:1', 'run:2026-10-02:1', 'run:2026-10-03:1'])

    const sameDay = (await buildLearning(dir, NOW)).days[0]
    assert.deepStrictEqual(sameDay.learnt, { human: 4, ai: 2, unsure: 0 }, 'dedupe (later file wins), judged flips unsure only, other author is 0')

    const h = current.health
    assert.deepStrictEqual([h.lastRun, h.stale, h.staleDays, h.lock, h.coverageFrom, h.eval], ['2026-10-03', false, 7, 'learn', '2026-08-01', { precision: 0.8, recall: 0.75 }], 'health')

    const second = fixture().dir
    fs.writeFileSync(path.join(second, 'cursor.json'), JSON.stringify({ updatedAt: '2026-01-01T00:00:00Z' }))
    fs.rmSync(path.join(second, 'changelog.md'))
    const old = (await buildLearning(second, NOW)).current.health
    assert.deepStrictEqual([old.lastRun, old.stale, old.eval], ['2026-01-01', true, { precision: 0.81, recall: null }], 'stale cursor, eval from profile frontmatter')
    fs.writeFileSync(path.join(second, '.learn.lock'), JSON.stringify({ startedAt: new Date(NOW.getTime() - 31 * 60_000).toISOString() }))
    assert.strictEqual((await buildLearning(second, NOW)).current.health.lock, null, 'stale learn lock ignored')
    fs.writeFileSync(path.join(second, '.refresh.lock'), JSON.stringify({ startedAt: new Date(NOW.getTime() - 59 * 60_000).toISOString() }))
    assert.strictEqual((await buildLearning(second, NOW)).current.health.lock, 'refresh')
    fs.writeFileSync(path.join(second, '.refresh.lock'), JSON.stringify({ startedAt: new Date(NOW.getTime() - 61 * 60_000).toISOString() }))
    assert.strictEqual((await buildLearning(second, NOW)).current.health.lock, null)
    fs.rmSync(path.join(second, 'style-profile.md'))
    assert.ok((await buildLearning(second, NOW)).current.audiences.every((a) => a.profile === 'no profile'), 'no profile when file missing')
    fs.rmSync(path.join(dir, '.learn.lock'))
    assert.strictEqual((await buildLearning(dir, NOW)).current.health.lock, null)
    fs.writeFileSync(path.join(dir, '.learn.lock'), JSON.stringify({ startedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() }))

    const missing = (await buildLearning(path.join(tmp(), 'nope'), NOW)).current
    assert.deepStrictEqual([missing.empty, missing.hint, missing.totals.human], [true, '/more-like-you learn', 0], 'missing folder')
    const partial = tmp()
    dirs.push(partial)
    fs.mkdirSync(path.join(partial, 'raw'))
    fs.writeFileSync(path.join(partial, 'raw', '2026-10-01-pull.jsonl'), '{"ts":"2026-10-01T00:00:00Z"}\n')
    fs.writeFileSync(path.join(partial, 'raw', '2026-10-01-prompts.jsonl'), '{"ts":"2026-10-01T00:00:00Z"}\n')
    fs.writeFileSync(path.join(partial, 'raw', '2026-10-01-edits.jsonl'), '{"ts":"2026-10-01T00:00:00Z"}\n')
    const p = (await buildLearning(partial, NOW)).current
    assert.deepStrictEqual([p.empty, p.totals.human, p.totals.captures.pull + p.totals.captures.prompts + p.totals.captures.edits, p.audiences.every((a) => a.profile === 'no profile')], [false, 0, 3, true], 'partial folder')

    const home = '/home/fx'
    assert.deepStrictEqual(resolveLearningFolder({ MORE_LIKE_YOU_VAULT: '~/x', VAULT_PATH: '/v' }, home, '/s'), { folder: '/home/fx/x', via: 'env' })
    assert.deepStrictEqual(resolveLearningFolder({ VAULT_PATH: '/v/' }, home, '/s'), { folder: '/v/more-like-you', via: 'vaultPath' })
    assert.deepStrictEqual(resolveLearningFolder({}, home, '/s'), { folder: '/s/more-like-you', via: 'vaultPath' })
    assert.deepStrictEqual(resolveLearningFolder({}, home), { folder: '/home/fx/.claude/more-like-you', via: 'default' })

    const cachedHome = tmp()
    dirs.push(cachedHome)
    fs.mkdirSync(path.join(cachedHome, '.claude', 'more-like-you'), { recursive: true })
    fs.writeFileSync(path.join(cachedHome, '.claude', 'more-like-you', 'location.json'), JSON.stringify({ folder: '/c/mly' }))
    assert.deepStrictEqual(resolveLearningFolder({}, cachedHome), { folder: '/c/mly', via: 'cached' })
    assert.strictEqual(resolveLearningFolder({}, cachedHome, '/s').via, 'vaultPath', 'vaultPath beats cached')
    assert.strictEqual(resolveLearningFolder({ MORE_LIKE_YOU_VAULT: '/e' }, cachedHome).via, 'env')
    fs.writeFileSync(path.join(cachedHome, '.claude', 'more-like-you', 'location.json'), JSON.stringify({ folder: '' }))
    assert.strictEqual(resolveLearningFolder({}, cachedHome).via, 'default', 'empty cached folder ignored')

    const day = (date: string, human: number): LearningDayDoc => ({
      _id: `day:${date}`, type: 'day', date, learnt: { human, ai: 0, unsure: 0 },
      captures: { pull: 0, observed: 0, prompts: 0, feedback: 0, edits: 0 },
      sources: { slack: 0, jira: 0, confluence: 0, github: 0, prompts: 0, notes: 0, observed: 0, 'edits-feedback': 0 },
      humanByAudience: { 'slack-dm': 0, 'slack-channel': 0, jira: 0, confluence: 0, 'github-pr': 0 }, updatedAt: NOW
    })
    const edge = [day('2027-01-04', 2), day('2026-12-31', 1), day('2026-12-28', 3)]
    assert.deepStrictEqual(bucket(edge, 'week').map((b) => [b.key, b.start, b.cumulativeHuman]), [['2026-W53', '2026-12-28', 4], ['2027-W01', '2027-01-04', 6]], 'ISO week across year boundary')
    assert.deepStrictEqual(bucket(edge, 'month').map((b) => [b.key, b.start, b.cumulativeHuman]), [['2026-12', '2026-12-01', 4], ['2027-01', '2027-01-01', 6]])
    assert.deepStrictEqual(bucket(edge, 'day').map((b) => b.cumulativeHuman), [3, 4, 6])

    assert.deepStrictEqual(parseEval('- Eval: precision(human) 0.96, recall 0.71, heuristic only'), { precision: 0.96, recall: 0.71 })
    assert.deepStrictEqual(parseEval('PRECISION: 0.5 recall: 0.4\nprecision(human) = 0.9  recall(human) = 0.8'), { precision: 0.9, recall: 0.8 }, 'last match wins')
    assert.strictEqual(parseEval('no numbers'), null)

    const m = mergeDays([day('2026-10-01', 1), day('2026-10-03', 1)], [day('2026-10-01', 9), day('2026-10-02', 2), day('2026-10-03', 5)], '2026-10-03')
    assert.deepStrictEqual(m.map((d) => [d.date, d.learnt.human]), [['2026-10-01', 1], ['2026-10-02', 2], ['2026-10-03', 5]], 'mongo past, vault today and gaps')

    const json = JSON.stringify({ current, days, runs })
    for (const s of secrets) assert.ok(!json.includes(s), `leaked ${s}`)
    const banned = new Set(['text', 'id', 'pid', 'target', 'channel', 'thread', 'issue', 'contentId', 'repo', 'number', 'permalink', 'authorId', 'path', 'reason', 'identity'])
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk)
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        for (const [k, x] of Object.entries(v)) {
          assert.ok(!banned.has(k), `forbidden key ${k}`)
          walk(x)
        }
      }
    }
    walk({ current, days, runs })

    const store = new Map<string, Record<string, unknown>>()
    const col = {
      updateOne: async (filter: { _id: string }, update: Record<string, Record<string, unknown>>, opts?: { upsert?: boolean }) => {
        const hit = store.get(filter._id)
        if (!hit && !opts?.upsert) return
        if (!hit) store.set(filter._id, { _id: filter._id, ...update.$setOnInsert, ...update.$set })
        else if (update.$set) Object.assign(hit, update.$set)
      }
    }
    await upsertSnapshots(col as never, days, runs, '2026-10-03')
    assert.strictEqual(store.size, days.length + runs.length)
    const snap = JSON.stringify([...store.values()])
    for (const s of secrets) assert.ok(!snap.includes(s), `stored ${s}`)
    const mutated = days.map((d) => ({ ...d, learnt: { ...d.learnt, human: d.learnt.human + 100 } }))
    await upsertSnapshots(col as never, mutated, runs.map((r) => ({ ...r, kind: 'other' as const })), '2026-10-03')
    assert.strictEqual((store.get('day:2026-10-01')!.learnt as { human: number }).human, 4, 'past day unchanged')
    assert.strictEqual((store.get('day:2026-10-03')!.learnt as { human: number }).human, 101, 'today updated')
    assert.strictEqual(store.get('run:2026-09-20:1')!.kind, 'learn', 'run docs unchanged')

    const fdir = fixture().dir
    await refreshInto(fdir, NOW, null)
    const sfile = path.join(fdir, 'insights', 'snapshots.jsonl')
    const raw1 = fs.readFileSync(sfile, 'utf8')
    for (const sec of secrets) assert.ok(!raw1.includes(sec), `file leaked ${sec}`)
    for (const l of raw1.trim().split('\n')) for (const k of Object.keys(JSON.parse(l))) assert.ok(!['text', 'id', 'channel'].includes(k), `file key ${k}`)
    assert.strictEqual(readSnapshotFile(fdir).days.length, days.length)
    fs.appendFileSync(sfile, 'not json\n')
    fs.appendFileSync(path.join(fdir, 'raw', '2026-10-03-edits.jsonl'), '{"ts":"2026-10-03T09:00:00Z"}\n')
    fs.rmSync(path.join(fdir, 'raw', '2026-10-01-classified.jsonl'), { force: true })
    await refreshInto(fdir, NOW, null)
    const f2 = readSnapshotFile(fdir)
    const ids = [...f2.days, ...f2.runs].map((d) => d._id)
    assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate ids')
    assert.strictEqual(f2.days.length, days.length)
    assert.strictEqual(f2.days.find((d) => d.date === '2026-10-03')!.captures.edits, 2, 'today updated')
    assert.deepStrictEqual(f2.days.find((d) => d.date === '2026-10-01')!.learnt, { human: 4, ai: 2, unsure: 0 }, 'past unchanged')

    const bstore = new Map<string, Record<string, unknown>>()
    const bcol = {
      updateOne: async (filter: { _id: string }, update: Record<string, Record<string, unknown>>) => {
        const hit = bstore.get(filter._id)
        if (!hit) bstore.set(filter._id, { _id: filter._id, ...update.$setOnInsert, ...update.$set })
        else if (update.$set) Object.assign(hit, update.$set)
      }
    }
    await refreshInto(fdir, NOW, bcol as never)
    const snap1 = JSON.stringify([...bstore.entries()])
    await refreshInto(fdir, NOW, bcol as never)
    assert.strictEqual(JSON.stringify([...bstore.entries()]), snap1, 'backfill idempotent')
    assert.strictEqual(bstore.size, days.length + runs.length)

    const dayLine = (date: string, human: number) => JSON.stringify({ ...day(date, human), updatedAt: NOW.toISOString() })
    const mkdir = () => {
      const d = tmp()
      dirs.push(d)
      return d
    }
    const putSnap = (d: string, lines: string[]) => {
      fs.mkdirSync(path.join(d, 'insights'), { recursive: true })
      fs.writeFileSync(path.join(d, 'insights', 'snapshots.jsonl'), lines.join('\n') + '\n')
    }
    const putRaw = (d: string, name: string, body: string) => {
      fs.mkdirSync(path.join(d, 'raw'), { recursive: true })
      fs.writeFileSync(path.join(d, 'raw', name), body)
    }
    const read = (d: string, getCol: () => Promise<never>) => readLearning('day', d, 'default', NOW, getCol)
    const down = async () => null as never
    const hist = (r: Awaited<ReturnType<typeof read>>) => {
      assert.ok(r.ok)
      return r.history.map((b) => [b.key, b.learnt.human, b.captures.edits])
    }

    const both = mkdir()
    putSnap(both, [dayLine('2026-10-01', 7), dayLine('2026-10-03', 1)])
    putRaw(both, '2026-10-01-edits.jsonl', '{"ts":"2026-10-01T00:00:00Z"}\n')
    putRaw(both, '2026-10-02-edits.jsonl', '{"ts":"2026-10-02T00:00:00Z"}\n')
    putRaw(both, '2026-10-03-edits.jsonl', '{"ts":"2026-10-03T00:00:00Z"}\n')
    const rBoth = await read(both, down)
    assert.ok(rBoth.ok)
    assert.deepStrictEqual([rBoth.source, rBoth.mongoDown], ['vault', true])
    assert.deepStrictEqual(hist(rBoth), [['2026-10-01', 7, 0], ['2026-10-02', 0, 1], ['2026-10-03', 0, 1]], 'file past wins, today and raw-only from raw')

    const fileOnly = mkdir()
    putSnap(fileOnly, [dayLine('2026-10-01', 5), dayLine('2026-10-02', 6)])
    const rFile = await read(fileOnly, down)
    assert.ok(rFile.ok)
    assert.deepStrictEqual([hist(rFile), rFile.current.empty], [[['2026-10-01', 5, 0], ['2026-10-02', 6, 0]], true], 'file only')

    const rawOnly = mkdir()
    putRaw(rawOnly, '2026-10-02-edits.jsonl', '{"ts":"2026-10-02T00:00:00Z"}\n')
    assert.deepStrictEqual(hist(await read(rawOnly, down)), [['2026-10-02', 0, 1]], 'raw only')

    const rNone = await read(mkdir(), down)
    assert.ok(rNone.ok)
    assert.deepStrictEqual([rNone.history, rNone.current.empty, rNone.mongoDown], [[], true, true], 'neither')
    const rThrow = await read(both, async () => {
      throw new Error('boom')
    })
    assert.ok(rThrow.ok && rThrow.mongoDown && rThrow.source === 'vault', 'throwing getter is down')

    const rUp = await read(both, async () => ({ find: () => ({ toArray: async () => [day('2026-10-01', 9)] }) }) as never)
    assert.ok(rUp.ok)
    assert.deepStrictEqual([rUp.source, rUp.mongoDown], ['mongo', false])
    assert.deepStrictEqual(hist(rUp)[0], ['2026-10-01', 9, 0], 'mongo past wins')

    const rec = new Map<string, Record<string, unknown>>()
    const calls: { id: string; op: string }[] = []
    const recCol = {
      updateOne: async (filter: { _id: string }, update: Record<string, Record<string, unknown>>) => {
        calls.push({ id: filter._id, op: Object.keys(update)[0] })
        const hit = rec.get(filter._id)
        if (!hit) rec.set(filter._id, { _id: filter._id, ...update.$setOnInsert, ...update.$set })
        else if (update.$set) Object.assign(hit, update.$set)
      }
    }
    const bf = fixture().dir
    await refreshInto(bf, NOW, null)
    const fileDocs = readSnapshotFile(bf)
    const pastFileIds = fileDocs.days.filter((d) => d.date !== '2026-10-03').map((d) => d._id)
    fs.appendFileSync(path.join(bf, 'raw', '2026-10-03-edits.jsonl'), '{"ts":"2026-10-03T09:00:00Z"}\n')
    await refreshInto(bf, NOW, recCol as never)
    const state1 = JSON.stringify([...rec.entries()])
    const callsAfter1 = calls.length
    await refreshInto(bf, NOW, recCol as never)
    assert.strictEqual(JSON.stringify([...rec.entries()]), state1, 'second run no state change')
    assert.strictEqual(rec.size, fileDocs.days.length + fileDocs.runs.length, 'doc count = unique days + runs')
    for (const id of [...pastFileIds, ...fileDocs.runs.map((r) => r._id)]) {
      assert.ok(calls.filter((c) => c.id === id).every((c) => c.op === '$setOnInsert'), `${id} never re-set`)
      assert.ok(rec.has(id), `${id} inserted`)
    }
    assert.ok(calls.length > callsAfter1)
    assert.strictEqual((rec.get('day:2026-10-03')!.captures as { edits: number }).edits, 2, 'today reflects fresh build')

    const gone = path.join(tmp(), 'nope')
    await refreshInto(gone, NOW, null)
    assert.ok(!fs.existsSync(gone), 'missing folder not created')

    const before = readStats.parses
    await readFolder(dir)
    await readFolder(dir)
    const warm = readStats.parses
    assert.ok(warm - before <= 0, 'unchanged files served from cache')
    fs.appendFileSync(path.join(dir, 'raw', '2026-10-03-edits.jsonl'), '{"ts":"2026-10-03T09:00:00Z"}\n')
    await readFolder(dir)
    assert.strictEqual(readStats.parses, warm + 1, 'changed file re-parsed')

    console.log('learning check: ok')
  } catch (e) {
    console.error('learning check failed:', e)
    process.exitCode = 1
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
  }
})()
