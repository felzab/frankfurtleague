#!/usr/bin/env bash
#
# PreToolUse hook on Bash — refuses a bare `docker compose` for local work.
#
# WHY THIS IS A HOOK:
#   `docker compose` with no `-f` reads `docker-compose.yml`, which is the PRODUCTION definition.
#   Local work belongs to `docker-compose.local.yml`, driven through `./scripts/local.sh`. The two
#   share a project name, so a bare command appears to work while operating a different stack —
#   there is no error to notice.
#
# CONTRACT: prints nothing and exits 0 unless the command invokes compose without naming the local
# file. `./scripts/local.sh` runs compose internally, in its own process, and is unaffected.
#
# TARGET PLATFORM: any (Git Bash on Windows). node rather than jq — jq is not installed here.

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

printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: a bare `docker compose` reads docker-compose.yml, the PRODUCTION definition. Local work goes through ./scripts/local.sh — `--down` to stop, `--fresh` to drop volumes, `--logs` to follow. If you genuinely need compose directly, pass -f docker-compose.local.yml."}}'

exit 0
