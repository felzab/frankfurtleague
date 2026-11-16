#!/usr/bin/env bash
# Sourced, never run directly.
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
_ROWS_ENDED=0

# Where a scope the gate runs beside others leaves its count of findings for the runner's table. Read
# once and unset, so no script this run starts can write over it.
_FINDINGS_FILE="${FL_GATE_FINDINGS_FILE:-}"
unset FL_GATE_FINDINGS_FILE

# Run-wide, not per section: a finding before the first `section` has no row, and summing rows
# alone would close a run green over it. Advisories count apart, never failing a run.
_RUN_FINDINGS=0
_RUN_ADVISORIES=0

VERBOSE="${VERBOSE:-0}"

# A verdict may only make a row worse. `failed` outranks `refused`: where a section produced both,
# the definite verdict is the actionable one. A crash and an interrupt end the run where they happen.
_RANK_LABELS=("no verdict" "pass" "advisory" "refused" "failed" "crashed" "interrupted")

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

# Tags arrive pre-padded because printf's %4s pads by BYTES and mis-pads the multibyte tags.
_emit() {
  local colour="$1" tag="$2" first=1 line
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

info() { _emit "$C_BLUE"   "   ·" "$*"; }

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
  _record_finding
  _STEP_MS0=""
}

die() {
  local s; s="$(_step_suffix)"
  if [[ "${1-}" == --summary ]]; then shift; else _annotate "$*"; fi
  printf '\n' >&2
  _emit "$C_RED" "   ✗" "$*${s}" >&2
  printf '\n' >&2
  if (( _CHROME )); then _record_finding; _closing findings; fi
  exit 1
}

step() {
  _STEP_MS0="$(_now_ms)"
  _STEP_LABEL="$*"
  printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_RESET"
}

# Under a section every step carries its duration, because a total no line itemises is one
# nobody can act on. The section's own row is a wall clock, which its steps sum to only while
# they run in order.
ok() {
  local suffix
  suffix="$(_step_suffix)"
  _escalate 1
  _emit "$C_GREEN" "  ok" "$*${suffix}"
  _STEP_MS0=""
}

