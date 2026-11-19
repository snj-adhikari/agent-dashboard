import { describe, expect, it } from 'vitest';
import { chatKey } from './chatKeys';

const k = (key: string, shiftKey = false, isComposing = false) => ({ key, shiftKey, isComposing });

describe('chat keys', () => {
  it('chat keys enter sends', () => {
    expect(chatKey(k('Enter'))).toBe('send');
    expect(chatKey(k('Enter', false, true))).toBeNull();
  });

  it('chat keys shift enter newline', () => {
    expect(chatKey(k('Enter', true))).toBe('newline');
  });

  it('chat keys leave escape to the island', () => {
    expect(chatKey(k('Escape'))).toBeNull();
    expect(chatKey(k('a'))).toBeNull();
  });
});
