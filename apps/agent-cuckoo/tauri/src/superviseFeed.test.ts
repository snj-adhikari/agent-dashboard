import { describe, expect, it } from 'vitest';
import { superviseFeed } from './superviseFeed';
import type { Reply } from './types';

const r = (id: string, agentId: string, at: number, kind?: Reply['kind']): Reply => ({ id, agentId, codename: null, text: id, at, kind });
const targets = [{ agentId: 'a', name: 'eon' }, { agentId: 'b', name: 'hopper' }];

describe('supervise feed', () => {
  it('supervise feed filters by targets and since', () => {
    const feed = superviseFeed([r('old', 'a', 5), r('x', 'c', 20), r('n1', 'b', 30), r('n0', 'a', 10)], targets, 10, new Set());
    expect(feed.map((f) => [f.id, f.name])).toEqual([['n0', 'eon'], ['n1', 'hopper']]);
  });

  it('supervise feed dedupes by id and skips seen', () => {
    const feed = superviseFeed([r('d', 'a', 11), r('d', 'a', 11), r('s', 'b', 12)], targets, 0, new Set(['s']));
    expect(feed.map((f) => f.id)).toEqual(['d']);
  });

  it('supervise feed tells asks from replies', () => {
    const feed = superviseFeed([r('q', 'a', 1, 'ask'), r('p', 'a', 2, 'reply'), r('s', 'b', 3, 'summary')], targets, 0, new Set());
    expect(feed.map((f) => f.kind)).toEqual(['ask', 'reply', 'reply']);
  });

  it('supervise feed is empty without targets', () => {
    expect(superviseFeed([r('q', 'a', 1)], [], 0, new Set())).toEqual([]);
  });
});
