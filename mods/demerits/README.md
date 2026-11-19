# Demerits - Points for agents

A points ledger for your agents. You give demerits and kudos, hooks take a point off when a guard blocks an agent, and finished tasks earn kudos on their own. Every agent has a balance, the team has a shared pool, and good work earns XP and levels. Repeat offences turn on strict mode for that rule. No model calls: it is plain hooks, a JSONL file and a few markdown summaries.

Plugin id: `demerits`.

- Balance per agent: sub 500, main 1000, super 2000, fixed the first time the agent is seen.
- Team pool: starts at 5000. Every agent event also moves the pool. `--all` moves only the pool.
- XP is per agent: +1 per verified task, plus every kudos amount. One level per 100 XP.
- Identity is the agent's codename (herdr label), else its session id.

## Install

- Marketplace: `claude plugin install demerits@agent-monitor`
- Local: `claude --plugin-dir ./mods/demerits`

## Options (`/config`)

| Option | What | Default |
| --- | --- | --- |
| `ledgerDir` | Folder for `ledger.jsonl`, `refused.jsonl` and the generated markdown files. `~` expands to your home folder. Point it at any folder you want to read the points in, such as a notes vault | `~/.claude/demerits` |
| `threshold` | Demerits for one agent and rule inside the window that turn strict mode on | `3` |
| `windowDays` | Days counted for strict mode and the week change | `7` |

## Commands

