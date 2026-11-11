#!/usr/bin/env bash
# SCRIPTS · shared helpers — sourced, never run directly.
# Sourcing applies strict mode and installs the ERR, INT, TERM and HUP traps.

# `-E`: without errtrace the ERR trap is not inherited by a function, so a command failing inside
# one never reaches `on_error`. It exits with its own status — 1, which the exit contract spells
# "findings" — rather than the crash floor of 3.
set -Eeuo pipefail
IFS=$'\n\t'

# Two levels: this file sits in `scripts/lib/`, so one `..` would root every script at
# `scripts/` and leave every relative path inside them one directory short.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Resolved before the `cd`: `--help` reads a script's own header back off this path. The
# ${x-default} form (no colon) survives `set -u` on an absent array element.
_caller="${BASH_SOURCE[1]-${BASH_SOURCE[0]-$0}}"
SELF="$(cd "$(dirname "$_caller")" && pwd)/$(basename "$_caller")"
unset _caller

# `BASH_SOURCE` keeps a path as it was given, so a relative one names a file from here: every script
# and this file are entered before the `cd` below, and a file sourced after it takes an absolute path.
_STARTED_IN="$PWD"
cd "$REPO_ROOT"

# --- Output ----------------------------------------------------------------------------------------

# `FL_GATE_COLOR`, never an exported `NO_COLOR` or `FORCE_COLOR`, which prettier and pnpm read too: a
# scope run beside others writes to a file, so `[[ -t 1 ]]` cannot answer. `FORCE_COLOR=0` is off.
if [[ -n "${FL_GATE_COLOR:-}" ]]; then
  if [[ "$FL_GATE_COLOR" == "1" ]]; then _colour=1; else _colour=0; fi
elif [[ -n "${NO_COLOR:-}" || "${FORCE_COLOR:-}" == "0" ]]; then
  _colour=0
elif [[ -t 1 || -n "${FORCE_COLOR:-}" || -n "${GITHUB_ACTIONS:-}" ]]; then
  _colour=1
else
  _colour=0
fi
if (( _colour )); then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
else
  C_RESET=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''; C_DIM=''
fi
unset _colour

# --- Run state ---------------------------------------------------------------------------------------

# The chrome sleeps until `section` is called: a script speaking only the verbs prints plainly.
_CHROME=0
_SECTION_NAMES=(); _SECTION_RANKS=(); _SECTION_MS=(); _SECTION_FINDINGS=(); _SECTION_ADVISORIES=()
_SECTION_OPEN=-1
_SECTION_T0=0
_STEP_MS0=""
_STEP_LABEL=""
_ENDED=0

# Run-wide, not per section: a finding before the first `section` has no row, and summing rows
# alone would close a run green over it. Advisories count apart, never failing a run.
_RUN_FINDINGS=0
_RUN_ADVISORIES=0

VERBOSE="${VERBOSE:-0}"

# A verdict may only make a row worse. `failed` outranks `refused`: where a section produced both,
# the definite verdict is the actionable one.
_RANK_LABELS=("no verdict" "skipped" "pass" "advisory" "refused" "failed")

# Bash's own clock, not `date`: a process spawn per step is the expensive part on Windows.
_now_ms() {
  local t="${EPOCHREALTIME:-}"
  if [[ -n "$t" ]]; then
    # The separator is the locale's, and `10#` stops a leading zero being read as octal.
    printf '%s' "$(( ${t%%[.,]*} * 1000 + 10#${t#*[.,]} / 1000 ))"
  else
    printf '%s' "$(( SECONDS * 1000 ))"
  fi
}

# Rounded once, before the arms branch: rounding inside the seconds arm puts 119.7 s past its own
# bound and prints `120s` where the next arm says `2m 00s`.
fmt_ms() {
  local ms="$1" secs
  if (( ms < 0 )); then ms=0; fi
  secs=$(( (ms + 500) / 1000 ))
  if   (( ms < 10000 ));  then printf '%d.%ds' $(( ms / 1000 )) $(( (ms % 1000) / 100 ))
  elif (( secs < 120 )); then printf '%ds' "$secs"
  else printf '%dm %02ds' $(( secs / 60 )) $(( secs % 60 ))
  fi
}

