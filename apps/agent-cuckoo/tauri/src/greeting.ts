import { t } from './i18n';

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

const KEY: Record<DayPart, string> = { morning: 'greeting.morning', afternoon: 'greeting.afternoon', evening: 'greeting.evening', night: 'greeting.late' };

export function dayPart(hour: number): DayPart | null {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function greeting(hour: number): string {
  const part = dayPart(hour);
  return t(part ? KEY[part] : 'greeting.hello');
}