# Six spaces, the continuation indent every verb's later lines take.
detail() {
  if (( $# )); then printf '      %s\n' "$@"
  else sed 's/^/      /'
  fi
}

# Readable because a caller grades a failure by the tool's own words, and re-running the tool to
# read them back would pay for the gate's slowest steps twice.
QUIETLY_OUTPUT=""
# The streaming arm's copy while its command runs, so an interrupt can reclaim it.
_QUIETLY_CAPTURE=""

# `--exits` reads the status through `exit_class`, so a tool whose clean answer is not 0 replays only
# where its class is not clean.
quietly() { # [--exits <tables>] the command
  local out rc=0 class exits=""
  local -a piped=() said=()
  if [[ "${1-}" == --exits ]]; then exits="$2"; shift 2; fi
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
    out="$("$@" 2>&1)" || rc=$?
    class="$rc"
    if [[ -n "$exits" ]]; then class=0; exit_class "$exits" "$rc" || class=$?; fi
    # As arguments, one per line: a here-string yields at least one, so `detail` never reads stdin.
    if (( class )); then mapfile -t said <<<"$out"; detail "${said[@]}"; fi
  fi
  # shellcheck disable=SC2034  # read by the scripts that source this file
  QUIETLY_OUTPUT="$out"
  return "$rc"
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

# The run total is kept open section or not: `finish` tests it before green.
_record_finding() {
  _RUN_FINDINGS=$(( _RUN_FINDINGS + 1 ))
  if (( _CHROME && _SECTION_OPEN >= 0 )); then
    _SECTION_FINDINGS[_SECTION_OPEN]=$(( _SECTION_FINDINGS[_SECTION_OPEN] + 1 ))
  fi
  _escalate 4
}

_record_advisory() {
  _RUN_ADVISORIES=$(( _RUN_ADVISORIES + 1 ))
  if (( _CHROME && _SECTION_OPEN >= 0 )); then
    _SECTION_ADVISORIES[_SECTION_OPEN]=$(( _SECTION_ADVISORIES[_SECTION_OPEN] + 1 ))
  fi
  _escalate 2
}

# Empty once the open step is closed: one verdict per step is what makes the closing table's sums
# honest. Outside a section only for a step long enough to notice, where every quick step of a
# plain script would print a zero.
_step_suffix() {
  local ms
  if [[ -z "$_STEP_MS0" ]]; then return 0; fi
  ms=$(( $(_now_ms) - _STEP_MS0 ))
  if (( ! _CHROME && ms < 3000 )); then return 0; fi
  printf '   %s%s%s' "$C_DIM" "$(fmt_ms "$ms")" "$C_RESET"
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
}

# Called directly only to print outside every Actions group.
end_section() {
  _STEP_MS0=""
  if (( _SECTION_OPEN < 0 )); then return 0; fi
  _SECTION_MS[_SECTION_OPEN]=$(( $(_now_ms) - _SECTION_T0 ))
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then printf '::endgroup::\n'; fi
  _SECTION_OPEN=-1
}

# The name column's width, every row's name known before the first row prints.
_table_width() {
  local name w=7
  for name in "${_SECTION_NAMES[@]}"; do
    if (( ${#name} > w )); then w=${#name}; fi
  done
  printf '%s' "$w"
}

_table_header() {
  printf '\n      %s%-*s  %-11s  %9s  %8s%s\n' "$C_DIM" "$(_table_width)" "section" "result" "duration" "findings" "$C_RESET"
}

# Padded before the colour wraps it: printf counts an escape sequence's bytes as width.
_table_row() { # $1 the row's index
  local rank="${_SECTION_RANKS[$1]}" colour
  case "$rank" in
    1) colour="$C_GREEN" ;;
    2|6) colour="$C_YELLOW" ;;
    3|4|5) colour="$C_RED" ;;
    *) colour="$C_DIM" ;;
  esac
  printf '      %-*s  %s%-11s%s  %9s  %8s\n' \
    "$(_table_width)" "${_SECTION_NAMES[$1]}" "$colour" "${_RANK_LABELS[rank]}" "$C_RESET" \
    "$(fmt_ms "${_SECTION_MS[$1]}")" "${_SECTION_FINDINGS[$1]}"
}

# For a run of more than one row alone: a run of one section has just said all its row would.
_summary_table() {
  local i count="${#_SECTION_NAMES[@]}"
  if (( count < 2 )); then return 0; fi
  _table_header
  for (( i = 0; i < count; i++ )); do _table_row "$i"; done
}

# A row of the closing table for a unit run as a process of its own, such as a scope run beside
# others. It starts with no verdict, so a unit that never reports one closes the run as a finding.
add_row() {
  local IFS=' '
  _SECTION_NAMES+=("$*"); _SECTION_RANKS+=(0); _SECTION_MS+=(0)
  _SECTION_FINDINGS+=(0); _SECTION_ADVISORIES+=(0)
}

# A row's verdict, printed as a line of the table the moment it arrives, the header before the first.
end_row() { # $1 the row's index · $2 its rank · $3 its milliseconds · $4 its findings
  _SECTION_RANKS[$1]=$2; _SECTION_MS[$1]=$3; _SECTION_FINDINGS[$1]=$4
  _RUN_FINDINGS=$(( _RUN_FINDINGS + $4 ))
  if (( ! _ROWS_ENDED )); then _table_header; _ROWS_ENDED=1; fi
  _table_row "$1"
}

# One per end state, printed once: a run stopping without one crashed in a way nothing here saw,
# which is itself what the reader needs to be told.
_closing() { # $1 the ending · $2 a sentence for the green statement · $3 what ran, as it names it
  local state="$1" extra="${2:-}" what="${3:-}" count elapsed advisories=""
  if (( _ENDED )); then return 0; fi
  _ENDED=1
  end_section
  if [[ -n "$_FINDINGS_FILE" ]]; then printf '%s\n' "$_RUN_FINDINGS" > "$_FINDINGS_FILE" || true; fi
  _summary_table
  count="${#_SECTION_NAMES[@]}"
  if [[ -z "$what" ]]; then what="${count} section(s)"; fi
  elapsed="$(fmt_ms $(( $(_now_ms) - _RUN_T0 )))"
  # A count of zero is a non-empty string, so the ${x:+…} form cannot decide this one.
  if (( _RUN_ADVISORIES )); then advisories=" ${_RUN_ADVISORIES} advisory line(s) above."; fi
  case "$state" in
    # Named in the green statement, so a run cannot report "no findings" over a warning on screen.
    green)
      printf '
'
      ok "Green — ${what}, no findings, ${elapsed}.${advisories}${extra:+ ${extra}}" ;;
    # "In the section it came from" survives Actions folding, where "the lines above" would not.
    findings)
      printf '
' >&2
      _emit "$C_RED" "   ✗" "${_RUN_FINDINGS} finding(s) in this run, ${count} section(s), ${elapsed}. Each is
named in the section it came from, and each names something to fix in the change — exit 1." >&2 ;;
    refused)
      printf '
