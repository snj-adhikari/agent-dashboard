import type { ServerResponse } from 'http'
import { getHistory } from '../services/history'
import { sendJson } from '../http'

const RANGE_MS: Record<string, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000
}

export async function handleHistory(res: ServerResponse, range: string): Promise<void> {
  const ms = RANGE_MS[range] || RANGE_MS.day
  try {
    const data = await getHistory(ms)
    sendJson(res, { ok: true, ...data })
  } catch (e) {
    const error = (e as Error).message
    sendJson(res, { ok: false, error, mongoDown: /ECONNREFUSED|server selection|Topology/i.test(error) })
  }
}
