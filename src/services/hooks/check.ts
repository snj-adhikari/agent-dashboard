import assert from 'assert'
import { execFileSync } from 'child_process'
import type { IncomingMessage } from 'http'
import { toEvent } from './jiraHook'
import { reviewRequestToEvent } from './slackPrReviewHook'
import { overrideHookSettings, validInterval } from './config'
import { parseLsofCwds } from '../processes'
import { recordSession, reportedByPid } from './sessions'
import { hasPendingReview } from './reviewGuard'
import { mentionsToEvents } from './jiraMentionPrHook'
import { pickSessionTarget, usagePctFromJsonl } from './sessionTarget'
import { shellQuote } from '../cmuxControl'
import { isTrustedRequest } from '../../http'
import { isPushEndpoint } from '../push'
import { parseBrowserAction } from '../../routes/mobile'
import { isSurfaceRef } from '../cmuxControl'
import { DeferredError, shouldRequeue } from './execute'
import { autoDisableDecision, enabledHooks, expired, insertByQueuedAt, nextIdleCount, pollingPaused, queueOrder, runnableOrder, shouldAutoEnable } from './state'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { findTicketWork } from './branchName'
import type { QueuedEvent } from './state'
import type { MentionComment } from './jiraMentionPrHook'

overrideHookSettings({
  atlassian: { siteUrl: 'example.atlassian.net', repositoryFieldId: '', workIssueTypes: ['Bug', 'Defect subtask', 'Dev subtask'], subtaskIssueType: 'Dev subtask', extraInstructions: '' },
  profile: { displayName: '', githubHandle: '', createPrSkill: '', prReviewSkill: 'pr-review' }
})

function req(headers: Record<string, string>, method = 'GET'): IncomingMessage {
  return { headers, method } as IncomingMessage
}

assert.ok(isTrustedRequest(req({ host: 'localhost:5818' }), 5818))
assert.ok(isTrustedRequest(req({ host: '127.0.0.1:5818' }), 5818))
assert.ok(isTrustedRequest(req({ host: 'my.localhost:5818' }), 5818), 'subdomain .localhost alias must be trusted')
assert.ok(!isTrustedRequest(req({ host: 'evil.example', 'tailscale-user-login': 'me@example.com' }), 5818), 'a login header alone must not trust a foreign host')
assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc') && !isPushEndpoint('https://169.254.169.254/x') && !isPushEndpoint('https://fcm.googleapis.com:8443/x') && !isPushEndpoint('http://fcm.googleapis.com/x'))
assert.ok(isSurfaceRef('surface:45') && !isSurfaceRef('surface:4; rm -rf') && !isSurfaceRef(undefined))
assert.deepStrictEqual(parseBrowserAction({ action: 'click', fx: 0.5, fy: 1 }), { action: 'click', fx: 0.5, fy: 1 })
assert.strictEqual(parseBrowserAction({ action: 'click', fx: 2, fy: 0 }), null, 'tap outside 0-1 is rejected')
assert.strictEqual(parseBrowserAction({ action: 'goto', url: 'javascript:alert(1)' }), null, 'only http(s) URLs')
assert.strictEqual(parseBrowserAction({ action: 'eval', text: 'x' }), null, 'unknown actions are rejected')
assert.ok(validInterval(5) && validInterval(1440) && !validInterval(4) && !validInterval(1441) && !validInterval(7.5) && !validInterval('30'))
assert.ok(!isTrustedRequest(req({ host: 'evil.com:5818' }), 5818))
assert.ok(!isTrustedRequest(req({ host: 'notlocalhost:5818' }), 5818), 'must not match by suffix alone, only .localhost')
assert.ok(
  !isTrustedRequest(req({ host: 'my.localhost:5818', origin: 'http://evil.com' }, 'POST'), 5818)
)

