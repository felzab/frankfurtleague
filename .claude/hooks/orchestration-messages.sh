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
status=$?

# reg.py tells of its own failures; uv refusing to start it, a `required-version` this uv does not
# meet among them, reaches none of its lines, so the status is read here. Still exit 0: the send went.
if (( status != 0 )); then
  [[ "$payload" =~ \"agent_id\"[[:space:]]*: ]] && exit 0
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}' \
    "The messages hook's uv run exited ${status}, so this message is in no messages file; uv's error is on the hook's stderr."
fi
exit 0
