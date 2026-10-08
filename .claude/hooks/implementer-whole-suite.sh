#!/usr/bin/env bash
# HOOKS · an implementer's whole suite, gate run or local stack, refused before it starts
# PreToolUse hook on Bash, Monitor and PowerShell. CI runs every scope over the combined head once a
# batch lands, so an implementer's whole run repeats it on a machine the fleet shares and slows every
# other agent's checks. Exit 2 refuses with the reason on stderr; anything unreadable is let through,
# since a miss costs time where a false refusal costs the agent a check it needs.

# The builtin rather than `cat`: a probe runs this with no PATH, to show it lets the call through
# when node is missing.
IFS= read -r -d '' payload || true

# Matched before node starts: every shell call of every session pays for this hook, and only an
# implementer's can be refused.
case "$payload" in
  *implementer*) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0

# The reader sits beside this script, found from its own path since the harness runs it from any
# directory.
here="${BASH_SOURCE[0]%/*}"
[[ "$here" == "${BASH_SOURCE[0]}" ]] && here=.
rc=0
printf '%s' "$payload" | node "${here}/implementer-whole-suite.mjs" || rc=$?

# Only the refusal is passed on: a crash inside node is the unreadable case, and a PreToolUse exit
# other than 2 would surface as a hook error on a call this hook has no reason to stop.
if [ "$rc" -eq 2 ]; then exit 2; fi
exit 0
