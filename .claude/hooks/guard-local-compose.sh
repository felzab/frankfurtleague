#!/usr/bin/env bash
# PreToolUse hook on Bash and PowerShell — refuses a compose subcommand that would create, start,
# stop or enter a container while the PRODUCTION definition is what compose reads. With no `-f`
# naming `docker-compose.local.yml` compose reads `docker-compose.yml`, whose `env_file` is
# `./fl_backend/.env` — so the stack comes up wired to the production database, and the two files
# share a project name, which is what makes the bare command look like it worked.
#
# A subcommand that only reads or renders cannot do that and is released against either file, which
# is what lets a checker render both definitions. An unrecognised subcommand refuses: the list below
# is closed, and a compose release adding a verb must not open a hole by doing so.

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
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this compose subcommand creates, starts, stops or enters a container, and with no -f naming docker-compose.local.yml it reads docker-compose.yml — the PRODUCTION definition, whose env_file is ./fl_backend/.env. The stack would come up wired to the production database. Local work goes through ./scripts/local.sh — `--down` to stop, `--fresh` to drop volumes, `--logs` to follow; pass -f docker-compose.local.yml to drive compose directly. Reading is already allowed against either file: config, ps, logs, images, ls, port, top, stats, events, volumes and version all run unrefused. A subcommand this hook does not recognise refuses rather than guessing."}}'
  exit 0
}

# Subcommands that read or render and mutate nothing. Closed, and short by design: everything a
# release adds refuses until someone reads its flags. `wait` is absent because --down-project drops
# the project, which is the whole hazard spelled as a wait.
READS=" config events images logs ls port ps stats top version volumes "

# Decided by word position, as guard-branch-bash.sh decides: a mention in a grep or a heredoc buys
# neither refusal nor release. A command position is the start or the far side of a separator, a
# group or a substitution.
segments=""
quote=""
index=0
# Only outside quotes, where the shell reads a separator as one: in `grep "a\|b"` it does not.
while [ "$index" -lt "${#cmd}" ]; do
  char="${cmd:index:1}"
  if [ -n "$quote" ]; then
    [ "$char" = "$quote" ] && quote=""
  else
    case "$char" in
      '"' | "'") quote="$char" ;;
      ';' | '|' | '&' | '(' | ')' | '{' | '}' | '`') char=$'\n' ;;
    esac
  fi
  segments="${segments}${char}"
  index=$((index + 1))
done

while IFS= read -r seg; do
  # Quotes are removed, not split on: neither half of a quoted token is a program or a file name.
  seg="${seg//\"/}"
  seg="${seg//"'"/}"
  read -ra words <<<"$seg"
  i=0
  # A leading environment assignment, sudo or env leaves the program the same program. A flag on
  # any of them is not skipped, so `sudo -u x docker compose up` reads as the program -u.
  while [ "$i" -lt "${#words[@]}" ]; do
    case "${words[$i]}" in
      sudo | env) i=$((i + 1)) ;;
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
  # The subcommand is the earliest word that is neither a global option nor a value bound to one.
  subcommand=""
  while [ "$i" -lt "${#words[@]}" ]; do
    word="${words[$i]}"
    value=""
    case "$word" in
      -f | --file)
        value="${words[$((i + 1))]:-}"
        i=$((i + 1))
        ;;
      -f=* | --file=*) value="${word#*=}" ;;
      # Every other global option taking a value, read off `docker compose --help` rather than
      # recalled: its value is not a subcommand, and reading one as such would release the real one.
      -p | --project-name | --ansi | --env-file | --parallel | --profile | --progress | \
        --project-directory) i=$((i + 1)) ;;
      -*) ;;
      *) [ -n "$subcommand" ] || subcommand="$word" ;;
    esac
    # Ahead of the subcommand only: compose reads a global option there, and behind it the token is
    # an argument of the subcommand — which `exec db sh -f <local>` would otherwise spell as consent.
    case "${value##*/}" in
      docker-compose.local.yml) [ -n "$subcommand" ] || local_named=1 ;;
    esac
    i=$((i + 1))
  done
  # The local file is the developer's own stack, so what is run against it is their business.
  [ "$local_named" = "1" ] && continue
  # Compose acts only through a subcommand, so an invocation naming none — `docker compose`,
  # `docker compose --help` — starts nothing and is released with the reads.
  [ -n "$subcommand" ] || continue
  case "$READS" in
    *" $subcommand "*) continue ;;
  esac
  deny
done <<<"$segments"

exit 0
