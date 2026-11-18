import { invoke } from '@tauri-apps/api/core';
import type { ApiError, Cli, CuckooState, Decision, Usage } from './types';

export interface Settings { monitorUrl: string; token: string | null; sounds: boolean; recents: string[] }

export const getState = (): Promise<CuckooState> => invoke('cuckoo_get', { what: 'state' });
export const getUsage = (): Promise<Usage> => invoke('cuckoo_get', { what: 'usage' });
export const getClis = (): Promise<Cli[]> => invoke('cuckoo_get', { what: 'clis' });

const post = <T>(what: string, body: object): Promise<T> => invoke('cuckoo_post', { what, body });

export const say = (agentId: string, text: string) => post<{ ok: true; relayKey: string; sha256: string }>('say', { agentId, text });
export const approve = (id: string, decision: Decision) => post<{ ok: true; sent: string }>('approve', { id, decision });
export const focus = (agentId: string) => post<{ ok: true; focused: boolean }>('focus', { agentId });
export const launch = (cwd: string, prompt: string, cli: string) => post<{ ok: true; ref: string }>('launch', { cwd, prompt, cli });

export const getSettings = (): Promise<Settings> => invoke('get_settings');
export const saveSettings = (settings: Settings): Promise<Settings> => invoke('save_settings', { settings });
export const addRecent = (dir: string): Promise<Settings> => invoke('add_recent', { dir });
export const setHitRect = (rect: { x: number; y: number; w: number; h: number }): Promise<void> => invoke('set_hit_rect', { rect });

export function errorText(e: unknown): string {
  const err = e as Partial<ApiError>;
  if (err?.kind === 'offline') return 'agent-monitor is offline';
  if (err?.kind === 'no_token') return 'No agent-monitor token found';
  if (err?.error === 'grant_in_terminal') return 'Answer commit/push in the terminal';
  if (err?.error === 'stale') return 'The agent changed, try again';
  return err?.message ?? String(e);
}
