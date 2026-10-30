# dev-kit

Skills that set up a Claude Code instance (working rules, learning notes, guards) and run a dev or QA task end to end with approval gates.

## Install

- Marketplace: `claude plugin install dev-kit@agent-monitor`
- Local: `claude --plugin-dir ./mods/dev-kit`
- `dev-task` and `qa-task` use `git` worktrees; ticket lookups use a Jira or GitHub MCP if connected, otherwise they ask for the text.

## Skills

| Skill | What it does |
| --- | --- |
| `setup-claude` | Reads `~/.claude` and installed mods, interviews you one question at a time, drafts `~/.claude/CLAUDE.md` rules and a read-only permissions allowlist, then offers `guards`, `setup-learning`, `stop-slop` and `agent-monitor-hook`. Shows every diff before writing. |
| `setup-learning` | Sets up Claude memory and an optional notes folder (`Daily/`, `Projects/<repo>/raw/`, `Projects/<repo>/wiki/index.md` and `log.md`) plus `CLAUDE.md` rules for when to read and write them. |
| `setup-guards` | Installs the `guards` mod, sets `GUARDS_PROTECTED_BRANCHES` if wanted, then builds and tests any extra hook rules you ask for. |
| `dev-task` | Ticket to ready-to-review PR in an isolated worktree: understand, plan (gate 1), implement and test, review, commit (gate 2), PR (gate 3). Offers `/factory` for large tasks. |
| `qa-task` | Builds a test plan from the acceptance criteria, runs the repo's checks and browser checks on non-production URLs, and reports pass or fail per criterion with evidence. Never edits source. |

## Usage

- "set up my Claude"
- "pick up PROJ-123"
- "QA this PR on staging"
