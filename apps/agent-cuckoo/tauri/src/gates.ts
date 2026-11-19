export const RECAP_WEEKDAY = 1;
export const RECAP_HOUR = 8;
export const WHATS_NEW_DELAY_MS = 4_000;
export const WHATS_NEW_RETRY_MS = 15_000;
export const WHATS_NEW_MAX_RETRIES = 12;
export const WHATS_NEW_POSE = 'proud';

/** Most recent Monday 08:00 (local) at or before `now`. */
export function recapAnchor(now: Date): Date {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate(), RECAP_HOUR);
  a.setDate(a.getDate() - ((a.getDay() - RECAP_WEEKDAY + 7) % 7));
  if (a > now) a.setDate(a.getDate() - 7);
  return a;
}

/** Due once per week from Monday 08:00 until shown. */
export function recapDue(now: Date, lastShownAt: number | null): boolean {
  return lastShownAt === null || lastShownAt < recapAnchor(now).getTime();
}

export type WhatsNewDecision = 'skip' | 'show' | 'retry' | 'give-up';

/** `attempt` 0 is the first try at launch + 4 s; 1..12 are the retries every 15 s. A first install (nothing seen yet) skips; the caller stores the version either way. */
export function whatsNew(version: string, lastSeen: string | null, attempt: number, idle: boolean): WhatsNewDecision {
  if (lastSeen === null || version === lastSeen) return 'skip';
  if (idle) return 'show';
  return attempt >= WHATS_NEW_MAX_RETRIES ? 'give-up' : 'retry';
}

export const whatsNewDelayMs = (attempt: number): number => (attempt === 0 ? WHATS_NEW_DELAY_MS : WHATS_NEW_RETRY_MS);

export const GUIDE_PAGES = ['tabs', 'prompt', 'control', 'keys'] as const;
export type GuidePage = (typeof GUIDE_PAGES)[number];

/** Shown once on first open; Done or Skip stores `guideSeen`. Settings can re-open it any time. */
export const guideDue = (seen: boolean | undefined): boolean => seen !== true;

export const guideStep = (page: number, delta: number): number => Math.min(GUIDE_PAGES.length - 1, Math.max(0, page + delta));