' >&2
      _emit "$C_RED" "   ✗" "Refused after ${elapsed}, so nothing here stands as a verdict on the change and the
refusal above names what could not be judged. Not findings, which would name what to
fix; not a crash, which would mean the check never ran at all — exit 2." >&2 ;;
    crashed)
      printf '
' >&2
      _emit "$C_RED" "   ✗" "Crashed after ${elapsed}. A line above names the script itself failing rather than
anything about the change, and nothing past that line ran — exit 3 or more." >&2 ;;
    interrupted)
      printf '
' >&2
      _emit "$C_YELLOW" "  !!" "Interrupted after ${elapsed}. The sections that had opened are all there is, and
none is a verdict on the change (exit 130)." >&2 ;;
  esac
  return 0
}

# Exits rather than returning: a script free to carry on past its closing statement prints a
# second one. A sentence passed in is appended to the green statement alone, and `--what` names what
# ran there in place of the count of sections.
finish() { # [--what <what ran>] · a sentence for the green statement
  local i count what="" failed=0 refused=0 crashed=0 interrupted=0
  if [[ "${1-}" == --what ]]; then what="$2"; shift 2; fi
  end_section
  count="${#_SECTION_NAMES[@]}"
  # A section closing with no verdict is a caller defect: green would print "no findings" beside a
  # row reading `no verdict`. `fail`, not `warn` — a section proving nothing must not pass.
  for (( i = 0; i < count; i++ )); do
    if (( _SECTION_RANKS[i] == 0 )); then
      fail "section '${_SECTION_NAMES[i]}' closed with no verdict — nothing in it proves anything"
    fi
    case "${_SECTION_RANKS[i]}" in
      3) refused=1 ;;
      4) failed=1 ;;
      # Only a row run elsewhere arrives here so: this process's own crash or interrupt has exited.
      5) crashed=1 ;;
      6) interrupted=1 ;;
    esac
  done
  # First, as an interrupt ends a run of this process whatever it had recorded: the run is not whole.
  if (( interrupted )); then _closing interrupted; exit 130; fi
  if (( _RUN_FINDINGS > 0 || failed )); then _closing findings; exit 1; fi
  if (( refused )); then _closing refused; exit 2; fi
  if (( crashed )); then _closing crashed; exit 3; fi
  _closing green "$*" "$what"
  exit 0
}

