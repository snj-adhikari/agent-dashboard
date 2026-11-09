---
name: agent-spin
description: Use for "/agent-spin", "spin up an agent", "spin up a space", "spin and deliver", "spin factory", "bare agent", "deliver <KEY>", or any quick request for a new agent, tab or branch on a repo under herdr. Creates a herdr worktree (or uses the main checkout), starts one Claude agent in it and sends the task (bare agent), or seeds `/factory <task>` (factory/deliver mode), or opens the space only. Pure herdr CLI plus git. Never commits or pushes.
---

# Agent Spin

Quick agent or space on a repo in herdr. Runs the steps below, then reports in one line per item.

**Announce at start:** "Using agent-spin to start `<name>` on `<branch>`."

Needs `herdr` (0.9.5+) and `git`. No herdr: say so and suggest `agent-worktree` instead.

## Arguments

| Says | Means |
|---|---|
| `/agent-spin <repo> <task…>` | bare agent on a new worktree |
| `/agent-spin <repo> <KEY> <task…>` | same, branch named from the ticket key |
| `… as <name> …` | agent name given by the user |
| `… here …` | no worktree: main checkout (or the current herdr workspace when it is that repo) |
| `/agent-spin space <repo> [branch\|KEY]` | worktree and tab only, no agent |
| "spin and deliver", "spin factory", "deliver <KEY>", any "factory"/"deliver" wording | factory mode |

- Natural phrasing ("spin up an agent on api to fix the footer") maps the same way: repo, optional key, task.
- Ticket key: `^[A-Z][A-Z0-9]+-[0-9]+$`.

## Step 1: Resolve the repo

- Absolute or relative path: use it; `git -C <path> rev-parse --show-toplevel` must succeed.
- Bare name: look under `$AGENT_SPIN_ROOT`, default the parent folder of the current repo (`dirname "$(git rev-parse --show-toplevel)"`). Try `<root>/<name>`, then any `<root>/*<name>*` that is a git repo. Ask if 0 or 2+ match.
- `repo_short`: the folder name, lowercased.

## Step 2: Pick the mode

| Mode | When | What the agent gets |
|---|---|---|
| Bare agent (default) | "spin an agent", "bare agent", no mode word | the task as its first prompt |
| Factory / deliver | "factory" or "deliver" wording | `/factory <KEY> <task>` (key left out when none). Needs the `factory` mod. |
| Space | `space` | nothing: no agent started |

Factory mode with a controller session that wants updates (the current session is a controller, or the user names one): send `/factory-report <controller session>` first, then `/factory …`.

## Step 3: Branch name

- Type: `fix` by default with a key; `feat` for feature/story/feat wording; `tech` for spike/research/tech/chore; `hotfix` only on "hotfix" wording. Without a key the default is `tech`.
- With a key: `<type>/<key lowercased>`, nothing appended.
- Without a key: `<type>/<slug>`, slug from the first ~5 meaningful words of the task, lowercase, `[a-z0-9-]` only, stopwords and type words dropped.
- User gave an explicit branch: use it as given.
- Collision (local branch, `origin` branch, or worktree folder exists): suffix `-i`, then `-ii`, `-iii`. Never reset or reuse an existing branch.

```bash
git -C "$repo" fetch origin --quiet
wt_root="$(dirname "$repo")/$(basename "$repo")-worktrees"
taken() { git -C "$repo" show-ref --verify --quiet "refs/heads/$1" \
  || git -C "$repo" ls-remote --exit-code --heads origin "$1" >/dev/null \
  || [ -e "$wt_root/${1//\//-}" ]; }
```

- Base: `origin/develop` if it exists, else `origin/HEAD` (`git -C "$repo" symbolic-ref --short refs/remotes/origin/HEAD`).
- Worktree folder: `<repo-parent>/<repo>-worktrees/<branch with / → ->`, e.g. `../api-worktrees/fix-abc-123`.

