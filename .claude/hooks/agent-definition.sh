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

# Factual statements rather than instructions, as the hooks documentation asks of additionalContext.
text="This agent's standing definition is the file .claude/agents/${type}.md as it is on disk now. Where that file differs from the definition this agent started with, the file binds."
printf '{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"%s"}}' "$text"
exit 0
