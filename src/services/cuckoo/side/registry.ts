import type { SideId, SideItem, SideProvider, SideReason, SideSettings, SideVia } from '../agents'

export const SIDE_IDS: SideId[] = ['mail', 'whatsapp', 'music', 'crypto', 'github', 'vercel', 'stripe', 'n8n', 'resend', 'notion', 'calcom', 'recap', 'notes', 'phone']
export const PERSONAL_IDS: SideId[] = ['mail', 'whatsapp', 'notes', 'phone']
export const isSideId = (v: unknown): v is SideId => typeof v === 'string' && (SIDE_IDS as string[]).includes(v)

export interface SideStatus {
  available: boolean
  via: SideVia | null
  reason: SideReason | null
}

export interface SideData {
  items: SideItem[]
  summary: string | null
}

/** One provider module per id; `actions` is the allow-list checked before `action` runs. `open` is always allowed. */
export interface Provider {
  id: SideId
  actions: string[]
  status(settings: SideSettings): Promise<SideStatus>
  data(settings: SideSettings): Promise<SideData | null>
  action(action: string, itemId: string | null, text: string | null, settings: SideSettings): Promise<string | null>
}

/** Stub used until a provider task fills its module. */
export const stub = (id: SideId): Provider => ({
  id,
  actions: [],
  status: async () => ({ available: false, via: null, reason: 'disabled' }),
  data: async () => null,
  action: async () => null,
})

const STATUS_MS = 5000

/** Disabled providers are never probed, so no permission prompt fires before the user opts in; a throw or hang becomes a reason. */
export async function providerStatus(p: Provider, settings: SideSettings, timeoutMs = STATUS_MS): Promise<SideProvider> {
  const enabled = settings.enabled[p.id] === true
  if (!enabled) return { id: p.id, available: false, enabled, via: null, reason: 'disabled' }
  let timer: NodeJS.Timeout | undefined
  try {
    const s = await Promise.race([p.status(settings), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)))])
    return { id: p.id, available: s.available, enabled, via: s.via, reason: s.available ? null : s.reason ?? 'not_installed' }
  } catch {
    return { id: p.id, available: false, enabled, via: null, reason: 'not_installed' }
  } finally {
    clearTimeout(timer)
  }
}