# Its own ending: the check ran and its result cannot stand as a verdict. Ranked above `pass`, so
# a step that passed before the refusal cannot leave the row reading green.
refuse() {
  _escalate 3
  # Closed first, so the message lands outside the Actions fold: a reader told to look above must
  # not be sent into something collapsed.
  end_section
  _annotate "$*"
  printf '\n' >&2
  _emit "$C_RED" "   ✗" "$*" >&2
  # As `die` and an interrupt: a script speaking the verbs plainly ends on its own sentence.
  if (( _CHROME )); then _closing refused; fi
  # 2, not 1: a caller branching on the code has to tell "fix the change" from "the checker could
  # not judge it", and 1 is spoken for by findings.
  exit 2
}

# `set -e` otherwise exits in silence. A library helper passes $4, the file its line is in, read off
# `BASH_SOURCE` at that line's frame: its caller may be a sourced file rather than the script.
on_error() {
  local rc="$1" line="$2" cmd="$3" file="${4:-$SELF}"
  local where="${file##*/}"
  # The open section crashed whatever its steps reached: a row reading `pass` beside a crash
  # statement misleads anyone scanning the table rather than the prose.
  _escalate 5
  # Outside the fold, so a reader told to look above is not sent into something collapsed.
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
  _escalate 6
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

# --- The exit contract -------------------------------------------------------------------------------

# Each tool's own exit statuses, read into the contract every script here answers on: 0 clean,
# 1 findings, 2 refused, 3 crashed. Each row is the tool's documentation for the release this
# repository pins, and every row reads it by one rule:
# - 1 is the status by which the tool reports what it found;
# - 2 is one by which the tool, having started, says in its own words that it could not judge: an
#   input it could not read, a network it could not reach, a configuration it could not load;
# - 3 is one saying our invocation was wrong or the tool itself died, one the tool shares between
#   either of those and anything else, and any status its documentation does not name.
# A status no row names is 3, and 130, the shell's for a command a SIGINT ended, is 130 in every row.
declare -grA EXIT_CODES=(
  # This repository's scripts, and every checker on scripts/lib/checker_kernel.py.
  [contract]="0:0 1:1 2:2"
  # A tool documenting 1 for what it found and every other failure as its own, or no other status.
  [tool]="0:0 1:1"
  # `docker run`'s own statuses, which come ahead of the container's: 125 the daemon failed, so
  # nothing ran; 126 and 127 the image cannot invoke or find its command.
  [docker]="125:2 126:3 127:3"
  # 0.24.2: 1 missing inputs, a runtime failure or a configuration error, 2 a link that failed, 3 an
  # error in the config file.
  [lychee]="0:0 1:2 2:1 3:2"
  # 1.32.0: 1 an error during the audit, a GitHub API it could not reach among them, 2 an argument it
  # could not parse, 3 no input collected, 11 to 14 findings by their highest severity. Nothing
  # answers 10 since 1.14.0.
  [zizmor]="0:0 1:2 2:3 3:2 11:1 12:1 13:1 14:1"
  # 0.11.0: 2 a file it could not process, 3 and 4 a flag or an option it was handed wrong.
  [shellcheck]="0:0 1:1 2:2 3:3 4:3"
  # 1.7.12: 2 an invalid command-line option, which Go's own panic status shares, 3 a fatal error.
  [actionlint]="0:0 1:1 2:3 3:2"
  # 2 an interrupt and a test module that does not collect alike, 3 an internal error, 4 a usage
  # error or a conftest.py that fails to import, 5 no test collected.
  [pytest]="0:0 1:1 2:3 3:3 4:3 5:2"
  # 2 a fatal error with nothing reported, 3 a config file it could not read or parse, 4 an illegal
  # command-line parameter.
  [pyright]="0:0 1:1 2:3 3:2 4:3"
  # git grep answers 0 for a match, which is what it found, and 1 for none.
  [git-grep]="0:1 1:0"
  # git diff answers 1 for a difference, and with --check 2 for what the check found.
  [git-diff]="0:0 1:1"
  [git-diff-check]="0:0 2:1"
)

# The class `$2` reads as through the tables `$1` names, joined by `+`, the first naming the status
# deciding, answered as this function's own status: call it as `exit_class docker+lychee "$rc" ||
# class=$?`. A table no row names is a defect of the caller, so it crashes rather than reading as 1.
exit_class() { # $1 the tables · $2 the status
  local table pair status="$2"
  if [[ "$status" == 130 ]]; then return 130; fi
  local IFS='+'
  for table in $1; do
    [[ -n "${EXIT_CODES[$table]+set}" ]] || on_error 3 "${BASH_LINENO[0]}" "exit_class: no table named '${table}'"
    IFS=' '
    for pair in ${EXIT_CODES[$table]}; do
      if [[ "${pair%%:*}" == "$status" ]]; then return "${pair#*:}"; fi
    done
    IFS='+'
  done
  return 3
}

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
    *)                    have=unknown ;;
  esac
  [[ "$have" == "$want" ]] || refuse "This script targets ${want}; this machine looks like ${have}.
