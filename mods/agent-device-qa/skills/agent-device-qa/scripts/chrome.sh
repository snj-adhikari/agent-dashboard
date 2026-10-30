#!/usr/bin/env bash
# source under bash: cview <w> <h>, copen <path|url>, clog, cclick <selector>, cev, cshot <name>
ADQ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${OUT:=${TMPDIR:-/tmp}/agent-device-qa}" "${APP_PORT:=3000}"
export OUT APP_PORT
mkdir -p "$OUT"

cb() { AGENT_BROWSER_SESSION=chrome timeout 120 agent-browser "$@"; }
cview() { cb set viewport "$1" "$2"; }
copen() { local u="$1"; [[ "$u" == http* ]] || u="http://localhost:$APP_PORT$u"; cb open "$u" | tail -1; cb wait 2000 >/dev/null; }
clog() { cb eval --stdin < "$ADQ_DIR/logger.js"; }
cclick() { local s; s=$(jq -n --arg s "$1" '$s'); cb eval "(()=>{const e=document.querySelector($s);if(!e)return 'none';e.scrollIntoView({block:'center'});e.click();return 'clicked'})()"; }
cev() { cb eval "JSON.stringify((window.__dl||[]).map(e=>e.ev+(e.body?' '+e.body:'')))"; }
cshot() { cb screenshot "$OUT/$1.png" >/dev/null && echo "$OUT/$1.png"; }
