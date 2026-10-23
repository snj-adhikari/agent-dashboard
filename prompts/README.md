# Prompts

Copy a prompt into Claude Code (or another coding agent) started in this repo. Each one tells the agent what to do, what to check, and what not to touch, so you get a guided setup instead of reading the whole README.

| Prompt | Use it to |
| --- | --- |
| [setup-agent-dashboard.md](setup-agent-dashboard.md) | Install, build and start Agent Dashboard on a new Mac, then finish onboarding |
| [setup-phone-access.md](setup-phone-access.md) | Use the dashboard from your phone over Tailscale, with notifications |
| [troubleshoot-phone-access.md](troubleshoot-phone-access.md) | Find out why the phone page doesn't load or doesn't notify |
| [tune-hooks.md](tune-hooks.md) | Choose poll intervals and usage gates for the automation hooks |

## Skills

For setup and automation you run often, install the `dev-kit` mod (`/plugin install dev-kit --marketplace <owner>/<repo>`) and ask Claude for the skill by name:

| Skill | Use it to |
| --- | --- |
| `setup-claude` | Set up a Claude Code instance: working rules, permissions, mods |
| `setup-learning` | Make Claude keep what it learns: memory rules and a notes folder |
| `setup-guards` | Install the `guards` mod and add your own safety hooks, each tested |
| `dev-task` | Ticket to PR in a worktree, with approval before plan, commit and PR |
| `qa-task` | Test plan and evidence per acceptance criterion, non-production only |

The agent should ask before anything that needs your password, changes system settings, or publishes beyond your own tailnet.
