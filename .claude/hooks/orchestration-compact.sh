#!/usr/bin/env bash
# HOOKS · a compacted coordinator is told where its fleet's state lives
# SessionStart hook on compact. A fleet's state lives in its register's resume point, which a summary
# may not carry; a register recording the compacted session's own id is what marks it a coordinator,
# every other session hearing nothing. Silent wherever it cannot read.

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

# Factual statements rather than instructions, as the hooks documentation asks of additionalContext.

# Compaction is documented to re-attach a skill's latest invocation, yet a coordinator that
# re-invoked the edited skill got its first copy back: the file on disk is named as the current core.
text="This session coordinates the agent fleet recorded in ${named}. Its orchestration core is .claude/skills/orchestration/SKILL.md as it is on disk; a copy of the skill re-attached after a compaction can be older than that file. Its resume point is in that register."
text="${text//\\/\\\\}"
text="${text//\"/\\\"}"

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$text"
exit 0
