export interface InboxWatch {
  ok: boolean
  error: string | null
}

let health: InboxWatch = { ok: false, error: 'not started' }

/** While ok, notifications drive the PR-review hooks and their timed polls are skipped. */
export function inboxWatch(): InboxWatch {
  return health
}

export function setInboxWatch(next: InboxWatch): void {
  health = next
}
