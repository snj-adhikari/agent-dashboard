#!/usr/bin/env bash
# source under bash (proxy running): iboot [device name], iopen <path> <tag> [hash-params], iresult <tag>
if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app/Contents/Developer ]; then export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer; fi
: "${OUT:=${TMPDIR:-/tmp}/agent-device-qa}" "${PROXY_PORT:=3005}"
export OUT PROXY_PORT
mkdir -p "$OUT"

_booted() { timeout 30 xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1; }
_tagcount() { [ -f "$OUT/results.jsonl" ] && jq -cR --arg t "$1" 'fromjson? | select(.tag == $t)' "$OUT/results.jsonl" | wc -l | tr -d ' ' || echo 0; }
_waittag() {
  local before="$2" i
  for ((i = 0; i < 60; i++)); do [ "$(_tagcount "$1")" -gt "$before" ] && return 0; sleep 2; done
  echo "no result for $1 after 120 s"; return 1
}

iboot() {
  local line u
  line=$(timeout 30 xcrun simctl list devices available | grep -F "${1:-iPhone}" | head -1)
  u=$(grep -oE '[0-9A-F-]{36}' <<<"$line")
  [ -z "$u" ] && { echo "no simulator matching '${1:-iPhone}'"; return 1; }
  timeout 60 xcrun simctl boot "$u" 2>/dev/null
  open -a Simulator
  timeout 180 xcrun simctl bootstatus "$u" -b >/dev/null && export SIM_UDID="$u" && echo "booted $line"
}
iresult() { [ -f "$OUT/results.jsonl" ] && jq -cR --arg t "$1" 'fromjson? | select(.tag == $t)' "$OUT/results.jsonl" | tail -1; }
iopen() {
  local u="${SIM_UDID:-$(_booted)}" sep='?' url before
  [ -z "$u" ] && { echo "no booted simulator: run iboot"; return 1; }
  [[ "$1" == *\?* ]] && sep='&'
  url="http://localhost:$PROXY_PORT$1${sep}r=$RANDOM#t=$2${3:+&$3}"
  before=$(_tagcount "$2")
  timeout 30 xcrun simctl openurl "$u" "$url" || { echo "openurl timed out, retrying"; timeout 60 xcrun simctl openurl "$u" "$url"; }
  _waittag "$2" "$before" && sleep 1
  timeout 30 xcrun simctl io "$u" screenshot "$OUT/$2.png" >/dev/null 2>&1 && echo "$OUT/$2.png"
  iresult "$2"
}
