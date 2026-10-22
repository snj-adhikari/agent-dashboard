import type { ServerResponse } from 'http'
import { mongoStatus, restartMongo } from '../services/db'
import { sendJson } from '../http'

export async function handleMongoStatus(res: ServerResponse): Promise<void> {
  sendJson(res, { ok: true, ...(await mongoStatus()) })
}

export async function handleMongoRestart(res: ServerResponse): Promise<void> {
  try {
    await restartMongo()
    sendJson(res, { ok: true })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
