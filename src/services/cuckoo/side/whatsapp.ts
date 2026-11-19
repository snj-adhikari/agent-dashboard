import { execFile } from 'child_process'
import fs from 'fs'
import { CuckooError } from '../relayLog'
import { osa } from './music'
import type { Provider, SideStatus } from './registry'

const APP_PATH = '/Applications/WhatsApp.app'
const ABSENT = 'absent'

const BADGE = `on run argv
tell application "System Events" to tell process "Dock"
try
set b to value of attribute "AXStatusLabel" of UI element (item 1 of argv) of list 1
on error number n
if n is -1728 then return "${ABSENT}"
error number n
end try
end tell
if b is missing value then return ""
return b
end run`

const openArgs = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => execFile('open', args, { timeout: 5000 }, (err) => (err ? reject(err) : resolve())))

export const whatsappDeps = {
  osa,
  open: openArgs,
  platform: process.platform as string,
  installed: (): boolean => fs.existsSync(APP_PATH),
}

/** Accessibility (-1719, -25211) and Automation (-1743) refusals both mean the user has not granted it yet. */
export const isPermissionError = (e: unknown): boolean => /-1719|-25211|-1743|assistive|not allowed/i.test(String((e as { stderr?: string })?.stderr ?? '') + String((e as Error)?.message ?? ''))

/** `null` = WhatsApp not in the Dock; `-1` = a badge with no number (e.g. a dot). */
export function parseBadge(out: string): number | null {
  const s = out.trim()
  if (s === ABSENT) return null
  if (!s) return 0
  const digits = /^(\d+)\+?$/.exec(s)
  return digits ? Number(digits[1]) : -1
}

export const composeUrl = (text: string): string => `whatsapp://send?text=${encodeURIComponent(text)}`

async function unread(): Promise<number | null> {
  try {
    return parseBadge(await whatsappDeps.osa(BADGE, ['WhatsApp']))
  } catch (e) {
    if (isPermissionError(e)) throw new CuckooError('no_permission', 'Accessibility access is needed to read the WhatsApp badge')
    throw new CuckooError('host_failed', 'could not read the WhatsApp badge')
  }
}

export const provider: Provider = {
  id: 'whatsapp',
  actions: ['compose'],
  async status(): Promise<SideStatus> {
    if (whatsappDeps.platform !== 'darwin') return { available: false, via: null, reason: 'unsupported_os' }
    if (!whatsappDeps.installed()) return { available: false, via: null, reason: 'not_installed' }
    try {
      await unread()
      return { available: true, via: 'applescript', reason: null }
    } catch (e) {
      return { available: false, via: null, reason: e instanceof CuckooError && e.code === 'no_permission' ? 'no_permission' : 'not_installed' }
    }
  },
  async data() {
    const n = await unread()
    const value = n === null ? null : n < 0 ? 'new' : String(n)
    const item = { id: 'unread', title: 'WhatsApp', subtitle: n === null ? 'Not in the Dock' : null, value, url: null, tone: n ? ('warn' as const) : ('ok' as const), group: null, actions: ['compose', 'open'] }
    return { items: [item], summary: null }
  },
  async action(action, _itemId, text) {
    if (action === 'compose') await whatsappDeps.open([composeUrl(text ?? '')])
    else if (action === 'open') await whatsappDeps.open(['-a', 'WhatsApp'])
    else throw new CuckooError('bad_request', `whatsapp does not allow ${action}`)
    return null
  },
}

export const providers = [provider]
