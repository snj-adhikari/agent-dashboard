import { describe, expect, it } from 'vitest';
import fixture from '../../contract/fixture.json';
import { usageLabel, usageLevel } from './usage';

describe('usage', () => {
  it('colours by threshold', () => {
    expect([0, 49.9, 50, 79, 80, 100].map(usageLevel)).toEqual(['green', 'green', 'amber', 'amber', 'red', 'red']);
    expect(usageLevel(null)).toBe('unknown');
  });

  it('labels the fixture', () => {
    expect(usageLabel(fixture.usage.claude.fiveHour)).toBe('42%');
    expect(usageLabel(null)).toBe('–');
  });
});
