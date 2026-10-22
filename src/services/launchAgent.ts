import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ServiceSettings } from './settings'

const execFileAsync = promisify(execFile)
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/
const MASK = '********'
const MAX_SECRET_LEN = 256

export interface GeneratedAgent {
  path: string
  plist: string
  secretEnvNames: string[]
  commands: string[]
  note: string
}

export function serviceDefaults(): ServiceSettings {
  const logs = path.join(os.homedir(), 'Library', 'Logs')
  return {
    label: 'agent-monitor',
    nodePath: process.execPath,
    repoPath: path.join(__dirname, '..', '..'),
    logPath: path.join(logs, 'agent-monitor.log'),
    errLogPath: path.join(logs, 'agent-monitor.err.log'),
    pathEnv: process.env.PATH || '',
    secretEnvNames: []
  }
}

function plistPath(label: string): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function readExisting(file: string): Promise<{ Label?: string; EnvironmentVariables?: Record<string, string> } | null> {
  if (!fs.existsSync(file)) return null
  try {
    const { stdout } = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', file])
    return JSON.parse(stdout)
  } catch {
    throw new Error(`${file} exists but could not be read as a plist, so it was left alone`)
  }
}

export function cleanSecrets(input: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input || typeof input !== 'object') return out
  for (const [name, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value === '') continue
    if (!ENV_NAME_RE.test(name)) throw new Error(`Invalid environment variable name: ${name}`)
    if (/[\r\n]/.test(value) || value.length > MAX_SECRET_LEN) throw new Error(`Invalid value for ${name}: no newlines, max ${MAX_SECRET_LEN} characters`)
    out[name] = value
  }
  return out
}

function renderPlist(s: ServiceSettings, env: Record<string, string>): string {
  const envXml = Object.entries(env)
    .map(([k, v]) => `    <key>${esc(k)}</key>\n    <string>${esc(v)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${esc(s.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(s.nodePath)}</string>
    <string>${esc(path.join(s.repoPath, 'dist', 'index.js'))}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${esc(s.repoPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${esc(s.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(s.errLogPath)}</string>
</dict>
</plist>
`
}

function validate(s: Partial<ServiceSettings>): ServiceSettings {
  const d = serviceDefaults()
  const pick = (k: 'label' | 'nodePath' | 'repoPath' | 'logPath' | 'errLogPath' | 'pathEnv') => s[k]?.trim() || d[k]
  const label = pick('label')
  const nodePath = pick('nodePath')
  const repoPath = pick('repoPath')
  const logPath = pick('logPath')
  const errLogPath = pick('errLogPath')
  if (!label || !LABEL_RE.test(label)) throw new Error('Label may only contain letters, digits, dots, dashes and underscores')
  if (!nodePath || !path.isAbsolute(nodePath)) throw new Error('Node path must be absolute')
  if (!repoPath || !path.isAbsolute(repoPath)) throw new Error('Repo path must be absolute')
  if (!logPath || !errLogPath) throw new Error('Log paths are required')
  const names = [...new Set((s.secretEnvNames || []).map((n) => n.trim()).filter(Boolean))]
  const bad = names.find((n) => !ENV_NAME_RE.test(n))
  if (bad) throw new Error(`Invalid environment variable name: ${bad}`)
  return { label, nodePath, repoPath, logPath, errLogPath, pathEnv: pick('pathEnv'), secretEnvNames: names }
}

/** Writes only under ~/Library/LaunchAgents; never replaces a plist with another Label; secret values are copied from the existing file, never taken from settings. */
export async function generateLaunchAgent(input: Partial<ServiceSettings>, secretsInput?: unknown): Promise<GeneratedAgent> {
  const secrets = cleanSecrets(secretsInput)
  const s = validate({ ...input, secretEnvNames: [...(input.secretEnvNames || []), ...Object.keys(secrets)] })
  const file = plistPath(s.label)
  const existing = await readExisting(file)
  if (existing && existing.Label !== s.label) {
    throw new Error(`${file} belongs to label "${existing.Label}"; refusing to overwrite it`)
  }
  const old = existing?.EnvironmentVariables || {}
  const env: Record<string, string> = {}
  if (s.pathEnv) env.PATH = s.pathEnv
  const unset: string[] = []
  for (const name of s.secretEnvNames) {
    if (secrets[name] !== undefined) env[name] = secrets[name]
    else if (old[name] !== undefined) env[name] = old[name]
    else unset.push(name)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, renderPlist(s, env))
  const masked = { ...env }
  for (const name of s.secretEnvNames) if (name in masked) masked[name] = MASK
  const plist = renderPlist(s, masked)
  const domain = `gui/${process.getuid?.() ?? 501}`
  const note = unset.length
    ? `Add values for ${unset.join(', ')} to the plist yourself (EnvironmentVariables); values are never stored in the database.`
    : 'Existing secret values in the plist were kept; none are stored in the database.'
  return {
    path: file,
    plist,
    secretEnvNames: s.secretEnvNames,
    commands: [`launchctl bootout ${domain}/${s.label}`, `launchctl bootstrap ${domain} ${file}`],
    note
  }
}

export async function installLaunchAgent(label: string): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('LaunchAgents are macOS only')
  if (!LABEL_RE.test(label)) throw new Error('Invalid label')
  const file = plistPath(label)
  const existing = await readExisting(file)
  if (!existing) throw new Error('Generate the plist first')
  if (existing.Label !== label) throw new Error(`${file} belongs to label "${existing.Label}"`)
  const domain = `gui/${process.getuid?.() ?? 501}`
  await execFileAsync('launchctl', ['bootout', `${domain}/${label}`]).catch(() => undefined)
  await execFileAsync('launchctl', ['bootstrap', domain, file])
}
