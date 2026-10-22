import fs from 'fs'
import path from 'path'
import { settings } from './settings'
import { expandHome } from '../utils'

const IGNORED = new Set(['.obsidian', '.git', 'node_modules'])

export interface VaultNode {
  name: string
  relPath: string
  type: 'file' | 'dir'
  children?: VaultNode[]
}

function walk(absDir: string, relDir: string): VaultNode[] {
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
  const nodes: VaultNode[] = []
  for (const entry of entries) {
    if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue
    const relPath = path.join(relDir, entry.name)
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, relPath, type: 'dir', children: walk(path.join(absDir, entry.name), relPath) })
    } else if (entry.name.endsWith('.md')) {
      nodes.push({ name: entry.name, relPath, type: 'file' })
    }
  }
  return nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
}

/** Empty when no vault is configured; callers check vaultConfigured() first. */
export function vaultRoot(): string {
  const configured = process.env.VAULT_PATH || settings().vaultPath
  return configured ? path.resolve(expandHome(configured)) : ''
}

export function vaultConfigured(): boolean {
  return vaultRoot() !== ''
}

export function vaultExists(): boolean {
  return vaultConfigured() && fs.existsSync(vaultRoot())
}

export function getVaultTree(): VaultNode[] {
  if (!vaultExists()) return []
  return walk(vaultRoot(), '')
}

export function readVaultFile(relPath: string): string {
  const root = vaultRoot()
  if (!root) throw new Error('vault not configured')
  const resolved = path.resolve(root, relPath)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Path escapes vault root')
  }
  if (!resolved.endsWith('.md')) throw new Error('Only .md files can be read')
  return fs.readFileSync(resolved, 'utf8')
}

function flattenFiles(nodes: VaultNode[]): VaultNode[] {
  return nodes.flatMap((n) => (n.type === 'file' ? [n] : flattenFiles(n.children || [])))
}

export interface GraphNode {
  id: string
  label: string
  relPath: string
}

export interface GraphLink {
  source: string
  target: string
}

const WIKILINK = /\[\[([^\]|#]+)/g

export function getVaultGraph(): { nodes: GraphNode[]; links: GraphLink[] } {
  if (!vaultExists()) return { nodes: [], links: [] }
  const root = vaultRoot()
  const files = flattenFiles(getVaultTree())
  const byBasename = new Map<string, VaultNode>()
  for (const f of files) byBasename.set(f.name.replace(/\.md$/, '').toLowerCase(), f)

  const nodes: GraphNode[] = files.map((f) => ({ id: f.relPath, label: f.name.replace(/\.md$/, ''), relPath: f.relPath }))
  const links: GraphLink[] = []

  for (const f of files) {
    let content: string
    try {
      content = fs.readFileSync(path.join(root, f.relPath), 'utf8')
    } catch {
      continue
    }
    for (const match of content.matchAll(WIKILINK)) {
      const target = byBasename.get(match[1].trim().toLowerCase())
      if (target && target.relPath !== f.relPath) links.push({ source: f.relPath, target: target.relPath })
    }
  }

  return { nodes, links }
}
