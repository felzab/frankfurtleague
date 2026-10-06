#!/usr/bin/env bash
# HOOKS · a spawned or resumed agent is told its definition file binds as it is on disk
# SubagentStart hook. The desktop app can hand an agent the definition text its session read at
# launch, and a resumed agent keeps the text it started with; this hook runs on both, and the file on
# disk is the definition that binds. Silent for an agent with no definition file, or unreadable input.

IFS= read -r -d '' payload || true

# The type's own alphabet, checked before it reaches a path.
[[ "$payload" =~ \"agent_type\"[[:space:]]*:[[:space:]]*\"([A-Za-z0-9_-]+)\" ]] || exit 0
type="${BASH_REMATCH[1]}"

here="${BASH_SOURCE[0]%/*}"
[[ "$here" == "${BASH_SOURCE[0]}" ]] && here=.
[[ -f "${here}/../agents/${type}.md" ]] || exit 0

# The path is absolute: a relative one resolves inside the agent's worktree, whose copy is as old as
# its fork, and agents resumed after a definition changed read that stale copy as current.
definition="${CLAUDE_PROJECT_DIR:-$(cd "${here}/../.." && pwd)}/.claude/agents/${type}.md"

# Factual statements rather than instructions, as the hooks documentation asks of additionalContext.
text="This agent's standing definition is the file ${definition} as it is on disk now; a copy of .claude/agents/${type}.md inside the agent's own worktree can be older. Where that file differs from the definition this agent started with, the file binds."
text="${text//\\/\\\\}"
text="${text//\"/\\\"}"
printf '{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"%s"}}' "$text"
exit 0