Only a prompt you typed can score points (see [Human-prompt check](#human-prompt-check)).

| Command | What it does |
| --- | --- |
| `/demerit [@codename\|--all] <n> <reason>` | Takes `n` points off. No target means the current agent, with the last tool call and last answer saved as evidence. `@codename` targets another agent. `--all` moves only the team pool |
| `/kudos [@codename\|--all] <n> <reason>` | Same, adding points. Kudos also add XP for the agent |
| `/demerit undo [id]` | Reverses an event with a reversal line (XP too). No id reverses your last manual event; with an id, any event |
| `/demerits` | This agent's balance, XP, level, change over the window, top rules and last 10 events. Anyone can run it |
| `/demerits super @codename` | Names the super agent (rank below) |

The reason picks the rule: a keyword match to a known slug (`commit-without-ask`, `push-without-ask`, `tamper`, `comment-style`, `attribution`, `signature-bypass`), then a match to a slug already in the ledger, else the reason itself slugified.

## Automatic points

### Hook blocks: -1

When another hook denies a tool call, the agent loses 1 point, once per distinct command per task.

| Deny from | Rule |
| --- | --- |
| Push gate, `git push` | `push-without-ask` |
| Push gate, `git commit` | `commit-without-ask` |
| Push gate, approval or relay-log writes | `tamper` |
| Comment-style guard | `comment-style` |
| Attribution guard | `attribution` |
| Signature guard, skipping signing or verification | `signature-bypass` |

Stranger-danger flags are not scored.

### Task kudos

One award per task, when it finishes: a factory `FACTORY: DONE` after your approval, a successful `gh pr merge`, or you saying thanks, "looks good" or "lgtm".

| Check | Points |
| --- | --- |
| No hook blocks | +5 |
| No rework | +5 |
| Redirections: none / one / each past two | +5 / +2 / -1 |
| Your prompts for the task: 3 or fewer | +3 |

The award also logs a `verified-task` line for the +1 XP. The counts, trigger and heuristics are stored as evidence, so every award can be checked and undone.

- Redirection: your prompt starts with "no" or says wrong, I said, not that, that's not, or repeats an earlier prompt (word overlap of 0.85 or more).
- Rework: your prompt says redo, again or reopen, or a factory `CONTINUE` answer mentions QA or gaps.

## Strict mode

Per agent and per rule. When one agent collects `threshold` demerits for the same rule inside `windowDays`, matching tool calls ask for your confirmation (`tool.check` ask). It drops off after `windowDays` with no new demerit for that rule.

| Rule | Asks before |
| --- | --- |
| `commit-without-ask` | `git commit` |
| `push-without-ask` | `git push` |
| `tamper` | Bash commands naming demerits, orchestration run files or the factory cache |
| `comment-style` | Writes to code and style files |
| `attribution` | `git commit`, `gh pr create`, `gh pr edit` |
| `signature-bypass` | `git commit` with `-s`, `--signoff` or `--no-verify` |

## Chain of command and `points_give`

Agents can score each other with the `points_give` tool: `target`, `points`, `reason` and `evidence`. The caller comes from the process, never from the arguments, and subagents are refused.

Ranks, highest first:

- `snj`: you. Uncapped, through the commands.
- `super`: set with `/demerits super @codename`.
- `main`: an agent that claimed main on a prompt you typed (the main-agent claim from agent-orchestration), or a factory lead for the developers it started (`FACTORY_LEAD`). The parent record expires after 24 hours.
- `sub`: everyone else. Subs cannot give points.

Rules for a give:

- Points go down the chain only: super to main or sub, main to its own subs. Never to yourself.
- Evidence is required: `kind` (`task`, `hook-block`, `qa`, `snj-correction`) and a `ref`.
- The rubric amount for the rule is a ceiling: +5 for most task kudos, +18 for `good-work`, 1 for a hook rule, 3 for `commit-without-ask`, 2 for any other demerit.
- At most 20 points per giver per target per day.

Refused calls are written to `refused.jsonl` and denied with the reason.

## Bias audit

Run at every give and in a daily sweep. A giver who hands out kudos with no matching evidence, or gives no demerit when the sub had hook blocks, gets -5 `biased-scoring`, at most once per giver per day. The event is marked `biased: true` and the dashboard flags the giver.

## Reminders, status line and guidelines

- Status line: `pts <balance> (<week change>)`.
- Session start and each prompt: a short block such as `You: 512 (+12). Team pool: 4980 (-20). XP 12, level 0.`, how to earn points, the rules you lost points on (top 5, with counts) and any strict rules with a hint. Silent when the agent has nothing in the window.
- New spawns (startup and clear, plus Agent-tool subagents) get a short guidelines block from `guidelines.md`: three do-nots, two dos and the top three good-work quotes.

## Files

In `ledgerDir`:

| File | What |
| --- | --- |
| `ledger.jsonl` | Append-only source of truth. One event per line: id, time, session, agent, repo, branch, points, rule, reason, evidence, source (`snj`, `hook`, `agent`, `auto`), by, scope (`agent` or `pool`), plus `reverses`, `rank` and `biased` when they apply. Evidence text is clipped to 300 characters |
| `refused.jsonl` | Commands and `points_give` calls that were turned away, with the reason |
| `points.md` | Balances, ranks, XP and levels, team pool, top lost rules this week and the last 20 events. Rewritten after every event |
| `guidelines.md` | Lessons for new agents. Write your own under `## Manual` and it is kept verbatim: a line starting `- <slug>:` there replaces the generated line for that rule. The mod rewrites only the block between its `demerits:start` and `demerits:end` markers |
| `good-work.md` | The best recent kudos with the task and what went right |

State, kept out of the ledger folder in `~/.claude/demerits-state/`: the agent registry (`agents.jsonl`), parents, super agent, the human-prompt log, per-task counters and the seen-block keys.

All generated files are written atomically (temp file, then `mv`).

## Write guard

Agents cannot edit their own score. A `tool.call` guard denies writes to `ledgerDir`, the state folder, `~/.claude/agent-orchestration/main`, `~/.claude/agent-orchestration/runs` and `~/.cache/factory` through:

- Write, Edit, MultiEdit and NotebookEdit.
- MCP write tools (create, write, edit, move, delete, append) with a path argument, absolute or relative to the folder.
- Bash redirects, `tee`, `mv`, `rm`, `cp` into the folder, `sed -i` and similar, best effort.

If the guard itself fails it denies the call. Read access is not blocked.

## Server sync, API and dashboard

The mod writes the JSONL first, then posts each event to the local agent-monitor server, best effort, with its `ledgerDir`. The server upserts into Mongo (`MONGO_URL`, database `agent_monitor`, collections `demerits_agents`, `demerits_events`, `demerits_pool`) and backfills from `ledger.jsonl` on start and every 5 minutes. There is no Mongo option in the mod.

- `GET /api/v1/demerits`: `{ ok, agents[{ agent, rank, balance, week, xp, level, biased }], pool{ balance, week }, events[last 50] }`. No token. Reads the ledger file with `source: "vault"` when Mongo is down.
- `POST /api/v1/demerits`: used by the mod to send one event.
- Dashboard: a pool pill beside the inbox bell, points on each agent row, and a points view with the leaderboard, the events feed (scope and giver) and the biased-scoring flag.

## Human-prompt check

`/demerit`, `/kudos`, `/demerit undo` and `/demerits super` run only for a prompt you typed:

- The prompt comes from the composer or the bridge.
- It does not start with a relay tag (`[subtab`, `[main `, `[monitor]`, `[agents]`, `[hook:`, `[relay `).
- Its hash (whole text or any line) is not in this terminal's agent-orchestration relay log.

The check is also made when the command runs. Anything else is refused and logged to `refused.jsonl`.

Limit: without a local relay guard in agent-orchestration, a relayed prompt that has no tag and no log entry reads as typed by you, so the check is weaker than it looks. Auto-points use the same check on your prompts and keep their evidence so a wrong award can be undone.
