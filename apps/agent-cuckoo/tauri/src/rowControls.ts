import { isGitGrant } from './board';
import type { Agent, Approval } from './types';

export type RowAction = 'reply' | 'continue' | 'approve' | 'deny' | 'stop';
export type RowReason = 'readOnly' | 'answerInTerminal' | null;
export interface RowControls { actions: RowAction[]; disabled: RowAction[]; reason: RowReason }

/** Which controls an expanded agent row shows; read-only agents show them all disabled with the reason. */
export function rowControls(agent: Pick<Agent, 'state' | 'canSend'>, approval: Pick<Approval, 'command'> | null, hasAsk = false): RowControls {
  const decide = approval !== null || hasAsk;
  const actions: RowAction[] = [
    'reply',
    ...(agent.state !== 'working' ? (['continue'] as const) : []),
    ...(decide ? (['approve', 'deny'] as const) : []),
    ...(agent.state === 'working' || agent.state === 'waiting' ? (['stop'] as const) : []),
  ];
  if (!agent.canSend) return { actions, disabled: actions, reason: 'readOnly' };
  if (approval && isGitGrant(approval.command)) return { actions, disabled: ['approve'], reason: 'answerInTerminal' };
  return { actions, disabled: [], reason: null };
}
