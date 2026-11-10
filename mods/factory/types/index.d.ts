export type OfficeStatus = 'working' | 'idle' | 'blocked' | 'done'

export type OfficeAgent = {
  id: string
  team: 'product' | 'tech' | 'research' | 'dev' | 'qa'
  role: string
  task: string
  status: OfficeStatus
  codename: string | null
  terminal: string | null
}

export type OfficeLead = { terminal: string; codename: string | null }

export type FactoryRun = {
  goal: string
  round: number
  lastPrompt: string
  agents?: OfficeAgent[]
  lead?: OfficeLead
  leadStatus?: OfficeStatus
  file?: string
} | null

declare module 'claude-code' {
  interface PluginState {
    factory: { run: FactoryRun; reportTo: string | null }
  }
}