const bug = toEvent({ key: 'PROJ-1300', summary: 'Remove lint\nstuff', issueType: 'Dev subtask', project: 'PROJ' })
assert.ok(bug)
assert.strictEqual(bug.branch, 'fix/proj-1300')
const link = (url: string) => toEvent({ key: 'PROJ-1300', summary: 'x', issueType: 'Bug', project: 'PROJ', url })?.details?.url
assert.strictEqual(link('https://example.atlassian.net/browse/PROJ-1300'), 'https://example.atlassian.net/browse/PROJ-1300')
assert.strictEqual(link('https://evil.com/browse/PROJ-1300'), undefined)
assert.strictEqual(link('javascript:alert(1)'), undefined)
assert.strictEqual(link('https://example.atlassian.net/browse/PROJ-9'), undefined)
assert.ok(!bug.context.includes('\n'), 'seed prompt must be single-line')
assert.ok(!bug.context.includes('Remove lint'), 'seed prompt must not carry ticket text')

assert.strictEqual(
  toEvent({ key: 'PROJ-9', summary: 'x', issueType: 'Bug', project: 'PROJ', repoGuess: '../../etc' })?.repoHint,
  undefined,
  'repoGuess must be a known local repo'
)

assert.strictEqual(toEvent({ key: 'PROJ-1; rm -rf ~', summary: 'x', issueType: 'Bug', project: 'PROJ' }), null)
const sub = (key: string, assignedToMe: boolean, done = false) => ({ key, summary: 'dev', assignedToMe, done })
const story = (devSubtasks: ReturnType<typeof sub>[]) => toEvent({ key: 'PROJ-2', summary: 'feature', issueType: 'Story', project: 'PROJ', devSubtasks })
const create = story([])
assert.ok(create && create.id === 'PROJ-2' && create.branch === 'fix/proj-2', 'story with no Dev subtask is worked')
assert.ok(create.context.includes('create ONE "Dev subtask"') && !create.context.includes('\n'), 'creation prompt, single-line')
assert.strictEqual(story([sub('PROJ-5', false)]), null, 'Dev subtask owned by someone else: skip')
assert.strictEqual(story([sub('PROJ-5', true, true)]), null, 'my Dev subtask already done: skip')
const existing = story([sub('PROJ-5', false), sub('PROJ-6', true)])
assert.ok(existing && existing.branch === 'fix/proj-6' && existing.id === 'PROJ-2' && !existing.context.includes('create ONE'), 'my Dev subtask is worked, deduped on the story key')
const child = toEvent({ key: 'PROJ-6', summary: 'dev', issueType: 'Dev subtask', project: 'PROJ', parentKey: 'PROJ-2', parentType: 'Story' })
assert.strictEqual(child?.id, 'PROJ-2', 'subtask poll and story poll share one dedupe id')
assert.strictEqual(toEvent({ key: 'PROJ-3', summary: 'tidy', issueType: 'Task', project: 'PROJ' }), null)
assert.strictEqual(toEvent({ key: 'PROJ-4', summary: '[SPIKE] cache', issueType: 'Task', project: 'PROJ' })?.branch, 'tech/proj-4')

const now = String(Date.now() / 1000)
assert.ok(reviewRequestToEvent({ prUrl: 'https://github.com/acme/web-app/pull/42', ts: now }))
assert.strictEqual(reviewRequestToEvent({ prUrl: 'https://github.com/a/b/pull/1; curl x|sh', ts: now }), null)
assert.strictEqual(reviewRequestToEvent({ prUrl: 'https://evil.com/a/b/pull/1', ts: now }), null)
assert.strictEqual(reviewRequestToEvent({ prUrl: 'https://github.com/a/b/pull/1', ts: 'nope' }), null)
assert.strictEqual(reviewRequestToEvent({ prUrl: 'https://github.com/a/b/pull/1', ts: '1000' }), null)

const tricky = `it's $(whoami) \`id\` "q"`
assert.strictEqual(execFileSync('sh', ['-c', `printf %s ${shellQuote(tricky)}`], { encoding: 'utf8' }), tricky)

