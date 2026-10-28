# agent-hooks

Claude Code hooks for safer git, cleaner PRs and read-only cloud access. Each hook fails open when it can't parse its input.

## Install

- Marketplace: `claude plugin install agent-hooks@agent-monitor`
- Local: `claude --plugin-dir ./mods/agent-hooks`
- Needs `jq` and `python3` on `PATH`.

## Hooks

| Hook | Event | What it does |
| --- | --- | --- |
| `agent-push-gate.py` | PreToolUse Bash | Denies `git commit` / `git push` unless your latest message asks for it (commit, push, create PR, same PR), you just said yes to a commit or push question, or the branch already has an open PR. Subagents can only commit or push on a branch with an open PR. |
| `agent-signature.sh` | PreToolUse Bash | Blocks skipping commit signing or hooks (`--no-verify`, `--no-gpg-sign`, `-n`). With `AGENT_SIGNATURE` set, adds it as a commit trailer and to PR bodies in place of `Signed-off-by`. |
| `agent-no-claude-pr-attribution.sh` | PreToolUse Bash | Denies "Generated with Claude Code", Claude `Co-Authored-By` and similar lines in commits and PR/issue titles, bodies and comments. |
| `agent-create-pr-gate.sh` + `agent-create-pr-mark.sh` | PreToolUse Bash, PostToolUse Skill | `gh pr create` is denied until the `agent-pr` skill (agent-kit) has run in the session, so PR bodies follow the repo's template. |
| `agent-comment-style-guard.sh` | PreToolUse Write, Edit, Bash | Denies added comment blocks longer than one `//` line (JS, TS, PHP, Java, Go, C) or three `#` lines (Python, Ruby, shell, YAML), and any comment in CSS, SCSS, Sass or Less. |
| `agent-jira-timetracking-guard.sh` | PreToolUse and PostToolUse Atlassian MCP | Estimates and worklogs only go on issues it has seen as a `Dev subtask`, never on the parent Story, Task, Bug or Epic. |
| `agent-aws-guard.py` | PreToolUse Bash, file tools, aws-mcp | Denies the read/write AWS profile (`AGENT_AWS_RW_PROFILE`, default `prod-rw`) and `~/.aws/credentials`; asks before any `aws` CLI call so lookups go through read-only MCP profiles. |
| `agent-prod-browse-guard.py` | PreToolUse Chrome MCP, WebFetch, Bash | For domains in `AGENT_PROD_HOSTS` (comma-separated), asks before a real browser loads them, and checks that the GTA - Blocker extension is active. Reply "allow all" to stop asking for the session. Off when unset. |
| `agent-branch-convention.sh` | SessionStart | Warns when the branch doesn't match `feat|fix/<ticket>-...` or `tech|docs|chore|.../<kebab-case>`. |

## Settings

| Variable | Default | Used by |
| --- | --- | --- |
| `AGENT_SIGNATURE` | unset (no trailer) | `agent-signature.sh` |
| `AGENT_AWS_RW_PROFILE` | `prod-rw` | `agent-aws-guard.py` |
| `AGENT_PROD_HOSTS` | unset (guard off) | `agent-prod-browse-guard.py` |
