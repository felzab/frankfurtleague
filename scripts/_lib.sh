#!/usr/bin/env bash
# SCRIPTS · shared helpers — sourced, never run directly.
# Sourcing applies strict mode and installs the ERR and INT traps.

set -euo pipefail
IFS=$'\n\t'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Resolved before the `cd`: `--help` reads a script's own header back off this path. The
# ${x-default} form (no colon) survives `set -u` on an absent array element.
_caller="${BASH_SOURCE[1]-${BASH_SOURCE[0]-$0}}"
SELF="$(cd "$(dirname "$_caller")" && pwd)/$(basename "$_caller")"
unset _caller

cd "$REPO_ROOT"

# --- Image naming -----------------------------------------------------------------------------------

# Public packages: an anonymous pull needs no login on the server and no token that expires
# mid-deploy. A pull failing to authenticate means one was made private. SC2034 throughout:
# every name below is read by the scripts that source this file.
REGISTRY="ghcr.io"
# shellcheck disable=SC2034
REPO_FRONTEND="${REGISTRY}/felzab/frankfurtleague-frontend"
# shellcheck disable=SC2034
REPO_BACKEND="${REGISTRY}/felzab/frankfurtleague-backend"
# shellcheck disable=SC2034
IMAGE_FRONTEND="${REPO_FRONTEND}:latest"
# shellcheck disable=SC2034
IMAGE_BACKEND="${REPO_BACKEND}:latest"

# --- Output ----------------------------------------------------------------------------------------

# `FL_GATE_COLOR`, never an exported `NO_COLOR` or `FORCE_COLOR`, which prettier and pnpm read too.
# A worker cannot answer for itself: its stdout is a file, so `[[ -t 1 ]]` comes back uncoloured.
# `FORCE_COLOR=0` means off, per npm.
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

# Held here, not at the call site: most endings exit where they stand, so a line printed there
# would be lost by a replayed failure.
_NOT_RUN=""

VERBOSE="${VERBOSE:-0}"

# A worker prints no summary: the parent prints the table once, into bytes replayed verbatim.
# Carried in the environment rather than as a flag, which `scripts/selfcheck.sh` would read out
# of the header into `--help`.
_WORKER=0
if [[ "${FL_GATE_WORKER:-}" == "1" ]]; then _WORKER=1; fi

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

# In a condition, for `verbose`'s reason.
worker() { (( _WORKER )); }

set_not_run() { _NOT_RUN="$*"; }

_RUN_T0="$(_now_ms)"

# --- Spinner -----------------------------------------------------------------------------------------