See scripts/README.md for which script belongs to which environment."
}

# The venv layout differs by platform, and the gate runs on both. Returns 1 rather than dying: every
# caller reads it through `$( )`, where a `die` exits the subshell alone and the ERR trap prints a
# stack block over the message.
venv_python() {
  local win="${REPO_ROOT}/fl_backend/.venv/Scripts/python.exe"
  local nix="${REPO_ROOT}/fl_backend/.venv/bin/python"
  if   [[ -x "$win" ]]; then printf '%s' "$win"
  elif [[ -x "$nix" ]]; then printf '%s' "$nix"
  else return 1
  fi
}

require_dir()  { [[ -d "$1" ]] || refuse "Missing required directory: $1${2:+
$2}"; }

# The checkout as a `docker run -v` source, in Windows' own spelling under Git Bash: Git Bash mounts
# %TEMP% at /tmp, so a checkout there spelled `/tmp/...` binds an unrelated directory of the engine's.
mount_source() { cygpath -w "$REPO_ROOT" 2>/dev/null || printf '/%s' "$REPO_ROOT"; }

# The image the gate runs a linter from, read off the line its stage name marks in the tools file,
# since Dependabot moves a `FROM` line and no image typed in a shell string. Answers 1 where the file
# holds no single such line.
TOOLS_FILE="scripts/gate/tools.Dockerfile"
tool_image() { # $1 the stage naming the tool
  local image
  image="$(sed -nE "s/^FROM ([^ ]+) AS ${1}\$/\1/p" "$TOOLS_FILE")"
  if [[ -z "$image" || "$image" == *$'\n'* ]]; then return 1; fi
  printf '%s' "$image"
}

# --- The rendered compose models ----------------------------------------------------------------------

# Every environment file the compose files name. Compose refuses to parse a stack whose file is
# missing, and the real ones are never copied: each is replaced by a stand-in naming itself, which
# the compose checker reads back.
COMPOSE_STAND_INS=(fl_backend/.env fl_frontend/.env)

# One staging for every reader of the rendered models, so a change to the files compose reads reaches
# each. `$1` is an empty scratch directory.
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
    # 130 travels: flattened to 3 it reads as a crash, and the caller cannot recover the interrupt.
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
    # 130 travels: flattened to 3 it would read as a crash rather than an interrupt.
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
# certificates of their own, and the check widens until it says nothing. The shapes both
# `.dockerignore` files exclude; the image assertions' tests hold the two lists together.
IMAGE_CONTEXT_FIND='find /app -xdev \( -name node_modules -o -name .venv \) -prune -o \( -name ".env" -o -name ".env.*" -o -name "*.pem" -o -name "*.key" -o -name "*.crt" -o -name ".npmrc" -o -name ".tmp-*" \) -print'
# A context the dockerignore stopped covering still builds.
image_context_clean() { # $1.. the images
  local image found rc
  for image in "$@"; do
    rc=0
    found="$(docker run --rm --entrypoint sh "$image" -c "$IMAGE_CONTEXT_FIND")" || rc=$?
    # 130 travels: flattened to 3 it would read as a crash rather than an interrupt.
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
