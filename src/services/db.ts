import { execFile } from 'child_process'
import net from 'net'
import { promisify } from 'util'
import { MongoClient, Db } from 'mongodb'

const execFileAsync = promisify(execFile)

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017'
const DB_NAME = process.env.MONGO_DB || 'agent_monitor'
const RETRY_AFTER_MS = 10_000
const MONGO_SERVICE = process.env.MONGO_SERVICE || 'mongodb-community'
const BREW = '/opt/homebrew/bin/brew'
const START_WAIT_MS = 20_000

let dbPromise: Promise<Db> | null = null
let lastFailure: { at: number; error: Error } | null = null

export function getDb(): Promise<Db> {
  if (dbPromise) return dbPromise
  if (lastFailure && Date.now() - lastFailure.at < RETRY_AFTER_MS) return Promise.reject(lastFailure.error)
  const connecting = MongoClient.connect(MONGO_URL, { serverSelectionTimeoutMS: 2000 }).then(async (client) => {
    const db = client.db(DB_NAME)
    await db.collection('snapshots').createIndex({ ts: 1 })
    return db
  })
  connecting.catch((error: Error) => {
    dbPromise = null
    lastFailure = { at: Date.now(), error }
  })
  dbPromise = connecting
  return connecting
}

function localMongoPort(): number | null {
  const { hostname, port } = new URL(MONGO_URL)
  return hostname === '127.0.0.1' || hostname === 'localhost' ? Number(port) || 27017 : null
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('error', () => resolve(false))
  })
}

export async function restartMongo(): Promise<void> {
  const port = localMongoPort()
  if (!port) throw new Error('MONGO_URL is not a local server, so it cannot be restarted from here')
  await execFileAsync(BREW, ['services', 'restart', MONGO_SERVICE], { timeout: 60_000 })
  const deadline = Date.now() + START_WAIT_MS
  while (!(await portOpen(port))) {
    if (Date.now() > deadline) throw new Error(`MongoDB did not accept connections within ${START_WAIT_MS / 1000}s; check its log`)
    await new Promise((r) => setTimeout(r, 300))
  }
  dbPromise = null
  lastFailure = null
  statusCache = null
}

const STATUS_CACHE_MS = 10_000
let statusCache: { at: number; value: { up: boolean; error?: string } } | null = null

export async function mongoStatus(): Promise<{ up: boolean; error?: string }> {
  if (statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) return statusCache.value
  let value: { up: boolean; error?: string }
  try {
    const db = await getDb()
    await db.command({ ping: 1 })
    value = { up: true }
  } catch (e) {
    value = { up: false, error: (e as Error).message }
  }
  statusCache = { at: Date.now(), value }
  return value
}
