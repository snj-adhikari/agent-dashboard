import 'dotenv/config'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { handleGraph } from './routes/graph'
import { handleTerminate } from './routes/terminate'
import { handleRemoveWorktree } from './routes/removeWorktree'
import { handleRemoveWorktrees } from './routes/removeWorktrees'
import { handleWorktreeStatus } from './routes/worktreeStatus'
import { handleInactiveWorktrees } from './routes/inactiveWorktrees'
import { handleSend } from './routes/send'
import { handleScreen } from './routes/screen'
import { handleNewSession } from './routes/newSession'
import { handleHistory } from './routes/history'
import { handleVaultTree, handleVaultGraph, handleVaultFile } from './routes/vault'
import { handleHookEnabled, handleHookInterval, handleHookSession, handleHookStatus, handleJiraStart, handleRunQueued } from './routes/hookStatus'
import { handlePluginDownload, handlePluginImport } from './routes/plugin'
import { handleMongoRestart, handleMongoStatus } from './routes/mongo'
import { handleGetSettings, handleSaveSettings } from './routes/settings'
import { handleCheckDir, handleServiceGenerate, handleServiceInstall, handleSetupStatus } from './routes/setup'
import { handleMobileSessions, handlePulse, handlePushKey, handlePushSubscribe, handlePushTest, handlePushUnsubscribe } from './routes/mobile'
import { isTrustedRequest } from './http'
import { noteClientSeen, startHistoryLogging } from './services/history'
import { startHookPolling } from './services/hooks'
import { loadSettings } from './services/settings'
import { MONGO_URL } from './services/db'
import { missingSteps } from './routes/setup'

const PORT = Number(process.env.MONITOR_PORT) || 5818
const WEB_DIST = path.join(__dirname, '..', 'web', 'dist')

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json'
}

function serveFile(res: http.ServerResponse, filePath: string): void {
  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream' })
  res.end(fs.readFileSync(filePath))
}

function serveWebApp(res: http.ServerResponse, pathname: string): void {
  const candidate = path.join(WEB_DIST, pathname)
  if (candidate.startsWith(WEB_DIST) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    serveFile(res, candidate)
    return
  }
  serveFile(res, path.join(WEB_DIST, pathname === '/m' || pathname.startsWith('/m/') ? 'm/index.html' : 'index.html'))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)

  if (!isTrustedRequest(req, PORT)) {
    res.writeHead(403)
    res.end()
    return
  }

  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/hook-session') noteClientSeen()

  if (url.pathname === '/api/graph') return handleGraph(res, url.searchParams.get('expanded') || '')
  if (url.pathname === '/api/terminate' && req.method === 'POST') return handleTerminate(req, res)
  if (url.pathname === '/api/remove-worktree' && req.method === 'POST') return handleRemoveWorktree(req, res)
  if (url.pathname === '/api/remove-worktrees' && req.method === 'POST') return handleRemoveWorktrees(req, res)
  if (url.pathname === '/api/worktree-status') return handleWorktreeStatus(res, url.searchParams.get('path') || '')
  if (url.pathname === '/api/worktrees/inactive') return handleInactiveWorktrees(res)
  if (url.pathname === '/api/send' && req.method === 'POST') return handleSend(req, res)
  if (url.pathname === '/api/new-session' && req.method === 'POST') return handleNewSession(req, res)
  if (url.pathname === '/api/screen') return handleScreen(res, url.searchParams.get('ref') || '')
  if (url.pathname === '/api/history') return handleHistory(res, url.searchParams.get('range') || 'day')
  if (url.pathname === '/api/vault/tree') return handleVaultTree(res)
  if (url.pathname === '/api/vault/graph') return handleVaultGraph(res)
  if (url.pathname === '/api/vault/file') return handleVaultFile(res, url.searchParams.get('path') || '')
  if (url.pathname === '/api/hook-status') return handleHookStatus(res)
  if (url.pathname === '/api/hooks/jira/start' && req.method === 'POST') return handleJiraStart(req, res)
  if (url.pathname === '/api/hooks/queue/run' && req.method === 'POST') return handleRunQueued(req, res)
  if (url.pathname === '/api/plugin/import' && req.method === 'POST') return handlePluginImport(req, res)
  if (url.pathname === '/api/plugin/download') return handlePluginDownload(res, url.searchParams.get('name') || '')
  if (url.pathname === '/api/hook-session' && req.method === 'POST') return handleHookSession(req, res)
  if (url.pathname === '/api/mongo/status') return handleMongoStatus(res)
  if (url.pathname === '/api/mongo/restart' && req.method === 'POST') return handleMongoRestart(res)
  if (url.pathname === '/api/settings') return req.method === 'POST' ? handleSaveSettings(req, res) : handleGetSettings(res)
  if (url.pathname === '/api/setup/status') return handleSetupStatus(res)
  if (url.pathname === '/api/setup/check-dir' && req.method === 'POST') return handleCheckDir(req, res)
  if (url.pathname === '/api/setup/service/generate' && req.method === 'POST') return handleServiceGenerate(req, res)
  if (url.pathname === '/api/setup/service/install' && req.method === 'POST') return handleServiceInstall(req, res)
  if (url.pathname === '/api/mobile/pulse') return handlePulse(res)
  if (url.pathname === '/api/mobile/sessions') return handleMobileSessions(res)
  if (url.pathname === '/api/push/key') return handlePushKey(res)
  if (url.pathname === '/api/push/subscribe' && req.method === 'POST') return handlePushSubscribe(req, res)
  if (url.pathname === '/api/push/unsubscribe' && req.method === 'POST') return handlePushUnsubscribe(req, res)
  if (url.pathname === '/api/push/test' && req.method === 'POST') return handlePushTest(res)
  const hookEnabled = url.pathname.match(/^\/api\/hooks\/([^/]+)\/enabled$/)
  if (hookEnabled && req.method === 'POST') return handleHookEnabled(req, res, hookEnabled[1])
  const hookInterval = url.pathname.match(/^\/api\/hooks\/([^/]+)\/interval$/)
  if (hookInterval && req.method === 'POST') return handleHookInterval(req, res, hookInterval[1])

  serveWebApp(res, url.pathname)
})

const SETTINGS_RETRY_MS = 30_000

function setupHint(mongoUp: boolean): void {
  if (!missingSteps(mongoUp).length) return
  const url = `http://localhost:${PORT}/setup`
  console.log(mongoUp ? `Setup incomplete: open ${url}` : `MongoDB not reachable at ${MONGO_URL.replace(/\/\/[^@/]*@/, '//')}; open ${url} for the install guide`)
}

let downHinted = false

async function initSettings(): Promise<void> {
  try {
    await loadSettings()
    setupHint(true)
  } catch (e) {
    console.error(`settings not loaded, retrying in ${SETTINGS_RETRY_MS / 1000}s: ${(e as Error).message}`)
    if (!downHinted) setupHint(false)
    downHinted = true
    setTimeout(initSettings, SETTINGS_RETRY_MS)
  }
}

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`agent-monitor listening on http://localhost:${PORT}`)
  startHistoryLogging()
  await initSettings()
  if (!process.env.DISABLE_HOOKS) startHookPolling()
})
