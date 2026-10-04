#!/usr/bin/env bash
# HOOKS · a compacted coordinator is sent back to its skill and its register
# SessionStart hook on compact. Compaction keeps only the opening of an invoked skill, and a fleet's
# state lives in its register's resume point; a register recording the compacted session's own id
# is what marks it a coordinator, every other session hearing nothing. Silent wherever it cannot read.

IFS= read -r -d '' payload || true

# A subagent is no coordinator whatever session id it carries: its brief, not the skill, is what
# it re-reads after a compaction.
[[ "$payload" =~ \"agent_id\"[[:space:]]*: ]] && exit 0
[[ "$payload" =~ \"source\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]] || exit 0
[[ "${BASH_REMATCH[1]}" == compact ]] || exit 0
# The id's own alphabet, checked before it reaches a pattern.
[[ "$payload" =~ \"session_id\"[[:space:]]*:[[:space:]]*\"([A-Za-z0-9_-]+)\" ]] || exit 0
id="${BASH_REMATCH[1]}"

registers=()
for register in "${HOME}"/.claude/plans/*/REGISTER-*.md; do
  [[ -f "$register" ]] || continue
  if grep -qE "^Coordinator session id: ${id}[[:space:]]*\$" "$register" </dev/null 2>/dev/null; then
    # Spelled from the home directory, which reads the same on every platform: Git Bash's own
    # spelling of an absolute path is one a Windows tool may not open.
    registers+=("~${register#"${HOME}"}")
  fi
done
(( ${#registers[@]} )) || exit 0

named="${registers[0]}"
for register in "${registers[@]:1}"; do named+=", and ${register}"; done

text="This session coordinates the fleet its register records, and it was just compacted, which keeps only the opening of the orchestration skill. Before your next action, invoke the orchestration skill again (/orchestration) to restore its whole text, then read the RESUME POINT in ${named}."
text="${text//\\/\\\\}"
text="${text//\"/\\\"}"

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$text"
exit 0
