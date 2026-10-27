---
name: agent-worktree
description: Use whenever the user mentions "new cmux tab", "new tab", "new workspace", "new worktree", "spin up a worktree", "work on <ticket> in a worktree", or asks to start a branch/task in isolation (and does NOT say "subagent"). Creates a git worktree with a clean `type/slug` branch (e.g. fix/abc-123), opens it in a new cmux workspace named "Ticket - <KEY>" / "Research - <title>" with its own Claude session, the branch as a green status pill, and the task prompt sent in. Needs cmux; without it, falls back to a plain git worktree. Also covers giving parallel subagents their own visible cmux tabs and clearing worktrees.
---

# Agent: Work on a New Worktree

Keeps the **git branch** in real `type/slug` form and derives the **folder** name with a single `/` to `-` substitution: no `type+slug`, no `type--slug`, no opaque `agent-<hash>` folders.

**Announce at start:** "Using agent-worktree to set up `<branch>`."

## Routing: cmux session vs subagent

- User mentions **new cmux tab / new tab / new workspace / new worktree** and does **not** say "subagent": do the work in a new cmux workspace and Claude session via this skill, and send the task prompt into it (Step 3). Don't use the Agent tool for it.
- User says "subagent" / "use an agent": Agent tool as normal (Step 4 still applies if they also want visible tabs).
- **Tab only (no worktree mentioned):** skip Steps 1-2. `target` = the folder the user named, else the current session's cwd. Still apply 3a naming, the status pills (no `branch` pill if `target` isn't a git repo) and the seeded prompt.
- **Prompt to send:** the user's task as they stated it, plus any ticket key or context from this conversation the new session can't see. Ticket key with no other instruction: the plan-and-pause default in Step 3. After sending, `cmux read-screen --workspace <id>` once to confirm it was received, then report the workspace name back here.

## Step 0: Inputs

- `branch` (required): lowercase `type/slug`. Types are typically `fix`, `feat`, `tech`, `hotfix`, `chore`; follow the repo's own convention if it has one. Given a bare description instead, propose a branch name and confirm before creating anything.
- `folder` (optional): an explicit path is used as-is (create parent dirs if needed). Default: `<repo-parent>/<repo-name>-worktrees/<folder-slug>`.
- `base` (optional): ref to branch from. Default is the repo's default branch:
  ```bash
  base=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || { git remote set-head origin -a >/dev/null && git symbolic-ref --short refs/remotes/origin/HEAD; })   # e.g. origin/main
  ```
  Use another base only if the user names one.

## Step 1: Compute names, don't guess

```bash
branch="fix/abc-123"                 # real branch name, slash intact
folder_slug="${branch/\//-}"         # "fix-abc-123", single substitution
repo_root=$(git rev-parse --show-toplevel)
repo_name=$(basename "$repo_root")
target="${folder:-$repo_root/../${repo_name}-worktrees/$folder_slug}"
```

**Collisions:** if the branch or folder already exists, never reset or reuse it. Suffix `-i` for the first extra one (`fix/abc-123-i`), then `-ii`, `-iii`, and so on.

## Step 2: Create the worktree

```bash
git fetch origin "${base#origin/}"
git worktree add "$target" -b "$branch" "$base"
```

Check `git status` first; if the current checkout has uncommitted work that makes this surprising, mention it before proceeding.

**No cmux?** (`command -v cmux` fails): stop after this step and tell the user the path plus the command to start: `cd <target> && claude`.

## Step 3: Open it as a visible cmux workspace, seeded with the task

### 3a: Decide the workspace name (before creating it)

Match the style of the user's existing workspaces (`cmux list-workspaces`): `<Kind> - <Label>`, short, no branch in the title.

| Work | `ws_name` | Example |
|------|-----------|---------|
| Ticket key given | `Ticket - <TICKET-KEY>` | `Ticket - ABC-123` |
| Research / spike / investigation | `Research - <short title>` | `Research - Cache purge` |
| Tech debt / chore, no ticket | `<Repo short> - <short title>` | `Webapp - Tech Debt` |

- `<Repo short>` = repo name capitalised, minus any common org prefix.
- Short title: 2-4 words, Title Case, from the user's request (or the ticket summary if fetched).
- **Unsure which kind, or no clear title?** Ask with `AskUserQuestion` (2-3 proposed names, recommended first). Don't guess.
- **Confirm the name** in the same question as the branch confirmation when one is being asked anyway: "Workspace name: `Ticket - ABC-123`. Keep or change?" A user-supplied name is used verbatim. Only the title is up for change; branch, folder and pills stay as computed.
- If the user said "just do it" or gave everything up front, use the computed name without asking.

### 3b: Create the workspace

```bash
cmux new-workspace --cwd "$target" --name "$ws_name" \
  --description "$repo_name · $branch${ticket_summary:+ · $ticket_summary}" \
  --command "claude" --focus true
```

- `--description` carries repo, branch and the ticket summary when known. Fetch the summary only if an Atlassian (or other issue tracker) MCP is connected: one call, summary field only, skip on failure.
- `--command "claude"` starts Claude Code in the worktree. `--focus` needs an explicit `true`/`false`; bare `--focus` errors.
- Capture the workspace id from the output (`OK workspace:<n>`). If `--name` didn't stick:
  ```bash
  cmux rename-workspace --workspace <workspace_id> "$ws_name"
  ```
- A ref like `workspace:12` can return "Workspace ref not found" for a second or two, so wait until `cmux list-status --workspace <workspace_id>` succeeds before setting pills, then check `list-status` shows them all.
- Branch in green (for a branch-less research worktree, use the folder slug):
  ```bash
  cmux set-status branch "$branch" --workspace <workspace_id> --icon arrow.triangle.branch --color "#22c55e" --priority 3
  ```
