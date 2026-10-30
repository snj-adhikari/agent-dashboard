# agent-monitor-hook

Reports each interactive Claude session's phase to Agent Dashboard and shows the hook ticket in the status line. Needed for phone push notifications when a session is waiting.

## Install

- Marketplace: `claude plugin install agent-monitor-hook@agent-monitor`
- Local: `claude --plugin-dir ./mods/agent-monitor-hook`
- Check: `claude plugin validate mods/agent-monitor-hook`
- Agent Dashboard must be running to receive reports; failed reports are ignored.

## Hooks

Registered in `hooks/register.ts`. Each report is a `POST` to `<AGENT_MONITOR_URL>/api/hook-session` with session id, phase, pid, cwd, cmux workspace, hook, ticket and branch. Non-interactive sessions never report.

| Event | What it does |
| --- | --- |
| `session.start` | Reads the env below, reports phase `working`, and shows `<ticket> · <branch> · <phase>` in the status line when a ticket is set. |
| `tool.call` Bash | After a successful `gh pr create`, sets phase `pr-opened` and reports. |
| `turn.complete` | Sets phase `awaiting-you` and reports, unless a PR was opened. |

## Settings

| Variable | Default | Set by |
| --- | --- | --- |
| `AGENT_MONITOR_URL` | `http://localhost:5818` | you |
| `AGENT_MONITOR_TICKET` | unset (no status line) | Agent Dashboard hook tabs |
| `AGENT_MONITOR_BRANCH` | unset | Agent Dashboard hook tabs |
| `AGENT_MONITOR_HOOK` | unset | Agent Dashboard hook tabs |
| `CMUX_CLAUDE_PID`, `CMUX_WORKSPACE_ID` | unset | cmux |