const q = (id: string, priority: number): QueuedEvent => ({
  hook: 'jira',
  queuedAt: '',
  event: { source: 'jira', id, title: id, context: '', action: 'worktree', priority }
})
assert.deepStrictEqual(
  queueOrder([q('low-first', 3), q('medium', 2), q('high', 1), q('blocker', 0)]).map((x) => x.event.id),
  ['high', 'blocker', 'low-first', 'medium'],
  'FIFO with urgent items jumping ahead in arrival order'
)

const slackItem: QueuedEvent = { ...q('pr-1', 2), hook: 'slack-pr-review' }
const mixed = [q('j-1', 2), slackItem, q('j-2', 0)]
assert.deepStrictEqual(
  runnableOrder(mixed, ['jira']).map((x) => x.event.id),
  ['pr-1'],
  'drain skips queued items of a disabled hook'
)
assert.strictEqual(mixed.length, 3, 'disabled hook items stay in the queue')
assert.deepStrictEqual(runnableOrder(mixed, []).map((x) => x.event.id), ['j-2', 'j-1', 'pr-1'])

const at = (id: string, queuedAt: string, action: QueuedEvent['event']['action'] = 'worktree'): QueuedEvent => ({
  ...q(id, 2),
  queuedAt,
  event: { ...q(id, 2).event, action }
})
const sendItem = at('s-1', '2026-09-29T09:00:00.000Z', 'session-command')
assert.ok(shouldRequeue(sendItem.event, new Error('tab closed')), 'a send-path error requeues a session command')
assert.ok(shouldRequeue(q('w', 2).event, new DeferredError('busy')))
assert.ok(!shouldRequeue(q('w', 2).event, new Error('git failed')), 'other actions keep drop-on-error')
assert.deepStrictEqual(
  runnableOrder([sendItem, at('s-2', '2026-09-29T09:01:00.000Z', 'session-command'), q('w', 2)], [], ['session-command']).map((x) => x.event.id),
  ['w'],
  'after one session command, the rest of the tick skips session commands'
)
const later = [at('a', '2026-09-29T08:00:00.000Z'), at('c', '2026-09-29T10:00:00.000Z')]
assert.deepStrictEqual(
  insertByQueuedAt(later, sendItem).map((x) => x.event.id),
  ['a', 's-1', 'c'],
  'requeue restores the original position by queuedAt'
)
assert.deepStrictEqual(insertByQueuedAt([], sendItem).map((x) => x.event.id), ['s-1'])
const sentAt = Date.parse(sendItem.queuedAt)
assert.ok(!expired(sendItem, sentAt + 23 * 3600_000), 'session command under 24h is kept')
assert.ok(expired(sendItem, sentAt + 25 * 3600_000), 'session command over 24h is dropped')
assert.ok(!expired(at('w', sendItem.queuedAt), sentAt + 25 * 3600_000), 'expiry only applies to session commands')

assert.deepStrictEqual(
  enabledHooks([{ name: 'jira' }, { name: 'slack-pr-review' }], ['jira']).map((h) => h.name),
  ['slack-pr-review'],
  'polling skips a disabled hook'
)

const idleAfterTwo = nextIdleCount(nextIdleCount(0, 0, 60), 0, 60)
assert.strictEqual(autoDisableDecision(idleAfterTwo, 0), 'idle', '2 empty polls over 50% auto-pause the hook')
assert.strictEqual(autoDisableDecision(nextIdleCount(0, 0, 60), 0), null, '1 empty poll does not')
assert.strictEqual(nextIdleCount(1, 3, 60), 0, 'a poll that queues something resets the counter')
assert.strictEqual(nextIdleCount(1, 0, 50), 0, 'polls at or under 50% reset the counter')
assert.strictEqual(autoDisableDecision(nextIdleCount(nextIdleCount(0, 0, 40), 0, 50), 0), null, 'polls at or under 50% never count')
assert.strictEqual(autoDisableDecision(0, 5), 'queue', 'queue of 5 pauses all hooks')
assert.strictEqual(autoDisableDecision(0, 4), null, 'queue of 4 does not')
assert.ok(shouldAutoEnable({ reason: 'idle', until: 1000 }, 1000, 9), 'reset time passed re-enables')
assert.ok(!shouldAutoEnable({ reason: 'idle', until: 1000 }, 999, 0), 'idle stays paused until the reset')
assert.ok(shouldAutoEnable({ reason: 'queue', until: 1000 }, 999, 4), 'queue pause lifts once the queue is back to 4')
assert.ok(!shouldAutoEnable({ reason: 'queue', until: 1000 }, 999, 5))
assert.deepStrictEqual(pollingPaused(['jira'], {}), ['jira'], 'clearing auto-disables keeps a manual disable')
assert.deepStrictEqual(pollingPaused(['jira'], { jira: { reason: 'idle', until: 1 }, slack: { reason: 'queue', until: 1 } }), ['jira', 'slack'])

