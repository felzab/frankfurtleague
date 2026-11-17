#!/usr/bin/env bash
# Sourced, never run directly.
# Sourcing applies strict mode and installs the ERR, INT, TERM and HUP traps.

# `-E`: without errtrace the ERR trap is not inherited by a function, so a command failing inside
# one never reaches `on_error`. It exits with its own status — 1, which the exit contract spells
# "findings" — rather than the crash floor of 3.
set -Eeuo pipefail
IFS=$'\n\t'

# Until the ERR trap below is installed, a failing step here would exit with its own status, 1 among
# them, which the exit contract spells findings: each step's failure is the crash it is, spelled out.

# Two levels: this file sits in `scripts/lib/`, so one `..` would root every script at
# `scripts/` and leave every relative path inside them one directory short.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 3

# Resolved before the `cd`: `--help` reads a script's own header back off this path. The
# ${x-default} form (no colon) survives `set -u` on an absent array element.
# One substitution to an assignment: the assignment answers the status of its last one alone.
_caller="${BASH_SOURCE[1]-${BASH_SOURCE[0]-$0}}"
_caller_dir="$(cd "$(dirname "$_caller")" && pwd)" || exit 3
SELF="${_caller_dir}/${_caller##*/}"
unset _caller _caller_dir

# `BASH_SOURCE` keeps a path as it was given, so a relative one names a file from here: every script
# and this file are entered before the `cd` below, and a file sourced after it takes an absolute path.
_STARTED_IN="$PWD"
cd "$REPO_ROOT" || exit 3

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
# What the rows of units run as processes of their own counted, for the closing count alone.
_ROW_FINDINGS=0

VERBOSE="${VERBOSE:-0}"

# A verdict may only make a row worse. `failed` outranks `refused`: where a section produced both,
# the definite verdict is the actionable one. A crash and an interrupt end the run where they happen.
_RANK_LABELS=("no verdict" "pass" "advisory" "refused" "failed" "crashed" "interrupted")
# The rank each class of the exit contract gives a row, an index of `_RANK_LABELS`: the verbs raise
# their own row by it, and a run of several scopes ranks each scope's exit code by it.
declare -grA RANK_OF_CLASS=([0]=1 [1]=4 [2]=3 [3]=5 [130]=6)
_RANK_ADVISORY=2

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
  _escalate "${RANK_OF_CLASS[0]}"
  _emit "$C_GREEN" "  ok" "$*${suffix}"
  _STEP_MS0=""
}

