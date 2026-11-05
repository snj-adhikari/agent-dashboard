# Agent Magic - Every skill gets its own tab

Plugin id: `agent-orchestration`.

Runs each skill you type in its own cmux sub-tab of the same pane, so the main tab's context stays clean. The sub-tab's questions and its done-summary are relayed into the main tab, and the main agent answers them or tells the sub-tab to finish.

## Install

- Marketplace: `claude plugin install agent-orchestration@agent-monitor`
- Local: `claude --plugin-dir ./mods/agent-orchestration`
- Needs [cmux](https://cmux.dev) and `claude` on `PATH`. Outside cmux (no `CMUX_SURFACE_ID`) the mod does nothing.

## How it works

1. You type `/<skill> ...` in a cmux tab. The prompt is dropped, a sub-tab opens in the same pane running `claude --permission-mode <mode> "/<skill> ..."`, and the input box is cleared. `<mode>` is the main tab's permission mode, captured from each `classic.UserPromptSubmit` into `~/.claude/agent-orchestration/mode-<surface>.json`; `default` when unknown.
2. When a sub-tab turn ends with a question, the main tab gets `[subtab <surface> <skill> asks]` plus the sub-tab's last message.
3. The main agent answers with `subtab_reply`, or asks you first for judgement calls and anything that publishes, posts, commits, pushes or merges.
4. When the skill is finished, the sub-tab writes a short summary and hands off. The main tab gets `[subtab done]` with the summary, and the sub-tab closes itself.

## Hooks

Registered in `hooks/register.ts`, tested by `hooks/register.test.ts`.

| Event | What it does |
| --- | --- |
| `prompt.submit` (main tab) | a typed skill (not a built-in, not in the stay list) is dropped and opened in a sub-tab; the box is cleared |
| `prompt.submit` (sub-tab) | adds the handoff instructions: summary to `summary.md`, then create `done`; questions as plain text, never AskUserQuestion |
| `prompt.submit` (relayed) | adds context telling the main agent how to answer, when to ask you, and when to finish |
| `session.start` (main tab) | registers `subtab_reply` and polls every 3 s: relays questions and summaries, closes finished sub-tabs, cleans up tabs closed by hand, notifies once after 12 h without a handoff |
| `turn.complete` (sub-tab) | files the sub-tab's last message as a question for the main tab |
| `tool.call` Bash | refuses `cmux close-surface` / `close-workspace` while a sub-tab run is live, so the summary is never skipped |

## Tool

`subtab_reply` (`mcp__agent-orchestration__subtab_reply`): `surface` (the id from the relayed prompt), `text` (the answer), or `finish: true` to make the sub-tab write its summary and close.

## Settings

| Variable | Default | Does |
| --- | --- | --- |
| `AGENT_SUBTAB_OFF` | unset | `1` turns routing off; skills run in the main tab |
| `AGENT_SUBTAB_STAY` | unset | comma-separated skill names that always run in the main tab, on top of `loop`, `update-config`, `keybindings-help`, `fewer-permission-prompts` |

Set them in the `env` block of `~/.claude/settings.json`. Run state lives in `~/.claude/agent-orchestration/runs/<id>/` and is removed when a run finishes.
