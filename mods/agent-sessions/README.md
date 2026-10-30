# agent-sessions

Adds `/agent-sessions`: a terminal tree of every Claude session, grouped by repo and worktree, read from Agent Dashboard.

## Install

- Marketplace: `claude plugin install agent-sessions@agent-monitor`
- Local: `claude --plugin-dir ./mods/agent-sessions` (or `--plugin-dir ./agent-sessions` from the Plugin page zip)
- Agent Dashboard must be running.

## Commands

| Command | What it does |
| --- | --- |
| `/agent-sessions` | Fetches `<AGENT_MONITOR_URL>/api/graph` and prints repos with active worktrees (branch, main checkout flag, changed file count) and the cmux tabs or bare agent processes in each. Sessions outside known worktrees are listed under "Not in a known worktree". |

## Settings

| Variable | Default | Used by |
| --- | --- | --- |
| `AGENT_MONITOR_URL` | `http://localhost:5818` | `/agent-sessions` |

## Usage

```
/agent-sessions

3 Claude session(s)

my-api  (1 active, 2 idle)
└─ fix/abc-123 · 4 changed
   ● <tab ref>  <tab title>  <last active>
```

- If the dashboard is down it prints `Could not reach the agent-monitor at <url>. Is it running?`.
- Tree logic is in `hooks/tree.ts`, tested by `hooks/tree.test.ts`.
