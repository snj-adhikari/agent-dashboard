# Prompts

Copy a prompt into Claude Code (or another coding agent) started in this repo. Each one tells the agent what to do, what to check, and what not to touch, so you get a guided setup instead of reading the whole README.

| Prompt | Use it to |
| --- | --- |
| [setup-agent-monitor.md](setup-agent-monitor.md) | Install, build and start agent-monitor on a new Mac, then finish onboarding |
| [setup-phone-access.md](setup-phone-access.md) | Use the dashboard from your phone over Tailscale, with notifications |
| [troubleshoot-phone-access.md](troubleshoot-phone-access.md) | Find out why the phone page doesn't load or doesn't notify |
| [tune-hooks.md](tune-hooks.md) | Choose poll intervals and usage gates for the automation hooks |

The agent should ask before anything that needs your password, changes system settings, or publishes beyond your own tailnet.