# Six spaces, the continuation indent every verb's later lines take. Read line by line in bash, so the
# verb has no command of its own to fail: it runs in the middle of every other verdict.
detail() {
  local line
  if (( $# )); then printf '      %s\n' "$@"; return 0; fi
  while IFS= read -r line || [[ -n "$line" ]]; do printf '      %s\n' "$line"; done
}

# Readable because a caller grades a failure by the tool's own words, and re-running the tool to
# read them back would pay for the gate's slowest steps twice.
QUIETLY_OUTPUT=""
# The streaming arm's copy while its command runs, so an interrupt can reclaim it.
_QUIETLY_CAPTURE=""

# Run as a condition or beside `||`, where bash suspends `set -e` and the ERR trap for every command in
# it, so each step of its own that can fail says so through `crash`.
quietly() { # the command
  local out rc=0
  local -a piped=() said=()
  QUIETLY_OUTPUT=""
  if (( VERBOSE )); then
    # Kept as well as streamed, or a caller grading by the output grades this form differently. A
    # file rather than `/dev/fd/1`, which Linux reopens: a redirected log would lose its start.
    _QUIETLY_CAPTURE="$(mktemp)" || crash "mktemp could not make the file a command's output is kept in"
    # `PIPESTATUS`, not the pipeline's status, which is `tee`'s without `pipefail`.
    { "$@" 2>&1 | tee "$_QUIETLY_CAPTURE"; piped=("${PIPESTATUS[@]}"); } || :
    rc="${piped[0]}"
    if (( piped[1] )); then crash "the output of a command could not be kept in ${_QUIETLY_CAPTURE}"; fi
    out="$(<"$_QUIETLY_CAPTURE")"
    rm -f -- "$_QUIETLY_CAPTURE" || crash "the kept output ${_QUIETLY_CAPTURE} could not be removed"
    _QUIETLY_CAPTURE=""
  else
    out="$("$@" 2>&1)" || rc=$?
    # As arguments, one per line: a here-string yields at least one, so `detail` never reads stdin.
    if (( rc )); then mapfile -t said <<<"$out"; detail "${said[@]}"; fi
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
  _escalate "${RANK_OF_CLASS[1]}"
}

_record_advisory() {
  _RUN_ADVISORIES=$(( _RUN_ADVISORIES + 1 ))
  if (( _CHROME && _SECTION_OPEN >= 0 )); then
    _SECTION_ADVISORIES[_SECTION_OPEN]=$(( _SECTION_ADVISORIES[_SECTION_OPEN] + 1 ))
  fi
  _escalate "$_RANK_ADVISORY"
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
# The rank alone decides how the run ends; the findings fill the row's column and the closing count,
# never this run's own total, so a unit that counted a finding and then refused stays a refusal.
end_row() { # $1 the row's index · $2 its rank · $3 its milliseconds · $4 its findings
  _SECTION_RANKS[$1]=$2; _SECTION_MS[$1]=$3; _SECTION_FINDINGS[$1]=$4
  _ROW_FINDINGS=$(( _ROW_FINDINGS + $4 ))
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
      printf '\n'
      ok "Green — ${what}, no findings, ${elapsed}.${advisories}${extra:+ ${extra}}" ;;
    # "In the section it came from" survives Actions folding, where "the lines above" would not.
    findings)
      printf '\n' >&2
      _emit "$C_RED" "   ✗" "$(( _RUN_FINDINGS + _ROW_FINDINGS )) finding(s) in this run, ${count} section(s), ${elapsed}. Each is
named in the section it came from, and each names something to fix in the change — exit 1." >&2 ;;
    refused)
      printf '\n' >&2
      _emit "$C_RED" "   ✗" "Refused after ${elapsed}, so nothing here stands as a verdict on the change and the
refusal above names what could not be judged. Not findings, which would name what to
fix; not a crash, which would mean the check never ran at all — exit 2." >&2 ;;
    crashed)
      printf '\n' >&2
      _emit "$C_RED" "   ✗" "Crashed after ${elapsed}. A line above names the script itself failing rather than
anything about the change, and nothing past that line ran — exit 3 or more." >&2 ;;
    interrupted)
      printf '\n' >&2
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
    if (( _SECTION_RANKS[i] == RANK_OF_CLASS[2] )); then refused=1; fi
    if (( _SECTION_RANKS[i] == RANK_OF_CLASS[1] )); then failed=1; fi
    # Only a row run elsewhere arrives here so: this process's own crash or interrupt has exited.
    if (( _SECTION_RANKS[i] == RANK_OF_CLASS[3] )); then crashed=1; fi
    if (( _SECTION_RANKS[i] == RANK_OF_CLASS[130] )); then interrupted=1; fi
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
# a step that passed before the refusal cannot leave the row reading green. `--summary` first, as
# `fail`'s: the refusal restates one a script annotated itself.
refuse() {
  local summary=0
  if [[ "${1-}" == --summary ]]; then summary=1; shift; fi
  _escalate "${RANK_OF_CLASS[2]}"
  # Closed first, so the message lands outside the Actions fold: a reader told to look above must
  # not be sent into something collapsed.
  end_section
  if (( ! summary )); then _annotate "$*"; fi
  printf '\n' >&2
  _emit "$C_RED" "   ✗" "$*" >&2
  # As `die` and an interrupt: a script speaking the verbs plainly ends on its own sentence.
  if (( _CHROME )); then _closing refused; fi
  # 2, not 1: a caller branching on the code has to tell "fix the change" from "the checker could
  # not judge it", and 1 is spoken for by findings.
  exit 2
}

# A step of the script's own that could not be carried out, ending the run as a crash on the
# sentence that says which: nothing past it ran, and nothing about the change was judged.
crash() { # $1 the sentence
  on_error 3 "${BASH_LINENO[0]}" "$1"
}

