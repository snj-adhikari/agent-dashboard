import type { ServerResponse } from 'http'
import { getLearning, refreshLearningSnapshots, type LearningGran } from '../services/learning'
import { sendJson } from '../http'

export async function handleLearning(res: ServerResponse, gran: string): Promise<void> {
  const g: LearningGran = gran === 'week' || gran === 'month' ? gran : 'day'
  try {
    sendJson(res, await getLearning(g))
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}

export async function handleLearningRefresh(res: ServerResponse): Promise<void> {
  try {
    await refreshLearningSnapshots()
    sendJson(res, { ok: true })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
