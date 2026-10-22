import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import type { IncomingMessage, ServerResponse } from 'http'
import { readJsonBody, sendJson } from '../http'
import { settings } from '../services/settings'

const execFileAsync = promisify(execFile)
const MODS_DIR = path.join(__dirname, '..', '..', 'mods')
const MODS = ['agent-monitor-hook', 'agent-sessions', 'stop-slop', 'factory']
const EXTENSION = 'njw-analytic-blocker'
const SKIP = new Set(['.claude-plugin/types', 'tsconfig.json', 'rules.test.js'])
/** Claude Code auto-loads a plugin folder placed in ~/.claude/skills/<name> in every session. */
const INSTALL_DIR = path.join(os.homedir(), '.claude', 'skills')
/** Chrome keeps loading an unpacked extension from its folder, so it needs a stable home outside the repo. */
const EXTENSION_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'agent-monitor', 'extensions', EXTENSION)

export async function handlePluginDownload(res: ServerResponse, name: string): Promise<void> {
  const mod = MODS.includes(name) || name === EXTENSION ? name : MODS[0]
  let dir = mod === EXTENSION ? path.join(MODS_DIR, '..', 'extensions', EXTENSION) : path.join(MODS_DIR, mod)
  let tmp: string | undefined
  try {
    if (mod === EXTENSION) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${EXTENSION}-`))
      dir = path.join(tmp, EXTENSION)
      stageExtension(dir)
    }
    const { stdout } = await execFileAsync('zip', ['-r', '-q', '-', '.', '-x', '.claude-plugin/types/*', 'tsconfig.json', 'rules.test.js'], { cwd: dir, encoding: 'buffer', maxBuffer: 5 * 1024 * 1024 })
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${mod}.zip"` })
    res.end(stdout)
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'could not build plugin zip' }))
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function pluginName(dir: string): string | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name
  } catch {
    return undefined
  }
}

function copyPlugin(src: string, dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true, filter: (f) => !SKIP.has(path.relative(src, f)) })
}

function stageExtension(dest: string): void {
  copyPlugin(path.join(MODS_DIR, '..', 'extensions', EXTENSION), dest)
  const { name, sites } = settings().blocker ?? { name: '', sites: [] }
  const manifestPath = path.join(dest, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const title = name || manifest.name
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, name: title }, null, 2) + '\n')
  fs.writeFileSync(path.join(dest, 'config.json'), JSON.stringify({ name: title, sites }, null, 2) + '\n')
}

/** Chrome has no way to install an unpacked extension from outside, so stage it and open the Load unpacked flow. */
async function importExtension(res: ServerResponse): Promise<void> {
  try {
    stageExtension(EXTENSION_DIR)
    await execFileAsync('open', ['-a', 'Google Chrome', 'chrome://extensions'])
    await execFileAsync('open', ['-R', EXTENSION_DIR])
    const pbcopy = execFile('pbcopy')
    pbcopy.stdin?.end(EXTENSION_DIR)
    sendJson(res, { ok: true, path: EXTENSION_DIR })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}

export async function handlePluginImport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { name } = await readJsonBody(req)
  if (name === EXTENSION) return importExtension(res)
  if (typeof name !== 'string' || !MODS.includes(name)) return sendJson(res, { ok: false, error: 'unknown mod' })
  const src = path.join(MODS_DIR, name)
  const dest = path.join(INSTALL_DIR, name)
  if (fs.existsSync(dest) && pluginName(dest) !== name) {
    return sendJson(res, { ok: false, error: `${dest} already exists and is not the ${name} plugin` })
  }
  try {
    copyPlugin(src, dest)
    sendJson(res, { ok: true, path: dest })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
