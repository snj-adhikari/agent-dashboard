# Agent Monitor extension

Toolbar popup listing every agent session grouped by repo and worktree, plus a badge with the session count (refreshed every 3 minutes). Reads the local monitor at `http://localhost:5818`.

Install: `chrome://extensions` → Developer mode → Load unpacked → select this `extension` folder.

To point at another monitor, change `MONITOR_URL` in `sessions.js` and the `host_permissions` entry in `manifest.json`.
