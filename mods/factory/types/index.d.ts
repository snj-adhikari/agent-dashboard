export type FactoryRun = { goal: string; round: number; lastPrompt: string } | null

declare module 'claude-code' {
  interface PluginState {
    factory: { run: FactoryRun; reportTo: string | null }
  }
}