- Repo (or plain folder) in red, using the main repo name, not the worktree folder:
  ```bash
  if common=$(git -C "$target" rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
    where="Repo: $(basename "$(dirname "$common")")"
  else
    where="Folder: $(basename "$target")"
  fi
  cmux set-status where "$where" --workspace <workspace_id> --icon folder --color "#ef4444" --priority 1
  ```
- Pills sort by `--priority`, higher first. Don't add a `running`/`live` pill: cmux already shows its own `claude_code` pill (Running / Idle / Needs input), and a second one contradicts it when idle. Clear stale ones with `cmux clear-status running --workspace <workspace_id>`.
- Renaming later: `cmux rename-workspace --workspace <workspace_id> "X"` (title only, leave pills alone).
- **If a ticket key was given**, seed the new session instead of leaving it idle. Give it a moment to launch, then:
  ```bash
  cmux send --workspace <workspace_id> "Ticket <TICKET-KEY>. Use the issue tracker MCP if connected to fetch the ticket (summary, description, acceptance criteria, comments), and read the relevant code in this worktree. Write an implementation plan to ai/\$(date +%Y-%m-%d)-<ticket-lowercase>-plan.md in this worktree. Plan only: do not write or edit implementation code yet. When done, print a short summary of the plan here and stop; wait for my explicit approval before starting the work.\n"
  ```
  Always plan-and-pause first; never let a seeded session edit code unattended. If the user gave different seed instructions, use those.
- Seeding gotchas:
  - In a folder Claude hasn't opened before, the session starts on the folder-trust prompt, where the default is "No, exit". `read-screen` first; if it's showing, send `Down` then `Enter`. A project MCP prompt may follow; `Enter` keeps its safe default.
  - A long `cmux send` lands as `[Pasted text]` and its trailing `\n` doesn't submit it. Follow with `cmux send-key --workspace <workspace_id> Enter`, then `read-screen` to confirm the session is working.

## Step 4: Parallel subagents each get their own visible tab

When work fans out into several agents on the same or sibling worktrees, give each a real tab instead of invisible background output:

```bash
cmux new-workspace --cwd "$target" --name "$branch:$task_label" --command "claude" --focus false
```

- Seed it as in Step 3 (`cmux send --workspace <id> "<task prompt>\n"`) rather than baking the prompt into `--command`, so quoting stays simple and plan-and-pause still applies per task.
- Name each tab `<branch>:<short-task-label>` so the set is scannable (`cmux list-workspaces`).
- `--focus false` keeps the user's current tab active; check progress with `cmux read-screen --workspace <id>` without switching.

## Step 5: Cleanup, "clear worktree" (one, or all)

### Mode A: clear one worktree

Trigger by branch name or ticket ("clear worktree `feat/abc-123`", "clear abc-123"); look the path up, don't ask for it.

1. Resolve branch to path:
   ```bash
   git -C <repo_root> worktree list --porcelain | awk -v b="refs/heads/$branch" '/^worktree/{p=$2} $0=="branch "b{print p}'
   ```
   If the branch isn't checked out in any worktree, say so.
2. If the superpowers `finishing-a-development-branch` skill is installed, follow it for the branch/PR decision; otherwise run these safety checks and stop to ask if any show unsaved work:
   ```bash
   git -C "$target" status --porcelain              # uncommitted changes
   git -C "$target" log @{u}.. --oneline 2>/dev/null  # unpushed commits
   git -C <repo_root> fetch origin "<base-branch>"
   git -C <repo_root> rev-list --count "$branch" ^origin/<base-branch>  # unmerged commits
   ```
   Compare against the fetched `origin/<base-branch>`; a stale local base can make merged work look unmerged.
3. Close its cmux tab (match by `cwd`, the `branch` pill, or the `Ticket - <KEY>` title):
   ```bash
   cmux list-workspaces
   cmux close-workspace --workspace <workspace_id>
   ```
   Skip if no tab is open. If the user says the tab is in active use, confirm first.
4. Remove the worktree:
   ```bash
   git worktree remove "$target"     # --force only with explicit confirmation of discarded work
   ```
5. Delete the branch (`git branch -D <branch>`) only if the user explicitly asks.

### Mode B: clear ALL worktrees

When the user says "clear all worktrees" (optionally "in `<repo>`" or "in `<folder>`"):

1. Scope: `<repo-parent>/<repo>-worktrees/*` and `<repo>/.claude/worktrees/*` for the named repo (or the current one).
2. Enumerate what's actually there: `git -C <repo_root> worktree list --porcelain`.
3. Run Mode A steps 2-4 for each. "Clear all" is the batch confirmation: proceed through every **clean** worktree without re-confirming each.
4. **Exclude and flag, never auto-remove:**
   - dirty, unpushed or unmerged worktrees
   - broken/partial checkouts: `git status` shows mass deletions across the tracked tree while `ls` shows far fewer entries than the repo has (common with opaque `.claude/worktrees/agent-<hash>` leftovers). Don't try to fix it; report and ask.
   Remove a flagged one only if the user explicitly confirms discarding it.
5. Finish with `git worktree prune` in each affected repo and a summary: removed N, skipped M (with reasons).

## What NOT to do

- Never name a worktree folder `type+slug`, `type--slug` or `agent-<hash>`; always the `folder_slug` from Step 1.
- With cmux available, never create the worktree on disk without also opening its tab.
- Never leave a subagent's tab unlabelled or numbered.
