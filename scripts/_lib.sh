#!/usr/bin/env bash
#
# SCRIPTS · shared helpers — sourced by every other script, never run directly.
#
# Anything more than one script needs lives here, so there is one copy to fix. Sourcing it also
# applies strict mode, installs the error and interrupt traps, and defines the run chrome — the
# sections, verdicts, closing table and statement every script's output is assembled from.
#
# See:
# - docs/ops/spec.md — the script conventions, and the output standard these helpers implement

set -euo pipefail
IFS=$'\n\t'

# Every script behaves identically whatever directory it was called from. Without this, a relative
# path fails with a "path not found" that depends on where the caller happened to stand.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Resolved BEFORE the cd below: `--help` reads a script's own header back, and a relative path stops
# resolving once we cd. The ${x-default} form (no colon) survives `set -u` even when the array
# element does not exist.
_caller="${BASH_SOURCE[1]-${BASH_SOURCE[0]-$0}}"
SELF="$(cd "$(dirname "$_caller")" && pwd)/$(basename "$_caller")"
unset _caller

cd "$REPO_ROOT"

# --- Image naming -----------------------------------------------------------------------------------

# One package per service (ADR-0012). The packages are public, which is what makes anonymous pulls
# work — no docker login on the server, and no token that expires mid-deploy. A pull failing to
# authenticate means a package was left private.
REGISTRY="ghcr.io"
# shellcheck disable=SC2034  # consumed by the scripts that source this file
REPO_FRONTEND="${REGISTRY}/felzab/frankfurtleague-frontend"
# shellcheck disable=SC2034  # consumed by the scripts that source this file
REPO_BACKEND="${REGISTRY}/felzab/frankfurtleague-backend"
# shellcheck disable=SC2034  # consumed by the scripts that source this file
IMAGE_FRONTEND="${REPO_FRONTEND}:latest"
# shellcheck disable=SC2034  # consumed by the scripts that source this file
IMAGE_BACKEND="${REPO_BACKEND}:latest"

# --- Output ----------------------------------------------------------------------------------------

# Every script speaks through the helpers below and nothing writes formatting of its own. The verbs,
# what each means and the line shape they print are the output standard in `docs/ops/spec.md` §1.7.

# Colour is on for a terminal and in GitHub Actions, whose log renders ANSI. NO_COLOR forces it off
# (https://no-color.org) and FORCE_COLOR forces it on — except FORCE_COLOR=0, which the npm
# ecosystem defines as "off" and which is honoured the same way.

# A worker is told the parent's answer, because it decides from `[[ -t 1 ]]` and its stdout is a
# file: left to itself it comes back uncoloured underneath a coloured table.

# The variable is the gate's own and never `NO_COLOR` or `FORCE_COLOR`. Those two are read by every
# tool a scope runs, so exporting either would change what prettier and pnpm print inside the scope
# as well as what the gate prints around it.
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

# Sections, their verdicts and their timings, in the order they opened. Every one of them sleeps
# until a script calls `section`: a script speaking only the verbs below prints exactly what it
# printed before the chrome existed.
_CHROME=0
_SECTION_NAMES=(); _SECTION_RANKS=(); _SECTION_MS=(); _SECTION_FINDINGS=(); _SECTION_ADVISORIES=()
_SECTION_OPEN=-1
_SECTION_T0=0
_STEP_MS0=""
_STEP_LABEL=""
_ENDED=0

# Counted for the whole run, not only for the open section: a finding recorded before the first
# `section` belongs to no row, and summing the rows alone would let a run close green over one the
# reader has just watched go past.

# Advisories count apart because they must not fail a run. Every bare `warn` here is one a run is
# meant to survive — an uncommitted publish, an unreadable header, a fresh upstream advisory — and
# `fail` is the verb for the other meaning.
_RUN_FINDINGS=0
_RUN_ADVISORIES=0

# The scopes a run's flags left out, named by whichever ending it reaches.

