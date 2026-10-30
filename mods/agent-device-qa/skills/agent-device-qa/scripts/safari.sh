#!/usr/bin/env bash
# source under bash (proxy running): sopen <path> <tag> [hash-params], sresult <tag>
: "${OUT:=${TMPDIR:-/tmp}/agent-device-qa}" "${PROXY_PORT:=3005}"
export OUT PROXY_PORT
mkdir -p "$OUT"

_stagcount() { [ -f "$OUT/results.jsonl" ] && jq -cR --arg t "$1" 'fromjson? | select(.tag == $t)' "$OUT/results.jsonl" | wc -l | tr -d ' ' || echo 0; }
sresult() { [ -f "$OUT/results.jsonl" ] && jq -cR --arg t "$1" 'fromjson? | select(.tag == $t)' "$OUT/results.jsonl" | tail -1; }
sopen() {
  local sep='?' url before wid i
  [[ "$1" == *\?* ]] && sep='&'
  url="http://localhost:$PROXY_PORT$1${sep}r=$RANDOM#t=$2${3:+&$3}"
  before=$(_stagcount "$2")
  open -g -a Safari "$url"
  for ((i = 0; i < 60; i++)); do [ "$(_stagcount "$2")" -gt "$before" ] && break; sleep 2; done
  [ "$i" -eq 60 ] && echo "no result for $2 after 120 s"
  wid=$(timeout 10 osascript -e 'tell application "Safari" to id of front window' 2>/dev/null)
  if [ -n "$wid" ] && screencapture -x -o -l "$wid" "$OUT/$2.png" 2>/dev/null; then echo "$OUT/$2.png"; else echo "no screenshot (window in Stage Manager?)"; fi
  sresult "$2"
}
