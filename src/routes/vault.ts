import type { ServerResponse } from 'http'
import { getVaultTree, getVaultGraph, readVaultFile, vaultConfigured, vaultExists } from '../services/vault'
import { sendJson } from '../http'

const NOT_CONFIGURED = { ok: false, error: 'vault not configured' }

export function handleVaultTree(res: ServerResponse): void {
  if (!vaultConfigured()) return sendJson(res, { ...NOT_CONFIGURED, exists: false, tree: [] })
  sendJson(res, { ok: true, exists: vaultExists(), tree: getVaultTree() })
}

export function handleVaultGraph(res: ServerResponse): void {
  if (!vaultConfigured()) return sendJson(res, { ...NOT_CONFIGURED, nodes: [], links: [] })
  sendJson(res, { ok: true, ...getVaultGraph() })
}

export function handleVaultFile(res: ServerResponse, relPath: string): void {
  try {
    const content = readVaultFile(relPath)
    sendJson(res, { ok: true, content })
  } catch (e) {
    sendJson(res, { ok: false, error: (e as Error).message })
  }
}
