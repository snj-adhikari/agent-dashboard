import { invoke } from '@tauri-apps/api/core';
import type { RecapResponse } from '../types';
import { h } from './cards';
import './side-b.css';
import { t } from '../i18n';

export const EXPORT_W = 1080;
export const EXPORT_H = 1920;

export interface RecapModel { week: string; stats: [string, string][]; byCli: [string, string][]; projects: [string, string][] | null }

/** Projects stay null when the server hides them, so no project name ever reaches the card or the PNG. */
export function recapModel(r: RecapResponse): RecapModel {
  return {
    week: r.week,
    stats: [
      [t('recap.sessions'), String(r.sessions)],
      [t('recap.approvals'), String(r.approvals)],
      [t('recap.finished'), String(r.finishes)],
      [t('recap.errors'), String(r.errors)],
      [t('recap.activeDays'), String(r.activeDays)],
    ],
    byCli: r.byCli.map((c) => [c.cli, String(c.count)]),
    projects: r.topProjects ? r.topProjects.map((p) => [p.name, String(p.count)]) : null,
  };
}

const rows = (list: [string, string][]) => h('div', { class: 'recap-rows' }, ...list.map(([k, v]) => h('div', { class: 'recap-row' }, h('span', {}, k), h('b', {}, v))));

export function recapCard(r: RecapResponse, on: { exported(path: string): void; failed(e: unknown): void; close(): void }): HTMLElement {
  const m = recapModel(r);
  return h(
    'div',
    { class: 'panel recap' },
    h('div', { class: 'who' }, t('recap.title', { week: m.week })),
    rows(m.stats),
    m.byCli.length > 0 && rows(m.byCli),
    m.projects && m.projects.length > 0 && rows(m.projects),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', onclick: on.close }, t('common.close')),
      h('button', { type: 'button', class: 'primary', onclick: () => exportRecap(r).then(on.exported, on.failed) }, t('recap.saveImage')),
    ),
  );
}

/** Draws the recap at 1080x1920; text goes through fillText only. */
export function drawRecap(ctx: CanvasRenderingContext2D, m: RecapModel): void {
  ctx.fillStyle = '#0e0f11';
  ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);
  ctx.fillStyle = '#f5f6f8';
  ctx.textBaseline = 'top';
  ctx.font = '700 88px system-ui, sans-serif';
  ctx.fillText(t('recap.shareTitleShort'), 96, 160, EXPORT_W - 192);
  ctx.fillStyle = '#8e939c';
  ctx.font = '500 48px system-ui, sans-serif';
  ctx.fillText(m.week, 96, 272);
  let y = 420;
  const section = (list: [string, string][]) => {
    for (const [k, v] of list) {
      ctx.fillStyle = '#8e939c';
      ctx.font = '500 52px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(k, 96, y, 640);
      ctx.fillStyle = '#f5f6f8';
      ctx.font = '700 64px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(v, EXPORT_W - 96, y - 6, 240);
      y += 96;
    }
    ctx.textAlign = 'left';
    y += 48;
  };
  section(m.stats);
  section(m.byCli.slice(0, 5));
  if (m.projects) section(m.projects.slice(0, 5));
  ctx.fillStyle = '#6366f1';
  ctx.font = '600 44px system-ui, sans-serif';
  ctx.fillText('agent-cuckoo', 96, EXPORT_H - 160);
}

export async function recapPng(r: RecapResponse): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_W;
  canvas.height = EXPORT_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('error.canvas'));
  drawRecap(ctx, recapModel(r));
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error(t('error.encodePng'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Saves into ~/Downloads via the Rust `save_png` command and returns the path. */
export async function exportRecap(r: RecapResponse): Promise<string> {
  const bytes = await recapPng(r);
  return invoke<string>('save_png', { bytes: Array.from(bytes), name: `cuckoo-recap-${r.week}` });
}