# Call it in a condition: bare, a false answer is a non-zero status that `set -e` acts on.
verbose() { (( VERBOSE )); }

_RUN_T0="$(_now_ms)"

# --- Spinner -----------------------------------------------------------------------------------------

# NO_SPINNER is offered because some terminals mangle a carriage return. `GITHUB_ACTIONS` rather
# than `CI`, which a developer's shell may export.
if [[ -t 1 && -z "${GITHUB_ACTIONS:-}" && -z "${NO_SPINNER:-}" ]]; then
  _SPINNER=1
  # Dupped before any verb redirects: `warn` points stdout at stderr, and the frame has to be
  # erased from the screen it was drawn on.
  exec {_SPIN_OUT}>&1
else
  _SPINNER=0
  _SPIN_OUT=1
fi
_SPIN_PID=""

# One `sleep` per frame: the alternatives leak a process or need a fifo, and at this rate the
# spawn is invisible beside the step.
spinner_start() {
  if (( ! _SPINNER || VERBOSE )); then return 0; fi
  # A stop inside a pipeline kills the frames in a subshell the caller never sees, so a recorded
  # pid is believed only while it answers. Reaping keeps the job table a parallel group can `wait` on.
  if [[ -n "$_SPIN_PID" ]]; then
    if kill -0 "$_SPIN_PID" 2>/dev/null; then return 0; fi
    wait "$_SPIN_PID" 2>/dev/null || true
    _SPIN_PID=""
  fi
  # SIGINT stays ignored in here, as bash starts every `&` command of a script, so the frames go on
  # through a Ctrl-C while the run's tool winds down. They never draw over the interrupt message:
  # `on_interrupt` ends them through `spinner_stop` before it prints.
  (
    # Detached because `set -E` hands this child the run's ERR trap: a failed frame would run
    # `on_error` here and print the run's closing table from a process that is not the run.
    # Nothing reads this loop's status, so it may die quietly instead.
    trap - ERR
    # The backslash frame in ANSI-C quotes: inside single quotes shellcheck reads a trailing
    # backslash as an escape.
    _f=('|' '/' '-' $'\\'); _i=0
    while :; do
      printf '\r%s   %s %s%s' "$C_DIM" "${_f[_i]}" "$1" "$C_RESET"
      _i=$(( (_i + 1) % ${#_f[@]} ))
      sleep 0.25
    done
  ) 1>&"$_SPIN_OUT" 2>/dev/null &
  _SPIN_PID=$!
}

# Called before anything else prints: otherwise a frame is left half-drawn under a real line.
spinner_stop() {
  if [[ -z "$_SPIN_PID" ]]; then return 0; fi
  kill "$_SPIN_PID" 2>/dev/null || true
  # Reaping stops the shell announcing the killed job later; the status is a signal, so dropped.
  wait "$_SPIN_PID" 2>/dev/null || true
  _SPIN_PID=""
  # Erase rather than overwrite: the frame's width is the step label's, which nothing here tracks.
  printf '\r\033[2K' 1>&"$_SPIN_OUT"
}

# Tags arrive pre-padded because printf's %4s pads by BYTES and mis-pads the multibyte tags.
_emit() {
  local colour="$1" tag="$2" first=1 line
  spinner_stop
  shift 2
  while IFS= read -r line; do
    if (( first )); then
      printf '%s%s%s  %s\n' "$colour" "$tag" "$C_RESET" "$line"
      first=0
    else
      printf '      %s\n' "$line"
    fi
  done <<< "$*"
}

# One verb per meaning, each defined in `docs/ops/spec.md` §1.7.
info() { _emit "$C_BLUE"   "   ·" "$*"; }
skip() { _emit "$C_DIM"    "  --" "$*"; _escalate 1; }

# An advisory, never a finding — use `fail` where the run must not stay green.
warn() { _emit "$C_YELLOW" "  !!" "$*" >&2; _record_advisory; }

# Under Actions, one error annotation per finding, on stdout beside the output it follows, and none
# for a statement summing findings already annotated, which would list them a second time among the
# run's annotations.
_annotate() {
  if [[ -z "${GITHUB_ACTIONS:-}" ]]; then return 0; fi
  local message="${*//'%'/%25}"
  message="${message//$'\r'/}"
  printf '::error::%s\n' "${message//$'\n'/ }"
}

# `die` without the exit, for a script collecting every finding before it reports. It closes the
# step: a later verdict carries no duration. `--summary` first: the line sums findings annotated above.
fail() {
  local s; s="$(_step_suffix)"
  if [[ "${1-}" == --summary ]]; then shift; else _annotate "$*"; fi
  _emit "$C_RED" "   ✗" "$*${s}" >&2
  add_findings 1
  _escalate 5
  _STEP_MS0=""
}

die() {
  local s; s="$(_step_suffix)"
  if [[ "${1-}" == --summary ]]; then shift; else _annotate "$*"; fi
  printf '\n' >&2
  _emit "$C_RED" "   ✗" "$*${s}" >&2
  printf '\n' >&2
  if (( _CHROME )); then add_findings 1; _escalate 5; _closing findings; fi
  exit 1
}

# Starts no spinner: a step cannot know whether its work streams, and a frame ends without a
# newline, so it and a tool's first line would share one. Only `quietly` may spin.
step() {
  spinner_stop
  _STEP_T0=$SECONDS
  _STEP_MS0="$(_now_ms)"
  _STEP_LABEL="$*"
  printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_RESET"
}

# Under a section every step carries its duration, because a total no line itemises is one
# nobody can act on. The section's own row is a wall clock, which its steps sum to only while
# they run in order.
ok() {
  local suffix=""
  if (( _CHROME )); then
    suffix="$(_step_suffix)"
    _escalate 2
  elif [[ -n "${_STEP_T0:-}" ]] && (( SECONDS - _STEP_T0 >= 3 )); then
    suffix=" ${C_DIM}($(fmt_duration $(( SECONDS - _STEP_T0 ))))${C_RESET}"
  fi
  _emit "$C_GREEN" "  ok" "$*${suffix}"
  _STEP_MS0=""
}

# Six spaces, the continuation indent every verb's later lines take (`docs/ops/spec.md` §1.7).
detail() {
  spinner_stop
  if (( $# )); then printf '      %s\n' "$@"
  else sed 's/^/      /'
  fi
}

# Readable because a caller grades a failure by the tool's own words, and re-running the tool to
# read them back would pay for the gate's slowest steps twice.

QUIETLY_OUTPUT=""
# The streaming arm's copy while its command runs, so an interrupt can reclaim it.
_QUIETLY_CAPTURE=""

quietly() {
  local out rc=0
  local -a piped=() said=()
  QUIETLY_OUTPUT=""
  if (( VERBOSE )); then
    # Kept as well as streamed, or a caller grading by the output grades this form differently. A
    # file rather than `/dev/fd/1`, which Linux reopens: a redirected log would lose its start.
    _QUIETLY_CAPTURE="$(mktemp)"
    # `PIPESTATUS`, not the pipeline's status, which is `tee`'s without `pipefail`. Left of `||`, so
    # neither `set -e` nor the ERR trap acts on the tool's own failure.
    { "$@" 2>&1 | tee "$_QUIETLY_CAPTURE"; piped=("${PIPESTATUS[@]}"); } || :
    rc="${piped[0]}"
    out="$(<"$_QUIETLY_CAPTURE")"
    rm -f -- "$_QUIETLY_CAPTURE"
    _QUIETLY_CAPTURE=""
  else
    # The one wrapper the spinner needs: a captured command is the stretch where a run looks hung.
    if (( _CHROME )); then spinner_start "$_STEP_LABEL"; fi
    out="$("$@" 2>&1)" || rc=$?
    spinner_stop
    # As arguments, one per line: a here-string yields at least one, so `detail` never reads stdin.
    if (( rc )); then mapfile -t said <<<"$out"; detail "${said[@]}"; fi
  fi
  # shellcheck disable=SC2034  # read by the scripts that source this file
  QUIETLY_OUTPUT="$out"
  return "$rc"
}

fmt_duration() {
  local s="$1"
  if (( s < 120 )); then printf '%ss' "$s"
  else printf '%sm %02ds' $(( s / 60 )) $(( s % 60 ))
  fi
}

# The script's own header is its help text, so usage cannot drift from the code.
usage() {
  awk 'NR>1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$SELF"
  exit 0
}

# --- Sections ----------------------------------------------------------------------------------------

# The bookkeeping helpers return 0 whatever they decided: a verb's status is the caller's control
# flow, and "nothing to record" answered with 1 would trip `set -e` at the call site.
_escalate() {
  if (( ! _CHROME || _SECTION_OPEN < 0 )); then return 0; fi
  if (( $1 > _SECTION_RANKS[_SECTION_OPEN] )); then _SECTION_RANKS[_SECTION_OPEN]=$1; fi
  return 0
}

# For what a checker counted itself: findings reported in one block say so here rather than
# counting as one. The run total is kept open section or not — `finish` tests it before green.
add_findings() {
  _RUN_FINDINGS=$(( _RUN_FINDINGS + $1 ))
  if (( ! _CHROME || _SECTION_OPEN < 0 )); then return 0; fi
  _SECTION_FINDINGS[_SECTION_OPEN]=$(( _SECTION_FINDINGS[_SECTION_OPEN] + $1 ))
  if (( $1 > 0 )); then _escalate 5; fi
  return 0
}

_record_advisory() {
  _RUN_ADVISORIES=$(( _RUN_ADVISORIES + 1 ))
  if (( _CHROME && _SECTION_OPEN >= 0 )); then
    _SECTION_ADVISORIES[_SECTION_OPEN]=$(( _SECTION_ADVISORIES[_SECTION_OPEN] + 1 ))
  fi
  _escalate 3
}

# Empty outside a section, and once the open step is closed: one verdict per step is what makes
# the closing table's sums honest.
_step_suffix() {
  if (( ! _CHROME )) || [[ -z "$_STEP_MS0" ]]; then return 0; fi
  printf '   %s%s%s' "$C_DIM" "$(fmt_ms $(( $(_now_ms) - _STEP_MS0 )))" "$C_RESET"
  return 0
}

section() {
  # `IFS` is $'\n\t' repo-wide, so an unlocalised `$*` joins a two-word name with a newline. Not
  # localised in `_emit`, whose newline-joining is what gives every verb its multi-line message.
  local IFS=' '
  local name="$*" pad
  end_section
  _CHROME=1
  _SECTION_NAMES+=("$name"); _SECTION_RANKS+=(0); _SECTION_MS+=(0)
  _SECTION_FINDINGS+=(0); _SECTION_ADVISORIES+=(0)
  _SECTION_OPEN=$(( ${#_SECTION_NAMES[@]} - 1 ))
  _SECTION_T0="$(_now_ms)"
  # A fold and no annotation: each finding carries its own (`_annotate`), and the table only sums them.
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    printf '::group::%s\n' "$name"
  else
    printf -v pad '%*s' "$(( ${#name} < 66 ? 66 - ${#name} : 3 ))" ''
    printf '\n%s▌ %s %s%s\n' "$C_BOLD" "$name" "${pad// /─}" "$C_RESET"
  fi
  # A script installing its own INT trap replaces `on_interrupt` and silently loses the statement,
  # the table and `spinner_stop`. A section is where a rewired script first reaches here.
  if [[ "$(trap -p INT)" != *on_interrupt* ]]; then
    warn "this script re-trapped INT, so Ctrl-C no longer reaches ${SELF##*/}'s closing statement.
Remove it: scripts/lib/_lib.sh traps INT and exits 130, which fires this script's own EXIT trap."
  fi
}

# Called directly only to print outside every Actions group; `section` and the endings call it.
end_section() {
  spinner_stop
  _STEP_MS0=""
  if (( _SECTION_OPEN < 0 )); then return 0; fi
  _SECTION_MS[_SECTION_OPEN]=$(( $(_now_ms) - _SECTION_T0 ))
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then printf '::endgroup::\n'; fi
  _SECTION_OPEN=-1
}

# Padded before the colour wraps it: printf counts an escape sequence's bytes as width.
_summary_table() {
  local count="${#_SECTION_NAMES[@]}" i w=7 rank colour
  if (( count == 0 )); then return 0; fi
  for (( i = 0; i < count; i++ )); do
    if (( ${#_SECTION_NAMES[i]} > w )); then w=${#_SECTION_NAMES[i]}; fi
  done
  printf '\n      %s%-*s  %-10s  %9s  %8s%s\n' "$C_DIM" "$w" "section" "result" "duration" "findings" "$C_RESET"
  for (( i = 0; i < count; i++ )); do
    rank=${_SECTION_RANKS[i]}
    case "$rank" in
      2) colour="$C_GREEN" ;;
      3) colour="$C_YELLOW" ;;
      4|5) colour="$C_RED" ;;
      *) colour="$C_DIM" ;;
    esac
    printf '      %-*s  %s%-10s%s  %9s  %8s\n' \
      "$w" "${_SECTION_NAMES[i]}" "$colour" "${_RANK_LABELS[rank]}" "$C_RESET" \
      "$(fmt_ms "${_SECTION_MS[i]}")" "${_SECTION_FINDINGS[i]}"
  done
}

# One per end state, printed once: a run stopping without one crashed in a way nothing here saw,
# which is itself what the reader needs to be told.
_closing() {
  local state="$1" extra="${2:-}" count elapsed advisories=""
  if (( _ENDED )); then return 0; fi
  _ENDED=1
  end_section
  _summary_table
  count="${#_SECTION_NAMES[@]}"
  elapsed="$(fmt_ms $(( $(_now_ms) - _RUN_T0 )))"
  # A count of zero is a non-empty string, so the ${x:+…} form cannot decide this one.
  if (( _RUN_ADVISORIES )); then advisories=" ${_RUN_ADVISORIES} advisory line(s) above."; fi
  case "$state" in
    # Named in the green statement, so a run cannot report "no findings" over a warning on screen.
    green)
      ok "Green — ${count} section(s), no findings, ${elapsed}.${advisories}${extra:+ ${extra}}" ;;
    # "In the section it came from" survives Actions folding, where "the lines above" would not.
    findings)
      _emit "$C_RED" "   ✗" "${_RUN_FINDINGS} finding(s) in this run, ${count} section(s), ${elapsed}. Each is
named in the section it came from, and each names something to fix in the change — exit 1." >&2 ;;
    refused)
      _emit "$C_RED" "   ✗" "Refused after ${elapsed}, so nothing here stands as a verdict on the change and the
refusal above names what could not be judged. Not findings, which would name what to
fix; not a crash, which would mean the check never ran at all — exit 2." >&2 ;;
    crashed)
      _emit "$C_RED" "   ✗" "Crashed after ${elapsed}. The line above is the script itself failing rather than
anything about the change, so nothing past it ran — exit 3 or more." >&2 ;;
    interrupted)
      _emit "$C_YELLOW" "  !!" "Interrupted after ${elapsed}. ${count} section(s) had opened and the rest never
ran, so nothing here is a verdict on the change (exit 130)." >&2 ;;
  esac
  return 0
}

# Exits rather than returning: a script free to carry on past its closing statement prints a
# second one. A sentence passed in is appended to the green statement alone.
finish() {
  local i count worst=0
  end_section
  count="${#_SECTION_NAMES[@]}"
  # A section closing with no verdict is a caller defect: green would print "no findings" beside a
  # row reading `no verdict`. `fail`, not `warn` — a section proving nothing must not pass.
  for (( i = 0; i < count; i++ )); do
    if (( _SECTION_RANKS[i] == 0 )); then
      fail "section '${_SECTION_NAMES[i]}' closed with no verdict — nothing in it proves anything"
    fi
    if (( _SECTION_RANKS[i] > worst )); then worst=${_SECTION_RANKS[i]}; fi
  done
  if (( _RUN_FINDINGS > 0 || worst >= 5 )); then _closing findings; exit 1; fi
  if (( worst == 4 )); then _closing refused; exit 2; fi
  # No row reached `pass`, so nothing judged anything and green would read as a run that did.
  # Below the endings owning rank 0 and rank 4; `count` because a script speaking the verbs
  # plainly opens no section at all.
  if (( count > 0 && worst < 2 )); then
    refuse "every section in this run was skipped, so nothing here judged the change and there is
no verdict to report. Each skip above names what was not run and why."
  fi
  _closing green "$*"
  exit 0
}

# Its own ending: the check ran and its result cannot stand as a verdict. Ranked above `pass`, so
# a step that passed before the refusal cannot leave the row reading green.
refuse() {
  _escalate 4
  # Closed first, so the message lands outside the Actions fold: a reader told to look above must
  # not be sent into something collapsed.
  end_section
  _annotate "$*"
  printf '\n' >&2
  _emit "$C_RED" "   ✗" "$*" >&2
  _closing refused
  # 2, not 1: a caller branching on the code has to tell "fix the change" from "the checker could
  # not judge it", and 1 is spoken for by findings.
  exit 2
}

# `set -e` otherwise exits in silence. A library helper passes $4, the file its line is in, read off
# `BASH_SOURCE` at that line's frame: its caller may be a sourced file rather than the script.
on_error() {
  local rc="$1" line="$2" cmd="$3" file="${4:-$SELF}"
  local where="${file##*/}"
  # The open section failed whatever its steps reached: a row reading `pass` beside a crash
  # statement misleads anyone scanning the table rather than the prose.
  _escalate 5
  # Outside the fold, for `refuse`'s reason.
  end_section
  _annotate "${where} failed at line ${line}: ${cmd} (exit status ${rc})"
  printf '\n' >&2
  _emit "$C_RED" "   ✗" "${where} failed
line ${line}:  ${cmd}
exit status ${rc}" >&2
  printf '\n' >&2
  if (( _CHROME )); then _closing crashed; fi
  # The exit contract, which a reader and a caller both depend on: 0 green, 1 findings, 2 refused,
  # 3 and up the script itself failing. The underlying status is printed above.
  if (( rc < 3 )); then rc=3; fi
  exit "$rc"
}

_on_err_trap() { # $1 status, $2 line, $3 `$BASH_COMMAND`, $4 the file the line belongs to
  local text
  # The file's own whole command, since inside another trap `$BASH_COMMAND` holds the command that
  # trap interrupted, and `$LINENO` names one physical line of a continued one. Here, not in
  # `on_error`, whose explicit callers pass a message.
  text="$(
    # Read from where a relative `$4` was given rather than joined to that directory: under Git
    # Bash an absolute path may open with a drive letter, which a test for a leading slash misses.
    cd -- "$_STARTED_IN" && awk -v n="$2" '
    # A line holding only a comment never continues, whatever its last character: bash reads that
    # backslash as text, so the line below it starts a command of its own.
    function continues(l) { return l ~ /\\$/ && l !~ /^[[:space:]]*#/ }
    { line[NR] = $0 }
    END {
      if (n < 1 || n > NR) exit 1
      s = n; while (s > 1 && continues(line[s - 1])) s--
      e = n; while (e < NR && continues(line[e])) e++
      for (i = s; i <= e; i++) {
        part = line[i]; sub(/^[[:space:]]+/, "", part); sub(/[[:space:]]*\\$/, "", part)
        out = (i == s) ? part : out " " part
      }
      print out
    }' "$4" 2>/dev/null)" || text="$3"
  on_error "$1" "$2" "$text" "$4"
}
# Expanded as the trap fires: read inside the function, `$LINENO` would name that function's line.
trap '_on_err_trap "$?" "$LINENO" "$BASH_COMMAND" "${BASH_SOURCE[0]}"' ERR

# A dropped SSH session's hangup among them: left to bash, each still runs a script's EXIT trap but
# dies by its signal, with no statement and `quietly`'s capture left behind, a hangup exiting 129,
# which the exit contract never names.
on_interrupt() {
  # Once: a second signal would re-enter here from inside the EXIT trap and exit it half done.
  trap '' INT TERM HUP
  spinner_stop
  if [[ -n "$_QUIETLY_CAPTURE" ]]; then rm -f -- "$_QUIETLY_CAPTURE" || true; fi
  printf '\n' >&2
  if (( _CHROME )); then
    _closing interrupted
  else
    _emit "$C_YELLOW" "  !!" "Interrupted — ${SELF##*/} stopped where it stood." >&2
  fi
  exit 130
}
trap on_interrupt INT TERM HUP

# --- Guards ----------------------------------------------------------------------------------------

# Each ends through `refuse`, never `die`: a missing daemon, a wrong platform or an absent file is
# never something the change could be fixed to answer for. Explicit `||`, never the trap, so a
# guard speaks inside a caller that captures a status too.

# Docker's own error ("npipe:////./pipe/...") explains nothing to anyone who has not seen it.
require_docker() {
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
    || refuse "Docker is not responding.
Start Docker Desktop (Windows) or 'sudo systemctl start docker' (Linux),
wait until it reports running, then try again."
}

require_platform() {
  local want="$1" have
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) have=windows ;;
    Linux)                have=linux   ;;
    Darwin)               have=macos   ;;
    *)                    have=unknown ;;
  esac
  [[ "$have" == "$want" ]] || refuse "This script targets ${want}; this machine looks like ${have}.
