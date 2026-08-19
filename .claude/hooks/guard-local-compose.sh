#!/usr/bin/env bash
# PreToolUse hook on Bash — refuses a compose invocation that does not name `docker-compose.local.yml`.
# With no `-f` compose reads `docker-compose.yml`, the PRODUCTION definition, and the two share a
# project name — so the bare command appears to work while operating a different stack.

cmd="$(node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try {
    process.stdout.write(JSON.parse(s).tool_input?.command || "");
  } catch {}
});
' 2>/dev/null)"

[ -n "$cmd" ] || exit 0

# Only compose invocations are in scope — `docker ps`, `docker build` and friends are fine.
case "$cmd" in
  *"docker compose"* | *"docker-compose "*) ;;
  *) exit 0 ;;
esac

# Naming the local file anywhere in the command is the thing that makes it correct.
case "$cmd" in
  *docker-compose.local.yml*) exit 0 ;;
esac

# The backticks are Markdown in the refusal copy, not substitution.
# shellcheck disable=SC2016
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: a bare `docker compose` reads docker-compose.yml, the PRODUCTION definition. Local work goes through ./scripts/local.sh — `--down` to stop, `--fresh` to drop volumes, `--logs` to follow. If you genuinely need compose directly, pass -f docker-compose.local.yml."}}'

exit 0