## Step 4: Agent name

- User name (`as <name>`): must match `^[a-z][a-z0-9_-]{0,31}$` and not be in use in any running session. Otherwise ask for another.
- No name: pick the first unused codename from this list:

  `bond, curie, darwin, euler, faraday, galileo, hopper, hypatia, kepler, lovelace, maverick, newton, noether, okafor, pascal, ramanujan, ride, sagan, tesla, turing, volta, wu`

- In use means it appears as `name` or `display_agent` in `herdr agent list` of any running session (Step 5 lists them).

## Step 5: herdr session

- `herdr session list` (columns: name, status, directory, socket).
- Inside herdr (`HERDR_ENV=1`) and the current session suits the repo: reuse it.
- Else a running session named `<repo_short>`: target it.
- Else none: start a headless server for it, detached, then wait (up to 30 s) until `herdr session list` shows it `running`; report and stop if it never does:

```bash
env -u HERDR_SOCKET_PATH -u HERDR_PANE_ID HERDR_SESSION="$repo_short" nohup herdr server >/dev/null 2>&1 &
for _ in $(seq 30); do herdr session list | awk -v s="$repo_short" '$1==s && $2=="running"' | grep -q . && break; sleep 1; done
```

- A headless session has no TUI: the user views its agents with `herdr agent attach <name>` in any terminal tab, or opens `herdr --session <repo_short>` for the TUI.
- Target another session with `HERDR_SESSION=<name>`. Inside a herdr pane `HERDR_SOCKET_PATH` takes precedence, so unset it:

```bash
hs() { env -u HERDR_SOCKET_PATH HERDR_SESSION="$session" herdr "$@"; }   # other session
hs() { herdr "$@"; }                                                     # current session
```

- Names in use across sessions: run `env -u HERDR_SOCKET_PATH HERDR_SESSION=<s> herdr agent list` for every `running` session.

## Step 6: Worktree and tab

Title: `<name> · <task short>`, or `<name> · <KEY> · <task short>` with a key (task short: first ~5 words).

```bash
hs worktree create --cwd "$repo" --branch "$branch" --base "$base" \
  --path "$wt" --label "$title" --no-focus
```

- Prints JSON (no `--json` flag): `workspace`, `tab`, `root_pane`, `worktree`. Keep `tab` and `root_pane`.
- `here`: no worktree. `hs tab create --cwd "$repo" --label "$title" --no-focus` (add `--workspace <id>` for the repo's existing workspace); use its tab and pane.
- Space mode stops here: report and finish.

## Step 7: Start the agent and send the task

Start Claude with no prompt argument, then send the prompt as one argument. Never put task text in a shell string unquoted; read it through a quoted heredoc:

```bash
hs agent start "$name" --kind claude --pane "$pane" --
task=$(cat <<'EOF'
<task text exactly as the user wrote it>
EOF
)
hs agent prompt "$name" "$task"
```

- Factory mode: `prompt="/factory $key $task"` (or `/factory $task`), sent the same way. Any `/factory-report <controller>` goes first.
- `agent start` fails when the pane is not at a shell prompt or the name is taken: report the error, do not retry with another pane.

## Step 8: Label it

```bash
hs pane report-metadata "$pane" --source agent-spin --display-agent "$name" --token codename="$name"
hs tab rename "$tab" "$title"
```

## Report back

- Mode (bare, factory or space), then one line: name, session, tab title, worktree path, branch, base.
- Session started headless by this skill: add how to view it (`herdr agent attach <name>` or `herdr --session <session>`).
- Say plainly if any step failed and which ones already ran (e.g. worktree created, agent not started).

## Rules

- Never `git commit` or `git push`. Never reset, reuse or delete an existing branch or worktree.
- Never close tabs, panes or sessions you did not create.
- No requirement check or brief: this is the quick path. For a full delivery flow, use factory mode or `agent-orchestrator`.
