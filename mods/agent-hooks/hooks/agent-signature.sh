#!/usr/bin/env bash
set -uo pipefail
# PreToolUse: blocks skipped commit signing; with AGENT_SIGNATURE set, commits get it as a trailer and PR bodies swap Signed-off-by for it.

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
MARK="${AGENT_SIGNATURE:-}"

if [[ "$command" =~ (^|[[:space:];\&\|])git[[:space:]] ]] && \
   [[ "$command" =~ (--no-gpg-sign|--no-verify|gpgsign=(false|0|no|off)|--no-post-rewrite)|(git[[:space:]]+commit[^;\&\|]*[[:space:]]-[a-zA-Z]*n[a-zA-Z]*([[:space:]]|$)) ]]; then
  jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"Blocked: never skip commit signing or verification (--no-gpg-sign, --no-verify, -n, commit.gpgsign=false). Fix the signing/hook failure instead."}}'
  exit 0
fi

[[ -n "$MARK" ]] || exit 0

GIT_LEAD='^[[:space:]]*(cd[[:space:]]+[^;&|]+&&[[:space:]]*)?git[[:space:]]'
if [[ "$command" =~ $GIT_LEAD && "$command" =~ git[[:space:]]+commit([[:space:]]|$) && "$command" != *"$MARK"* ]]; then
  new="${command/git commit/git commit --trailer '$MARK'}"
  jq -n --arg c "$new" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:{command:$c}}}'
  exit 0
fi

if [[ "$command" =~ gh[[:space:]]+pr[[:space:]]+(create|edit) ]]; then
  file=$(printf '%s' "$command" | sed -nE 's/.*(--body-file|-F)[ =]+"?([^" ]+)"?.*/\2/p' | head -1)
  file="${file/#\~/$HOME}"
  [[ -n "$file" && -f "$file" ]] && sed -i '' '/^Signed-off-by:/d' "$file"
  if [[ -n "$file" && -f "$file" ]] && ! tail -n 3 "$file" | grep -qF "$MARK"; then
    printf '\n%s\n' "$MARK" >> "$file"
  fi
fi
exit 0
