import type { ServerResponse } from 'http'
import { collectState } from '../services/state'
import { buildMermaid } from '../services/mermaid'
import { sendJson } from '../http'

export async function handleGraph(res: ServerResponse, expandedParam: string): Promise<void> {
  const state = await collectState()
  const expanded = new Set(expandedParam ? expandedParam.split(',') : [])
  sendJson(res, { mermaid: buildMermaid(state, expanded), state, ts: new Date().toLocaleTimeString() })
}
