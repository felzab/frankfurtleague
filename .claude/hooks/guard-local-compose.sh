#!/usr/bin/env bash
# PreToolUse hook on Bash and PowerShell — refuses a compose subcommand that would create, start,
# stop or enter a container while the PRODUCTION definition is what compose reads. With no `-f`
# naming `docker-compose.local.yml` compose reads `docker-compose.yml`, whose `env_file` is
# `./fl_backend/.env` — so the stack comes up wired to the production database, and the two files
# share a project name, which is what makes the bare command look like it worked.
#
# `config` refuses against EITHER file. At compose v5.4.0 it resolves every `env_file` into the
# rendered `environment:` block, so it prints `.env` to stdout, and `-o` saves that rendering to any
# path. That is disclosure, not operation, and consent to the local stack was never consent to it.
#
# A subcommand that only reads is released against either file. An unrecognised subcommand refuses:
# the list below is closed, and a compose release adding a verb must not open a hole by doing so. A
# segment naming docker whose PROGRAM this hook cannot place refuses on the same ground — an
# unrecognised leading word means "cannot tell", never "not docker". A segment FED by a pipe, a
# heredoc or a redirection refuses on it too unless its program can run neither an argument nor its
# input: the invocation then arrives in text this payload never carries.

deny() {
  # The backticks are Markdown in the refusal copy, not substitution.
  # shellcheck disable=SC2016
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this compose subcommand creates, starts, stops or enters a container, and with no -f naming docker-compose.local.yml it reads docker-compose.yml — the PRODUCTION definition, whose env_file is ./fl_backend/.env. The stack would come up wired to the production database. Local work goes through ./scripts/local.sh — `--down` to stop, `--fresh` to drop volumes, `--logs` to follow; to drive compose directly pass -f docker-compose.local.yml, spelled bare or as ./docker-compose.local.yml, and name no other file beside it. Reading is already allowed against either file: ps, logs, images, ls, port, top, stats, events, volumes and version all run unrefused. This hook refuses rather than guessing whenever it cannot read the command — an unrecognised subcommand, a program name it cannot place, a program handed its input by a pipe, a heredoc or a redirection, a substitution, or a payload it could not parse."}}'
  exit 0
}

deny_config() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: docker compose config resolves every env_file into the rendered environment block, so it prints ./fl_backend/.env and ./fl_frontend/.env to stdout — credential material this project never reads, echoes, renders or diffs (CLAUDE.md section 1). It also writes: -o saves that rendering to any path and --lock-image-digests produces an override file. It refuses against docker-compose.local.yml too, which carries the same env_file lines, so naming the local file does not release it. To see a definition, read the YAML itself."}}'
  exit 0
}

# The command string, out of the tool payload. A payload node could not read — or could not run at
# all — is a question nobody answered, so it refuses: this guard fronts the production database.
cmd="$(node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let p;
  try {
    p = JSON.parse(s);
  } catch {
    process.exit(1);
  }
  if (p === null || typeof p !== "object") process.exit(1);
  const c = p.tool_input ? p.tool_input.command : undefined;
  if (typeof c !== "string") process.exit(1);
  process.stdout.write(c);
});
' 2>/dev/null)"
read_status=$?

# An empty command is a real answer: there is nothing to guard.
[ "$read_status" -eq 0 ] || deny
[ -n "$cmd" ] || exit 0

# Release-only early out, read off a string the shell's own escaping has come off: `doc"ker"` and
# `\docker` both run docker, and testing the raw payload reads neither as the word. Case-folded
# with it: the dev machine is Windows, where `DOCKER compose` runs.
bare="${cmd//\"/}"
bare="${bare//\'/}"
bare="${bare//\\/}"
bare="${bare,,}"
case "$bare" in
  *docker*) ;;
  *) exit 0 ;;
esac

# A substitution spells any program and any file name, so a docker-naming command carrying one is a
# question this hook cannot answer.
# shellcheck disable=SC2016  # both openers are literals here, never expanded
case "$cmd" in
  *'$('* | *'`'*) deny ;;
esac

