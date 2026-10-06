#!/usr/bin/env bash
# HOOKS · a coordinator's sent message recorded in its agent's messages file
# PostToolUse hook on SendMessage. An order appended to a messages file by hand, its send forgotten,
# never reached its agent; recorded from the send itself, the file holds exactly what was sent. The
# work is `.claude/skills/orchestration/tools/reg.py :: record`; silent wherever it cannot run.

IFS= read -r -d '' payload || true

# A subagent's send goes to the coordinator, whose inbox has no file: answered before uv starts.
[[ "$payload" =~ \"agent_id\"[[:space:]]*: ]] && exit 0
command -v uv >/dev/null 2>&1 || exit 0

here="${BASH_SOURCE[0]%/*}"
[[ "$here" == "${BASH_SOURCE[0]}" ]] && here=.
root="$(cd "${here}/../.." && pwd)"

printf '%s' "$payload" | uv run --quiet --project "${root}/fl_backend" --frozen python \
  "${root}/.claude/skills/orchestration/tools/reg.py" message "${HOME}/.claude/plans" 2>/dev/null
exit 0
