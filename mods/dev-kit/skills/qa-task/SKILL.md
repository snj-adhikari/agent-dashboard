---
name: qa-task
description: Use when asked to test or verify a PR, branch or ticket ("QA this PR", "verify PROJ-123 on staging", "write a test plan"). Builds a test plan from the acceptance criteria, runs automated checks and browser checks on non-production environments, and reports pass or fail per criterion with evidence. Never edits source.
---

# qa-task

Verifies a change and reports evidence. Read-only on source code: if something fails, report it; don't fix it.

## 1. Scope

- Get the PR or branch and its ticket. List acceptance criteria; if missing, derive them from the ticket and PR description and confirm.
- Ask which environments to test: local, preview, dev, staging. Never load production in a real browser unless the person explicitly says so for this run; analytics and ad scripts make it bot traffic.

## 2. Test plan

A table, one row per check: `# | Given / When / Then | Criterion | Type (functional, visual, regression, perf) | Environment`.

Cover the criteria, then the edges that break things: empty and error states, mobile and desktop widths, light and dark, keyboard access, no layout shift.

## 3. Automated checks

- Check out the branch in a worktree; run the repo's own test, lint, typecheck and build scripts. Capture the real output.

## 4. Browser checks

- Use the browser tool available (agent-browser, Claude in Chrome or Playwright) on the agreed non-production URLs.
- For each row: steps taken, screenshot or console output, result.
- Check the console and network for new errors.

## 5. Report

- Per criterion: pass, fail, or blocked, with evidence. Failures get steps to reproduce, expected and actual.
- Overall verdict: ready, ready with notes, or not ready.
- Offer to post the report to the ticket or PR; post only on an explicit yes for that comment.
