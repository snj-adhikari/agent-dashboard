import { describe, expect, it } from 'vitest';
import { dayPart, greeting } from './greeting';

describe('greeting', () => {
  it('greeting splits the day at 5, 12, 17 and 21', () => {
    expect([4, 5, 11, 12, 16, 17, 20, 21, 0].map(dayPart)).toEqual([
      'night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night',
    ]);
    expect(greeting(9)).toBe('Good morning!');
  });

  it('greeting falls back to Hello!', () => {
    expect([NaN, -1, 24, 7.5].map(greeting)).toEqual(['Hello!', 'Hello!', 'Hello!', 'Hello!']);
  });
});