# NO_SPINNER is offered because some terminals mangle a carriage return.
if [[ -t 1 && -z "${CI:-}" && -z "${GITHUB_ACTIONS:-}" && -z "${NO_SPINNER:-}" ]]; then
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
  # No trap in here: Ctrl-C reaches the whole process group, and a spinner that ignored it would
  # keep drawing over the interrupt message.
  (
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

# `die` without the exit, for a script collecting every finding before it reports. It closes the
# step: a later verdict carries no duration.
fail() {
  local s; s="$(_step_suffix)"
  _emit "$C_RED" "   ✗" "$*${s}" >&2
  add_findings 1
  _escalate 5
  _STEP_MS0=""
}

die() {
  local s; s="$(_step_suffix)"
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

# Re-dates the open step to the work's own length, for a step whose work ran beside its neighbours
# rather than between them, where the order they are collected in is not the order they ran in.
# `docs/ops/spec.md` §1.6.
step_took_ms() { # $1 how long this step's work actually took, in milliseconds
  _STEP_MS0=$(( $(_now_ms) - $1 ))
  _STEP_T0=$(( SECONDS - $1 / 1000 ))
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

excerpt() {
  local max="${1:-5}" n=0 line
  spinner_stop
  while IFS= read -r line; do
    n=$(( n + 1 ))
    if (( VERBOSE || n <= max )); then printf '      %s\n' "$line"; fi
  done
  if (( ! VERBOSE && n > max )); then
    printf '      %s… %s more line(s) — --verbose prints all of it%s\n' "$C_DIM" "$(( n - max ))" "$C_RESET"
  fi
}

# Readable because `add_findings <n>` needs a count only the tool's output carries, and re-running
# it to read that back would pay for the gate's slowest steps twice.

QUIETLY_OUTPUT=""

quietly() {
  local out rc=0
  QUIETLY_OUTPUT=""
  if (( VERBOSE )); then
    "$@" || rc=$?
  else
    # The one wrapper the spinner needs: a captured command is the stretch where a run looks hung.
    if (( _CHROME )); then spinner_start "$_STEP_LABEL"; fi
    out="$("$@" 2>&1)" || rc=$?
    spinner_stop
    # shellcheck disable=SC2034  # read by the scripts that source this file
    QUIETLY_OUTPUT="$out"
    if (( rc )); then printf '%s\n' "$out" | detail; fi
  fi
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

# Per section as well as per run, so a worker's ledger can carry it home: a count held only as a
# run total has no row to travel in.
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
  # Findings annotations stay off: they surface out of order and duplicate the closing table.
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
Remove it: scripts/_lib.sh traps INT and exits 130, which fires this script's own EXIT trap."
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
  # This line is what makes every ending verb safe in a worker: none may summarise a run it sees
  # one scope of. Below `end_section`, because a duration read from a running section is not one.
  if (( _WORKER )); then return 0; fi

  # Below the worker's return: a worker's idea of what was left out is every scope but its own.
  if [[ -n "$_NOT_RUN" ]]; then skip "not run:${_NOT_RUN}"; fi
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
  # Reachable through an adopted row as well as a direct `refuse`, so a worker that could not judge
  # its input ends the same either way.
  if (( _RUN_FINDINGS > 0 || worst >= 5 )); then _closing findings; exit 1; fi
  if (( worst == 4 )); then _closing refused; exit 2; fi
  _closing green "$*"
  exit 0
}

# --- Sections a worker ran ---------------------------------------------------------------------------

# Concurrent scopes print nothing where they stand: each captures its own output, and the parent
# replays the captures in a fixed order, so a parallel run reads as a serial one.

# The name goes last, being the only field that may hold a space. Redirect this to a file: a
# worker's stdout is the output its parent replays.
emit_section_ledger() {
  local i count="${#_SECTION_NAMES[@]}" sum_f=0 sum_a=0
  for (( i = 0; i < count; i++ )); do
    sum_f=$(( sum_f + _SECTION_FINDINGS[i] ))
    sum_a=$(( sum_a + _SECTION_ADVISORIES[i] ))
  done
  # Refused rather than dropped: anything recorded before the section opened has no row to travel
  # in, and a parent never hearing of it reports a clean scope over a real finding.
  if (( _RUN_FINDINGS > sum_f || _RUN_ADVISORIES > sum_a )); then
    die "emit_section_ledger: $(( _RUN_FINDINGS - sum_f )) finding(s) and $(( _RUN_ADVISORIES - sum_a )) advisory
line(s) were recorded outside any section, so no row can carry them to the parent.
Open the section before the first verb that records."
  fi
  for (( i = 0; i < count; i++ )); do
    printf '%s\t%s\t%s\t%s\t%s\n' \
      "${_SECTION_RANKS[i]}" "${_SECTION_MS[i]}" "${_SECTION_FINDINGS[i]}" \
      "${_SECTION_ADVISORIES[i]}" "${_SECTION_NAMES[i]}"
  done
}

# A worker may never call `finish`, which speaks for every scope in the run. It owes its parent
# only the status its rows already imply, which the parent re-derives, so the two cannot disagree.
end_worker() {
  end_section
  if (( _RUN_FINDINGS > 0 )); then exit 1; fi
  exit 0
}

# Prints nothing: bytes and ledger travel apart, so a line here appears twice or out of order. An
# adopted row must stay indistinguishable from one run in-process, or a parallel run's table
# stops matching the serial one byte for byte.
adopt_section() {
  local name="$1" rank="$2" ms="$3" findings="$4" advisories="${5:-0}" value
  # A worker reports these through a file, so they are input, not literals: an unchecked one indexes
  # past the label table and takes the closing summary down with it.
  for value in "$rank" "$ms" "$findings" "$advisories"; do
    [[ "$value" =~ ^[0-9]+$ ]] \
      || die "adopt_section: '${value}' is not a count. Arguments: name rank ms findings [advisories]."
  done
  (( rank <= 5 )) || die "adopt_section: rank ${rank} is outside 0-5."
  # A row appended under an open section sorts before the section still running, and the fixed
  # order is the point of adopting rather than printing.
  (( _SECTION_OPEN < 0 )) || die "adopt_section: a section is still open. Call end_section first."
  _CHROME=1
  _SECTION_NAMES+=("$name"); _SECTION_RANKS+=("$rank"); _SECTION_MS+=("$ms")
  _SECTION_FINDINGS+=("$findings"); _SECTION_ADVISORIES+=("$advisories")
  _RUN_FINDINGS=$(( _RUN_FINDINGS + findings ))
  _RUN_ADVISORIES=$(( _RUN_ADVISORIES + advisories ))
  return 0
}

# The endings a row cannot carry: `on_error` and `on_interrupt` rank their section `failed`, so a
# parent reading rows alone would report a crash or an interrupt as findings. Every other status
# returns, the rows being the whole story there.
adopt_ending() { # $1 the worker's exit status
  local rc="$1"
  [[ "$rc" =~ ^[0-9]+$ ]] || die "adopt_ending: '${rc}' is not an exit status."
  if (( rc == 130 )); then _closing interrupted; exit 130; fi

  # The status a kill leaves is not a number `exit` can return: on Windows `kill -9` reports 2304,
  # which masks to 0. Classified on the raw value, because masking first closes the run green over
  # a killed scope.
  if (( rc > 255 )); then rc=3; fi
  if (( rc >= 3 )); then _closing crashed; exit "$rc"; fi
  return 0
}

# Its own ending: the check ran and its result cannot stand as a verdict. Ranked above `pass`, so
# a step that passed before the refusal cannot leave the row reading green.
refuse() {
  _escalate 4
  # Closed first, so the message lands outside the Actions fold: a reader told to look above must
  # not be sent into something collapsed.
  end_section
  printf '\n' >&2
  _emit "$C_RED" "   ✗" "$*" >&2
  _closing refused
  # 2, not 1: a caller branching on the code has to tell "fix the change" from "the checker could
  # not judge it", and 1 is spoken for by findings.
  exit 2
}

# `set -e` otherwise exits in silence. The values are passed in as the trap fires: `$LINENO` read
# inside the trap body would name this file rather than the script that failed.
on_error() {
  local rc="$1" line="$2" cmd="$3"
  # The open section failed whatever its steps reached: a row reading `pass` beside a crash
  # statement misleads anyone scanning the table rather than the prose.
  _escalate 5
  # Outside the fold, for `refuse`'s reason.
  end_section
  printf '\n' >&2
  _emit "$C_RED" "   ✗" "${SELF##*/} failed
line ${line}:  ${cmd}
exit status ${rc}" >&2
  printf '\n' >&2
  if (( _CHROME )); then _closing crashed; fi
  # The exit contract, which a reader and a caller both depend on: 0 green, 1 findings, 2 refused,
  # 3 and up the script itself failing. The underlying status is printed above.
  if (( rc < 3 )); then rc=3; fi
  exit "$rc"
}
trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

# Bash runs no EXIT trap for a signal it was never told to catch. Exiting rather than re-raising
# fires each script's own EXIT trap, so fixtures and throwaway tags are still reclaimed.
on_interrupt() {
  spinner_stop
  printf '\n' >&2
  if (( _CHROME )); then
    _closing interrupted
  else
    _emit "$C_YELLOW" "  !!" "Interrupted — ${SELF##*/} stopped where it stood." >&2
  fi
  exit 130
}
trap on_interrupt INT TERM

# --- Guards ----------------------------------------------------------------------------------------

# Docker's own error ("npipe:////./pipe/...") explains nothing to anyone who has not seen it.
require_docker() {
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
    || die "Docker is not responding.
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
  [[ "$have" == "$want" ]] || die "This script targets ${want}; this machine looks like ${have}.
See scripts/README.md for which script belongs to which environment."
}

# The venv layout differs by platform, and `scripts/verify.sh` runs on both. Returns 1 rather than
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

# Wider than `venv_python`: the scope check runs on every `scripts/verify.sh` invocation, and
# skipping it for a missing backend virtualenv buys a prerequisite for nothing.
any_python() {
  local win="${REPO_ROOT}/fl_backend/.venv/Scripts/python.exe"
  local nix="${REPO_ROOT}/fl_backend/.venv/bin/python"
  if   [[ -x "$win" ]]; then printf '%s' "$win"
  elif [[ -x "$nix" ]]; then printf '%s' "$nix"
  elif command -v python3 >/dev/null 2>&1; then printf 'python3'
  elif command -v python  >/dev/null 2>&1; then printf 'python'
  else return 1
  fi
}

require_file() { [[ -f "$1" ]] || die "Missing required file: $1${2:+
$2}"; }
require_dir()  { [[ -d "$1" ]] || die "Missing required directory: $1${2:+
$2}"; }

# --- Git -------------------------------------------------------------------------------------------
git_sha()    { git rev-parse --short=7 HEAD; }
git_branch() { git rev-parse --abbrev-ref HEAD; }
git_clean()  { [[ -z "$(git status --porcelain)" ]]; }

# --- Health ----------------------------------------------------------------------------------------

# A started container and a working app are different statements: on a bad environment variable
# the frontend stays up and 500s on every route.
wait_healthy() {
  local compose_file="$1" service="$2" timeout="${3:-150}" waited=0 state cid rc log_tail matched
  info "waiting for '${service}' to become healthy (up to ${timeout}s)"
  while (( waited < timeout )); do
    rc=0
    cid="$(docker compose -f "$compose_file" ps -q "$service" 2>/dev/null)" || rc=$?
    # An unasked question and an answered one both leave `cid` empty, and "no running container"
    # about a daemon that never replied sends an operator to the container, not the engine.
    if (( rc )); then
      warn "could not ask compose about '${service}' — 'docker compose ps' exited ${rc}.
This says nothing about the container; the daemon or the compose file is what did not answer."
      return 1
    fi
    if [[ -z "$cid" ]]; then
      warn "'${service}' has no running container"
      docker compose -f "$compose_file" logs --tail=30 "$service" 2>&1 | detail
      return 1
    fi
    # A service with no healthcheck reports "" — treat "running" as good enough for those.
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
    case "$state" in
      healthy|running) ok "'${service}' is ${state}"; return 0 ;;
      unhealthy)
        warn "'${service}' reports UNHEALTHY. Its own explanation, if it gave one:"
        # Filtered in memory: `grep | head` fails the pipeline on SIGPIPE under `pipefail`, which
        # prints the arm below underneath the lines it just found.
        log_tail="$(docker compose -f "$compose_file" logs --tail=60 "$service" 2>&1 || true)"
        matched="$(printf '%s\n' "$log_tail" | grep -iE "invalid environment|failed to prepare|error|refused" || true)"
        if [[ -n "$matched" ]]; then
          printf '%s\n' "$matched" | excerpt 12
        elif [[ -n "$log_tail" ]]; then
          detail "(nothing in the log matches the usual causes — its last 30 lines follow)"
          printf '%s\n' "$log_tail" | tail -30 | detail
        else
          detail "(no log came back for '${service}' — ask compose yourself)" \
                 "   docker compose -f ${compose_file} logs ${service}"
        fi
        return 1 ;;
    esac
    sleep 3; waited=$(( waited + 3 ))
  done
  warn "'${service}' did not become healthy within ${timeout}s. Last 30 log lines:"
  docker compose -f "$compose_file" logs --tail=30 "$service" 2>&1 | detail
  return 1
}

# The empty string is the only sentinel for an absent label: a comparison or an interpolated
# command needs a value, and a prose one breaks both. Wording it is the display pair's job.
_image_label() {
  local image="$1" label="$2" value=""
  # Returns 1 where the inspect itself failed, so a caller can tell "no such label" from "nothing
  # answered" — `docker image inspect` prints an empty line for both.
  value="$(docker image inspect --format "{{index .Config.Labels \"${label}\"}}" "$image" 2>/dev/null)" \
    || return 1
  [[ "$value" == "<no value>" ]] && value=""
  printf '%s' "$value"
}
image_revision() { _image_label "$1" "org.opencontainers.image.revision"; }
image_created()  { _image_label "$1" "org.opencontainers.image.created";  }

# For status output only: never in a comparison or a command, where a sentence is not a status.
image_revision_display() {
  local v rc=0; v="$(image_revision "$1")" || rc=$?
  if (( rc )); then printf 'could not be read'
  elif [[ -n "$v" ]]; then printf '%s' "$v"
  else printf 'unlabelled (not built by publish.sh)'
  fi
}
image_created_display() {
  local v rc=0; v="$(image_created "$1")" || rc=$?
  if (( rc )); then printf 'could not be read'
  elif [[ -n "$v" ]]; then printf '%s' "$v"
  else printf 'unknown'
  fi
}
