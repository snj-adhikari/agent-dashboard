export type ChatKey = 'send' | 'newline' | null;

/** Enter sends, Shift-Enter keeps the newline, IME composition is left alone; Esc bubbles to the island. */
export function chatKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing'>): ChatKey {
  if (e.key !== 'Enter' || e.isComposing) return null;
  return e.shiftKey ? 'newline' : 'send';
}
