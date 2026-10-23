Set up agent-monitor on this Mac from this repo, following the README "Set it up, step by step" section.

1. Check prerequisites: Node 20+, git, and a terminal backend (cmux preferred, else tmux). Report anything missing with the install command; don't install without asking.
2. MongoDB: check `mongodb://127.0.0.1:27017` answers. If not, suggest `brew services start mongodb-community` (or the Docker command in the README) and wait for me.
3. Run `npm run build`, then start it with `npm start` in the background and confirm `http://localhost:5818` responds.
4. Open `http://localhost:5818/setup` for me and walk me through the onboarding wizard: repo folders, profile, terminal backend. Ask me for each value; don't guess personal details.
5. Optional, ask first: install the background service from the Setup page so it starts at login, and the `agent-monitor-hook` mod so sessions report their status.
6. Finish with `npm run check` and a short list of what is set up and what I skipped.

Never commit `hooks.config.json`, `hooks-state.json`, `push-state.json` or any secret.
