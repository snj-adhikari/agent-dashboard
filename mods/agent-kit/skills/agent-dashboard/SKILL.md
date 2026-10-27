---
name: agent-dashboard
description: Starts (or reuses) the Agent Dashboard, a local Node/React app at http://localhost:5818 showing every git worktree, terminal tab (cmux or tmux) and agent CLI process (Claude Code, Copilot, Codex) across the repo folders the user configured, with controls to send prompts, read output, terminate agents, delete worktrees and start new worktree sessions. Also has a plugin page for mods, a settings/setup page and a phone view. Use when the user says "monitor my worktrees/agents", "open the agent monitor", "agent dashboard", or wants to see what every agent is working on.
---

# Agent: Dashboard

## Locate the repo

Use `$AGENT_MONITOR_DIR`. If it is unset, ask the user once where they cloned it. Not cloned yet: `git clone https://github.com/snj-adhikari/agent-dashboard`, then follow its README (Node 20+, git and MongoDB are required).

## Start or reuse

```bash
lsof -ti:${MONITOR_PORT:-5818} && echo "already running" || (cd "$AGENT_MONITOR_DIR" && npm run build && npm start &)
```

Then open `http://localhost:5818`. `MONITOR_PORT` overrides the port. If setup is incomplete or MongoDB is unreachable, the console prints `Setup incomplete: open http://localhost:5818/setup`. If a macOS LaunchAgent is installed (Setup page), it is already running as a service.

## Pages

- **Home** (`/`): mermaid graph (repo, worktree, terminal tab, bare agent process) polled from `/api/graph`; repos with a "New session" button (worktree + terminal tab running `claude`, same convention as `agent-worktree`); terminal tabs with expand output, send prompt and quick actions; bare agent processes with Terminate; worktrees with Delete and bulk delete of inactive ones; open-PR badges when `gh` is installed.
- **History** (`/history`), **Hooks** (`/hooks`): session history and Jira/Slack hook status (enable, interval, run queue).
- **Vault** (`/vault`): notes folder browser; hidden when no notes folder is set.
- **Plugin** (`/plugin`): mods from the repo's `mods/` with **Add to this device** (copies to `~/.claude/skills/<name>`) or **Download** (zip), plus Chrome extensions.
- **Setup** (`/setup`): onboarding wizard and settings (MongoDB, repo folders, profile, terminal backend, Atlassian, LaunchAgent, phone access).
- **Phone** (`/m/`): installable PWA over `tailscale serve`, with live screen output, prompt box and push notifications when a session is waiting.

## Repo scan

Repo folders come from the Setup page (`repoDirs` in the MongoDB `settings` collection), each scanned one level deep for git repos. `WATCH_DIRS` (comma-separated) replaces the saved list.

## Key API (localhost only, POST bodies must be JSON)

- `GET /api/graph`: mermaid definition + structured state
- `POST /api/terminate {pid}`
- `POST /api/remove-worktree {path, force?}`; refuses the main worktree, active sessions, open PRs and recently edited worktrees
- `POST /api/send {ref, text, surface?}`
- `GET /api/screen?ref=&surface=`
- `POST /api/new-session {repoPath, branch}`
- `GET|POST /api/settings`

## Notes

- No token or cost data per session exists; never fabricate it.
- Terminal backend: `auto`, `cmux`, `tmux` or `terminal` (Setup or `TERMINAL_BACKEND`). Without cmux or tmux, tabs are not listed.
- A LaunchAgent service sees 0 cmux tabs unless cmux socket access is enabled in Setup.