const T = Date.parse('2026-09-29T10:00:00+10:00')
const mention = (over: Partial<MentionComment> = {}): MentionComment => ({
  issueKey: 'PROJ-1300',
  commentId: '10042',
  created: '2026-09-29T09:50:00.000+1000',
  mentionsMe: true,
  mentionedAccountIds: ['me-1'],
  prUrls: ['https://github.com/acme/web-app/pull/42'],
  ...over
})
const localRepo = (name: string) => (name === 'web-app' ? '/repos/web-app' : undefined)
const mapped = (over: Partial<MentionComment> = {}, orgs: string[] = ['acme']) =>
  mentionsToEvents({ accountId: 'me-1', comments: [mention(over)] }, T, orgs, localRepo)
const [pr] = mapped()
assert.ok(pr, 'repo resolves via the injected resolver')
assert.strictEqual(pr.repoHint, '/repos/web-app')
assert.strictEqual(pr.id, 'jira:PROJ-1300:10042:https://github.com/acme/web-app/pull/42')
assert.strictEqual(pr.context, '/pr-review https://github.com/acme/web-app/pull/42')
overrideHookSettings({ profile: { displayName: '', githubHandle: '', createPrSkill: '', prReviewSkill: '' } })
assert.ok(!mapped()[0].context.startsWith('/'), 'blank skill falls back to a plain instruction')
overrideHookSettings(null)
assert.strictEqual(pr.action, 'session-command')
assert.deepStrictEqual(mapped({}, ['someone-else']), [], 'org not on the allowlist is rejected')
assert.deepStrictEqual(mapped({ created: '2026-09-29T09:20:00+10:00' }), [], 'comment outside the lookback is rejected')
assert.deepStrictEqual(mapped({ created: 'yesterday' }), [])
assert.deepStrictEqual(mapped({ mentionsMe: false }), [])
assert.deepStrictEqual(mapped({ mentionedAccountIds: ['other'] }), [], 'mention must match my accountId')
assert.deepStrictEqual(mapped({ commentId: '1; rm' }), [])
assert.deepStrictEqual(
  mapped({ prUrls: ['https://github.com/acme/web-app/issues/1', 'https://evil.com/a/b/pull/1', 'https://github.com/acme/web-app/pull/42'] }).map((e) => e.id),
  [pr.id],
  'non-PR URLs are ignored and duplicates collapse'
)
assert.deepStrictEqual(mapped({ prUrls: ['https://github.com/acme/no-such-local-repo/pull/1'] }), [], 'unmapped repo is rejected')

assert.ok(hasPendingReview([{ state: 'PENDING', user: { login: 'me' } }], 'me'), 'my pending review is flagged')
assert.ok(!hasPendingReview([{ state: 'PENDING', user: { login: 'other' } }], 'me'))
assert.ok(!hasPendingReview([{ state: 'APPROVED', user: { login: 'me' } }], 'me'), 'a submitted review does not block a re-review')

assert.deepStrictEqual(pickSessionTarget([]), { kind: 'open' }, 'no live tab opens a new one')
assert.deepStrictEqual(
  pickSessionTarget([{ ref: 'a', pct: 40 }, { ref: 'b', pct: 12 }, { ref: 'c', pct: null }, { ref: 'd', pct: 70 }]),
  { kind: 'send', ref: 'b', pct: 12 },
  'sends to the lowest session under 50%'
)
assert.strictEqual(pickSessionTarget([{ ref: 'a', pct: 50 }, { ref: 'b', pct: 90 }]).kind, 'defer', '≥50% defers')
assert.strictEqual(pickSessionTarget([{ ref: 'a', pct: null }]).kind, 'defer', 'unknown defers')

