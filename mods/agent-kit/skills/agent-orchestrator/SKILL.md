---
name: agent-orchestrator
description: Use when the user wants one controller session to run several coding agents in parallel across one or more repos, each in its own terminal tab and git worktree, e.g. "work across these repos", "cross-repo task", "open a tab per repo", "be the controller", "watch the other tabs", "take over as controller". Asks which repos first (names, local paths or git URLs), creates a worktree and agent tab per repo, sends each its task, watches for DONE/BLOCKED/permission prompts, and reports back before relaying any approval. Works with cmux, herdr, tmux, zellij and WezTerm on macOS, Linux and Windows (WSL or WezTerm); falls back to plain terminal tabs plus a shared status file.
---

# Agent Orchestrator

You are the **controller**. You open one worker tab per repo, give each a task, watch them, and are the only session that talks to the user. Workers never talk to each other directly: they share one notes file.

**Announce at start:** "Using agent-orchestrator as controller."

## Step 1: Ask which repos (always first)

Ask once, in one question, before creating anything:

> Which repos should I open? Give names, local paths or git URLs, one per line. Optional per repo: base branch, branch name, task.

Resolve each entry:

| Input | Resolution |
|---|---|
| Local path | use it; `git -C <path> rev-parse --show-toplevel` must succeed |
| Bare name (`my-api`) | look under the current dir's parent, `~/code`, `~/src`, `~/projects`, `~/dev`, `~/work`; ask if 0 or 2+ matches |
| Git URL | `git clone <url> <parent>/<name>` only after confirming the clone location |

Also ask for (or propose and confirm) a **session name**, e.g. `Research - Payments`. If the user already listed repos and tasks in the request, skip the question and confirm the list in one line.

## Step 2: Detect the backend

Pick the first that is present and running. Run these checks in this order:

```bash
[ -n "$CMUX_SOCKET_PATH" ] || command -v cmux     # cmux
command -v herdr && herdr status server           # herdr
[ -n "$TMUX" ]                                    # tmux (inside a session)
[ -n "$ZELLIJ" ]                                  # zellij
[ -n "$WEZTERM_PANE" ]                            # WezTerm (also native Windows)
```

None found: use **plain mode** (below). On native Windows without WezTerm, suggest WSL + tmux, or plain mode with Windows Terminal (`wt`).

## Step 3: Create the notes folder

Default `~/.agent-orchestrator/<session-slug>/` (ask if the user keeps notes elsewhere). Write two files:

- `controller.md`: backend, tab map (tab name, tab/pane id, repo, worktree path, branch), in-flight work, the rules below. This is what a replacement controller reads to take over.
- `shared-context.md`: tab table, rules for workers, `## Current task` (one bullet per tab), `## Cross-repo contracts` (fields, endpoints, env vars, payload shapes shared between repos), `## Findings log` (append only, `- YYYY-MM-DD HH:MM [Tab] finding`).

Never put secrets in either file.

## Step 4: One worktree per repo

```bash
repo=<resolved path>; name=$(basename "$repo")
branch=${branch:-tech/<session-slug>}          # lowercase type/slug
base=${base:-$(git -C "$repo" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || { git -C "$repo" remote set-head origin -a >/dev/null && git -C "$repo" symbolic-ref --short refs/remotes/origin/HEAD; })}
wt="$repo/../$name-worktrees/${branch//\//-}"
git -C "$repo" fetch origin "${base#origin/}"
git -C "$repo" worktree add "$wt" -b "$branch" "$base"
```

- Branch or folder exists: never reset or reuse it, suffix `-i`, `-ii`, ...
- Research-only tab with no code changes: a worktree is still useful so it never touches the user's main checkout.
- herdr: `herdr worktree create --cwd "$repo" --branch "$branch" --base "$base" --label "<Tab>" --no-focus --json` does this and the tab in one call; read the path from the JSON.

## Step 5: Open a worker tab per repo

Start the agent CLI the user runs (default `claude`) in the worktree, named after the repo.

| Backend | Open tab | Rename |
|---|---|---|
| cmux | `cmux new-surface --type terminal --workspace <ws> --pane <pane> --command "cd '$wt' && claude" --focus false` | `cmux tab-action --action rename --tab <surface> --workspace <ws> --title "<Tab>"` |
| herdr | from `worktree create` above, or `herdr tab create` in the workspace, then `herdr agent start <pane>` | `herdr tab rename` / `herdr agent rename` |
| tmux | `tmux new-window -d -n "<Tab>" -c "$wt" claude` | set by `-n` |
| zellij | `zellij action new-tab --name "<Tab>" --cwd "$wt"` then `zellij action write-chars "claude"` + Enter | set by `--name` |
| WezTerm | `wezterm cli spawn --cwd "$wt" -- claude` (prints pane id) | `wezterm cli set-tab-title --pane-id <id> "<Tab>"` |
| plain | macOS: `osascript` / iTerm new tab; Linux: `gnome-terminal --tab --working-directory="$wt" -- claude`; Windows: `wt -w 0 nt -d "$wt" --title "<Tab>" claude` | set at launch |

