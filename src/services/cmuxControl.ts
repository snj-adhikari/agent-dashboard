import { execFileSync } from 'child_process'

export function sendToWorkspace(ref: string, text: string): void {
  execFileSync('cmux', ['send', '--workspace', ref, `${text}\n`], { encoding: 'utf8' })
}

export function sendKey(ref: string, key: string): void {
  execFileSync('cmux', ['send-key', '--workspace', ref, key], { encoding: 'utf8' })
}

export function readWorkspaceScreen(ref: string): string {
  return execFileSync('cmux', ['read-screen', '--workspace', ref], { encoding: 'utf8' })
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function claudeCommand(prompt?: string, env: Record<string, string> = {}): string {
  const vars = Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)} `).join('')
  return `${vars}${prompt ? `claude ${shellQuote(prompt.replace(/[\r\n]+/g, ' '))}` : 'claude'}`
}

// cmux types --command into the user's shell, so a prompt must be shell-quoted to arrive as one argument.
export function openCmuxTab(name: string, cwd: string, command: string): string {
  const out = execFileSync(
    'cmux',
    ['workspace', 'create', '--name', name, '--cwd', cwd, '--command', command, '--focus', 'false'],
    { encoding: 'utf8' }
  )
  return out.trim().replace(/^OK\s+/, '')
}