const turn = (model: string, input: number, read: number, create: number) =>
  JSON.stringify({ type: 'assistant', message: { model, usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: 99 } } })
const jsonl = [
  '{"partial line from the tail cut',
  turn('claude-opus-5-5', 5, 1000, 0),
  JSON.stringify({ type: 'user', message: { content: 'hi' } }),
  turn('claude-opus-5-5', 2, 119972, 303),
  JSON.stringify({ type: 'assistant', isSidechain: true, message: { usage: { input_tokens: 190000 } } }),
  JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', usage: { input_tokens: 0 } } }),
  ''
].join('\n')
assert.strictEqual(usagePctFromJsonl(jsonl), 60, 'last real assistant turn over the 200k default window')
assert.strictEqual(usagePctFromJsonl(turn('claude-opus-5-5[1m]', 0, 120000, 0)), 12, '[1m] model uses a 1M window')
assert.strictEqual(usagePctFromJsonl(turn('claude-opus-5-5', 0, 300000, 0)), 30, 'usage over 200k implies a 1M window')
assert.strictEqual(usagePctFromJsonl('{"type":"user"}\n'), null)

assert.strictEqual(recordSession({ sessionId: 's1', ticket: 'PROJ-2', phase: 'awaiting-you' })?.phase, 'awaiting-you')
assert.strictEqual(recordSession({ sessionId: 's1', ticket: '<script>' })?.ticket, '', 'unsafe ticket text is dropped, not stored')
assert.strictEqual(recordSession({ sessionId: 's2', pid: '4242', cwd: '/Users/a b/repo' })?.cwd, '/Users/a b/repo', 'cwd with spaces is kept')
assert.strictEqual(reportedByPid().get('4242')?.sessionId, 's2', 'reported pid and cwd skip the lsof scan')
recordSession({ sessionId: 's3', pid: '4242', cwd: '/Users/a b/repo' })
assert.strictEqual(reportedByPid().get('4242')?.sessionId, 's3', '/clear: a new session id replaces the old one for the same pid')
assert.strictEqual(recordSession({ sessionId: 's4', pid: '12; rm', cwd: 'relative' })?.pid, '', 'bad pid and relative cwd are dropped')
assert.strictEqual(recordSession({ ticket: 'PROJ-2' }), null, 'sessionId is required')
assert.strictEqual(execFileSync('sh', ['-c', `X=${shellQuote("a'b")} sh -c 'printf %s "$X"'`], { encoding: 'utf8' }), "a'b", 'env prefix survives quoting')

const lsofCwds = parseLsofCwds('p101\nfcwd\nn/Users/a b/repo\np202\nfcwd\nn/tmp\n')
assert.strictEqual(lsofCwds.get('101'), '/Users/a b/repo', 'one lsof call maps every pid to its cwd, spaces kept')
assert.strictEqual(lsofCwds.get('202'), '/tmp')

process.stdout.write('hooks check ok\n')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-work-'))
const git = (...args: string[]) => execFileSync('git', ['-C', tmp, ...args], { stdio: 'pipe' })
git('init', '-q', '-b', 'main')
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
git('branch', 'feat/mc-123')
git('branch', 'fix/ca-45-i')
assert.strictEqual(findTicketWork(tmp, 'MC-123'), 'feat/mc-123')
assert.strictEqual(findTicketWork(tmp, 'CA-45'), 'fix/ca-45-i', 'suffixed branch still counts')
assert.strictEqual(findTicketWork(tmp, 'MC-12'), null, 'must not match a longer ticket number')
assert.strictEqual(findTicketWork(tmp, 'MC-1234'), null)
fs.rmSync(tmp, { recursive: true, force: true })