# `set -e` otherwise exits in silence. A library helper passes $4, the file its line is in, read off
# `BASH_SOURCE` at that line's frame: its caller may be a sourced file rather than the script.
# `--summary` first, as `fail`'s: the crash is a script's that annotated its own.
on_error() {
  local summary=0
  if [[ "${1-}" == --summary ]]; then summary=1; shift; fi
  local rc="$1" line="$2" cmd="$3" file="${4:-$SELF}"
  local where="${file##*/}"
  # The open section crashed whatever its steps reached: a row reading `pass` beside a crash
  # statement misleads anyone scanning the table rather than the prose.
  _escalate "${RANK_OF_CLASS[3]}"
  # Outside the fold, so a reader told to look above is not sent into something collapsed.
  end_section
  if (( ! summary )); then _annotate "${where} failed at line ${line}: ${cmd} (exit status ${rc})"; fi
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
  _escalate "${RANK_OF_CLASS[130]}"
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

# A program on the exit contract, a script of this repository or a checker of ours, run and its ending taken as
# this run's: 0 returns, 1 ends the run as findings on the sentence `$1`, 2 as a refusal on `$2`, 130 as an
# interrupt and any other status as a crash. `--summary` first, as `fail`'s, for a script on this library, which
# raised its own annotations above.
run_contract() { # [--summary] $1 the finding's sentence · $2 the refusal's · the command
  local rc=0 command
  local -a summary=()
  if [[ "${1-}" == --summary ]]; then summary=(--summary); shift; fi
  local finding="$1" refusal="$2"
  shift 2
  # Joined on spaces here: `$*` joins on the repository's IFS, a newline.
  printf -v command '%s ' "$@"
  "$@" || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) die "${summary[@]}" "$finding" ;;
    2) refuse "${summary[@]}" "$refusal" ;;
    130) on_interrupt ;;
    *) on_error "${summary[@]}" "$rc" "${BASH_LINENO[0]}" "${command% }" ;;
  esac
}

# --- Guards ----------------------------------------------------------------------------------------

# Each asks one question of the machine, and ends through `refuse` whatever status answered it: a
# missing daemon or plugin, a wrong platform, an absent directory or an install that does not answer
# its lockfile is never something the change could be fixed to answer for. Explicit `||`, never the
# trap, so a guard speaks inside a caller that captures a status too.

# Docker's own error ("npipe:////./pipe/...") explains nothing to anyone who has not seen it.
require_docker() {
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
    || refuse "Docker is not responding.
Start Docker Desktop (Windows) or 'sudo systemctl start docker' (Linux),
wait until it reports running, then try again."
}

# Compose and Buildx are plugins of the Docker CLI, so an engine that answers is no proof either is
# installed, and without one every compose file would read as one that does not parse, or the bake as
# a build that failed. Each prints its release, since nothing here pins the one its row was read from.
require_compose() {
  local release
  release="$(docker compose version --short 2>/dev/null)" \
    || refuse "Docker Compose did not answer 'docker compose version', so no compose file was parsed.
Install the Compose plugin, or start Docker Desktop, which carries it, then try again."
  info "Docker Compose ${release}"
}

require_buildx() {
  local release
  release="$(docker buildx version 2>/dev/null)" \
    || refuse "Docker Buildx did not answer 'docker buildx version', so no image was built.
Install the Buildx plugin, or start Docker Desktop, which carries it, then try again."
  info "Docker Buildx: ${release}"
}

# pnpm's dependency check (`verifyDepsBeforeRun`) runs on every `pnpm run` and `pnpm exec`, so one
# exec answers for every frontend step before any of them runs.
require_pnpm_starts() {
  quietly pnpm --dir "${REPO_ROOT}/fl_frontend" exec node -e "" \
    || refuse "pnpm would not start a command in fl_frontend: node_modules does not answer the manifest
and lockfile, or pnpm itself did not start (its own words are above). Fix with:  cd fl_frontend && pnpm install"
}

