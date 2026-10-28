#!/usr/bin/env bash
set -uo pipefail
# PreToolUse guard: deny Claude/AI attribution in commits and PR/issue titles, bodies and comments.

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)

[[ "$command" =~ (gh[[:space:]]+(pr|issue)[[:space:]]+(create|edit|comment|review)|gh[[:space:]]+api|git[[:space:]]+commit) ]] || exit 0

if printf '%s' "$command" | grep -qiE 'generated with .*claude|co-authored-by:.*(claude|anthropic)|claude\.(ai|com)/code|claude code|noreply@anthropic\.com|🤖'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "No Claude/Anthropic attribution in commits or PR/issue titles, bodies or comments. Retry without it."
    }
  }'
fi
exit 0
