import fs from 'fs'
import os from 'os'
import path from 'path'
import { herdrEnv, SNJ_TERM } from '../herdr'
import { addressOf, type Address } from './relayLog'
import { isWorkspaceRef } from '../cmuxControl'
import { io } from './keys'
import type { Agent } from './agents'

export type FocusVia = 'cmux' | 'herdr-app' | 'herdr' | 'app' | null

export interface FocusResult {
  ok: true
  focused: boolean
  via: FocusVia
}

type Focusable = Agent & { hostApp?: string | null; canFocus?: boolean }

const CMUX_APP_BIN = '/Applications/cmux.app/Contents/Resources/bin/cmux'
const HERDR_APP_LOCAL = path.join(os.homedir(), '.local', 'bin', 'herdr-app')
const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/

/** hostApp or terminalApp → app name for `open -a`; anything else is never activated. */
const APPS: Record<string, string> = { cmux: 'cmux', Herdr: 'Herdr', 'herdr-app': 'Herdr', Terminal: 'Terminal', iTerm2: 'iTerm', Ghostty: 'Ghostty', Claude: 'Claude' }

export const cmuxBin = (): string => (fs.existsSync(CMUX_APP_BIN) ? CMUX_APP_BIN : 'cmux')
export const herdrAppBin = (): string => (fs.existsSync(HERDR_APP_LOCAL) ? HERDR_APP_LOCAL : 'herdr-app')

const done = (via: FocusVia): FocusResult => ({ ok: true, focused: via !== null, via })

const activate = (app: string): Promise<string> => io.run('open', ['-a', app])

function address(agent: Agent): Address | null {
  try {
    return addressOf(agent)
  } catch {
    return null
  }
}

async function focusHerdr(agent: Agent, a: Address): Promise<void> {
  if (isWorkspaceRef(agent.cmuxWorkspace)) await io.run(cmuxBin(), ['select-workspace', '--workspace', agent.cmuxWorkspace])
  try {
    await io.run('herdr', ['agent', 'focus', a.pane], herdrEnv(process.env, a.session))
  } catch (e) {
    const name = agent.codename || agent.name
    if (!AGENT_NAME_RE.test(name)) throw e
    await io.run(SNJ_TERM, ['attach', a.session, name])
  }
}

/** Selects the agent's own cmux surface, Herdr app terminal or herdr pane; desktop, Terminal and bare agents only raise their app. */
export async function focusAgent(agent: Focusable): Promise<FocusResult> {
  if (agent.canFocus === false) return done(null)
  const app = APPS[agent.hostApp || agent.terminalApp || '']
  const a = agent.host === 'bare' ? null : address(agent)
  if (a?.host === 'cmux') {
    await io.run(cmuxBin(), ['select-workspace', '--workspace', a.session])
    if (a.pane) await io.run(cmuxBin(), ['focus-panel', '--panel', a.pane, '--workspace', a.session])
    await activate('cmux')
    return done('cmux')
  }
  if (a?.host === 'herdr-app') {
    await io.run(herdrAppBin(), ['do', 'pane.focus', JSON.stringify({ terminal: a.pane })])
    await activate('Herdr')
    return done('herdr-app')
  }
  if (a?.host === 'herdr') {
    await focusHerdr(agent, a)
    if (app) await activate(app)
    return done('herdr')
  }
  if (!app) return done(null)
  await activate(app)
  return done('app')
}