# `--frozen`, so the virtualenv is held to the lockfile alone: whether the lockfile answers
# pyproject.toml is the change's, which the backend scope's `uv lock --check` reports as a finding.
require_synced_venv() {
  quietly uv sync --project "${REPO_ROOT}/fl_backend" --dev --check --frozen \
    || refuse "fl_backend/.venv does not match fl_backend/uv.lock, so a finding here would be about this
machine rather than the change. Sync it with:  uv sync --project fl_backend --dev --frozen"
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

require_dir()  { [[ -d "$1" ]] || refuse "Missing required directory: $1${2:+
$2}"; }

# --- Paths and images --------------------------------------------------------------------------------

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

# A path as a `docker run -v` source, the checkout where none is given, in Windows' own spelling under
# Git Bash: Git Bash mounts %TEMP% at /tmp, so a checkout there spelled `/tmp/...` binds an unrelated
# directory of the engine's. Git Bash is told by its `cygpath`, never by cygpath failing.
mount_source() { # [$1 the path]
  local path="${1:-$REPO_ROOT}"
  if command -v cygpath > /dev/null; then cygpath -w "$path"; else printf '%s' "$path"; fi
}

# The image the gate runs a linter from, read off the line its stage name marks in the tools file,
# since Dependabot moves a `FROM` line and no image typed in a shell string. Answers 1 where the file
# holds no single such line. Read by bash, so a caller's condition reads no command's failure.
TOOLS_FILE="scripts/gate/tools.Dockerfile"
tool_image() { # $1 the stage naming the tool
  local line image="" found=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ ^FROM\ ([^ ]+)\ AS\ (.+)$ && "${BASH_REMATCH[2]}" == "$1" ]]; then
      image="${BASH_REMATCH[1]}"
      found=$(( found + 1 ))
    fi
  done < "$TOOLS_FILE"
  if (( found != 1 )); then return 1; fi
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
  cp docker-compose.yml docker-compose.local.yml docker-compose.e2e.yml "${directory}/"
  for env_file in "${COMPOSE_STAND_INS[@]}"; do
    number=$(( number + 1 ))
    printf 'FL_STAND_IN_READ_%s=%s\n' "$number" "$env_file" > "${directory}/${env_file}"
  done
}

# `$2` is `production`, `local` or `e2e`, written to `$1/$2.json`. The local stack is the merge
# `local.sh` runs and the end-to-end stack the merge `e2e_stack.sh` runs, neither override being a
# stack alone. `--output` keeps a text-mode stream off the model. Answers 1 for files that do not
# parse or merge, for the caller to word; an interrupt and a crash end the run here.
render_compose_model() {
  # The base file names both images by the tag a deploy pins and refuses to parse without one, and a
  # rendered model runs no image, so any word stands in.
  local -x TAG=gate
  local rc=0
  local -a files=(-f "$1/docker-compose.yml")
  if [[ "$2" == local || "$2" == e2e ]]; then files+=(-f "$1/docker-compose.local.yml"); fi
  if [[ "$2" == e2e ]]; then files+=(-f "$1/docker-compose.e2e.yml"); fi
  # Never `--no-env-resolution`: Compose 2.38 ignores it and later releases honour it, so it would
  # make the rendered environment depend on the release.
  quietly docker compose "${files[@]}" config --format json --output "$1/$2.json" || rc=$?
  case "$rc" in
    0|1) return "$rc" ;;
    130) on_interrupt ;;
    *) on_error "$rc" "${BASH_LINENO[0]}" "docker compose config, the ${2} stack" ;;
  esac
}

# --- What a successful build does not prove ------------------------------------------------------------

# Asked of the image itself, by the gate's images scope. Each answers 0, 1 for what it found, and 3
# for an image that would not run its probe, which says nothing about the image.

# A probe that did not answer what it asks, the reason printed. 130 travels: flattened to 3 it would
# read as a crash rather than an interrupt.
_unprobed() { # $1 the image · $2 the probe's status · $3 what was never read
  if (( $2 == 130 )); then return 130; fi
  printf '%s\n' "the ${1} image would not run its probe (exit ${2}), so ${3} was never read"
  return 3
}

# From the repo root `instrumentation.ts` compiles but is not traced into the standalone output,
# which silently disables the startup env gate and onRequestError.
image_has_instrumentation() { # $1 the frontend image
  local rc=0
  docker run --rm --entrypoint sh "$1" -c '[ -f .next/server/instrumentation.js ]' || rc=$?
  case "$rc" in
    0) ;;
    # The test's own answer. Anything higher is Docker's, and says nothing about the file.
    1) printf '%s\n' "the ${1} image has no .next/server/instrumentation.js"; return 1 ;;
    *) _unprobed "$1" "$rc" "whether instrumentation.js reached it" ;;
  esac
}

# A USER line lost in a refactor still builds.
image_runs_unprivileged() { # $1.. the images
  local image uid rc
  for image in "$@"; do
    rc=0
    uid="$(docker run --rm --entrypoint sh "$image" -c 'id -u')" || rc=$?
    if (( rc )); then _unprobed "$image" "$rc" "its runtime user"; return; fi
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
    if (( rc )); then _unprobed "$image" "$rc" "its context"; return; fi
    if [[ -n "$found" ]]; then
      printf '%s\n' "the ${image} image carries what its dockerignore exists to keep out:" "$found"
      return 1
    fi
  done
}
