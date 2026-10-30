---
name: agent-device-qa
description: Use when asked to "test on devices", "test on Android", "test on iPhone", "test on Safari", run a "cross-browser test", or "check dataLayer events on mobile". Guides device setup, opens pages on a real Android phone, the iOS simulator, Mac Safari and Mac Chrome widths, injects a non-throwing dataLayer logger, performs clicks, captures events and screenshots, and publishes a device x scenario report.
---

# agent-device-qa

Test one web page or flow across devices and browsers, capture dataLayer events and screenshots, report per device and scenario.

Scripts: `S=${CLAUDE_PLUGIN_ROOT}/skills/agent-device-qa/scripts` (this skill's base directory + `/scripts`). Output goes to `$OUT` (default `${TMPDIR:-/tmp}/agent-device-qa`).

## 1. Ask first

- What to test: URLs or paths, the buttons or flows, the events expected (e.g. dataLayer `event` names and key fields).
- Expected outcome per scenario, written so it can be ticked ✓ or ✗.
- Output wanted: pass/fail only, screenshots, full report.
- Where it runs: local dev server (port), dev or staging. Unclear on any of these: stop and ask before doing anything.

## 2. Pick devices

Offer each, any can be skipped:

- Real Android phone, Chrome (adb + remote debugging)
- iOS simulator, Safari
- Mac Safari
- Mac Chrome at responsive widths, e.g. 375, 768, 1280 (emulated)
- Real iPhone via Safari Web Inspector (manual: the user taps, you read the console)

## 3. Setup

- Run `bash $S/doctor.sh <android|ios|safari|chrome|iphone|all>`.
- NOT READY: show the printed steps, then wait for the user or skip that device.
- Never run sudo, never change OS or browser security settings; give the user the command (e.g. `sudo safaridriver --enable`).
- Safari and iOS need the proxy in front of the dev server: `node $S/inject-proxy.mjs --listen $PROXY_PORT --target $APP_PORT --out $OUT &`. Stop it when done.

## 4. Run

Device by device, one scenario at a time: open page, inject logger, act, capture events + screenshot. Clear events between scenarios or reload.

Run helpers under bash, never zsh: `bash -c 'source $S/chrome.sh; cview 375 812; copen /path; clog; cclick "#buy"; cev; cshot c375-buy'`.

Env: `OUT`, `APP_PORT` (3000), `PROXY_PORT` (3005), `CDP_PORT` (9333), `SIM_UDID` (booted simulator), `DEVELOPER_DIR` (Xcode, avoids `sudo xcode-select`). Logger options, set on `window` before `clog`/`alog`: `__dlKeep` (event regex), `__dlPanel = false` (no on-page panel).

- **Mac Chrome** (`chrome.sh`, emulated): `cview <w> <h>` before `copen <path>`, then `clog`, `cclick <selector>` (JS click, not coordinates), `cev`, `cshot <name>`.
- **Android** (`android.sh`, real device): `asetup` once (adb reverse for the app port, forward CDP to 9333), `aopen <path>` (opens and runs the logger), `atap <text-regex> [n]` (real finger tap), `aev`, `aclear`, `ashot <name>`, `aback` after a tel: or intent picker. `ab <cmd>` is agent-browser on the phone.
- **iOS simulator** (`ios.sh`, via proxy): `iboot [name]`, `iopen <path> <tag> [hash-params]` (waits up to 120 s, screenshots), `iresult <tag>`.
- **Mac Safari** (`safari.sh`, via proxy): `sopen <path> <tag> [hash-params]`, `sresult <tag>`.
- **Real iPhone** (manual): user opens the page; Mac Safari > Develop > iPhone > Console; paste `logger.js`; user taps; read `window.__dl`.

Proxy hash params (`runner.js`), joined with `&`:

- `t` tag (required), `wait` ms before acting (1000)
- `open` text regex clicked first, `sel` CSS selector, `click` text regex for the main target (visible buttons and links), `n` click count (1), `again` regex for a follow-up click
- `tel=1` click the first visible tel: link with the default prevented, `raw=n` include the last n raw dataLayer entries
- Result line in `$OUT/results.jsonl`: `{tag, ua, w, href, ev, seen, tel, raw, note}`; `note` says what didn't match.

## 5. Report

- Load the `artifact-design` skill, then build the Artifact from `report-template.html` in this skill's directory: keep its layout and tokens, fill the placeholders and the data, delete unused blocks.
- Testing tab: summary KPIs and bullets; Gaps (couldn't test, and why) separate from Anomalies (tested, unexpected); device cards; ✓/✗ matrix device × scenario with an Expected column; events captured; screenshots labelled real device / simulator / emulated / desktop.
- Guide tab: how each device was set up, how to replicate step by step, copyable prompt.
- Copy screenshots next to the page under `shots/` and publish them as supporting files. Never claim a ✓ without the event line or screenshot behind it.

## 6. Safety

- No real calls or payments: tel: links get preventDefault (`tel=1`), press Back on the phone's dial picker, stop at the payment step.
- No production sites in a browser unless the user says so in this run (analytics and ad scripts count it as bot traffic). Local, dev or staging only.
- Check free disk before installing an iOS runtime (~8.5 GB); doctor.sh prints it.

## 7. Gotchas

- Android: keep the phone unlocked (locked = black screenshots, zero-height elements).
- Android: press Back only when Chrome isn't focused (`aback` checks), or it navigates the page back.
- CDP on 9333, because desktop Chrome often holds 9222.
- First `simctl openurl` after boot can time out; `iopen` retries once.
- The simulator has no Phone app; tel: prompts can't be verified there.
- Run helpers under bash: zsh doesn't word-split and `BASH_SOURCE` is empty.
- Background Safari windows sit in Stage Manager, so `screencapture -l` gets a thumbnail or nothing; rely on the result line.
- One browser session at a time; concurrent sessions can hang a dev server.
- `?r=<random>` forces a fresh load; the helpers add it.
- The logger hides the Next.js dev overlay so it isn't in screenshots.
