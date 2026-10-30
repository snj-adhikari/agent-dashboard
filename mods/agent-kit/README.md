# agent-kit

Skills for agent work: a multi-repo controller, worktree tabs, template-first PR bodies, Artifact layouts, threaded Jira replies and starting Agent Dashboard.

## Install

- Marketplace: `claude plugin install agent-kit@agent-monitor`
- Local: `claude --plugin-dir ./mods/agent-kit`
- Or the Plugin page in Agent Dashboard.
- Needs `git`. `agent-worktree` needs cmux (falls back to a plain git worktree). `agent-pr` needs `gh`. `agent-jira-reply` needs the Atlassian MCP.

## Skills

| Skill | What it does |
| --- | --- |
| `agent-orchestrator` | One controller session opens a worktree and agent tab per repo (cmux, herdr, tmux, zellij or WezTerm; plain terminal tabs otherwise), sends each its task, watches for `DONE:`, `BLOCKED:` or permission prompts and relays approvals word for word. Notes in `~/.agent-orchestrator/<session>/`. |
| `agent-worktree` | Creates a worktree on a `type/slug` branch (folder `<repo>-worktrees/<type-slug>`, `-i`, `-ii` suffix on collision), opens it in a new cmux workspace named `Ticket - <KEY>` or `Research - <title>` with its own Claude session and sends the task. |
| `agent-pr` | Builds the PR body from the target repo's own template (keeps every heading, follows its inline instructions), matches the title convention from recent merged PRs, adds mermaid diagrams and root-cause notes where the PR type calls for them. Asks if no template exists. |
| `agent-artifact` | Picks a layout for an Artifact page (step guide or visual report) and reuses `templates/step-guide.html`. |
| `agent-jira-reply` | Posts a threaded reply under a Jira comment by filling a blank reply you started (the MCP can't create threaded replies). Never falls back to a top-level comment unless told. |
| `agent-dashboard` | Starts or reuses Agent Dashboard on `http://localhost:5818` and describes its pages and API. |

## Settings

| Variable | Default | Used by |
| --- | --- | --- |
| `AGENT_MONITOR_DIR` | unset (asks where the repo is cloned) | `agent-dashboard` |
| `MONITOR_PORT` | `5818` | `agent-dashboard` |

## Usage

- "be the controller and open a tab per repo for these: api, web, https://github.com/org/worker", or `/agent-kit:agent-orchestrator`.
- "new worktree for fix/abc-123".
- "raise a PR for this branch".
- "open the agent dashboard".
- No commit, push, PR or external post from any skill without your go-ahead in that turn.
