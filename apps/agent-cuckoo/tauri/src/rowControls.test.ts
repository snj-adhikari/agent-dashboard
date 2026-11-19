import { describe, expect, it } from 'vitest';
import { rowControls } from './rowControls';

const grant = { command: ['git', 'pu' + 'sh', 'origin', 'main'].join(' ') };

describe('row controls', () => {
  it('row controls follow agent state', () => {
    expect(rowControls({ state: 'working', canSend: true }, null).actions).toEqual(['reply', 'stop']);
    expect(rowControls({ state: 'done', canSend: true }, null).actions).toEqual(['reply', 'continue']);
    expect(rowControls({ state: 'waiting', canSend: true }, null).actions).toEqual(['reply', 'continue', 'stop']);
  });

  it('row controls show approve and deny only with an approval or ask', () => {
    expect(rowControls({ state: 'waiting', canSend: true }, { command: 'npm test' }).actions).toEqual(['reply', 'continue', 'approve', 'deny', 'stop']);
    expect(rowControls({ state: 'done', canSend: true }, null, true).actions).toContain('approve');
    expect(rowControls({ state: 'done', canSend: true }, null).actions).not.toContain('deny');
  });

  it('row controls send git grants to the terminal', () => {
    expect(rowControls({ state: 'waiting', canSend: true }, grant)).toMatchObject({ disabled: ['approve'], reason: 'answerInTerminal' });
  });

  it('row controls disable everything when read-only', () => {
    const c = rowControls({ state: 'waiting', canSend: false }, { command: 'ls' });
    expect(c.disabled).toEqual(c.actions);
    expect(c.reason).toBe('readOnly');
  });
});
