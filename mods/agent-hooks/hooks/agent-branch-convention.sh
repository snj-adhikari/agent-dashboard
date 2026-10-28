#!/bin/sh
git rev-parse --git-dir > /dev/null 2>&1 || exit 0

branch=$(git branch --show-current 2>/dev/null)
[ -z "$branch" ] && exit 0

case "$branch" in
  main|master|develop|staging|release/*) exit 0 ;;
esac

if echo "$branch" | grep -qE '^(feat|fix)/[a-z]+-[0-9]+(-[a-z0-9]+)*$'; then
  exit 0
fi
if echo "$branch" | grep -qE '^(tech|env|refactor|ci|docs|chore|hotfix|release|porter)/[a-z0-9]+(-[a-z0-9]+)*$'; then
  exit 0
fi

type=$(echo "$branch" | cut -d/ -f1)
case "$type" in
  feat|fix)
    ticket=$(echo "$branch" | grep -oiE '[a-z]{2,6}-[0-9]+' | head -1 | tr 'A-Z' 'a-z')
    if [ -n "$ticket" ]; then
      echo "Branch \"$branch\" is type \"$type/\" but fails the repo's branch-name-lint CI check (expects $type/<ticket>-description, lowercase). Detected ticket: $ticket - confirm the correct format with the user before renaming."
    else
      echo "Branch \"$branch\" is type \"$type/\" which requires a ticket id (e.g. $type/mc-1234-description) per branch-name-lint CI, but none was found. Ask the user for the ticket before making changes."
    fi
    ;;
  *)
    echo "Branch \"$branch\" doesn't match the repo's branch-name-lint CI pattern (feat|fix require a ticket; tech|env|refactor|ci|docs|chore|hotfix|release|porter allow ticket or free kebab-case). Ask the user for the correct branch name before making changes."
    ;;
esac