See scripts/README.md for which script belongs to which environment."
}

# The venv layout differs by platform, and `scripts/gate/verify.sh` runs on both. Returns 1 rather than
# dying: every caller reads it through `$( )`, where a `die` exits the subshell alone and the ERR
# trap prints a stack block over the message.
venv_python() {
  local win="${REPO_ROOT}/fl_backend/.venv/Scripts/python.exe"
  local nix="${REPO_ROOT}/fl_backend/.venv/bin/python"
  if   [[ -x "$win" ]]; then printf '%s' "$win"
  elif [[ -x "$nix" ]]; then printf '%s' "$nix"
  else return 1
  fi
}

# Wider than `venv_python`, for `nginx/edge_test.sh`, which needs an interpreter at the floor and no
# package.
any_python() {
  if venv_python; then return 0
  elif command -v python3 >/dev/null 2>&1; then printf 'python3'
  elif command -v python  >/dev/null 2>&1; then printf 'python'
  else return 1
  fi
}

# In bash and nowhere else: a checker cannot report on the version that refuses to compile it
# (`docs/ops/spec.md` §1.5).
PYTHON_FLOOR="3.14"

# Called bare in a condition, for `verbose`'s reason. `--version` rather than a `-c` snippet, whose
# own syntax an interpreter this refuses would have to be trusted to parse.
python_at_floor() { # $1 an interpreter
  local said major minor
  # A python 2 writes its version to stderr and a Windows Store stub prints nothing at all, so an
  # answer no version reads out of counts as below the floor rather than passing unread.
  said="$("$1" --version 2>/dev/null)" || return 1
  [[ "$said" =~ ^Python[[:space:]]+([0-9]+)\.([0-9]+) ]] || return 1
  major="${BASH_REMATCH[1]}"; minor="${BASH_REMATCH[2]}"
  # `10#`, or a component arriving with a leading zero is read as octal.
  local -i found=$(( (10#$major * 1000) + 10#$minor ))
  local -i floor=$(( (10#${PYTHON_FLOOR%%.*} * 1000) + 10#${PYTHON_FLOOR##*.} ))
  (( found >= floor ))
}

require_dir()  { [[ -d "$1" ]] || refuse "Missing required directory: $1${2:+
$2}"; }

# --- The rendered compose models ----------------------------------------------------------------------

# Every environment file the compose files name. Compose refuses to parse a stack whose file is
# missing, and the real ones are never copied: each is replaced by a stand-in naming itself
# (`scripts/checks/check_compose_model.py :: STAND_IN_READ`).
COMPOSE_STAND_INS=(fl_backend/.env fl_frontend/.env)

# One staging for the gate's ops scope and `nginx/edge_test.sh`, so a change to the files compose reads
# reaches both. `$1` is an empty scratch directory.
stage_compose_models() {
  local directory="$1" env_file number=0
  mkdir -p "${directory}/fl_backend" "${directory}/fl_frontend"
  cp docker-compose.yml docker-compose.local.yml "${directory}/"
  for env_file in "${COMPOSE_STAND_INS[@]}"; do
    number=$(( number + 1 ))
    printf 'FL_STAND_IN_READ_%s=%s\n' "$number" "$env_file" > "${directory}/${env_file}"
  done
}

# `$2` is `production` or `local`, written to `$1/$2.json`. The local stack is the merge `local.sh` runs,
# the override being no stack alone. `--output` keeps a text-mode stream off the model.
render_compose_model() {
  # The base file names both images by the tag a deploy pins and refuses to parse without one, and a
  # rendered model runs no image, so any word stands in.
  local -x TAG=gate
  local -a files=(-f "$1/docker-compose.yml")
  if [[ "$2" == local ]]; then files+=(-f "$1/docker-compose.local.yml"); fi
  # Never `--no-env-resolution`: Compose 2.38 ignores it and later releases honour it, so it would
  # make the rendered environment depend on the release.
  quietly docker compose "${files[@]}" config --format json --output "$1/$2.json"
}

# --- What a successful build does not prove ------------------------------------------------------------

# Asked of the image itself, by the gate's images scope. Each answers 0, 1 for what it found, and 3
# for an image that would not run, which says nothing about the image.

# From the repo root `instrumentation.ts` compiles but is not traced into the standalone output,
# which silently disables the startup env gate and onRequestError.
image_has_instrumentation() { # $1 the frontend image
  local rc=0
  docker run --rm --entrypoint sh "$1" -c '[ -f .next/server/instrumentation.js ]' || rc=$?
  case "$rc" in
    0) ;;
    # The test's own answer. Anything higher is docker's, and says nothing about the file.
    1) printf '%s\n' "the ${1} image has no .next/server/instrumentation.js"; return 1 ;;
    # 130 travels: flattened to 3 it reads as a refusal, and the caller cannot recover the interrupt.
    130) return 130 ;;
    *) printf '%s\n' "the ${1} image would not run (exit ${rc}), so whether instrumentation.js reached it was never read"
       return 3 ;;
  esac
}

# A USER line lost in a refactor still builds.
image_runs_unprivileged() { # $1.. the images
  local image uid rc
  for image in "$@"; do
    rc=0
    uid="$(docker run --rm --entrypoint sh "$image" -c 'id -u')" || rc=$?
    # For `image_has_instrumentation`'s reason.
    if (( rc == 130 )); then return 130; fi
    if (( rc )); then
      printf '%s\n' "the ${image} image would not run, so its runtime user was never read"
      return 3
    fi
    if [[ "$uid" == "0" ]]; then
      printf '%s\n' "the ${image} image runs as uid 0, so no USER line takes effect in it"
      return 1
    fi
  done
}

# The build context alone: filesystem-wide, the OS trust store and the dependency trees ship
# certificates of their own, and the check widens until it says nothing.

# The shapes both `.dockerignore` files exclude; `scripts/tests/test_image_assertions.py` holds the
# two lists together.
IMAGE_CONTEXT_FIND='find /app -xdev \( -name node_modules -o -name .venv \) -prune -o \( -name ".env" -o -name ".env.*" -o -name "*.pem" -o -name "*.key" -o -name "*.crt" -o -name ".npmrc" -o -name ".tmp-*" \) -print'
# A context the dockerignore stopped covering still builds.
image_context_clean() { # $1.. the images
  local image found rc
  for image in "$@"; do
    rc=0
    found="$(docker run --rm --entrypoint sh "$image" -c "$IMAGE_CONTEXT_FIND")" || rc=$?
    # For `image_has_instrumentation`'s reason.
    if (( rc == 130 )); then return 130; fi
    if (( rc )); then
      printf '%s\n' "the ${image} image would not run, so its context was never read"
      return 3
    fi
    if [[ -n "$found" ]]; then
      printf '%s\n' "the ${image} image carries what its dockerignore exists to keep out:" "$found"
      return 1
    fi
  done
}
