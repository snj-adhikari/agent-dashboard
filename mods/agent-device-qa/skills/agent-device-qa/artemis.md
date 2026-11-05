# Artemis on a real Android phone

[Artemis](https://github.com/snj-adhikari/artemis) (fork of [google/artemis](https://github.com/google/artemis)) is an MCP server that drives an Android device from natural-language tasks. Use it as an extra Android path when its tools (`mobile_*`) are loaded and a device is connected. Otherwise use `android.sh`.

## Setup

Give the user these steps; don't run them for them.

- Clone `https://github.com/snj-adhikari/artemis` and run `uv sync` in it to build `.venv`. Don't run `start.sh`: it installs a global `rules.md` into the Claude config.
- Register the MCP server at user scope:
  `claude mcp add -s user -e PYTHONPATH=<repo> artemis -- <repo>/.venv/bin/python -m mcp_server`
- Pick a model provider (below), then reconnect with `/mcp`.
- Optional: `brew install scrcpy ffmpeg` for video. `mobile_diagnose(attempt_fix=true)` installs the `com.artemis.helper` accessibility APK.
- Verify: `mobile_diagnose(verify_credentials=true)` returns verdict `ready`.

### Provider: Claude Code (default)

Depends on the fork's `claude-code` provider PR (branch `feat/claude-code-provider`, in progress). Until it lands, use an API key.

- Runs Artemis through the user's Claude Code login (`claude -p`), so no separate Gemini or Anthropic key is needed.
- Enable it in the gitignored local config override (`<local-config-file>`, name set by the fork PR) by setting every role's provider to `claude-code`.
- Trade-offs: about 2-5 s per step, and it counts against the user's Claude Code limits.

### Provider: API key (alternative)

- Copy `<repo>/.env.example` to `<repo>/.env` and set `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`. Never paste a key into chat.

### Optional: keys from a password manager

- Put password-manager references in `.env` instead of raw keys (e.g. `op://...`).
- Launch the MCP server through a wrapper that resolves the references and caches them, so each start doesn't prompt.

## Connect the phone (before any Artemis call)

1. `adb devices`. A device listed as `device`: go to Run.
2. Nothing listed: `adb mdns services` and `adb connect <host:port>` for any `_adb-tls-connect._tcp` entry. adb usually auto-connects already-paired phones on the same Wi-Fi.
3. No paired phone: pair over QR (below), then repeat step 1.
4. `mobile_diagnose(attempt_fix=true)` and confirm verdict `ready`.

### Pair over Wireless debugging

Verified on Android 16. The phone must be on Wi-Fi; Wireless debugging doesn't work on mobile data.

- QR pairing (most reliable):
  - `qrencode -o qr.png 'WIFI:T:ADB;S:<name>;P:<6 digits>;;'` and open the image.
  - On the phone: Developer options > Wireless debugging > Pair device with QR code, scan it.
  - Poll `adb mdns services` until `<name>` shows, then `adb pair <host:port> <6 digits>`. The phone then auto-connects through `_adb-tls-connect`.
- Manual code pairing: use the pairing port shown inside the "Pair with pairing code" dialog, not the connect port on the Wireless debugging screen. The wrong port gives `protocol fault (couldn't read status message)`.
- mDNS and QR need both machines on the same LAN without client isolation. Over Tailscale (no mDNS) or mobile data: connect by USB once, `adb tcpip 5555`, then `adb connect <tailscale-ip>:5555`. This resets on reboot, and a DERP relay adds 100-300 ms latency.

## Run

1. `mobile_get_device_state` for a baseline screenshot.
2. `mobile_run_task` per scenario. Write the task as steps plus the expected outcome. Set `locked_app_package` (e.g. `com.android.chrome`) to keep the task inside the app under test. For Pro tasks, set `expected_output_desc` to get a written report back.
3. `mobile_manage_task` status every ~60 s until it finishes.
4. `mobile_inspect_trace` for step screenshots and action overlays; use them as report evidence.

Artemis tasks drive the UI. For dataLayer event checks, pair it with `android.sh` (`asetup`, `aopen`, `aev`) on the same device, or record the scenario as screenshots only.

## Debug

- `mobile_get_device_state` with `screenshot` or `hierarchy` shows what the agent sees.
- On a failed task, read `stderr_log` in the task status.
- Any tool error, no device or "Artemis isn't working": `mobile_diagnose` and follow its ordered fix steps.
