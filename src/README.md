# src

Node/TypeScript server for Agent Dashboard. Compiled by `tsc` to `dist/` (CommonJS, ES2020), it binds to `127.0.0.1:${MONITOR_PORT:-5818}`, serves the JSON API under `/api/` and the built React app from `web/dist/`.

## Layout

| Path | What it does |
| --- | --- |
| `index.ts` | HTTP server: request routing, host and origin checks, static files from `web/dist` (`/m/` gets the phone page), startup and hook polling (unless `DISABLE_HOOKS` is set). |
| `http.ts` | Request helpers: JSON body reader (size-capped), trusted-request check including the Tailscale Serve login. |
| `types.ts` | Shared types (`MonitorState`, repos, worktrees, tabs, agents, PRs). |
| `utils.ts` | Path helpers, `WATCH_DIRS` / saved repo folders, active-worktree checks. |
| `check.ts` | Assertion checks for server logic; run by `npm run check`. |
| `routes/` | One handler per API area: graph, history, send and screen, new session, terminate, worktree removal and status, settings, setup (MongoDB, LaunchAgent, Tailscale), plugin import and download, notes folder, hook status, mobile. |
| `services/repos.ts` | Git worktree discovery and keep/inactive rules. |
| `services/processes.ts` | Agent CLI process discovery (one `lsof` call for all cwds). |
| `services/terminal.ts` | Terminal backend: cmux, tmux or Terminal.app. |
| `services/cmux.ts`, `services/cmuxControl.ts` | cmux tabs, surfaces, send and read. |
| `services/state.ts` | Builds and briefly caches the monitor state shared by concurrent polls. |
| `services/mermaid.ts` | Mermaid graph for the Home page. |
| `services/newSession.ts` | New worktree plus terminal session. |
| `services/db.ts` | MongoDB connection (`MONGO_URL`, `MONGO_DB`, `MONGO_SERVICE`). |
| `services/settings.ts` | Settings in the MongoDB `settings` collection, cached for sync reads. |
| `services/history.ts` | Activity snapshots for the History page while a client is watching. |
| `services/launchAgent.ts` | macOS LaunchAgent plist generation and install. |
| `services/tailnet.ts` | This Mac's MagicDNS name and owner login. |
| `services/push.ts` | Web Push keys and phone subscriptions. |
| `services/vault.ts` | Notes folder tree and graph. |
| `services/hooks/` | Jira and Slack triggers: polling, usage gate, queue, repo matching, branch names, starting sessions; `check.ts` validates them. |
| `scripts/importSettings.ts` | `settings:import`: imports an existing hooks config and LaunchAgent into settings. |

## Build, run, check

Run from the repo root.

| Script | Does |
| --- | --- |
| `npm run build:server` | `tsc -p tsconfig.json` into `dist/` |
| `npm run build` | web, then server |
| `npm start` | `node dist/index.js` |
| `npm run dev` | build, then start |
| `npm run check` | build server, run `dist/check.js` |
| `npm run check:hooks` | build server, run `dist/services/hooks/check.js` |
| `npm run settings:import -- <flags>` | build server, run `dist/scripts/importSettings.js` |

Env vars and settings are listed in the root [README](../README.md#settings-and-env).
