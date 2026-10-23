---
name: setup-learning
description: Use when someone wants Claude to remember what it learns across sessions, keep project notes, or "learn from mistakes". Sets up memory conventions, an optional notes folder (plain Markdown or an Obsidian vault) with per-project index and log, and the rules for when to write to them.
---

# setup-learning

Sets up a place for durable knowledge and the rules for using it. Ask before creating any folder or editing `CLAUDE.md`.

## 1. Choose where knowledge lives

Ask which they want (default: both):

- **Claude memory**: Claude Code's built-in memory files for preferences, corrections and project facts.
- **Notes folder**: a Markdown folder, ideally an existing Obsidian vault. Ask for its path; never pick one silently.

## 2. Notes layout (if chosen)

Create only what is missing:

```
<notes>/
├── Daily/                      one file per day, working record
└── Projects/<repo>/
    ├── raw/                    pasted logs, traces, scratch; never edited after writing
    └── wiki/
        ├── index.md            current state: active work, open PRs, gotchas
        └── log.md              append-only dated timeline
```

## 3. Rules to add to `~/.claude/CLAUDE.md`

Draft these, adapt to their answers, show the diff, write on yes:

- Before starting work in a repo, read `Projects/<repo>/wiki/index.md` and the latest `log.md` entries for decisions and gotchas.
- After a task, append one dated line per notable event to `log.md`; update `index.md` when the current state changed (branch, PR, open thread).
- Promote anything learned in `raw/` or a session that will matter later into `wiki/`; don't leave it only in `raw/` or a daily note.
- Save corrections the person gives ("don't do X", "always Y") as memory with the reason, so they apply next session.
- Never copy notes content into commits, PRs, tickets, comments or anything shared.
- Before trusting a remembered file path, flag or command, check it still exists.

## 4. Seed it

- Offer to write a first `index.md` for the current repo from what can be verified now: default branch, build and test commands, open PRs (`gh pr list --author @me`).
- Confirm by reading it back.

## 5. Finish

Tell them where knowledge now lives and the one-line habit: "ask Claude to log what it learned" at the end of a task.
