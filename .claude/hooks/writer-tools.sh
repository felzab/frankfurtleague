#!/usr/bin/env bash
# HOOKS · a writing or driving agent's MCP and Skill calls refused
# PreToolUse hook on every `mcp__*` tool and on Skill. The definitions deny both through
# `disallowedTools`, which the desktop app does not honour, so the refusal is made here, where every
# call passes. Exit 2 refuses with the reason on stderr; anything unreadable is let through.

IFS= read -r -d '' payload || true

# Matched before node starts: only an implementer's or a driving re-auditor's call can be refused.
case "$payload" in
  *implementer* | *driving-reauditor*) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0

rc=0
printf '%s' "$payload" | node -e '
let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return;
  }
  if (j.agent_type !== "implementer" && j.agent_type !== "driving-reauditor") return;
  const tool = String(j.tool_name || "");
  if (tool !== "Skill" && !tool.startsWith("mcp__")) return;
  process.stderr.write(
    "Refused by .claude/hooks/writer-tools.sh: " + j.agent_type + " holds no " + tool + ". Its definition denies every MCP tool " +
      "and the Skill tool: a browser call is the owner'"'"'s browser pass, never an agent'"'"'s, and a slash command is the coordinator'"'"'s.\n",
  );
  process.exitCode = 2;
});
' || rc=$?

# Only the refusal is passed on: a crash inside node is the unreadable case.
if [ "$rc" -eq 2 ]; then exit 2; fi
exit 0
