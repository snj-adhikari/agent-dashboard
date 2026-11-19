import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async (_cmd: string, _args?: unknown) => ({ ok: true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: unknown) => invoke(cmd, args) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

const api = await import('../api');
const { holdingsText, parseHoldings, PERSONAL, sideOn, SIDE_LABELS } = await import('./settings');

const up = (n: number) => ({ ok: true as const, uploadId: `u${n}`, name: `f${n}.png`, bytes: 1, mime: 'image/png' });

describe('side wiring', () => {
  it('side personal providers default off', () => {
    for (const id of PERSONAL) expect(sideOn(null, id)).toBe(false);
    expect(sideOn({ enabled: { mail: true } as never, holdings: [], currency: 'AUD', hideProjects: false, phonePush: false }, 'mail')).toBe(true);
    expect(SIDE_LABELS).toHaveLength(14);
  });

  it('parses crypto holdings', () => {
    expect(parseHoldings('btc 0.5, ETH 2, bad, doge -1, x')).toEqual([{ symbol: 'BTC', amount: 0.5 }, { symbol: 'ETH', amount: 2 }]);
    expect(holdingsText([{ symbol: 'BTC', amount: 0.5 }])).toBe('BTC 0.5');
  });

  it('chat sends attachments by upload id only and clears them', async () => {
    for (const n of [1, 2, 3, 4, 5]) api.attach(up(n));
    expect(api.attachments().map((u) => u.uploadId)).toEqual(['u2', 'u3', 'u4', 'u5']);
    api.detach('u3');
    await api.chat('claude', 'what is this');
    expect(invoke).toHaveBeenLastCalledWith('cuckoo_post', { what: 'chat', body: { cli: 'claude', text: 'what is this', conversationId: null, attachments: ['u2', 'u4', 'u5'] } });
    expect(api.attachments()).toEqual([]);
    await api.chat('claude', 'again');
    expect(invoke).toHaveBeenLastCalledWith('cuckoo_post', { what: 'chat', body: { cli: 'claude', text: 'again', conversationId: null } });
  });

  it('side routes go through the proxy', async () => {
    await api.getSideData('crypto');
    expect(invoke).toHaveBeenLastCalledWith('cuckoo_get', { what: 'side/crypto' });
    await api.getRecap('2026-W47');
    expect(invoke).toHaveBeenLastCalledWith('cuckoo_get', { what: 'recap?week=2026-W47' });
    await api.setCaptureShortcuts(false);
    expect(invoke).toHaveBeenLastCalledWith('set_capture_shortcuts', { enabled: false });
  });
});
