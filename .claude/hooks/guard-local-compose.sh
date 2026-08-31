#!/usr/bin/env bash
# PreToolUse hook on Bash — refuses a compose INVOCATION unless a `-f` value names
# `docker-compose.local.yml`. With no `-f` compose reads `docker-compose.yml`, the PRODUCTION
# definition, and the two share a project name — so the bare command appears to work while
# operating a different stack.

cmd="$(node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try {
    process.stdout.write(JSON.parse(s).tool_input?.command || "");
  } catch {}
});
' 2>/dev/null)"

[ -n "$cmd" ] || exit 0

# Release-only early out: a command never spelling docker invokes no compose.
case "$cmd" in
  *docker*) ;;
  *) exit 0 ;;
esac

deny() {
  # The backticks are Markdown in the refusal copy, not substitution.
  # shellcheck disable=SC2016
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: a bare `docker compose` reads docker-compose.yml, the PRODUCTION definition. Local work goes through ./scripts/local.sh — `--down` to stop, `--fresh` to drop volumes, `--logs` to follow. If you genuinely need compose directly, pass -f docker-compose.local.yml."}}'
  exit 0
}

# Decided by word position, as guard-branch-bash.sh decides: a mention in a grep or a heredoc buys
# neither refusal nor release. A command position is the start or the far side of a separator, a
# substitution opening one too.
segments="${cmd//&&/$'\n'}"
segments="${segments//"||"/$'\n'}"
segments="${segments//;/$'\n'}"
segments="${segments//|/$'\n'}"
segments="${segments//&/$'\n'}"
segments="${segments//\(/$'\n'}"
segments="${segments//\`/$'\n'}"

while IFS= read -r seg; do
  # Quotes are removed, not split on: neither half of a quoted token is a program or a file name.
  seg="${seg//\"/}"
  seg="${seg//"'"/}"
  read -ra words <<<"$seg"
  i=0
  # A leading environment assignment or sudo leaves the program the same program.
  while [ "$i" -lt "${#words[@]}" ]; do
    case "${words[$i]}" in
      sudo) i=$((i + 1)) ;;
      [A-Za-z_]*=*) i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "${#words[@]}" ] || continue
  prog="${words[$i]##*/}"
  prog="${prog%.exe}"
  if [ "$prog" = "docker" ] && [ "${words[$((i + 1))]:-}" = "compose" ]; then
    i=$((i + 2))
  elif [ "$prog" = "docker-compose" ]; then
    i=$((i + 1))
  else
    continue
  fi
  # Only a `-f` value is the file compose reads. The name anywhere else — a comment, an unrelated
  # argument — is a mention, and releasing on one would let a production invocation through.
  local_named=0
  while [ "$i" -lt "${#words[@]}" ]; do
    value=""
    case "${words[$i]}" in
      -f | --file)
        value="${words[$((i + 1))]:-}"
        i=$((i + 1))
        ;;
      -f=* | --file=*) value="${words[$i]#*=}" ;;
    esac
    case "${value##*/}" in
      docker-compose.local.yml) local_named=1 ;;
    esac
    i=$((i + 1))
  done
  [ "$local_named" = "1" ] || deny
done <<<"$segments"

exit 0
