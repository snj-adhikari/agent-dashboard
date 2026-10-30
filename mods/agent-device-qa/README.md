# agent-device-qa

Skill that tests one web page or flow across a real Android phone, the iOS simulator, Mac Safari, Mac Chrome widths and a real iPhone, captures dataLayer events and screenshots, and reports per device and scenario.

## Install

- Marketplace: `claude plugin install agent-device-qa@agent-monitor`
- Local: `claude --plugin-dir ./mods/agent-device-qa`
- Always needs `bash`, `jq` and `timeout` (`brew install coreutils jq`).
- Per device (run `doctor.sh` to see what is missing):

| Device | Needs |
| --- | --- |
| Android phone, Chrome | `adb` (`brew install --cask android-platform-tools`), USB debugging on, `agent-browser` |
| iOS simulator, Safari | Xcode with an iOS runtime (about 8.5 GB), Node 18+ for the inject proxy |
| Mac Safari | Safari, Node 18+ for the inject proxy |
| Mac Chrome widths | `agent-browser` (`npm i -g agent-browser && agent-browser install`) |
| Real iPhone | Web Inspector on, cable, Mac Safari developer features (manual) |

## Skills

| Skill | What it does |
| --- | --- |
| `agent-device-qa` | Asks what to test and the expected outcome per scenario, picks devices, runs the setup doctor, opens pages, injects a non-throwing dataLayer logger, clicks, captures events and screenshots, then builds an Artifact report (device x scenario matrix, gaps, anomalies, setup guide) from `report-template.html`. |

## Scripts

All under `skills/agent-device-qa/scripts/`. Source the helpers under bash, not zsh.

| Script | What it does |
| --- | --- |
| `doctor.sh [android\|ios\|safari\|chrome\|iphone\|all]` | Read-only. Prints READY / NOT READY per device and the steps to run yourself. Never runs sudo. |
| `chrome.sh` | Mac Chrome (emulated widths): `cview`, `copen`, `clog`, `cclick`, `cev`, `cshot`. |
| `android.sh` | Real Android phone over adb and CDP: `asetup`, `aopen`, `atap`, `aev`, `aclear`, `ashot`, `aback`, `ab`. |
| `ios.sh` | iOS simulator through the proxy: `iboot`, `iopen`, `iresult`. |
| `safari.sh` | Mac Safari through the proxy: `sopen`, `sresult`. |
| `inject-proxy.mjs` | HTTP proxy in front of the dev server that injects `logger.js` and `runner.js` and appends results to `$OUT/results.jsonl`. |
| `logger.js` | dataLayer logger; set `window.__dlKeep` (event regex) or `window.__dlPanel = false` before injecting. |
| `runner.js` | Acts on proxy hash params (`t`, `wait`, `open`, `sel`, `click`, `n`, `again`, `tel`, `raw`). |

## Settings

| Variable | Default | Used by |
| --- | --- | --- |
| `OUT` | `${TMPDIR:-/tmp}/agent-device-qa` | all helpers, proxy |
| `APP_PORT` | `3000` | `chrome.sh`, `android.sh`, proxy target |
| `PROXY_PORT` | `3005` | `ios.sh`, `safari.sh`, proxy listen |
| `CDP_PORT` | `9333` | `android.sh` |
| `SIM_UDID` | booted simulator | `ios.sh` |
| `DEVELOPER_DIR` | `/Applications/Xcode.app/Contents/Developer` if present | `doctor.sh`, `ios.sh` |

## Usage

```bash
S=./mods/agent-device-qa/skills/agent-device-qa/scripts
bash $S/doctor.sh all
bash -c "source $S/chrome.sh; cview 375 812; copen /; clog; cclick '#buy'; cev; cshot c375-buy"
node $S/inject-proxy.mjs --listen 3005 --target 3000 &
bash -c "source $S/safari.sh; sopen / buy 'click=Buy'; sresult buy"
```

- Or ask in a session: "test this page on Android and iPhone and check the dataLayer events".
- tel: links are clicked with the default prevented (`tel=1`); payment steps are never completed.
- Local, dev or staging only; production is not opened in a browser unless you say so for that run.