# A heredoc body is data the shell never runs, and it comes off before the scan because its lines
# would otherwise read as commands — a document quoting this very rule would refuse itself.
heredoc_start='(^|[^<])<<-?[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)'
scan=""
delimiter=""
in_body=0
while IFS= read -r line; do
  if [ "$in_body" = "1" ]; then
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [ "$trimmed" = "$delimiter" ] && in_body=0
    continue
  fi
  scan="${scan}${line}"$'\n'
  # Quotes come off for the test alone: `<<'EOF'` and `<<EOF` open the same body.
  probe="${line//\"/}"
  probe="${probe//\'/}"
  probe="${probe//\\/}"
  if [[ "$probe" =~ $heredoc_start ]]; then
    delimiter="${BASH_REMATCH[2]}"
    in_body=1
  fi
done <<<"$cmd"
[ -n "$scan" ] || scan="$cmd"

# Decided by word position, as guard-branch-bash.sh decides: a mention in a grep or a comment buys
# neither refusal nor release. Quotes and unquoted backslashes come off here too, so a program name
# spelt across them is one word again.
segments=""
quote=""
comment=0
prev=""
index=0
while [ "$index" -lt "${#scan}" ]; do
  raw="${scan:index:1}"
  char="$raw"
  if [ "$comment" = "1" ]; then
    if [ "$raw" = $'\n' ]; then comment=0; else char=""; fi
  elif [ -n "$quote" ]; then
    [ "$raw" = "$quote" ] && { quote=""; char=""; }
  else
    case "$raw" in
      '"' | "'") quote="$raw"; char="" ;;
      # A `#` opens a comment only where a word opens, which is what keeps `a#b` a word.
      '#') case "$prev" in "" | " " | $'\t' | $'\n') comment=1; char="" ;; esac ;;
      \\) char="" ;;
      # A pipe hands the NEXT segment its input, so \001 opens that segment: `|&` pipes
      # as well, while `||` separates like the rest and marks nothing.
      '|')
        if [ "${scan:index+1:1}" = '|' ] || [ "$prev" = '|' ]; then
          char=$'\n'
        else
          char=$'\n\001 '
        fi
        ;;
      '&') if [ "$prev" = '|' ]; then char=""; else char=$'\n'; fi ;;
      ';' | '(' | ')' | '{' | '}' | '`') char=$'\n' ;;
    esac
  fi
  segments="${segments}${char}"
  prev="$raw"
  index=$((index + 1))
done

# Words leaving the program the same program. Their own flags and operands stand between them and
# it, so the program is the next docker word rather than the next word: `sudo -u root docker`,
# `nice -n 5 docker` and `timeout 5 docker` all run docker.
PREFIXES=" command env exec ionice nice nohup setsid stdbuf sudo time timeout "
# Programs that run neither an argument nor their input, so a docker word reaching one — written or
# piped — is text rather than a command. Closed and short: anything able to execute either — an
# interpreter, xargs, find, git, sed, awk — is outside it and lands on the refusal below instead.
INERT=" cat echo egrep fgrep grep head ls printf rg tail wc "
# Subcommands that read and mutate nothing. Closed by design: a verb a later release adds refuses
# until someone reads its flags. `wait` is out because --down-project drops the project; `config`
# because it renders `.env` and writes.
READS=" events images logs ls port ps stats top version volumes "

