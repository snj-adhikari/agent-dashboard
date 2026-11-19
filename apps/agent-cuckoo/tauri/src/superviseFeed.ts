import { replyKind } from './board';
import type { Reply } from './types';

export interface FeedTarget { agentId: string; name: string }
export interface FeedItem { id: string; kind: 'reply' | 'ask'; agentId: string; name: string; text: string; at: number }

/** Replies and asks from the targeted agents since the send, oldest first, skipping ids already shown. */
export function superviseFeed(replies: readonly Reply[], targets: readonly FeedTarget[], since: number, seen: ReadonlySet<string>): FeedItem[] {
  const names = new Map(targets.map((t) => [t.agentId, t.name]));
  const out = new Map<string, FeedItem>();
  for (const r of replies) {
    const name = names.get(r.agentId);
    if (name === undefined || r.at < since || seen.has(r.id) || out.has(r.id)) continue;
    out.set(r.id, { id: r.id, kind: replyKind(r) === 'ask' ? 'ask' : 'reply', agentId: r.agentId, name, text: r.text, at: r.at });
  }
  return [...out.values()].sort((a, b) => a.at - b.at);
}
