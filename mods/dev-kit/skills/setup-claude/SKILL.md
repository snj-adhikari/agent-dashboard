---
name: setup-claude
description: Use when setting up Claude Code on a new machine or for a new person, or when asked to "set up my Claude", "configure Claude Code", or "make Claude follow my rules". Walks through working rules, permissions, mods, learning and guards, asking before every change.
---

# setup-claude

A guided setup of `~/.claude` for one person. Interview first, change second, and show every diff before writing it.

## 1. Read what exists

- `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, `~/.claude/settings.local.json`, any project `CLAUDE.md` in the current repo.
- `claude plugin list` (or `/plugin`) for installed mods.
- Summarise in a few bullets: rules already set, permissions, hooks, mods. Never print secrets or tokens found in settings or env.

## 2. Interview

Ask one short question at a time, offering the usual answer as the default:

- Name and role; which repos and languages they work in.
- Branch naming (e.g. `feat/<ticket>`), protected branches, commit style, whether Claude may commit or push without asking (default: ask every time).
- PR conventions: title format, template location, ticket key format.
- Writing style for comments, tickets and PRs (offer the `stop-slop` mod).
- Spelling locale, comment density in code, test expectations.
- Anything Claude must never do (prod browsing, posting to Slack/Jira without asking, force push).

## 3. Write the rules

- Draft `~/.claude/CLAUDE.md` sections from the answers: short imperative bullets, grouped by Git, PRs, Code, Writing, Safety. Keep what is already there; merge, don't overwrite.
- Show the diff and wait for a yes before writing.

## 4. Permissions

- Propose an allowlist in `~/.claude/settings.json` for read-only commands they run often (`git status`, `git diff`, `git log`, test and lint scripts from `package.json`).
- Never allow `git push`, `git commit`, deploy or delete commands by default.

## 5. Mods and next steps

Offer, one by one, and run the matching skill when they say yes:

- `guards` mod: blocks force push, commits/pushes on protected branches, rm -rf on home or root. Then run `setup-guards`.
- `setup-learning`: notes and memory so Claude keeps what it learns.
- `stop-slop` mod: plain, human writing for tickets and PRs.
- `agent-monitor-hook` mod: reports session status to the agent-monitor dashboard and phone.

## 6. Finish

List what changed (files and settings keys), what was skipped, and how to undo each change.
