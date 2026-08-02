#!/usr/bin/env bash
#
# PreToolUse hook on Edit|Write|NotebookEdit — refuses a write while HEAD is `main`.
#
# WHY THIS IS A HOOK AND NOT A CLAUDE.md RULE:
#   `main` is protected and takes changes only through a PR, but nothing announces a mistake at the
#   moment it is made: `git checkout -b` carries the working tree over, so editing on `main` is free
#   and invisible right up until the push is rejected. CLAUDE.md states the rule; only a hook can
#   make it impossible to skip.
#
# CONTRACT: prints nothing and exits 0 on any branch but `main`. On `main` it prints the deny JSON
# the PreToolUse event understands, which stops the tool call before it writes.
#
# TARGET PLATFORM: any (Git Bash on Windows).

branch="$(git branch --show-current 2>/dev/null)"

if [ "$branch" = "main" ]; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: HEAD is main, which is protected and only takes changes through a PR. Create the topic branch BEFORE editing (CLAUDE.md 4) — any uncommitted work comes with you:  git checkout main && git pull --ff-only origin main && git checkout -b <short-kebab-name>"}}'
fi

exit 0
