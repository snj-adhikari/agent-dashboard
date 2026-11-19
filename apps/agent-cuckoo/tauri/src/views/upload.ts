import { invoke } from '@tauri-apps/api/core';
import { errorText } from '../api';
import type { UploadResponse } from '../types';
import { MORPH_MS, SWALLOW_MS, UPLOAD_POSE, UPLOAD_VIEW_H, uploadPct, uploadPhaseAt, uploadTimeline, type UploadEvent } from '../uploadTimeline';
import { h } from './cards';
import { poseSrc, type MascotPose } from './mascot';
import { t } from '../i18n';

export type UploadSound = 'gulp' | 'tick';

export interface UploadRun {
  path: string;
  name: string;
  startedAt: number;
  timeline: UploadEvent[];
  upload: UploadResponse | null;
  error: string | null;
  done: boolean;
}

export interface UploadHooks {
  sound(name: UploadSound): void;
  render(): void;
  done(run: UploadRun): void;
}

export const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export const soundFor = (e: UploadEvent): UploadSound | null => (e.kind === 'gulp' ? 'gulp' : e.kind === 'tick' ? 'tick' : null);

let timers: number[] = [];

export function cancelUpload(): void {
  timers.forEach((id) => clearTimeout(id));
  timers = [];
}

/** Plays the box morph, swallow and ticks while `upload_path` runs; `done` fires once both the choose step and the upload have finished. */
export function startUpload(path: string, hooks: UploadHooks, r = Math.random()): UploadRun {
  cancelUpload();
  const run: UploadRun = { path, name: baseName(path), startedAt: performance.now(), timeline: uploadTimeline(r), upload: null, error: null, done: false };
  let chooseDue = false;
  const finish = () => {
    if (run.done || !chooseDue || !run.upload) return;
    run.done = true;
    hooks.done(run);
  };
  for (const e of run.timeline) {
    timers.push(
      window.setTimeout(() => {
        if (run.error) return;
        const s = soundFor(e);
        if (s) hooks.sound(s);
        if (e.kind === 'choose') chooseDue = true;
        hooks.render();
        finish();
      }, e.at),
    );
  }
  invoke<UploadResponse>('upload_path', { path }).then(
    (u) => {
      run.upload = u;
      finish();
    },
    (e) => {
      run.error = errorText(e);
      cancelUpload();
      hooks.render();
    },
  );
  return run;
}

/** Upload view, height 176: the mascot as a box, then a progress bar until the choose view. */
export function uploadView(run: UploadRun, now = performance.now()): HTMLElement {
  const elapsed = now - run.startedAt;
  const phase = uploadPhaseAt(elapsed, run.timeline, !!run.upload);
  const pct = uploadPct(elapsed, run.timeline);
  const box = h('img', { class: 'upload-box', src: poseSrc(UPLOAD_POSE as MascotPose), alt: '', draggable: 'false' });
  const label = run.error ?? (phase === 'upload' || phase === 'choose' ? t('upload.progress', { percent: pct }) : t('upload.swallowingNamed', { name: run.name }));
  const el = h(
    'div',
    { class: `upload-view ${phase} ${run.error ? 'failed' : ''}` },
    h('div', { class: 'upload-stage' }, box),
    h('div', { class: 'upload-meta' }, h('span', { class: 'upload-name' }, run.name), h('span', { class: 'upload-label', role: 'status' }, label)),
    h('div', { class: 'upload-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }, h('i', { style: `width:${pct}%` })),
  );
  el.style.height = `${UPLOAD_VIEW_H}px`;
  el.style.setProperty('--morph', `${MORPH_MS}ms`);
  el.style.setProperty('--swallow', `${SWALLOW_MS}ms`);
  return el;
}
