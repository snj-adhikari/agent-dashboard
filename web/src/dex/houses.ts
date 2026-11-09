import { hashOf, houseOf, isWarden, type House } from '../../../src/shared/house'
import type { HerdrAgent } from '../types'

export interface DexHouse extends House {
  session: string
  title: string
  host: 'herdr' | 'herdr-app'
  warden?: HerdrAgent
  creatures: HerdrAgent[]
}

const RANK: Record<string, number> = { blocked: 0, working: 1, done: 2, idle: 3 }

/** Groups herdr agents into one house per session, warden first, creatures by urgency then codename. */
export function housesOf(agents: HerdrAgent[]): DexHouse[] {
  const sessions = [...new Set(agents.map((a) => a.session))].sort()
  return sessions.map((session) => {
    const members = agents.filter((a) => a.session === session)
    const title = members.find((a) => a.display)?.display || session
    return {
      ...houseOf(title),
      session,
      title,
      host: members[0]?.host || 'herdr',
      warden: members.find((a) => isWarden(a.name)),
      creatures: members
        .filter((a) => !isWarden(a.name))
        .sort((a, b) => (RANK[a.status] ?? 4) - (RANK[b.status] ?? 4) || (a.codename || '').localeCompare(b.codename || ''))
    }
  })
}

export const dexNumber = (codename: string): string => `No. ${String((hashOf(codename) % 999) + 1).padStart(3, '0')}`
