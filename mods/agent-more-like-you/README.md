# Agent - That feels like you

Plugin id: `agent-more-like-you`.

Learns how you write for each audience (Slack DM, Slack channel, Jira, Confluence, GitHub PR) and makes agents redraft external comments in that voice. It learns from your typed prompts, your sends, your edits to agent drafts, and an optional notes folder. Read-only on every external system; nothing is sent or posted.

## Install

- Marketplace: `claude plugin install agent-more-like-you@agent-monitor`
- Local: `claude --plugin-dir ./mods/agent-more-like-you`

## Folder

Resolved once, first hit wins:

1. `MORE_LIKE_YOU_VAULT`: the folder itself.
2. `VAULT_PATH`: `<root>/more-like-you`.
3. Dashboard `settings.vaultPath` from `${AGENT_MONITOR_URL}/api/settings` (default `http://127.0.0.1:5818`): `<root>/more-like-you`. Best effort; errors fall through.
4. `~/.claude/more-like-you`.

It holds `config.json`, `style-profile.md`, `phrasebook.md`, `rules.md`, `perspective.md`, `changelog.md`, `cursor.json` and `raw/`.

## config.json

Written by `/more-like-you learn` on first run. Missing keys use the default.

| Key | Default | Meaning |
| --- | --- | --- |
| `sources` | all `true` | `slack`, `jira`, `confluence`, `github`, `transcripts`, `notes`, `prompts` |
| `audiences` | all `true` | audiences the gate applies to |
| `backfillDays` | `90` | window for the first `learn` |
| `staleDays` | `7` | age before the nudge, and before a full refresh |
| `threshold` | `null` | override the learnt human threshold |
| `notesDir` | `null` | notes folder to learn from; falls back to the resolved vault root |
| `autoRefresh` | `local` | `local` or `full` |
| `judgeLimit` | `300` | max paragraphs judged per run |
| `perspective` | `true` | inject a `perspective.md` excerpt once per session |

## Hooks

| Event | What it does |
| --- | --- |
| `session.start` | Starts a local learn (no MCP, no model): typed prompts, captured prompts, feedback, observed rows, transcripts, notes; refreshes markers, `rules.md` and phrasebook counts. With `autoRefresh: full`, an existing `cursor.json` and stale cursors, may spawn one detached headless `/more-like-you refresh` in the session's permission mode (`default` when unknown); never in plan mode. Registers the `more_like_you` tool. |
| `prompt.submit` | Captures your cleaned, redacted typed prompt to `raw/`. Logs your next prompt after an allowed gated draft as feedback. Adds a one-line nudge once per session when the cursor is missing or stale. Once per session, when `perspective` is on and `perspective.md` exists, adds an excerpt of it (800 character cap) as context, framed: "How the user thinks and why. Use it to understand their reasoning and explain trade-offs in terms they care about. It is not evidence that they are right: judge each case on its merits, disagree when the facts point elsewhere, and do not agree just because something matches their past choices." |
| `tool.call` | Gate: the first write per audience per session (Slack draft, Jira or Confluence comment, `gh` PR comment or review) is denied with your rules, edits and profile section; the retry goes through. Never denies when there is nothing to apply. Passive capture: non-write tool results are run through `extractors.ts`; the result is never altered. |

The `more_like_you` tool has actions `ingest`, `queue`, `label`, `samples` and `eval`.

## Usage

- `/more-like-you learn` the first time: asks the config questions, pulls, ingests, judges, evals, spot-checks with you, then writes the profile.
- `/more-like-you refresh` when nudged.

The refresh decision runs on `classic.SessionStart`, which carries the session's `permission_mode`. Full mode reads `~/.claude/usage-state.json`, which is not a standard Claude Code file. When it is missing or stale, the spawn is skipped and the session shows the refresh nudge instead.

## Custom pull files

Any `raw/<date>-<name>-pull.jsonl` is ingested, one JSON object per line:

```json
{"id":"example:1","source":"example","ts":"2026-01-15T09:30:00Z","text":"short sample message","self":true,"audience":"slack-channel","target":"example-thread-1"}
```

- `self: true` marks your own text without an identity lookup.
- `audience` (one of the five) puts it in that profile section; without it the row feeds markers and phrasebook only.
- `target` is the match key against agent writes to the same place.

To capture a new tool-result shape automatically, add an extractor to `hooks/extractors.ts` (`{ name, test, extract }`).

## Privacy

Everything stays in the local folder. Captured prompts pass through redaction first: key-prefixed tokens, JWTs, `Bearer` tokens, `key=value` secrets and long hex or base64 runs become `[redacted]`. Only text that passes the classifier as yours feeds the profile; others' text is reference only. Your CLAUDE.md, rules files and hooks, then the stop-slop bans, then your explicit instructions outrank the profile, including any formatting rules (layout, bullets, line breaks, length).

## Structure

The built-in scorer is neutral on layout: bullets, line count and multi-line messages neither raise nor lower a score. The only structural AI tell is a wall of 3 or more bullets mostly made of ticket or PR ids. Layout is learnt per audience as `structure` markers in `phrasebook.md`, from that audience's own human sends and feedback rewrites. Typed prompts feed vocabulary and phrasing markers only, never structure.
