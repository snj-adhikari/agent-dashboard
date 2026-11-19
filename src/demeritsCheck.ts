import assert from 'assert'
import { buildSnapshot, fold, upsertEvents, type DemeritEvent, type RegistryRow } from './services/demerits'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const ev = (over: Partial<DemeritEvent>): DemeritEvent => ({ id: 'e1', ts: NOW - 1000, agent: 'bond', scope: 'agent', by: 'snj', points: -10, rule: 'tamper', reason: 'r', source: 'snj', ...over })
const registry: RegistryRow[] = [{ agent: 'bond', rank: 'sub', start: 500, ts: 0 }, { agent: 'ash', rank: 'main', start: 1000, ts: 0 }]

const store = new Map<string, DemeritEvent>()
const fakeCol = {
  bulkWrite: async (ops: { updateOne: { filter: { id: string }; update: { $setOnInsert: DemeritEvent } } }[]) => {
    for (const { updateOne: u } of ops) if (!store.has(u.filter.id)) store.set(u.filter.id, u.update.$setOnInsert)
  }
}

void (async () => {
  await upsertEvents(fakeCol as never, [ev({})])
  await upsertEvents(fakeCol as never, [ev({}), ev({ id: 'e1', points: -99 })])
  assert.strictEqual(store.size, 1, 'same id twice is one event')
  assert.strictEqual(store.get('e1')?.points, -10, 'duplicate does not overwrite')

  const agentEvent = fold([ev({})], registry, NOW)
  assert.strictEqual(agentEvent.agents.find((a) => a.agent === 'bond')?.balance, 490, 'agent event moves the agent')
  assert.strictEqual(agentEvent.agents.find((a) => a.agent === 'ash')?.balance, 1000, 'other agents untouched')
  assert.strictEqual(agentEvent.pool.balance, 4990, 'agent event moves the pool')

  const poolEvent = fold([ev({ id: 'p1', scope: 'pool', points: 25 })], registry, NOW)
  assert.deepStrictEqual(poolEvent.agents.map((a) => a.balance), [500, 1000], 'pool event leaves agents alone')
  assert.strictEqual(poolEvent.pool.balance, 5025, 'pool event moves the pool')

  const undone = fold([ev({}), ev({ id: 'r1', points: 10, reverses: 'e1' })], registry, NOW)
  assert.strictEqual(undone.agents.find((a) => a.agent === 'bond')?.balance, 500, 'reversal cancels the agent move')
  assert.strictEqual(undone.pool.balance, 5000, 'reversal cancels the pool move')

  const snap = buildSnapshot([ev({}), ev({ id: 'e2', ts: NOW - 500, rule: 'biased-scoring' })], registry, NOW, 'vault')
  assert.strictEqual(snap.events[0].id, 'e2', 'feed is newest first')
  assert.strictEqual(snap.agents.find((a) => a.agent === 'bond')?.biased, true, 'biased-scoring flags the agent')
  assert.strictEqual(snap.source, 'vault')
})()
