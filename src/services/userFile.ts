import fs from 'fs'
import os from 'os'
import path from 'path'

/** The user's name and nickname as plain JSON, read by mods and other tools without the server running. */
export const USER_FILE = path.join(os.homedir(), '.config', 'agent-monitor', 'user.json')

export interface UserFile {
  name: string
  nickname: string
}

/** Writes the file and returns its mtime, so a later hand edit can be told apart from this write. */
export function writeUserFile(user: UserFile, file = USER_FILE): number {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ name: user.name.trim(), nickname: user.nickname.trim() }, null, 2)}\n`)
  return fs.statSync(file).mtimeMs
}

/** The file's values when it changed after `syncedAt` (the mtime of the last sync); undefined when missing, unchanged or not JSON. */
export function readNewerUserFile(syncedAt: number | undefined, file = USER_FILE): (UserFile & { mtimeMs: number }) | undefined {
  try {
    const { mtimeMs } = fs.statSync(file)
    if (syncedAt !== undefined && mtimeMs <= syncedAt) return undefined
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    return { name: str(j.name), nickname: str(j.nickname), mtimeMs }
  } catch {
    return undefined
  }
}
