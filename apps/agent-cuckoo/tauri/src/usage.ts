export type UsageLevel = 'green' | 'amber' | 'red' | 'unknown';

export function usageLevel(pct: number | null | undefined): UsageLevel {
  if (pct == null || Number.isNaN(pct)) return 'unknown';
  if (pct < 50) return 'green';
  if (pct < 80) return 'amber';
  return 'red';
}

export function usageLabel(pct: number | null | undefined): string {
  return pct == null || Number.isNaN(pct) ? '–' : `${Math.round(pct)}%`;
}
