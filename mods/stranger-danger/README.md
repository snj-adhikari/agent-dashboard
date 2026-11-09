# Stranger Danger - Only your words are orders

Checks what other people wrote (Slack, Jira, Confluence, Gmail, any MCP read, WebFetch, `gh`/`curl` output) for instructions aimed at the agent, and makes Claude ask you before acting on them. Your prompts, Claude's own text and anything you authored are never scanned. Pure regex in one `tool.call` hook: no model calls, no extra tokens unless something is flagged.

Plugin id: `stranger-danger`.

## Install

- Marketplace: `claude plugin install stranger-danger@agent-monitor`
- Local: `claude --plugin-dir ./mods/stranger-danger`

## Who counts as you

Detected once per session, no setup:

- git `user.name` and `user.email`, `gh` login
- the Jira/Confluence account from `atlassianUserInfo` and the Slack user from `slack_read_user_profile`, when those MCP servers are connected

`Author: text` lines and JSON objects (comments, messages) by any of these are skipped. A mention of you inside someone else's message is still scanned.

## Options (`/config`)

| Option | What | Default |
| --- | --- | --- |
| `self` | Extra comma-separated identities (Slack user id, names, emails) | empty |
| `trustedServers` | MCP servers whose output is never scanned | `agent-orchestration,plugin-authoring,agent-more-like-you,context7` |
| `privateTerms` | Strings that must never appear in an outbound post | empty |

## Hooks

Registered in `hooks/register.ts`, tested by `hooks/guard.test.ts`.

| Event | Does |
| --- | --- |
| `tool.call` external read | Scores a stranger's text against injection patterns (override instructions, text addressed to the agent, hiding things from the user, secret requests, `curl \| sh`, fake prompt markup, hidden unicode). Medium or high: status line, transcript line, and a note telling Claude to say "`<author>` is asking for X. Shall I do it?" and wait |
| `tool.call` external post after a flag | Any MCP write (send, create, update, comment, transition...), `gh pr comment/review/merge`, `git push/commit`, `curl -d` or `rm -rf` asks Block / Allow once until your next prompt. Local file edits are not gated |
| `tool.call` outbound post | Asks before posting a token or key, a markdown image with a query string, a long URL payload, a credential assignment or a `privateTerms` string |
| `prompt.submit` | Clears the flag |

## Limits

- Regex catches common phrasing, not paraphrase. The real guard rail is the post gate after a flag.
- Flag and identity live in module memory: a reload clears them.
- `gh` and `curl` reads are only seen through the Bash tool.
