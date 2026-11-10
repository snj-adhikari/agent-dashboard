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

/** Herdr app agents share one hc session, so each Herdr app space gets its own house. */
const houseKey = (a: HerdrAgent): string => (a.host === 'herdr-app' ? `${a.session}:${a.workspaceId || a.display || ''}` : a.session)

/** Groups agents into one house per herdr session or Herdr app space, warden first, creatures by urgency then codename. */
export function housesOf(agents: HerdrAgent[]): DexHouse[] {
  const keys = [...new Set(agents.map(houseKey))].sort()
  return keys.map((key) => {
    const members = agents.filter((a) => houseKey(a) === key)
    const title = members.find((a) => a.display)?.display || key
    const given = members.find((a) => a.house)
    return {
      ...houseOf(title),
      ...(given && { house: given.house as string, colours: given.houseColours || houseOf(title).colours }),
      session: key,
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
