#!/usr/bin/env bash
# HOOKS · a coordinator's sent message recorded in its agent's messages file
# PostToolUse hook on SendMessage. An order appended to a messages file by hand, its send forgotten,
# never reached its agent; recorded from the send itself, the file holds exactly what was sent. The
# work, and every judgement of the payload, is `.claude/skills/orchestration/tools/reg.py :: record`.

IFS= read -r -d '' payload || true

# Without uv nothing records, so the coordinator is told; a subagent's send, which records nothing
# anyway, stays silent.
if ! command -v uv >/dev/null 2>&1; then
  [[ "$payload" =~ \"agent_id\"[[:space:]]*: ]] && exit 0
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}' \
    "The messages hook found no uv, so this message is in no messages file."
  exit 0
fi

here="${BASH_SOURCE[0]%/*}"
[[ "$here" == "${BASH_SOURCE[0]}" ]] && here=.
root="$(cd "${here}/../.." && pwd)"

printf '%s' "$payload" | uv run --quiet --project "${root}/fl_backend" --frozen python \
  "${root}/.claude/skills/orchestration/tools/reg.py" message "${HOME}/.claude/plans"
exit 0
