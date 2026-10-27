---
name: agent-artifact
description: Use whenever creating, publishing or redesigning an Artifact (HTML page): setup guides, how-tos, runbooks, onboarding, prompt kits, test reports, analysis, comparisons, audits, status or review pages. Picks the right layout (step guide or visual report), applies the format rules, and reuses the saved step-guide template. Load it before writing the page, alongside the Artifact tool's own design guidance.
---

# Agent: Create Artifact

Format rules for Artifacts. Apply on top of the Artifact tool's page contract (quickstart / artifact-design); these rules win where they differ.

## 1. Pick the layout

| Request looks like | Layout |
|---|---|
| Setup, how-to, onboarding, runbook, "step by step", prompt kit, release/process flow | **Step guide** (section 2) |
| Test results, analysis, audit, comparison, review, metrics, investigation findings | **Visual report** (section 3) |
| Both (e.g. a guide with test evidence) | Visual report sections first, then the step guide |

## 2. Step guide (template: `templates/step-guide.html`)

Start from the template: copy it, keep its tokens, fonts, timeline and copy-button script, replace the content.

Order, top to bottom:
1. **Title + one-line lede.** Name, not a caption.
2. **Quick copy prompt, expanded.** One `<details open>` with a Copy button holding a single prompt that makes Claude Code walk the reader through every step, one at a time, waiting between steps. If any step touches a website, the prompt opens with a step 0: check Claude in Chrome (`/chrome`); if it's not connected, help install the Claude in Chrome extension, sign in, run `/chrome` and enable it; then use Chrome to show where to click, never changing settings itself.
3. **Flow diagram.** One inline SVG of boxes joined by arrows (3-5 boxes, last box filled with the accent). Short mono label plus a muted sub-label per box.
4. **Numbered timeline steps.** `ol.steps` with numbered circles and a connecting rule. Each step: a mono uppercase "who" line, a heading, one or two sentences, then every command/prompt in a collapsed `<details>` with its own Copy button (`Show command` / `Show prompt`).
5. **Things to ask / next steps.** Expandable copyable prompts.

Rules:
- Keep text minimal: one or two sentences per step.
- Every command or prompt is expandable and copyable. Never a bare code block without Copy.
- Put a read-only/safety note in an accent `.note` when access or credentials are involved.
- Link the official docs for auth or install steps.
- Readers may be on Mac or Windows: when any command differs by OS, include the template's Mac / Windows toggle (`data-os` blocks, auto-detected) with PowerShell versions, and tell the quick copy prompt to detect the OS.
- Content is for the reader's real setup: never mention the author's own sandbox, local paths, notes or test scaffolding. Use placeholders like `YOUR_PROJECT_ID`, `/Users/YOU/...`.
- Verify commands locally (in an isolated sandbox config, never overwriting real credentials) before saying the page is ready; say plainly which steps are unverified.

## 3. Visual report

All visuals together at the top, all text below:
1. **Summary first.** A short verdict line plus 3-5 key numbers or pills (pass / warn / fail), directly under the title.
2. **One "Charts" section with every visual**, each labelled with its topic. Include at least one mermaid diagram (flow, sequence or state, using `<pre class="mermaid">`, rendered natively) and at least one chart. Choose by data:
   - share of a whole: pie or donut
   - comparison across items: bar
   - change over time: line or area
   - process, pipeline, dependencies: mermaid flowchart
   - pass/fail matrix: coloured grid/table of pills
3. **Then text**: findings as bullets, tables, evidence, raw details in collapsed `<details>`.

Load the `dataviz` skill before drawing any chart. Charts use theme tokens so they read in light and dark.

## 4. Always

- Light and dark themes via tokens; phone width works; no emojis; no em dashes in copy.
- No private notes, ticket-internal notes or private paths in a published page.
- Copy buttons: `navigator.clipboard.writeText` in the click handler, fall back to selecting the text.
- After publishing, give the user the link, say who can open it (private vs org-shared), and list anything unverified.
