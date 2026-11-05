# Any app on a real Android phone

Drive any app (not only Chrome pages) on a real phone over adb, with no model API key. A Haiku subagent runs the loop with the `android.sh` helpers. Artemis is an optional upgrade for observing the screen.

## Connect the phone (on demand)

1. `adb devices`. A device listed as `device`: go on.
2. Nothing listed: `adb mdns services` and `adb connect <host:port>` for any `_adb-tls-connect._tcp` entry. adb usually auto-connects already-paired phones on the same Wi-Fi.
3. No paired phone: pair over QR (below), then repeat step 1.
4. Using Artemis: `mobile_diagnose(attempt_fix=true)` and confirm verdict `ready`.

### Pair over Wireless debugging

Verified on Android 16. The phone must be on Wi-Fi; Wireless debugging doesn't work on mobile data.

- QR pairing (most reliable):
  - `qrencode -o qr.png 'WIFI:T:ADB;S:<name>;P:<6 digits>;;'` and open the image.
  - On the phone: Developer options > Wireless debugging > Pair device with QR code, scan it.
  - Poll `adb mdns services` until `<name>` shows, then `adb pair <host:port> <6 digits>`. The phone then auto-connects through `_adb-tls-connect`.
- Manual code pairing: use the pairing port shown inside the "Pair with pairing code" dialog, not the connect port on the Wireless debugging screen. The wrong port gives `protocol fault (couldn't read status message)`.
- mDNS and QR need both machines on the same LAN without client isolation. Over Tailscale (no mDNS) or mobile data: connect by USB once, `adb tcpip 5555`, then `adb connect <tailscale-ip>:5555`. This resets on reboot, and a DERP relay adds 100-300 ms latency.

## Drive the app (default, no key)

Helpers, sourced under bash from `$S/android.sh`:

| Helper | Does |
| --- | --- |
| `alaunch <pkg>` | Launch an app by package name |
| `aui` | Print the uiautomator hierarchy (XML, bounds in pixels) |
| `autap <text-regex>` | Tap the centre of the first node whose `text` or `content-desc` matches |
| `atapxy <x> <y>` | Tap pixel coordinates |
| `atype <text>` | Type into the focused field |
| `aswipe <x1> <y1> <x2> <y2> [ms]` | Swipe (default 300 ms) |
| `aback` | Back key, unless Chrome is focused |
| `ashot <name>` | Screenshot to `$OUT/<name>.png` |

Dispatch one Haiku subagent per scenario (Agent tool, `model: "haiku"`). Give it the steps, the expected outcome, the package and the helper table above, and have it loop:

1. Observe: `aui` (or Artemis, below); `ashot` when the hierarchy is unclear.
2. Decide the next action from the steps and the screen.
3. Act with one helper.
4. Repeat until the expected outcome shows or 20 actions pass; stop at any payment or call step.

It returns pass/fail, the actions taken and the screenshot paths for the report.

## Observe with Artemis (optional)

When the official `artemis` MCP is loaded, prefer `mobile_get_device_state(view_type="hierarchy")` for observing. Its bounds are normalised to 0-1000: convert with `anorm <x> <y>` (scales by `adb shell wm size`, x*W/1000 and y*H/1000) before `atapxy`. uiautomator bounds from `aui` are already pixels. Artemis not loaded: use `aui`.

### Setup

Give the user these steps; don't run them for them.

- Clone `https://github.com/google/artemis` and run `uv sync` in it. Keep it current with `git pull` then `uv sync`. Never run `start.sh`: it installs a global `rules.md` into the Claude config.
- Register the MCP server at user scope, then reconnect with `/mcp`:
  `claude mcp add -s user -e PYTHONPATH=<repo> artemis -- <repo>/.venv/bin/python -m mcp_server`
- Optional: `brew install scrcpy ffmpeg` for video. `mobile_diagnose(attempt_fix=true)` installs the `com.artemis.helper` accessibility APK.

### Autonomous tasks (optional, needs a key)

- `mobile_run_task` needs the user's own `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` in `<repo>/.env` (copy `.env.example`). Never paste a key into chat.
- Keys can be password-manager references (e.g. `op://...`) with the MCP launched through a wrapper that resolves and caches them.
- Flow: `mobile_run_task` (steps + expected outcome, `locked_app_package`, `expected_output_desc` for Pro tasks) > `mobile_manage_task` status every ~60 s > `mobile_inspect_trace` for evidence. On failure read `stderr_log`; on any tool error run `mobile_diagnose`.
