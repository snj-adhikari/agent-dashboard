import { describe, expect, it } from 'vitest';
import type { Approval, Reply } from '../types';
import { rowContext } from './agent-controls';

const reply = (id: string, agentId: string, at: number, kind?: Reply['kind']): Reply => ({ id, agentId, codename: null, text: id, at, kind });
const approval = (id: string, agentId: string): Approval => ({ id, agentId, tool: 'Bash', command: 'npm test', options: [], receivedAt: 1, screenHash: 'x' });

describe('row controls context', () => {
  it('row controls pick the newest reply for that agent only', () => {
    const ctx = rowContext('a', { approvals: [], replies: [reply('r1', 'a', 1), reply('r2', 'a', 3), reply('r3', 'b', 9), reply('q1', 'a', 5, 'ask')] }, new Set());
    expect(ctx.latest?.id).toBe('r2');
    expect(ctx.ask?.id).toBe('q1');
    expect(ctx.approval).toBeNull();
  });

  it('row controls drop answered asks and find the pending approval', () => {
    const ctx = rowContext('a', { approvals: [approval('p1', 'b'), approval('p2', 'a')], replies: [reply('q1', 'a', 5, 'ask')] }, new Set(['q1']));
    expect(ctx.ask).toBeNull();
    expect(ctx.approval?.id).toBe('p2');
  });
});
