---
name: agent-pr
description: Draft and create a GitHub PR that strictly follows the target repo's own PR template. No filler text, mermaid diagrams for feature/fix/release/sync PRs, short 1-2 line bullets, root-cause analysis for fixes (with regression trace-back), and ticket/PR/commit tables with hyperlinks for release and sync/merge PRs. Use whenever the user asks to create, raise, open, or draft a PR, write a PR description, or says "create a PR", "raise PR", "PR for this branch", for ANY repo. Always find and respect that repo's real PR template first.
---

# Agent: Create PR

Every PR body is built from the target repo's **actual** PR template, never a generic one
carried over from another repo. The template's own inline instructions (e.g. "put an `x` in
boxes that apply, strikethrough the rest with `~~`") are instructions to follow, not text to
delete.

## Step 0: Find and read the real template (always first)

Check, in order, until one exists:
1. `.github/pull_request_template.md` or `.github/PULL_REQUEST_TEMPLATE.md`
2. `docs/pull_request_template.md`
3. `PULL_REQUEST_TEMPLATE.md` at repo root
4. `.github/PULL_REQUEST_TEMPLATE/*.md` (multiple templates: ask which, or infer from PR type)

```bash
gh api repos/<owner>/<repo>/contents/.github/pull_request_template.md --jq '.content' | base64 -d 2>/dev/null \
  || gh api repos/<owner>/<repo>/contents/docs/pull_request_template.md --jq '.content' | base64 -d 2>/dev/null \
  || gh api repos/<owner>/<repo>/contents/PULL_REQUEST_TEMPLATE.md --jq '.content' | base64 -d 2>/dev/null
```

If no template exists anywhere, say so and ask how the body should be structured rather than
inventing one.

**Rules once you have it:**
- Keep every template heading, in order. Add no sections the template lacks.
- Don't drop a heading because it's empty; leave it blank as the template does.
- Follow the template's formatting instructions literally (tick with `x`, strike the rest
  with `~~` if it says so).
- Check 4-5 recent merged PRs (`gh pr list --state merged`) for a title convention (e.g.
  `[TICKET-KEY] [TYPE] [scope] Summary`) and match it.

## Step 1: Classify the PR

From the branch name, `git log` vs base, or by asking:

- **Feature**: new functionality
- **Fix**: bugfix, possibly a regression
- **Release / cherry-pick**: branch cut from `main`/a release branch with tickets
  cherry-picked one commit at a time, or a staging release (`release/*` into `staging`)
- **Sync / merge**: one long-lived branch merged into another

Type changes how content sections are filled (Step 3), never the template's headings.

## Step 2: Gather tickets and commits

Grep commit messages and the branch name for ticket keys (`[A-Z]+-[0-9]+`). For each:
- Ticket link: `https://<tracker-host>/browse/<KEY>`. Take the host from existing PR bodies
  in the repo, or ask.
- Originating PR, if cherry-picked/synced: `gh pr list --search "<sha>"` or
  `git log --grep <ticket>`

Short commit SHAs go in code ticks: `` `1f144bd26` ``.

## Step 3: Fill the content sections

Universal rules, inside whatever heading the template uses for the change summary:

- **Everything is a bullet.** No prose paragraphs anywhere: root cause, sync notes, conflict
  notes included. A sentence needing a second clause becomes two bullets.
- **Bullets max 1-2 lines**, trimmed to what a reviewer needs.
- **Prefer a mermaid diagram over text** for any flow, causal chain or relationship. More
  than 2-3 bullets describing a sequence or before/after means draw it instead: `flowchart`
  for logic, `gitGraph` for branches, `sequenceDiagram` for multi-actor interactions. Each PR
  type below needs one as a floor; add another where a table or list would read better as a
  diagram.
- **Flowcharts default to `flowchart TD`.** Use `LR` only for naturally side-by-side nodes
  (e.g. per-scope subgraphs in a release PR).