# Held here rather than at the call site because most endings exit where they stand, so only one of
# them is reachable from a call site — which is why a line printed there survives a serial ending
# and a replayed failure loses it.
_NOT_RUN=""

# Set here rather than in each script, so `quietly`, the spinner and `verbose` read one variable
# whoever the caller is. A script still owns the `--verbose)` arm of its own argument loop.
VERBOSE="${VERBOSE:-0}"

# One scope, run in its own process for a parent to replay in the run's serial order.

# The parent prints the closing table and statement once, for every scope it replayed, so a worker
# printing either would put a second summary inside the bytes being replayed verbatim.

# The environment carries it, not a flag: `scripts/selfcheck.sh` reads every double-dashed word in
# a script's header as a flag it must accept, so an internal one would be documented in `--help`
# as though a person could type it.
_WORKER=0
if [[ "${FL_GATE_WORKER:-}" == "1" ]]; then _WORKER=1; fi

# A verdict may only make a section's row worse, so one failed step is what the row reports however
# many passed around it. The last two ranks block a green run. The labels are padded as ASCII.

# `failed` outranks `refused` because a definite verdict is the more actionable of the two: where a
# section both failed a check and could not judge another, the failure is what a reader should see.
_RANK_LABELS=("no verdict" "skipped" "pass" "advisory" "refused" "failed")

# Milliseconds from bash's own clock rather than `date`: closing a step then costs no process, which
# is what makes per-step timing free on Windows, where the spawn is the expensive part.
_now_ms() {
  local t="${EPOCHREALTIME:-}"
  if [[ -n "$t" ]]; then
    # The separator is the locale's, and `10#` stops a leading zero being read as octal.
    printf '%s' "$(( ${t%%[.,]*} * 1000 + 10#${t#*[.,]} / 1000 ))"
  else
    printf '%s' "$(( SECONDS * 1000 ))"
  fi
}

# Rounded to seconds once, before the arms branch on it: rounding inside the seconds arm alone puts
# 119.7 s past its own bound and prints `120s` where the next arm would have said `2m 00s`.
fmt_ms() {
  local ms="$1" secs
  if (( ms < 0 )); then ms=0; fi
  secs=$(( (ms + 500) / 1000 ))
  if   (( ms < 10000 ));  then printf '%d.%ds' $(( ms / 1000 )) $(( (ms % 1000) / 100 ))
  elif (( secs < 120 )); then printf '%ds' "$secs"
  else printf '%dm %02ds' $(( secs / 60 )) $(( secs % 60 ))
  fi
}

# True only under `--verbose`, for a caller deciding between streaming and an overview. Call it in a
# condition: bare, a false answer is a non-zero status that `set -e` acts on.
verbose() { (( VERBOSE )); }

# True inside a worker, for a caller deciding whether the run's ending is its own to print. Call it
# in a condition, for the same reason `verbose` says: bare, a false answer is a status `set -e` acts
# on.
worker() { (( _WORKER )); }

# The scopes this run's flags left out, for the ending to name. Set once, by the parent, before
# anything can end: every ending reads it, and only the flags know it.
set_not_run() { _NOT_RUN="$*"; }

# Sourcing happens at the top of every script, so this is the run's start for every purpose the
# closing statement has.
_RUN_T0="$(_now_ms)"

# --- Spinner -----------------------------------------------------------------------------------------

# Motion for a human watching a terminal, and nothing else: off down a pipe, off in CI whose log is
# read later, off under `--verbose` where the tool's own output is the progress, and off under
# NO_SPINNER where a terminal mangles a carriage return.
if [[ -t 1 && -z "${CI:-}" && -z "${GITHUB_ACTIONS:-}" && -z "${NO_SPINNER:-}" ]]; then
  _SPINNER=1
  # A dup of the terminal, taken before any verb redirects: `warn` runs `_emit` with stdout pointed
  # at stderr, and the frame has to be erased from the screen it was drawn on rather than from
  # whatever that caller's stdout happens to be.
  exec {_SPIN_OUT}>&1
else
  _SPINNER=0
  _SPIN_OUT=1
