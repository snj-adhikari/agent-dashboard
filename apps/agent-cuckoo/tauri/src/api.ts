import { invoke } from '@tauri-apps/api/core';
import type { Hemisphere, OutfitChoice } from './outfit';
import type { ApiError, ChatResponse, Cli, CuckooState, Decision, FocusResponse, RecapResponse, SideActionResponse, SideDataResponse, SideId, SideResponse, SideSettingsRequest, StopResponse, SuperviseConfirmResponse, SuperviseResponse, UploadResponse, Usage } from './types';
import { t } from './i18n';

export interface Settings {
  monitorUrl: string;
  token: string | null;
  sounds: boolean;
  recents: string[];
  openOnHover?: boolean;
  volume?: number;
  autoCloseSec?: number;
  outfit?: OutfitChoice;
  hemisphere?: Hemisphere;
  captureShortcuts?: boolean;
  desktopMascot?: boolean;
  recapShownAt?: number | null;
  whatsNewSeen?: string | null;
  islandCollapsed?: boolean;
  guideSeen?: boolean;
}

export const getState = (): Promise<CuckooState> => invoke('cuckoo_get', { what: 'state' });
export const getUsage = (): Promise<Usage> => invoke('cuckoo_get', { what: 'usage' });
export const getClis = (): Promise<Cli[]> => invoke('cuckoo_get', { what: 'clis' });

const post = <T>(what: string, body: object): Promise<T> => invoke('cuckoo_post', { what, body });

export const say = (agentId: string, text: string) => post<{ ok: true; relayKey: string; sha256: string }>('say', { agentId, text });
export const approve = (id: string, decision: Decision) => post<{ ok: true; sent: string }>('approve', { id, decision });
export const focus = (agentId: string) => post<FocusResponse>('focus', { agentId });
export const launch = (cwd: string, prompt: string, cli: string) => post<{ ok: true; ref: string }>('launch', { cwd, prompt, cli });
export const supervise = (text: string, conversationId: string | null, cli: string | null) => post<SuperviseResponse>('supervise', { text, conversationId, cli });
export const superviseConfirm = (confirmId: string, cancel = false) => post<SuperviseConfirmResponse>('supervise/confirm', { confirmId, cancel });
export const stop = (agentId: string) => post<StopResponse>('stop', { agentId });

let pending: UploadResponse[] = [];
export const MAX_ATTACHMENTS = 4;

/** Queues an upload as context for the next chat message (max 4, oldest dropped). */
export function attach(u: UploadResponse): void {
  pending = [...pending.filter((p) => p.uploadId !== u.uploadId), u].slice(-MAX_ATTACHMENTS);
}
export const attachments = (): UploadResponse[] => pending;
export const detach = (uploadId: string): void => void (pending = pending.filter((p) => p.uploadId !== uploadId));

/** Sends queued attachments by upload id only and clears them once the chat call succeeds. */
export async function chat(cli: string, text: string, conversationId: string | null = null): Promise<ChatResponse> {
  const sent = pending;
  const res = await post<ChatResponse>('chat', sent.length ? { cli, text, conversationId, attachments: sent.map((u) => u.uploadId) } : { cli, text, conversationId });
  pending = pending.filter((p) => !sent.includes(p));
  return res;
}
export const chatEnd = (conversationId: string) => post<{ ok: true }>('chat/end', { conversationId });
export const getSide = (): Promise<SideResponse> => invoke('cuckoo_get', { what: 'side' });
export const getSideData = (id: SideId): Promise<SideDataResponse> => invoke('cuckoo_get', { what: `side/${id}` });
export const sideAction = (id: SideId, action: string, itemId: string | null = null, text: string | null = null) => post<SideActionResponse>('side/action', { id, action, itemId, text });
export const saveSideSettings = (patch: SideSettingsRequest) => post<SideResponse>('side/settings', patch);
export const getRecap = (week: string): Promise<RecapResponse> => invoke('cuckoo_get', { what: `recap?week=${week}` });
export const setCaptureShortcuts = (enabled: boolean): Promise<void> => invoke('set_capture_shortcuts', { enabled });
export const desktopMascot = (show: boolean): Promise<void> => invoke('desktop_mascot', { show });

export const reduceMotion = (): Promise<boolean> => invoke('reduce_motion');

export const getSettings = (): Promise<Settings> => invoke('get_settings');
export const saveSettings = (settings: Settings): Promise<Settings> => invoke('save_settings', { settings });
export const addRecent = (dir: string): Promise<Settings> => invoke('add_recent', { dir });
export const setHitRect = (rect: { x: number; y: number; w: number; h: number }): Promise<void> => invoke('set_hit_rect', { rect });

export function errorText(e: unknown): string {
  const err = e as Partial<ApiError>;
  if (err?.kind === 'offline') return t('common.offline');
  if (err?.kind === 'no_token') return t('error.noToken');
  if (err?.error === 'grant_in_terminal') return t('common.answerInTerminal');
  if (err?.error === 'stale') return t('error.agentChanged');
  if (err?.error === 'signed_out') return t('error.cliSignedOut');
  if (err?.error === 'timeout') return t('error.chatSlow');
  return err?.message ?? String(e);
}
