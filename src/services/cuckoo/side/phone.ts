import type { Agent, AgentState, Approval, ApprovalKind, SideItem, SideSettings } from '../agents'
import type { PushPayload } from '../../push'
import type { Provider } from './registry'

export interface PhonePill {
  id: string
  name: string
  state: AgentState
  cli: string | null
  space: string
}

export interface PhoneApproval {
  id: string
  agent: string
  tool: string
  command: string
  kind: ApprovalKind
  receivedAt: number
}

export interface PhoneView {
  updatedAt: number
  pills: PhonePill[]
  approvals: PhoneApproval[]
}

const MAX_COMMAND = 200

/** Read-only view for the phone: names and states, plus a trimmed command per waiting approval. */
export function phoneView(agents: Agent[], approvals: Approval[], now = Date.now()): PhoneView {
  const nameOf = new Map(agents.map((a) => [a.id, a.codename || a.name]))
  return {
    updatedAt: now,
    pills: agents.map((a) => ({ id: a.id, name: a.codename || a.name, state: a.state, cli: a.cli, space: a.space })),
    approvals: approvals.map((p) => ({ id: p.id, agent: nameOf.get(p.agentId) || p.agentId, tool: p.tool, command: p.command.slice(0, MAX_COMMAND), kind: p.kind || 'permission', receivedAt: p.receivedAt })),
  }
}

/** Remembers approval ids; pushes only ids not seen before, and the first call only seeds so a restart doesn't replay. */
export function approvalNotifier(send: (payload: PushPayload) => Promise<number>) {
  let seen: Set<string> | null = null
  return async (view: PhoneView, settings: SideSettings): Promise<number> => {
    const fresh = seen ? view.approvals.filter((a) => !seen!.has(a.id)) : []
    seen = new Set(view.approvals.map((a) => a.id))
    if (!settings.enabled.phone || !settings.phonePush || !fresh.length) return 0
    let sent = 0
    for (const a of fresh) sent += await send({ title: `${a.agent} is waiting`, body: a.kind === 'permission' ? `Approve ${a.tool}?` : a.kind === 'plan' ? 'Plan ready for review' : 'Question for you', tag: `cuckoo-${a.id}` })
    return sent
  }
}

let last: PhoneView | null = null
export const lastPhoneView = (): PhoneView | null => last
export const setPhoneView = (view: PhoneView | null): void => {
  last = view
}

function items(view: PhoneView): SideItem[] {
  const pills = view.pills.map((p): SideItem => ({ id: p.id, title: p.name, subtitle: p.space, value: p.state, url: null, tone: p.state === 'waiting' ? 'warn' : null, group: 'pill', actions: [] }))
  const waiting = view.approvals.map((a): SideItem => ({ id: a.id, title: a.agent, subtitle: a.command || null, value: a.tool, url: null, tone: 'warn', group: 'approval', actions: [] }))
  return [...waiting, ...pills]
}

export const providers: Provider[] = [
  {
    id: 'phone',
    actions: [],
    status: async () => ({ available: true, via: 'web', reason: null }),
    data: async () => last && { items: items(last), summary: `${last.approvals.length} waiting` },
    action: async () => null,
  },
]
