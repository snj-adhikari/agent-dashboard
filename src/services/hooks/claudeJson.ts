import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadConfig } from './config'

const execFileAsync = promisify(execFile)
const TIMEOUT_MS = 10 * 60 * 1000

// launchd's PATH lacks ~/.local/bin, and the interactive `claude` is a zsh function wrapper.
export function claudeBin(): string {
  const local = path.join(os.homedir(), '.local', 'bin', 'claude')
  return process.env.CLAUDE_BIN || (fs.existsSync(local) ? local : 'claude')
}

interface ClaudeEnvelope {
  is_error?: boolean
  result?: string
  permission_denials?: { tool_name: string }[]
  structured_output?: { error?: string } & Record<string, unknown>
}

/**
 * Headless, read-only lookup: built-in tools removed (`--tools ""`), only the named MCP read
 * tools pre-approved; anything else is auto-refused because -p cannot prompt.
 */
export async function runClaudeJson<T>(prompt: string, schema: object, allowedTools: string[]): Promise<T> {
  const args = [
    '-p',
    '--model', loadConfig().pollModel,
    '--tools', '',
    '--allowedTools', allowedTools.join(','),
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    prompt
  ]
  const { stdout } = await execFileAsync(claudeBin(), args, {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024
  })
  const envelope = JSON.parse(stdout) as ClaudeEnvelope
  if (envelope.is_error) throw new Error(`claude -p failed: ${envelope.result || 'unknown error'}`)
  if (envelope.permission_denials?.length) {
    throw new Error(`permission denied: ${envelope.permission_denials.map((d) => d.tool_name).join(', ')}`)
  }
  const out = envelope.structured_output
  if (!out) throw new Error('claude -p returned no structured output')
  if (out.error) throw new Error(out.error)
  return out as T
}