while IFS= read -r seg; do
  # Fed by a pipe (\001), or by a heredoc, a here-string, a process substitution or a file — each
  # of which spells `<`. What such a segment runs is not in this payload.
  receives=0
  case "$seg" in
    *$'\001'* | *'<'*) receives=1 ;;
  esac
  seg="${seg//$'\001'/ }"
  read -ra words <<<"$seg"
  count="${#words[@]}"
  [ "$count" -gt 0 ] || continue

  i=0
  prefixed=0
  while [ "$i" -lt "$count" ]; do
    case "${words[$i]}" in
      # A parameter expansion at program position names a program this hook cannot see.
      *'$'*) deny ;;
      [A-Za-z_]*=*) i=$((i + 1)) ;;
      *)
        # Case-folded before the extension comes off, because Windows runs `DOCKER.EXE`.
        base="${words[$i]##*/}"
        base="${base,,}"
        base="${base%.exe}"
        case "$PREFIXES" in
          *" $base "*)
            prefixed=1
            i=$((i + 1))
            ;;
          *) break ;;
        esac
        ;;
    esac
  done
  [ "$i" -lt "$count" ] || continue

  prog="${words[$i]##*/}"
  prog="${prog,,}"
  prog="${prog%.exe}"
  case "$INERT" in
    *" $prog "*) continue ;;
  esac

  if [ "$prog" != "docker" ] && [ "$prog" != "docker-compose" ]; then
    # Handed its input, this program runs text the payload does not carry, so no docker word among
    # its arguments proves anything. The inert list above is what places one, and it is past.
    [ "$receives" = "0" ] || deny
    # Past a prefix the program is the next docker word; with no prefix, an unplaceable program
    # sharing a segment with one means "cannot tell", and guessing released every such spelling.
    j="$i"
    while [ "$j" -lt "$count" ]; do
      base="${words[$j]##*/}"
      base="${base,,}"
      base="${base%.exe}"
      case "$base" in
        docker | docker-compose)
          [ "$prefixed" = "1" ] || deny
          break
          ;;
      esac
      j=$((j + 1))
    done
    [ "$j" -lt "$count" ] || continue
    i="$j"
    prog="${words[$i]##*/}"
    prog="${prog,,}"
    prog="${prog%.exe}"
  fi

  if [ "$prog" = "docker" ]; then
    # `docker ps` and `docker run` are the plain CLI, which this hook does not speak for. The word
    # is folded like the program: a spelling this hook cannot place is not one it releases.
    verb="${words[$((i + 1))]:-}"
    [ "${verb,,}" = "compose" ] || continue
    i=$((i + 2))
  else
    i=$((i + 1))
  fi

  # Only a `-f` value is a file compose reads. The name anywhere else — a comment, an unrelated
  # argument — is a mention, and releasing on one would let a production invocation through.
  local_named=0
  other_file=0
  operand=0
  # The subcommand is the earliest word that is neither a global option nor a value bound to one.
  subcommand=""
  while [ "$i" -lt "$count" ]; do
    word="${words[$i]}"
    value=""
    valued=0
    case "$word" in
      -f | --file)
        value="${words[$((i + 1))]:-}"
        valued=1
        i=$((i + 1))
        ;;
      -f=* | --file=*)
        value="${word#*=}"
        valued=1
        ;;
      # Every other global option taking a value, read off `docker compose --help` rather than
      # recalled: its value is not a subcommand, and reading one as such would release the real one.
      -p | --project-name | --ansi | --env-file | --parallel | --profile | --progress | \
        --project-directory)
        case "${words[$((i + 1))]:-}" in
          "" | -*) ;;
          *) operand=1 ;;
        esac
        i=$((i + 1))
        ;;
      -*) ;;
      *)
        operand=1
        [ -n "$subcommand" ] || subcommand="$word"
        ;;
    esac
    if [ "$valued" = "1" ]; then
      case "$value" in
        "" | -*) ;;
        *) operand=1 ;;
      esac
      # Ahead of the subcommand only: behind it the token is an argument of the subcommand, which
      # `exec db sh -f <local>` would spell as consent. Matched WHOLE, so a file so named elsewhere
      # is not consent.
      if [ -z "$subcommand" ]; then
        case "$value" in
          docker-compose.local.yml | ./docker-compose.local.yml) local_named=1 ;;
          *) other_file=1 ;;
        esac
      fi
    fi
    i=$((i + 1))
  done

  # Disclosure is judged ahead of consent: the local file carries the same `env_file` lines, so
  # rendering it prints the same credentials.
  [ "$subcommand" = "config" ] && deny_config

  # The local file is the developer's own stack, so what is run against it is their business — but
  # only while it is the ONLY file named, because a second `-f` merges the production one back in.
  if [ "$local_named" = "1" ] && [ "$other_file" = "0" ]; then
    continue
  fi

  # Compose acts only through a subcommand, so an invocation naming none — `docker compose --help`
  # — starts nothing. An operand with none is the other case: a global option ate the verb.
  if [ -z "$subcommand" ]; then
    [ "$operand" = "1" ] && deny
    continue
  fi

  case "$READS" in
    *" $subcommand "*) continue ;;
  esac
  deny
done <<<"$segments"

exit 0
