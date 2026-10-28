#!/usr/bin/env bash
set -uo pipefail
# PreToolUse guard: deny Write/Edit/Bash adding a comment block over the per-language line limit (scans only the added text, fails open on anything it can't parse).

input=$(cat)
tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)

case "$tool_name" in
  Write) file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
         text=$(printf '%s' "$input" | jq -r '.tool_input.content // empty' 2>/dev/null) ;;
  Edit)  file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
         text=$(printf '%s' "$input" | jq -r '.tool_input.new_string // empty' 2>/dev/null) ;;
  Bash)  text=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
         cmd_only=$(printf '%s' "$text" | awk '
           skip { l=$0; if (dash) sub(/^\t+/,"",l); if (l==term) skip=0; next }
           { print
             if (match($0,/<<-?[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?/)) {
               seg=substr($0,RSTART,RLENGTH)
               dash=(seg ~ /^<<-/)
               term=seg; sub(/^<<-?/,"",term); gsub(/["'"'"'[:space:]]/,"",term)
               skip=1
             }
           }')
         file_path=$(printf '%s' "$cmd_only" | grep -oE '[^[:space:]>]+\.(ts|tsx|js|jsx|jsonc|php|java|go|c|cpp|cs|py|rb|sh|yml|yaml|tf|tfvars|json|css|scss|sass|less)\b' | tail -1) ;;
  *) exit 0 ;;
esac

[[ -n "$text" ]] || exit 0

case "$file_path" in
  *.css|*.scss|*.sass|*.less)
    if grep -nE '/\*|^[[:space:]]*//' <<<"$text" >/dev/null; then
      jq -n --arg r "Comment style: ${file_path} is a style file; never add comments in CSS/SCSS. Put any reasoning in the PR body." '{
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r }
      }'
    fi
    exit 0 ;;
esac

case "$file_path" in
  *.json) exit 0 ;;
  *.ts|*.tsx|*.js|*.jsx|*.jsonc|*.php|*.java|*.go|*.c|*.cpp|*.cs) token='//'; max=1 ;;
  *.py|*.rb|*.sh|*.yml|*.yaml) token='#'; max=3 ;;
  *.tf|*.tfvars) token='#|//'; max=1 ;;
  *) exit 0 ;;
esac

violation=$(awk -v tok="$token" -v max="$max" '
  BEGIN {
    pat = "^[[:space:]]*(" tok ")"
    directive = "^[[:space:]]*///[[:space:]]*<(reference|amd-)"
    shebang = "^#!"
    sep = "^[[:space:]]*(#|//)[[:space:]]*[-=_~*]+[-=_~*[:space:]]*$"
  }
  {
    if ($0 ~ shebang || $0 ~ directive || $0 ~ sep) { if (n>max) { print start":"last } n=0; next }
    if ($0 ~ pat) { n++; if (n==1) start=NR; last=NR }
    else { if (n>max) { print start":"last } n=0 }
  }
  END { if (n>max) print start":"last }
' <<<"$text")

[[ -n "$violation" ]] || exit 0

reason="Comment style: ${file_path} has a comment block of more than ${max} line(s) (lines ${violation} of the added text) using ${token//|/ or }. Use the language's real block-comment syntax if genuinely longer, or prefer no comment."

jq -n --arg r "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $r
  }
}'
exit 0
