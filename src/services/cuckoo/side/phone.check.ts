import assert from 'assert'
import type { Agent, Approval } from '../agents'
import type { PushPayload } from '../../push'
import { defaultSettings } from './config'
import { approvalNotifier, phoneView, providers } from './phone'

const agent = (id: string, state: Agent['state']): Agent => ({ id, name: id, codename: `cn-${id}`, colour: null, state, host: 'cmux', terminalApp: null, scope: null, space: 'grille', isMain: false, cwd: '/r', branch: null, lastLine: 'secret line', cli: 'claude', canSend: true })
const approval = (id: string, agentId: string): Approval => ({ id, agentId, tool: 'Bash', command: `rm -rf build ${'x'.repeat(300)}`, options: [], receivedAt: 1, screenHash: 'h' })

export async function run(): Promise<void> {
  assert.ok(providers.length > 0, 'phone exports providers')
  assert.deepStrictEqual(providers[0].actions, [], 'phone is read-only: no actions')
  const agents = [agent('a', 'waiting'), agent('b', 'working')]
  const view = phoneView(agents, [approval('p1', 'a')], 5)
  assert.deepStrictEqual(view.pills[0], { id: 'a', name: 'cn-a', state: 'waiting', cli: 'claude', space: 'grille' })
  assert.ok(!JSON.stringify(view).includes('secret line'), 'terminal lines stay off the phone')
  assert.strictEqual(view.approvals[0].command.length, 200, 'command trimmed')
  assert.deepStrictEqual([view.approvals[0].agent, view.approvals[0].kind], ['cn-a', 'permission'])

  const sent: PushPayload[] = []
  const send = async (p: PushPayload): Promise<number> => (sent.push(p), 1)
  const on = { ...defaultSettings(), enabled: { ...defaultSettings().enabled, phone: true }, phonePush: true }
  const push = approvalNotifier(send)
  assert.strictEqual(await push(phoneView(agents, [approval('old', 'a')]), on), 0, 'first poll only seeds')
  assert.strictEqual(await push(phoneView(agents, [approval('old', 'a'), approval('p1', 'a')]), on), 1, 'new approval pushed')
  assert.deepStrictEqual(sent, [{ title: 'cn-a is waiting', body: 'Approve Bash?', tag: 'cuckoo-p1' }])
  assert.ok(!JSON.stringify(sent).includes('rm -rf'), 'command never leaves in the push payload')
  assert.strictEqual(await push(phoneView(agents, [approval('p1', 'a')]), on), 0, 'same approval not pushed twice')
  assert.strictEqual(await push(phoneView(agents, [approval('p1', 'a'), approval('p2', 'b')]), { ...on, phonePush: false }), 0, 'phonePush off: no push')
  assert.strictEqual(await push(phoneView(agents, [approval('p3', 'b')]), { ...on, enabled: defaultSettings().enabled }), 0, 'phone provider off: no push')
  assert.strictEqual(sent.length, 1)
  assert.strictEqual(defaultSettings().phonePush, false, 'phonePush off by default')
  console.log('ok phone push on new approval')
}
