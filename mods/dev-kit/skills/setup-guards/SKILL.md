---
name: setup-guards
description: Use when someone wants safety rails on Claude Code, such as blocking force pushes, commits on main, destructive deletes, prod access, or posting without approval, or asks to "add guards", "add a hook that blocks X" or "stop Claude from doing Y".
---

# setup-guards

Installs the `guards` mod and adds any extra rules the person needs as Claude Code hooks. Show every change before writing it, and test every rule before calling it done.

## 1. Install the guards mod

- `/plugin install guards --marketplace <owner>/<repo>` from the marketplace that ships it, or `claude --plugin-dir mods/guards` from a local checkout.
- It blocks, for every Bash call:
  - force pushes (`--force`, `-f`, `--force-with-lease`, `+branch`);
  - pushes to and commits on protected branches;
  - `rm -rf` on `/`, `~`, `$HOME` or `..`.
- Protected branches default to `main, master, develop, staging`. To change them, set `GUARDS_PROTECTED_BRANCHES` in the `env` block of `~/.claude/settings.json` (comma-separated). Show the diff first.

## 2. Ask what else to guard

Offer common extras, one question each:

- Asking before any `git push` or `git commit`, even on feature branches.
- Production URLs that must never be opened in a browser tool.
- Posting to Slack, Jira, GitHub or email without an explicit go-ahead in that turn.
- Edits to secrets files (`.env`, keys, credentials).
- Code style rules a linter can't catch (comment density, banned words).

## 3. Build each extra rule

- Prefer a `PreToolUse` hook in `~/.claude/settings.json` running a small script in `~/.claude/hooks/`. Return a block decision with a one-line reason that says what to do instead.
- Keep each script to one rule, read only the tool input it needs, and fail open on its own errors so a bug never blocks every command.
- Never hard-code tokens or personal data in a script.

## 4. Test every rule

For each guard, run one command it must block and one it must allow, and show both results. A rule that wasn't seen blocking something isn't done.

## 5. Finish

List each guard, where it lives, and how to turn it off (remove the hook entry or `/plugin uninstall guards`).