fi
_SPIN_PID=""

# One `sleep` per frame is what a spinner costs in bash. The ways round it either leak a process
# that outlives the script or need a fifo to clean up, and at this frame rate the spawn is invisible
# beside the step being waited on.
spinner_start() {
  if (( ! _SPINNER || VERBOSE )); then return 0; fi
  # A stop inside a pipeline kills the frames in a subshell whose variables the caller never sees,
  # so a recorded pid is believed only while it answers. Reaping it keeps the job table a parallel
  # group can `wait` on clean.
  if [[ -n "$_SPIN_PID" ]]; then
    if kill -0 "$_SPIN_PID" 2>/dev/null; then return 0; fi
    wait "$_SPIN_PID" 2>/dev/null || true
    _SPIN_PID=""
  fi
  # No trap in here on purpose: Ctrl-C reaches the whole process group, and a spinner that ignored
  # it would keep drawing over the interrupt message.
  (
    # An array, and the backslash frame in ANSI-C quotes: inside single quotes shellcheck reads a
    # trailing backslash as an escape that was meant to be one.
    _f=('|' '/' '-' $'\\'); _i=0
    while :; do
      printf '\r%s   %s %s%s' "$C_DIM" "${_f[_i]}" "$1" "$C_RESET"
      _i=$(( (_i + 1) % ${#_f[@]} ))
      sleep 0.25
    done
  ) 1>&"$_SPIN_OUT" 2>/dev/null &
  _SPIN_PID=$!
}

# Called before anything else prints, so a frame can never be left half-drawn under a real line.
spinner_stop() {
  if [[ -z "$_SPIN_PID" ]]; then return 0; fi
  kill "$_SPIN_PID" 2>/dev/null || true
  # Reaping is what stops the shell announcing the killed job later; the status is a signal, so it
  # is discarded rather than checked.
  wait "$_SPIN_PID" 2>/dev/null || true
  _SPIN_PID=""
  # Erase rather than overwrite: the frame's width is the step label's, which nothing here tracks.
  printf '\r\033[2K' 1>&"$_SPIN_OUT"
}

# The funnel every verb below uses but `step` and `detail`, which own their line shapes. Tags arrive
# pre-padded because printf's %4s pads by BYTES and mis-pads the multibyte tags.
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

# An advisory, never a finding: `publish.sh --allow-dirty` and the frontend's audit both warn and
# are meant to carry on, so counting one here would fail a run this repository has always let
# pass. Use `fail` where the run must not stay green.
warn() { _emit "$C_YELLOW" "  !!" "$*" >&2; _record_advisory; }

# `fail` records what `die` records and keeps going, for a script collecting every finding before it
# reports. It closes the step too: a second verdict carries no duration, because an elapsed time on
# a step still running means nothing.
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

# Deliberately starts no spinner: a step cannot know whether its work streams, and `docker build`,
# `pull` and `push` all run unwrapped. A frame ends without a newline, so it and the tool's line
# would share one. Only `quietly` may spin.
step() {
  spinner_stop
  _STEP_T0=$SECONDS
  _STEP_MS0="$(_now_ms)"
  _STEP_LABEL="$*"
  printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_RESET"
}

# ok appends the running step's elapsed time once it is long enough to be worth reading — that is
# what makes a slow gate's log answer "where did the minutes go" without any caller keeping time.

# Under a section every step closes with its duration, however short. The table's rows are sums of
# these, and a total no line itemises is a number nobody can act on.
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

# Supporting output belonging to the line above it — a log excerpt, a findings list, a block of
# follow-up commands — indented to the same message column, from arguments or from stdin.
detail() {
  spinner_stop
  if (( $# )); then printf '      %s\n' "$@"
  else sed 's/^/      /'
  fi
}

# The first few lines of something long, then a count — the shape that replaces a per-file listing.
# `--verbose` is where the whole thing belongs, and the tail line says so rather than assuming it.
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

# Left readable because `add_findings <n>` needs a count only the checker's own output carries, and
# a caller re-running the tool to read it back would pay for the gate's slowest steps twice. Empty
# under `--verbose`, where nothing is captured to leave.

QUIETLY_OUTPUT=""

# Captures a command's output and prints it through `detail` only on failure, so a green run stays
# readable and a red one loses nothing. VERBOSE=1 streams instead of capturing.
quietly() {
  local out rc=0
  QUIETLY_OUTPUT=""
  if (( VERBOSE )); then
    "$@" || rc=$?
  else
    # The one wrapper the spinner needs: a captured command is exactly the stretch where a run looks
    # hung, and the label is the open step's rather than anything a caller has to repeat.
    if (( _CHROME )); then spinner_start "$_STEP_LABEL"; fi
    out="$("$@" 2>&1)" || rc=$?
    spinner_stop
    # shellcheck disable=SC2034  # consumed by the scripts that source this file
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

# Prints this script's own header comment as its help text, so usage can never drift from the
# code. Stops at the first line that is not a comment.
usage() {
  awk 'NR>1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$SELF"
  exit 0
}

# --- Sections ----------------------------------------------------------------------------------------

# The bookkeeping helpers return 0 whatever they decided. A verb's status is the caller's control
# flow, and one answering "nothing to record" with 1 would trip `set -e` at the call site.
_escalate() {
  if (( ! _CHROME || _SECTION_OPEN < 0 )); then return 0; fi
  if (( $1 > _SECTION_RANKS[_SECTION_OPEN] )); then _SECTION_RANKS[_SECTION_OPEN]=$1; fi
  return 0
}

# What a checker printed for itself: the shell counts its own `warn` and `fail` lines, and a tool
# that reported six findings in one block says so here rather than being counted as one.

# The run total is kept whether or not a section is open, and whether or not one ever was, because
# it is what `finish` tests before it is allowed to say green.
add_findings() {
  _RUN_FINDINGS=$(( _RUN_FINDINGS + $1 ))
  if (( ! _CHROME || _SECTION_OPEN < 0 )); then return 0; fi
  _SECTION_FINDINGS[_SECTION_OPEN]=$(( _SECTION_FINDINGS[_SECTION_OPEN] + $1 ))
  if (( $1 > 0 )); then _escalate 5; fi
  return 0
}

# Kept per section as well as per run so a worker's ledger can carry it home: a count held only as
# a run total has no row to travel in. The closing table shows findings alone, so the column changes
# no output.
_record_advisory() {
  _RUN_ADVISORIES=$(( _RUN_ADVISORIES + 1 ))
  if (( _CHROME && _SECTION_OPEN >= 0 )); then
    _SECTION_ADVISORIES[_SECTION_OPEN]=$(( _SECTION_ADVISORIES[_SECTION_OPEN] + 1 ))
  fi
  _escalate 3
}

# The dim elapsed-time tail a verdict carries, empty outside a section and empty once the open step
# has already been closed — one verdict per step is what makes the closing table's sums honest.
_step_suffix() {
  if (( ! _CHROME )) || [[ -z "$_STEP_MS0" ]]; then return 0; fi
  printf '   %s%s%s' "$C_DIM" "$(fmt_ms $(( $(_now_ms) - _STEP_MS0 )))" "$C_RESET"
  return 0
}

# Opens a section and closes the one before it. The first call is what wakes the chrome: from here
# the closing table has rows, steps carry durations, and a spinner runs on a terminal.
section() {
  # `IFS` is $'\n\t' repo-wide, so an unlocalised `$*` would join a two-word name with a newline and
  # break both the heading and its table cell. Localised here rather than in `_emit`, whose
  # newline-joining is what gives every verb its multi-line message.
  local IFS=' '
  local name="$*" pad
  end_section
  _CHROME=1
  _SECTION_NAMES+=("$name"); _SECTION_RANKS+=(0); _SECTION_MS+=(0)
  _SECTION_FINDINGS+=(0); _SECTION_ADVISORIES+=(0)
  _SECTION_OPEN=$(( ${#_SECTION_NAMES[@]} - 1 ))
  _SECTION_T0="$(_now_ms)"
  # One fold per section is the whole reason the grouping exists in the Actions log. Findings
  # annotations stay off: they surface out of order and duplicate the closing table.
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    printf '::group::%s\n' "$name"
  else
    printf -v pad '%*s' "$(( ${#name} < 66 ? 66 - ${#name} : 3 ))" ''
    printf '\n%s▌ %s %s%s\n' "$C_BOLD" "$name" "${pad// /─}" "$C_RESET"
  fi
  # A script installing its own INT trap replaces `on_interrupt` and loses the statement, the table
  # and `spinner_stop` — silently, since a trap nobody fires announces nothing. A section is where
  # a rewired script first reaches this library.
  if [[ "$(trap -p INT)" != *on_interrupt* ]]; then
    warn "this script re-trapped INT, so Ctrl-C no longer reaches ${SELF##*/}'s closing statement.
Remove it: scripts/_lib.sh traps INT and exits 130, which fires this script's own EXIT trap."
  fi
}

# Closes the open section without ending the run — the Actions fold with it. `section` and the
# closing statements call it themselves; a script needs it only to print outside every group.
end_section() {
  spinner_stop
  _STEP_MS0=""
  if (( _SECTION_OPEN < 0 )); then return 0; fi
  _SECTION_MS[_SECTION_OPEN]=$(( $(_now_ms) - _SECTION_T0 ))
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then printf '::endgroup::\n'; fi
  _SECTION_OPEN=-1
}

# One row per section, colour-coded by verdict. The columns are padded before the colour is wrapped
# round them, because printf counts an escape sequence's bytes as width.
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

# The closing statement, one per end state, printed once. A run that stops without one has crashed
# in a way nothing here saw, which is itself the thing a reader needs to be able to tell.
_closing() {
  local state="$1" extra="${2:-}" count elapsed advisories=""
  if (( _ENDED )); then return 0; fi
  _ENDED=1
  end_section
  # Every ending verb routes through here, so this line is what makes each of them safe in a
  # worker: they still print their own verdict and exit with their own code, and none prints a
  # summary of a run it can see one scope of.

  # Below `end_section` rather than above it: a worker's rows travel to its parent, and a
  # duration read from a section still running is not one.
  if (( _WORKER )); then return 0; fi

  # Above the table it completes — the rows name the scopes that ran, this line names the rest — and
  # below the worker's return, because a worker's idea of what was left out is every scope but its
  # own.
  if [[ -n "$_NOT_RUN" ]]; then skip "not run:${_NOT_RUN}"; fi
  _summary_table
  count="${#_SECTION_NAMES[@]}"
  elapsed="$(fmt_ms $(( $(_now_ms) - _RUN_T0 )))"
  # A count of zero is a non-empty string, so the ${x:+…} form cannot decide this one.
  if (( _RUN_ADVISORIES )); then advisories=" ${_RUN_ADVISORIES} advisory line(s) above."; fi
  case "$state" in
    # Advisories are named in the green statement rather than left out of it, so a run cannot
    # report "no findings" over a warning still on the reader's screen.
    green)
      ok "Green — ${count} section(s), no findings, ${elapsed}.${advisories}${extra:+ ${extra}}" ;;
    # The count is the run's, which can exceed the table's column sums: a finding recorded before
    # the first section belongs to no row. "In the section it came from" survives Actions folding,
    # where "the lines above" would point into something collapsed.
    findings)
      _emit "$C_RED" "   ✗" "${_RUN_FINDINGS} finding(s) in this run, ${count} section(s), ${elapsed}. Each is
named in the section it came from, and each names something to fix in the change — exit 1." >&2 ;;
    # Worded against both neighbours, because the exit code alone is what a reader is least likely
    # to have memorised: a refusal is not a finding to fix and not a crash to repair.
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

# Exits, rather than returning a status for a caller to act on: a run has exactly one ending, and a
# script free to carry on past its own closing statement can print a second one under it.

# A sentence passed in is appended to the GREEN statement only — "safe to merge" is the one thing a
# caller knows that this does not, and it is nonsense under any of the other four endings.
finish() {
  local i count worst=0
  end_section
  count="${#_SECTION_NAMES[@]}"
  # A section that closed with no verdict is a caller defect, and calling it green would print "no
  # findings" beside a row reading `no verdict`. `fail`, not `warn`: a section proving nothing is
  # what this standard exists to stop a run passing on.
  for (( i = 0; i < count; i++ )); do
    if (( _SECTION_RANKS[i] == 0 )); then
      fail "section '${_SECTION_NAMES[i]}' closed with no verdict — nothing in it proves anything"
    fi
    if (( _SECTION_RANKS[i] > worst )); then worst=${_SECTION_RANKS[i]}; fi
  done
  # A run whose worst outcome is a refusal ends as a refusal, not as findings. Reachable through an
  # adopted row as well as a direct `refuse`: a worker that could not judge its input has the same
  # ending whether its scope ran here or in its own process.
  if (( _RUN_FINDINGS > 0 || worst >= 5 )); then _closing findings; exit 1; fi
  if (( worst == 4 )); then _closing refused; exit 2; fi
  _closing green "$*"
  exit 0
}

# --- Sections a worker ran ---------------------------------------------------------------------------

# Concurrent scopes print nothing where they stand: each captures its own output, and a parent
# replays the captures in a fixed order so a parallel run reads as a serial one.

# The ledger is what a capture cannot carry home, and the verbs below move it: a pair for the rows,
# and a pair for the endings no row can express.

# The worker half. One tab-separated line per section — rank, milliseconds, findings, advisories,
# then the name, last because it is the only field that may hold a space. Redirect it to a file: a
# worker's stdout is the output its parent replays.
emit_section_ledger() {
  local i count="${#_SECTION_NAMES[@]}" sum_f=0 sum_a=0
  for (( i = 0; i < count; i++ )); do
    sum_f=$(( sum_f + _SECTION_FINDINGS[i] ))
    sum_a=$(( sum_a + _SECTION_ADVISORIES[i] ))
  done
  # Refused rather than dropped. Anything recorded before the section opened has no row to travel
  # in, and a parent that never hears of it reports a clean scope over a real finding — the failure
  # this standard exists to prevent, hidden where nobody looks.
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

# The end of a worker that reached the end of its scope. `finish` is what a script calls there and
# what a worker may never call: it prints the table and speaks for every scope in the run.

# All a worker owes its parent is the status its own rows already imply, which the parent re-derives
# from those rows — so the two cannot disagree about how the run ended.
end_worker() {
  end_section
  if (( _RUN_FINDINGS > 0 )); then exit 1; fi
  exit 0
}

# The parent half: a completed section recorded into this run's table and totals, printing nothing.
# The bytes and the ledger travel apart, so anything printed here would appear twice or out of the
# order the replay exists to fix.

# An adopted row is deliberately indistinguishable from one run in-process. Marking it would make a
# parallel run's table differ from the serial table it has to match byte for byte, which is the
# guarantee the whole grouping rests on.
adopt_section() {
  local name="$1" rank="$2" ms="$3" findings="$4" advisories="${5:-0}" value
  # A worker reports these through a file, so they are input rather than literals: an unchecked one
  # indexes past the label table and takes the closing summary down with it.
  for value in "$rank" "$ms" "$findings" "$advisories"; do
    [[ "$value" =~ ^[0-9]+$ ]] \
      || die "adopt_section: '${value}' is not a count. Arguments: name rank ms findings [advisories]."
  done
  (( rank <= 5 )) || die "adopt_section: rank ${rank} is outside 0-5."
  # A row appended under an open section would sort before the section that is still running, and
  # the fixed order is the entire point of adopting rather than printing.
  (( _SECTION_OPEN < 0 )) || die "adopt_section: a section is still open. Call end_section first."
  _CHROME=1
  _SECTION_NAMES+=("$name"); _SECTION_RANKS+=("$rank"); _SECTION_MS+=("$ms")
  _SECTION_FINDINGS+=("$findings"); _SECTION_ADVISORIES+=("$advisories")
  _RUN_FINDINGS=$(( _RUN_FINDINGS + findings ))
  _RUN_ADVISORIES=$(( _RUN_ADVISORIES + advisories ))
  return 0
}

# The two endings a row cannot carry. `on_error` and `on_interrupt` rank their section `failed`
# on the way out, so a parent reading rows alone would report a crash or an interrupt as
# findings — the wrong statement, and the wrong code.

# Every other status returns, the rows being the whole story there: `die` ranks its section 5 and
# `refuse` ranks it 4, and `finish` reads each back as the ending the serial run would have
# printed.
adopt_ending() { # $1 the worker's exit status
  local rc="$1"
  [[ "$rc" =~ ^[0-9]+$ ]] || die "adopt_ending: '${rc}' is not an exit status."
  if (( rc == 130 )); then _closing interrupted; exit 130; fi

  # A killed worker is a crash like any other, but the status a kill leaves is not a number `exit`
  # can return: measured on Windows, `kill -9` on a worker reports 2304, which masks to 0.

  # So it is classified on the raw value and reported as the floor. Masking first would close the
  # run green over a scope that was killed.
  if (( rc > 255 )); then rc=3; fi
  if (( rc >= 3 )); then _closing crashed; exit "$rc"; fi
  return 0
}

# A deliberate refusal, its own ending rather than a shade of a pass or a failure: ADR-0030's scope
# refusal is one, a checker meeting an input outside its parsed subset another. In both the check
# ran, and its result cannot stand as a verdict.

# Ranked below `failed` and above `pass`, so a step that passed before the refusal cannot leave the
# row reading green — the same rule that keeps an advisory from passing as a verdict.
refuse() {
  _escalate 4
  # Closed first, so the message lands outside the Actions fold: the closing statement points at it
  # from outside, and a reader told to look above must not be sent into something collapsed.
  end_section
  printf '\n' >&2
  _emit "$C_RED" "   ✗" "$*" >&2
  _closing refused
  # 2, not 1: a caller branching on the code has to tell "fix the change" from "the checker could
  # not judge it", and 1 is spoken for by findings.
  exit 2
}

# Report exactly what failed when a script dies unexpectedly: `set -e` otherwise exits in complete
# silence. The three values are passed in at the moment the trap fires, which is what makes them
# accurate.

# `$2` is the line a reader should open — a helper reporting for call sites it does not own passes
# the caller's, and the ERR trap passes `$LINENO`, which inside the trap body would name this file
# rather than the script that failed.
on_error() {
  local rc="$1" line="$2" cmd="$3"
  # The open section failed, whatever its steps had reached: a row still reading `pass` beside a
  # crash statement misleads anyone scanning the table rather than the prose.
  _escalate 5
  # Same reason as `refuse`: the script/line/status block is what the closing statement points at,
  # so it belongs outside the fold rather than inside the section that happened to be open.
  end_section
  printf '\n' >&2
  _emit "$C_RED" "   ✗" "${SELF##*/} failed
line ${line}:  ${cmd}
exit status ${rc}" >&2
  printf '\n' >&2
  if (( _CHROME )); then _closing crashed; fi
  # The floor a reader and a caller both depend on: 0 green, 1 findings, 2 a refusal, 3 and up the
  # script itself failing. The underlying status is printed above, so raising it loses nothing.
  if (( rc < 3 )); then rc=3; fi
  exit "$rc"
}
trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

# Ctrl-C during a slow step is the realistic interrupt, and bash runs no EXIT trap for a signal it
# was never told to catch.

# Exiting rather than re-raising is deliberate: it fires each script's own EXIT trap, so fixtures,
# stand-in env files and throwaway image tags are still reclaimed.
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

# Docker Desktop stops more often than expected, and its raw error ("npipe:////./pipe/...") explains
# nothing to anyone who has not seen it before.
require_docker() {
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
    || die "Docker is not responding.
Start Docker Desktop (Windows) or 'sudo systemctl start docker' (Linux),
wait until it reports running, then try again."
}

# Keeps the prod script off a laptop and the local script off the server. Both mistakes are one
# mistyped filename away and both are disruptive.
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

# Absolute path to fl_backend's virtualenv interpreter. The venv layout differs by platform --
# Scripts/python.exe on Windows, bin/python on Linux -- and verify.sh runs on both.

# Returns 1 rather than dying, because every caller reads it through `$( )`: a `die` there exits the
# subshell alone, the caller's assignment then fails, and the ERR trap prints a stack block under
# the message that already said what to do.
venv_python() {
  local win="${REPO_ROOT}/fl_backend/.venv/Scripts/python.exe"
  local nix="${REPO_ROOT}/fl_backend/.venv/bin/python"
  if   [[ -x "$win" ]]; then printf '%s' "$win"
  elif [[ -x "$nix" ]]; then printf '%s' "$nix"
  else return 1
  fi
}

# Any interpreter able to run the stdlib-only checkers in scripts/: the backend venv's where it
# exists, otherwise whatever is on PATH. Prints nothing and returns 1 when there is none.

# Deliberately wider than `venv_python`: the scope check runs on every verify.sh invocation,
# `--frontend` included, and skipping it for a missing backend virtualenv buys a prerequisite for
# nothing. The caller decides what an absent one means.
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

# A started container and a working app are different statements: on a bad environment variable the
# frontend stays up and 500s on every route, so the healthcheck fails and nginx serves nothing —
# fail-closed, and invisible unless something waits on it.
wait_healthy() {
  local compose_file="$1" service="$2" timeout="${3:-150}" waited=0 state cid rc
  info "waiting for '${service}' to become healthy (up to ${timeout}s)"
  while (( waited < timeout )); do
    rc=0
    cid="$(docker compose -f "$compose_file" ps -q "$service" 2>/dev/null)" || rc=$?
    # An unasked question and an answered one both leave `cid` empty, and an operator reads this
    # while a deploy is in trouble: "no running container" about a daemon that never replied sends
    # them to the container while the fault is in the engine.
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
        docker compose -f "$compose_file" logs --tail=60 "$service" 2>&1 \
          | grep -iE "invalid environment|failed to prepare|error|refused" | head -12 | detail \
          || detail "(nothing obvious in the log — see the full log below)"
        return 1 ;;
    esac
    sleep 3; waited=$(( waited + 3 ))
  done
  warn "'${service}' did not become healthy within ${timeout}s. Last 30 log lines:"
  docker compose -f "$compose_file" logs --tail=30 "$service" 2>&1 | detail
  return 1
}

# Reads one OCI label off an image, or returns empty where it is absent. `docker image inspect`
# succeeds and prints an empty line for a missing label, so a trailing `|| echo unknown` never
# fires — hence the explicit emptiness test.

# These return the raw value with exactly one sentinel, the empty string: deploy.sh compares the
# value and interpolates it into a suggested command, and a prose sentinel breaks both. Formatting
# for humans belongs to the caller.
_image_label() {
  local image="$1" label="$2" value=""
  value="$(docker image inspect --format "{{index .Config.Labels \"${label}\"}}" "$image" 2>/dev/null)" || true
  [[ "$value" == "<no value>" ]] && value=""
  printf '%s' "$value"
}
image_revision() { _image_label "$1" "org.opencontainers.image.revision"; }
image_created()  { _image_label "$1" "org.opencontainers.image.created";  }

# Human-readable form for status output only. Never use this in a comparison or a command.
image_revision_display() {
  local v; v="$(image_revision "$1")"
  [[ -n "$v" ]] && printf '%s' "$v" || printf 'unlabelled (not built by publish.sh)'
}
image_created_display() {
  local v; v="$(image_created "$1")"
  [[ -n "$v" ]] && printf '%s' "$v" || printf 'unknown'
}