Record every id in `controller.md`. Ids can change after a restart: re-list (`cmux list-pane-surfaces`, `herdr agent list`, `tmux list-windows`, `wezterm cli list`) before trusting them.

## Step 6: Send each worker its task

Every task prompt ends with this footer:

> Read `<notes>/shared-context.md` first and again before you finish. Work only in `<wt>`. Append findings to its Findings log. No commit, push, PR or external post unless the controller relays an explicit go-ahead. Finish with one line: `DONE: <gist>` or `BLOCKED: <why>`.

| Backend | Send | Read screen |
|---|---|---|
| cmux | `cmux send --workspace <ws> --surface <s> "<msg>"` then `cmux send-key ... Enter` (long text pastes and needs the extra Enter) | `cmux read-screen --workspace <ws> --surface <s>` |
| herdr | `herdr agent prompt <target> "<msg>"` | `herdr agent read <target> --source recent --lines 60` |
| tmux | `tmux send-keys -t "<Tab>" -l "<msg>"` then `tmux send-keys -t "<Tab>" Enter` | `tmux capture-pane -p -t "<Tab>" -S -60` |
| zellij | focus tab, `zellij action write-chars "<msg>"`, `zellij action write 13` | `zellij action dump-screen <notes>/<Tab>.screen.txt` |
| WezTerm | `wezterm cli send-text --pane-id <id> "<msg>"` then `wezterm cli send-text --pane-id <id> --no-paste $'\r'` | `wezterm cli get-text --pane-id <id>` |
| plain | pass the task as the launch argument (`claude "<msg>"`); later messages go through the user | `shared-context.md` only |

After sending, read the screen once to confirm it landed. A message sent while the agent is busy is queued, which is fine.

## Step 7: Watch without polling by hand

One background watcher per tab (`run_in_background`), exiting when the tab finishes, blocks or asks for permission. `READ` is the backend's read-screen command from Step 6:

```bash
until READ | grep -qE '^[⏺ ]*(DONE|BLOCKED):|Do you want to'; do sleep 20; done
echo "<Tab> needs attention"; READ | tail -40
```

- herdr can also block natively: `herdr agent wait <target> --timeout <ms>` (see `herdr agent explain <target>` for status names).
- Plain mode: watch the notes file instead, `until grep -q '\[<Tab>\].*\(DONE\|BLOCKED\)' shared-context.md; do sleep 20; done`.
- Windows PowerShell: `while (-not (Select-String -Path shared-context.md -Pattern '\[<Tab>\].*(DONE|BLOCKED)' -Quiet)) { Start-Sleep 20 }`.
- Only match lines written after the task was sent: if an old `DONE:` is still on screen, clear it or grep the tail after the send.

## Step 8: Report, then wait

When a watcher fires:

- Read the screen, then tell the user in short bullets: tab, result, files changed, anything to decide.
- Permission prompt in a worker: describe exactly what it wants to run, and wait for the user. Do not approve it yourself.
- Relay the user's decision to the worker **word for word**, then restart that tab's watcher.
- Update `controller.md` in-flight work and `shared-context.md` current task.

## Taking over from another controller

Read `controller.md` and `shared-context.md`, re-list tab ids, read every worker's screen, give the user a 3-5 bullet status, start the watchers, then wait.

## Adding or closing a tab

- Add: Steps 4-6 for the new repo, then add a row to both files.
- Close: confirm with the user, check `git -C <wt> status` is clean (or the user accepts losing changes), close the tab, `git worktree remove <wt>`. Never `--force` without an explicit yes.

## Rules (apply to every tab)

- No `git commit`, `git push` or PR without the user's explicit go-ahead in that turn; one go-ahead covers one action. Never push to `main`, `master`, `develop` or `staging`, never force-push.
- No posts to chat, ticket or code-review systems without a per-message go-ahead.
- Secrets: never read or print them. Use the user's secret manager references; give the user commands to run themselves for anything that writes a secret.
- Workers stay in their own worktree. Cross-repo facts go in `shared-context.md`, not in each other's tabs.
- Replies to the user: short bullets, lead with the result.
