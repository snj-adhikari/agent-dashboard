# factory

`/factory <goal>`: a lead agent grills you one question at a time, then drives researcher, planner, developer and QA agents unattended until every acceptance criterion has evidence.

## Install

- Marketplace: `claude plugin install factory@agent-monitor`
- Local: `claude --plugin-dir ./mods/factory --model opus` (the lead is meant to run on Opus)
- `factory:reverse-engineer` uses the REA MCP tools and the reverse-engineer-anything skill when installed; otherwise it reads public docs and observes the product in a browser.

## Commands

| Command | What it does |
| --- | --- |
| `/factory <goal or ticket key>` | Starts a run: prints the agent map and sends the lead brief. |
| `/factory-show` | Agent map, current round and live `factory:*` agents. |
| `/factory-report <session name \| off>` | Sends ASK, DONE and stop updates to another (lead) session. No argument shows the current target. |
| `/factory-stop` | Ends the run. |

## Agents

| Agent | Model | What it does |
| --- | --- | --- |
| `factory:researcher` | Sonnet (lead may pick Haiku or Opus) | Read-only research: code, tickets, docs, logs. |
| `factory:reverse-engineer` | Sonnet | Maps how an existing product works (structure, behaviour, data flow, network calls). Read-only. |
| `factory:planner` | Opus | Writes `ai/factory/plan.md`: acceptance criteria checklist, independent tasks, test plan. |
| `factory:developer` | Sonnet | Implements one plan task, runs typecheck and unit tests. Never commits. |
| `factory:qa` | Sonnet | Runs tests, lint, typecheck and a browser check on dev or staging; pass or fail per criterion. Never edits source. |

## Hooks

Registered in `hooks/register.ts`.

| Event | What it does |
| --- | --- |
| `turn.complete` | Reads the lead's last line: `FACTORY: CONTINUE` starts the next round, `WAIT` waits for background agents, `ASK` notifies you, `DONE` ends the run. Stops after 30 rounds. |
| `prompt.submit` | Records your latest message for the git gate. |
| `tool.call` Bash | During a run, denies `git commit` and `git push` unless your latest message says commit or push. |

## Usage

```
/factory add dark mode to the settings page
```

- Answer the lead's questions until it restates scope and criteria, then it runs on its own until the commit gate.
