# stop-slop

Writing rules added to every session (short bullets, plain words, no AI tells), plus a `stop-slop` skill for an editing pass on text about to ship.

## Install

- Marketplace: `claude plugin install stop-slop@agent-monitor`
- Local: `claude --plugin-dir ./mods/stop-slop`

## Hooks

| Event | What it does |
| --- | --- |
| `prompt.submit` | On the first prompt of each session, attaches the rules in `hooks/rules.ts` as context. If the hook errors, the prompt goes through unchanged. |

The rules apply to replies and to text for other people (tickets, comments, Slack and PR text, commit messages, reports), not to specs, plans or design docs. They cover: lead with the answer, short bullets, first person, Australian/British spelling, no emojis or em dashes, no stock AI phrasing or sales words, each claim once, hedge only real doubt.

## Skills

| Skill | What it does |
| --- | --- |
| `stop-slop` | Two-part edit over a document: a line-level pass from `line-patterns.md` (sentence-level AI tells) and a claim-level pass that deletes repeated claims. Style reference in `style-rules.md`. |

## Usage

- "run stop-slop over this PR description" before posting.

Patterns are adapted from Wikipedia's "Signs of AI writing" and blader/humanizer (MIT); see `NOTICE`.
