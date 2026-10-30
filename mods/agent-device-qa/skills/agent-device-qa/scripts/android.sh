#!/usr/bin/env bash
# source under bash: ab, asetup, aopen <path>, alog, atap <text-regex> [n], aev, aclear, ashot <name>, afocus, aback
ADQ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${OUT:=${TMPDIR:-/tmp}/agent-device-qa}" "${APP_PORT:=3000}" "${CDP_PORT:=9333}"
export OUT APP_PORT CDP_PORT
mkdir -p "$OUT"

ab() { AGENT_BROWSER_SESSION=android timeout 120 agent-browser --cdp "$CDP_PORT" "$@"; }
asetup() { timeout 20 adb reverse "tcp:$APP_PORT" "tcp:$APP_PORT" && timeout 20 adb forward "tcp:$CDP_PORT" localabstract:chrome_devtools_remote; }
aopen() { ab open "http://localhost:$APP_PORT$1" | tail -1; ab wait 3000 >/dev/null; alog; }
alog() { ab eval --stdin < "$ADQ_DIR/logger.js"; }
aev() { ab eval "JSON.stringify((window.__dl||[]).map(e=>e.ev+(e.body?' '+e.body:'')))"; }
aclear() { ab eval "window.__dl&&(window.__dl.length=0)" >/dev/null; }

_wvtop() {
  timeout 20 adb shell uiautomator dump /sdcard/adq-ui.xml >/dev/null 2>&1
  timeout 20 adb shell cat /sdcard/adq-ui.xml | grep -oE 'class="android.webkit.WebView"[^>]*bounds="\[0,[0-9]+' | grep -oE '[0-9]+$' | head -1
}
_apos() {
  local re; re=$(jq -n --arg r "$1" '$r')
  ab eval "(()=>{const re=new RegExp($re,'i');const b=[...document.querySelectorAll('button,a,[role=button]')].find(e=>e.getBoundingClientRect().height>0&&re.test(e.innerText||''));if(!b)return 'none';b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return Math.round((r.x+r.width/2)*devicePixelRatio)+' '+Math.round((r.y+r.height/2)*devicePixelRatio)})()" | tr -d '"'
}
atap() {
  local p x y t i n="${2:-1}"
  p=$(_apos "$1")
  case "$p" in ''|none) echo "no visible element /$1/"; return 1 ;; esac
  read -r x y <<<"$p"
  t=$(_wvtop); t=${t:-0}
  for ((i = 0; i < n; i++)); do timeout 20 adb shell input tap "$x" $((y + t)); done
  echo "tapped $x,$((y + t)) x$n"
}
ashot() { timeout 30 adb exec-out screencap -p > "$OUT/$1.png" && sips -Z 1200 "$OUT/$1.png" >/dev/null && echo "$OUT/$1.png"; }
afocus() { timeout 20 adb shell dumpsys window | grep -m1 mCurrentFocus | grep -oE '[a-z.]+/[A-Za-z.]+'; }
aback() { afocus | grep -q chrome || { timeout 20 adb shell input keyevent KEYCODE_BACK; sleep 1; }; }
