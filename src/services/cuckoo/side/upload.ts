import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { Transform, type Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { UploadResponse } from '../agents'
import { CuckooError } from '../relayLog'
import { cuckooDir, secureDir } from './config'

export const MAX_UPLOAD = 25 * 1024 * 1024
export const UPLOAD_ID_RE = /^[0-9a-f]{32}$/
export const INBOX_QUOTA = 200 * 1024 * 1024
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_NAME = 100

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv',
  '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.zip': 'application/zip',
}

export const inboxDir = (): string => path.join(cuckooDir(), 'inbox')
const inbox = (): string => secureDir(inboxDir())

/** Basename only, percent-decoded, no control or path characters, no leading dots, at most 100 chars. */
export function sanitiseName(raw: string | undefined | null): string {
  let name = String(raw ?? '')
  try {
    name = decodeURIComponent(name)
  } catch {}
  name = name.replace(/\\/g, '/').split('/').pop() ?? ''
  name = name.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^[.\s]+/, '').trim()
  if (name.length > MAX_NAME) {
    const ext = path.extname(name).slice(0, 12)
    name = name.slice(0, MAX_NAME - ext.length) + ext
  }
  return name || 'file'
}

export const mimeOf = (name: string): string => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream'

const tooLarge = (): CuckooError => new CuckooError('too_large', `uploads are capped at ${MAX_UPLOAD / 1024 / 1024} MB`)
const inboxFull = (): CuckooError => new CuckooError('too_large', `the upload inbox is over ${INBOX_QUOTA / 1024 / 1024} MB`)

/** Deletes uploads older than `maxAgeMs` and returns the bytes still held; never follows links, skips folders. */
export function sweepInbox(now = Date.now(), maxAgeMs = MAX_AGE_MS): number {
  const dir = inboxDir()
  if (!fs.existsSync(dir)) return 0
  let used = 0
  for (const f of fs.readdirSync(dir)) {
    const file = path.join(dir, f)
    const st = fs.lstatSync(file, { throwIfNoEntry: false })
    if (!st || st.isDirectory()) continue
    if (now - st.mtimeMs > maxAgeMs) fs.rmSync(file, { force: true })
    else used += st.size
  }
  return used
}

/** Streams into a new 0600 file (O_EXCL, O_NOFOLLOW) and aborts as soon as the byte count passes the per-file cap or the inbox quota. */
export async function saveUpload(body: Readable, rawName: string | undefined | null, declared?: number): Promise<UploadResponse> {
  if (declared != null && declared > MAX_UPLOAD) throw tooLarge()
  const dir = inbox()
  const room = INBOX_QUOTA - sweepInbox()
  if (room <= 0 || (declared != null && declared > room)) throw inboxFull()
  const limit = Math.min(MAX_UPLOAD, room)
  const name = sanitiseName(rawName)
  const uploadId = crypto.randomBytes(16).toString('hex')
  const file = path.join(dir, `${uploadId}-${name}`)
  const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants
  const fd = fs.openSync(file, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
  let bytes = 0
  const counter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length
      done(bytes > limit ? (limit < MAX_UPLOAD ? inboxFull() : tooLarge()) : null, chunk)
    },
  })
  try {
    await pipeline(body, counter, fs.createWriteStream('', { fd }))
  } catch (e) {
    fs.rmSync(file, { force: true })
    throw e instanceof CuckooError ? e : new CuckooError('bad_request', `upload interrupted: ${(e as Error).message}`)
  }
  return { ok: true, uploadId, name, bytes, mime: mimeOf(name) }
}

/** Resolves an upload id to its file inside the inbox; anything else (bad id, symlink, missing) is a bad request. */
export function resolveUpload(id: unknown): string {
  if (typeof id !== 'string' || !UPLOAD_ID_RE.test(id)) throw new CuckooError('bad_request', 'bad upload id')
  const dir = inbox()
  const entry = fs.readdirSync(dir).find((f) => f.startsWith(`${id}-`))
  const file = entry ? path.join(dir, entry) : ''
  const st = file ? fs.lstatSync(file, { throwIfNoEntry: false }) : undefined
  if (!st?.isFile() || path.dirname(file) !== dir) throw new CuckooError('bad_request', `no upload ${id}`)
  return file
}
