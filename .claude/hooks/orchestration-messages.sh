#!/usr/bin/env bash
# HOOKS · a coordinator's sent message recorded in its agent's messages file
# PostToolUse hook on SendMessage. An order appended to a messages file by hand, its send forgotten,
# never reached its agent; recorded from the send itself, the file holds exactly what was sent. The
# work, and every judgement of the payload, is `.claude/skills/orchestration/tools/reg.py :: record`.

IFS= read -r -d '' payload || true

# Without uv nothing can record, and nothing can say so either: the coordinator's check of its first
# send (`SKILL.md`, every dispatch) is what catches it.
command -v uv >/dev/null 2>&1 || exit 0

here="${BASH_SOURCE[0]%/*}"
[[ "$here" == "${BASH_SOURCE[0]}" ]] && here=.
root="$(cd "${here}/../.." && pwd)"

printf '%s' "$payload" | uv run --quiet --project "${root}/fl_backend" --frozen python \
  "${root}/.claude/skills/orchestration/tools/reg.py" message "${HOME}/.claude/plans"
exit 0