- **Timeline when the change has history.** If the PR adds, removes or re-adds behaviour that
  has flipped before (a gate, flag, validation), trace it with `git log -S`/`-G` and add a
  mermaid `timeline` (date : change (#PR, TICKET)) ending with this PR. Real commits only,
  never inferred dates.
- **Timeline for upgrades, patches and fallbacks.** Dependency/runtime upgrades, patches and
  fallback changes get a `timeline` of each version or fallback change (`git log -S` on the
  manifest, lockfile, version file or fallback code), ending with this PR.
- **Bug timeline for fixes.** When the faulty code landed, when it was first observed
  (ticket, alert, log date), any earlier partial fix, and this fix. Keep the root-cause
  `flowchart TD` alongside it.
- **Charts for measured comparisons.** A claimed performance or quality improvement gets a
  mermaid `xychart-beta`: `bar` for before/after, `line` for a trend. Measured numbers only;
  nothing measured, no chart.
- **Charts for drift over time.** A metric that degraded across releases gets an
  `xychart-beta` `line`, marking the causing release/PR and this PR's result. Name the data
  source under the chart.
- **Mirror in the tracker.** Most issue trackers don't render mermaid; post the same timeline
  or comparison there as a table.
- **Never name a file that's in the diff.** The Files tab shows it. Only name paths outside
  the diff that matter (an untouched config gating the behaviour, a shared module now
  depended on).
- **QA instructions are a checklist**: short imperative steps, one per line.

### Feature PR
- 2-4 short bullets: what it does, how it's wired up, anything non-obvious.
- Small mermaid `flowchart TD` (4-6 nodes): trigger, logic, outcome.
- QA checklist.

### Fix PR
Only the root cause and a short summary of the fix.

- First bullet states the **root cause**: the actual defect, not the ticket's symptom.
- If a regression, name the PR/commit that introduced it and add a compact `flowchart TD`:
  original behaviour, regression introduced, symptom, fix.
- 1-2 bullets on what the fix does. **Never list changed files** or describe file-by-file
  edits.
- QA checklist.
- Scannable in 10 seconds. Not an incident report.

### Release / cherry-pick PR
- Mermaid `flowchart LR`, one subgraph per team/scope: `Ticket --> PR --> release branch
  --> main`.
- One table per scope, columns exactly:

  | Ticket | Status | PR | Cherry-picked from |
  |---|---|---|---|

  Add a `Dev Task` column between Ticket and Status only if sub-tickets exist. `Ticket` and
  `PR` are hyperlinked; `Cherry-picked from` is the short SHA in code ticks.
- One short note confirming typecheck/tests/lint were green after each cherry-pick.
- If the repo has a fixed staging/release environment, put its URL in the template's staging
  link field.

### Sync / merge PR
- Mermaid `gitGraph` of the source branch's commits landing on the target, tagging this PR
  (`tag: "this PR"`).
- Table, columns exactly:

  | Commit | PR | Ticket | Description |
  |---|---|---|---|

- If conflicts were resolved:

  | File | Resolution |
  |---|---|

- "Sync issues / follow-up" bullets only if something is outstanding; otherwise omit.

### Other template fields
Fill only what's true. A ticket-links field just needs the hyperlinked keys. Leave a field
blank rather than "N/A" unless the template's own examples use "N/A".

### Screenshots for UI changes (optional)
Only for PRs with a visual change, and only if the template has a screenshots field.

- Table, one row per breakpoint (Mobile ~390px, Tablet 768px, Desktop), columns
  Breakpoint | Before | After.
- Before = the current environment (dev/staging showing the existing state). After = the PR
  preview, if the repo deploys one; otherwise a local build.
- Never screenshot production if loading it fires analytics or ad impressions.
- GitHub has no image-upload API. With Claude in Chrome on the PR page: `file_upload` the
  images onto the new-comment file input, read the generated
  `https://github.com/user-attachments/assets/...` URLs from the comment textarea, then clear
  the textarea without posting. Embed as `<img width="400" alt="before-mobile" src="..." />`.

## Step 4: Labels and assignee

- **Assignee**: the current user (`gh api user -q .login`).
- **Labels** that match what the PR is, only if they exist in the repo
  (`gh label list --repo <owner>/<repo> --search <name>`). Examples:
  - `release`: any release/cherry-pick PR.
  - `remerge`: re-applies previously reverted or superseded work.
- Never invent a label; ask if the right one is unclear.

```bash
gh pr edit <N> --repo <owner>/<repo> --add-label release --add-assignee <login>
```

## Step 5: Create it

Write the body to a scratch file; never pass a large body inline via `--body`.

```bash
gh pr create --repo <owner>/<repo> --title "<title>" --body-file <scratch>/pr-body.md
```

Creating a PR is shared-visibility. Show the drafted title and body and get a go-ahead before
`gh pr create`, unless the user already said to go ahead this turn. Then apply Step 4 in the
same action; the create isn't done until labels and assignee are set.
