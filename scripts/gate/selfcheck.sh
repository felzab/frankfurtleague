#!/usr/bin/env bash
#
# SCRIPTS · test the scripts themselves.
#
# `bash -n` checks syntax alone: a script can call a helper that does not exist and pass it. What
# did not run reaches the gate as well as the screen, through `$FL_SELFCHECK_LEDGER`.
#
#   ./scripts/gate/selfcheck.sh
#   ./scripts/gate/selfcheck.sh --verbose     one check at a time, and every finding in full
#   ./scripts/gate/selfcheck.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

# Arguments are read first, and this script joins RUNNABLE only below: the flag checks run every
# runnable script, so a suite answering neither would run itself recursively.
# shellcheck disable=SC2034  # VERBOSE is consumed by _lib.sh, which shellcheck cannot follow into
for arg in "$@"; do
  case "$arg" in
    --verbose)  VERBOSE=1 ;;
    --help|-h)  usage ;;
    *)          die "Unknown option: ${arg}. Try --help." ;;
  esac
done

RUNNABLE=(ops/local.sh gate/verify.sh ops/deploy.sh gate/selfcheck.sh)

# One EXIT trap for the whole run: bash keeps one, so a second `trap … EXIT` below would silently
# replace it. INT and TERM stay `scripts/lib/_lib.sh`'s, which exits 130 and so fires this.
SELFCHECK_TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$SELFCHECK_TMP"
}
trap cleanup EXIT

FAILURES=0
note_fail() { fail "$*"; FAILURES=$(( FAILURES + 1 )); }

# A bare `skip` or `warn` reaches nobody on the green run that most needs it, so these record one
# for the gate to replay. One record per line: a newline inside a message is folded, not read
# back as a record of its own.
LEDGERED=0
_ledger() { # $1 verb · $2 message
  LEDGERED=$(( LEDGERED + 1 ))
  if [[ -n "${FL_SELFCHECK_LEDGER:-}" ]]; then
    printf '%s\t%s\n' "$1" "${2//$'\n'/ }" >> "$FL_SELFCHECK_LEDGER"
  fi
}
note_skip() { skip "$*"; _ledger skip "$*"; }
note_warn() { warn "$*"; _ledger warn "$*"; }

# --- Which files are shell scripts ---------------------------------------------------------------

# Asked of the tree, not written down: a directory glob covers what existed the day it was written,
# and a script landing anywhere else is unchecked in silence with every step still green.

# `--others --exclude-standard`: a script is covered the moment it exists rather than the moment it
# is added, and a gitignored path is nobody's to lint.
TRACKED="${SELFCHECK_TMP}/tracked.txt"
TRACKED_RC=0
git ls-files --cached --others --exclude-standard > "$TRACKED" 2>/dev/null || TRACKED_RC=$?
SHELL_FILES=()
if (( TRACKED_RC != 0 )); then
  note_fail "git could not list the repository's files (exit ${TRACKED_RC}), so no shell script was linted, parsed or checked below"
else
  while IFS= read -r f || [[ -n "$f" ]]; do
    # `-f` because git lists what the index holds, which a deleted-but-unstaged path outlives.
    [[ -f "$f" ]] || continue
    case "${f##*/}" in
      *.sh) ;;
      # The hooks carry no suffix and nothing else lints them, so an extensionless file is asked
      # what runs it. Any other extension is some other language.
      *.*)  continue ;;
      *)    IFS= read -r shebang < "$f" || true
            [[ "$shebang" =~ ^#!.*(/|[[:space:]])(ba)?sh([[:space:]]|$) ]] || continue ;;
    esac
    SHELL_FILES+=("$f")
  done < "$TRACKED"
  # A list that came back empty is git having answered about some other tree, not a repository
  # holding no shell scripts.
  if (( ${#SHELL_FILES[@]} == 0 )); then
    note_fail "no shell script was found anywhere in the repository, so every per-file step below reads nothing"
  fi
fi

# --- Running the independent checks concurrently -------------------------------------------------

# No unit reads what another writes, so the parent replays their files in the queued order and the
# output is the serial one byte for byte. An empty file is a unit that failed, not a quiet pass.

# One at a time under `--verbose`, which is also the oracle: a disagreement between the widths is
# the parallel machinery being wrong, and there has to be a way to see it.

# A unit is a process spawn, not a core's worth of work, so wider buys nothing. MEASURED 2026-09-02
# on one 16-core machine, this section: 57-62s at 16, 54-60s at 24, 64-66s at 8, 95s at 4 — from
# 12 up the ranges overlap.
PAR_WIDTH=16
if verbose; then PAR_WIDTH=1; fi

PAR_ITEMS=()
PAR_LABELS=()

par_reset() {
  PAR_ITEMS=(); PAR_LABELS=()
}

par_add() { # $1 label · $2 item
  PAR_LABELS+=("$1"); PAR_ITEMS+=("$2")
}

# A change to how a probe runs owes a verdict set taken before it, diffed against the one after and
# required to lose nothing: a probe that stopped firing looks exactly like one that passes.
par_run() { # $1 unit function, called as `$1 <index> <item> <label>` once per queued item
  local fn="$1" total="${#PAR_ITEMS[@]}" width w i idx dir f verb msg p
  local -a pids=()
  if (( total == 0 )); then return 0; fi
  width=$PAR_WIDTH
  if (( width > total )); then width=$total; fi
  dir="${SELFCHECK_TMP}/par"
  rm -rf "$dir"; mkdir -p "$dir"
  # Every worker takes every width'th item, not a contiguous block: the queue is grouped by subject,
  # and blocks would hand one worker every cheap unit and another every expensive one.
  for (( w = 0; w < width; w++ )); do
    # `set +e` and `trap - ERR` together: a unit failing must end that unit, not the rest of this
    # worker's share. `set +e` does not disable an ERR trap, and `_lib.sh`'s `set -E` hands one to
    # every subshell.
    (
      set +e
      trap - ERR
      for (( i = w; i < total; i += width )); do
        printf -v idx '%05d' "$i"
        "$fn" "$i" "${PAR_ITEMS[i]}" "${PAR_LABELS[i]}" > "${dir}/${idx}" 2>/dev/null
      done
    ) &
    pids+=("$!")
  done
  for p in "${pids[@]}"; do wait "$p" 2>/dev/null || true; done
  for (( i = 0; i < total; i++ )); do
    printf -v idx '%05d' "$i"
    f="${dir}/${idx}"
    # An empty file is a worker that died before deciding — a failed spawn, not a verdict. Asked
    # again serially, because a real silence answers twice. In a subshell, because `|| true` grades
    # a status and does not contain an `exit`.
    if [[ ! -s "$f" ]]; then
      ( "$fn" "$i" "${PAR_ITEMS[i]}" "${PAR_LABELS[i]}" ) > "$f" 2>/dev/null || true
    fi
    if [[ ! -s "$f" ]]; then
      note_fail "${PAR_LABELS[i]}: this check produced no verdict, twice"
      continue
    fi
    # `|| [[ -n "$verb" ]]`: `read` returns non-zero on an unterminated final line, having filled the
    # variables anyway. Without it that verdict is dropped in silence — the file is not empty, so the
    # arm above does not fire either.
    while IFS=$'\t' read -r verb msg || [[ -n "$verb" ]]; do
      case "$verb" in
        info) info "$msg" ;;
        fail) note_fail "$msg" ;;
        skip) note_skip "$msg" ;;
        warn) note_warn "$msg" ;;
        *)    note_fail "${PAR_LABELS[i]}: unreadable verdict line" ;;
      esac
    done < "$f"
  done
  rm -rf "$dir"
  par_reset
}

# --- The third-party checkers, started early -----------------------------------------------------

# SC1091 is excluded throughout: shellcheck cannot follow the sourced `scripts/lib/_lib.sh`. SC2034 is
# annotated at the line instead, so a new unused-looking assignment justifies itself where written.

# Pinned so new checks arrive by a named bump, never as drift. By hand (`.github/dependabot.yml`'s
# invariant on shell strings); a bump replaces both digests below.
SHELLCHECK_VERSION="0.11.0"

# The registry's digest for that version's image tag, which the Docker fallback runs
# (`docs/ops/spec.md` §1.1).
SHELLCHECK_IMAGE_DIGEST="sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d"

# GitHub's digest for the release's `linux.x86_64.tar.xz`: CI unpacks it as root onto PATH, so an
# asset replaced under an unmoved tag is caught rather than trusted.
# shellcheck disable=SC2034  # .github/workflows/verify.yml reads it
SHELLCHECK_LINUX_X86_64_SHA256="8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198"

# Availability is decided here, not encoded in a status: shellcheck's own 2 means "a file could
# not be read", so a numeric sentinel would report a real failure as an absent tool.
shellcheck_available() { command -v shellcheck >/dev/null 2>&1 || docker version >/dev/null 2>&1; }
actionlint_available() { command -v actionlint >/dev/null 2>&1 || docker version >/dev/null 2>&1; }

# Git Bash mounts %TEMP% at /tmp, so a checkout there makes `/$REPO_ROOT` bind an unrelated
# directory and shellcheck blames the scripts for files it cannot read. cygpath resolves it.
mount_source() {
  cygpath -w "$REPO_ROOT" 2>/dev/null || printf '/%s' "$REPO_ROOT"
}

run_shellcheck() {
  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck -e SC1091 "$@"
    return
  fi
  # No local binary: the pinned official image, which is how shellcheck is reachable on a Windows
  # box. MSYS_NO_PATHCONV stops Git Bash rewriting the container path into a Windows one.
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(mount_source):/mnt" -w /mnt \
    "koalaman/shellcheck:v${SHELLCHECK_VERSION}@${SHELLCHECK_IMAGE_DIGEST}" -e SC1091 "$@"
}

run_actionlint() {
  if command -v actionlint >/dev/null 2>&1; then
    actionlint
    return
  fi
  # 1.7.8 is the floor: earlier versions reject `using: node24`, which GitHub documents and
  # supports. Nothing bumps this either, for the reason the shellcheck pin above records, and its
  # digest moves with its tag (`docs/ops/spec.md` §1.1).
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(mount_source):/repo" -w /repo \
    rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667
}

# Each reads files this run never writes and is the slowest thing in its step, so each starts here
# and is collected later: the wait then overlaps every cheap check instead of following them.
SC_OUT="${SELFCHECK_TMP}/shellcheck.out"; SC_RC="${SELFCHECK_TMP}/shellcheck.rc"
AL_OUT="${SELFCHECK_TMP}/actionlint.out"; AL_RC="${SELFCHECK_TMP}/actionlint.rc"
# `trap - ERR` beside `set +e`, which does not disable an ERR trap: a checker with findings would
# otherwise take its own reporter down before the status was written, and the step would read
# "it did not run to completion".
( set +e
  trap - ERR
  if shellcheck_available; then
    run_shellcheck "${SHELL_FILES[@]}" > "$SC_OUT" 2>&1; printf '%s' "$?" > "$SC_RC"
  else
    printf 'unavailable' > "$SC_RC"
  fi ) &
SC_PID=$!
( set +e
  trap - ERR
  if actionlint_available; then
    run_actionlint > "$AL_OUT" 2>&1; printf '%s' "$?" > "$AL_RC"
  else
    printf 'unavailable' > "$AL_RC"
  fi ) &
AL_PID=$!

step "1. Syntax"
# `.claude/hooks/` and `.githooks/` are included: a hook that does not parse fails on the session,
# or the commit, it was meant to guard.
unit_syntax() { # $1 index · $2 file · $3 label
  if bash -n "$2" 2>/dev/null; then
    printf 'info\t%s\n' "$3"
  else
    printf 'fail\t%s does not parse\n' "$3"
  fi
}
for f in "${SHELL_FILES[@]}"; do par_add "${f##*/}" "$f"; done
par_run unit_syntax

step "2. Line endings are LF"
# CRLF fails outright on Linux — `/usr/bin/env bash^M: bad interpreter` — and `.gitattributes`
# covers only what git writes. Windows tolerates it, so the defect is invisible where it is made.

# `tr` is byte-oriented and interprets the escape itself, so no carriage return appears in this
# file. MSYS awk strips CR on input, and grepping for a literal CR puts one into the detector.
unit_crlf() { # $1 index · $2 file · $3 label
  if [[ -n "$(tr -dc '\r' < "$2")" ]]; then
    printf 'fail\t%s\n' "$3 has CRLF endings. Fix:  tr -d '\r' < $2 > t && mv t $2 && chmod +x $2"
  else
    printf 'info\t%s\n' "$3"
  fi
}
for f in "${SHELL_FILES[@]}"; do par_add "${f##*/}" "$f"; done
par_run unit_crlf

step "3. Executable bit is set in git"
# The mode git records, not the filesystem's: on Windows core.fileMode is false, so `chmod +x` is
# cosmetic and the script reaches the Linux server non-executable. Invisible here, because bash
# runs a non-executable file when you name the interpreter.

# One query for the whole set: on Windows a spawn costs more than the work it saves. `_lib.sh`
# is excluded, being sourced rather than executed.
declare -A GIT_MODE=()
# Through a file with the status kept, not a process substitution: a failed query is
# indistinguishable from a repository holding no such files, and every script then takes the
# "not tracked" arm below. `docs/ops/spec.md`'s I10 has no other enforcement.
GIT_MODES="${SELFCHECK_TMP}/git-modes.tsv"
GIT_MODES_RC=0
git ls-files -s -- "${RUNNABLE[@]/#/scripts/}" > "$GIT_MODES" 2>"${GIT_MODES}.err" || GIT_MODES_RC=$?
if (( GIT_MODES_RC != 0 )); then
  note_fail "git could not be asked which modes it records (exit ${GIT_MODES_RC}), so no script's executable bit was checked: $(tr '\n' ' ' < "${GIT_MODES}.err" | cut -c1-200)"
else
  while IFS=$'\t' read -r meta path; do
    GIT_MODE["$path"]="${meta%% *}"
  done < "$GIT_MODES"
  # A per-script "not tracked" is a new script awaiting its first `git add`; ALL of them at once,
  # with the files on disk, is git having answered about some other tree.
  if (( ${#GIT_MODE[@]} == 0 )); then
    note_fail "git named none of the ${#RUNNABLE[@]} scripts, so there were no modes to check — this ran against something that is not the repository"
  fi
  for f in "${RUNNABLE[@]}"; do
    [[ -f "scripts/$f" ]] || continue
    mode="${GIT_MODE["scripts/$f"]:-}"
    if [[ "$mode" == "100755" ]]; then
      info "$f"
    elif [[ -z "$mode" ]]; then
      info "$f (not tracked by git yet)"
    else
      note_fail "$f is mode ${mode} in git, not 100755 — it will not be executable on the server. Fix:  git update-index --chmod=+x scripts/$f"
    fi
  done
fi

step "4. Every helper called is defined"
# The names checked are read out of the SCRIPTS, never out of `_lib.sh`: a pattern built from what
# is defined can only match names that resolve, which is `docs/_standard/standard.md` PRE-4. A hand-written
# pattern is the same thing one edit later.

# Command position only: a name in a string, a comment, a case pattern or a `for` variable is not a
# call.
# shellcheck disable=SC2016  # awk's own $0 and $1, which must not expand before awk reads them
CMD_WORDS='
# Q is built here rather than passed with -v: MSYS re-parses a Windows command line and eats the
# quote out of an argument that is one.
BEGIN { Q = sprintf("%c", 39); q = 0; cmd = 1; heredoc = ""; incase = 0; pat = 0; skipnext = 0
        arith = 0; sd = 0; cont = 0; assign = 0; arr = 0 }
{
  line = $0
  if (heredoc != "") {
    t = line; sub(/^[ \t]+/, "", t)
    if (t == heredoc) heredoc = ""
    cont = 0
    next
  }
  # `cont`: a backslash carries the command position onto the next record. Resetting there read the
  # first word of a continued argument list as a command of its own.
  if (q == 0 && sd == 0 && !cont) { cmd = 1; pat = (incase > 0); assign = 0 }
  n = length(line); word = ""
  for (i = 1; i <= n; i++) {
    c = substr(line, i, 1)
    # A command substitution opens a command position of its own, quoted or not. The pending word
    # is flushed first, or `x=$(helper)` swallows the helper into the assignment and loses it.
    if (c == "$" && substr(line, i+1, 1) == "(" && substr(line, i+2, 1) != "(") {
      if (word != "") { emit(word, "$"); word = "" }
      sd++; sq[sd] = q; q = 0; cmd = 1; pat = 0; i++; continue
    }
    if (q == 1) { if (c == Q) q = 0; continue }
    if (q == 2) { if (c == "\\") { i++; continue }; if (c == "\"") q = 0; continue }
    if (arith) { if (c == ")" && substr(line, i+1, 1) == ")") { i++; arith = 0; cmd = 0 }; continue }
    if (c == "\\") { i++; continue }
    # A parameter reference, consumed whole: `$name` runs the value, so the NAME is not a command,
    # and the `#` in `$#` opens no comment.
    if (c == "$") {
      if (word != "") { emit(word, "$"); word = "" }
      j = i + 1
      if (substr(line, j, 1) == "{") { while (j <= n && substr(line, j, 1) != "}") j++ }
      else { while (j <= n && substr(line, j, 1) ~ /[A-Za-z0-9_#?@*!-]/) j++; j-- }
      i = j; if (!assign) cmd = 0
      continue
    }
    if (c ~ /[A-Za-z0-9_.\/:=,-]/) { word = word c; continue }
    if (word != "") { emit(word, c); word = "" }
    # An assignment prefix keeps the next word in command position, however it is quoted.
    if (c == Q)    { q = 1; if (!assign) cmd = 0; continue }
    if (c == "\"") { q = 2; if (!assign) cmd = 0; continue }
    if (c == "#" && (i == 1 || substr(line, i-1, 1) ~ /[ \t;&|(]/)) break
    # `i-1`: the third character of a here-string is a `<` with a `<` behind it, and reading that as
    # a heredoc opener took the rest of the line as a delimiter.
    if (c == "<" && substr(line, i+1, 1) == "<" && substr(line, i+2, 1) != "<" && \
        (i == 1 || substr(line, i-1, 1) != "<")) {
      rest = substr(line, i+2); sub(/^-/, "", rest); sub(/^[ \t]+/, "", rest)
      fc = substr(rest, 1, 1)
      # The delimiter is the whole word, punctuation included: an identifier class stops at the
      # first hyphen, so the closing line never matches what it recorded and every line below the
      # opener is read as body.
      if (fc == Q || fc == "\"") {
        rest = substr(rest, 2); k = index(rest, fc)
        if (k > 1) heredoc = substr(rest, 1, k - 1)
      } else if (match(rest, /^[^ \t;&|<>()]+/)) heredoc = substr(rest, RSTART, RLENGTH)
      i++; cmd = 0; continue
    }
    # `x=( … )` holds data, not a command.
    if (c == "(" && assign) { arr = 1; cmd = 0; continue }
    if (c == "(" && substr(line, i+1, 1) == "(") { i++; arith = 1; continue }
    if (c == "[") { cmd = 0; continue }
    if (c == ")") {
      if (arr) { arr = 0; cmd = 0 }
      else if (sd > 0) { q = sq[sd]; sd--; cmd = 0 }
      else { cmd = 1; pat = 0 }
      continue
    }
    if (c ~ /[;|&({!`]/) { cmd = 1; pat = (incase > 0); assign = 0; continue }
    if (c == "}") { cmd = 1; continue }
  }
  if (word != "") emit(word, " ")
  cont = (q == 0 && substr(line, n, 1) == "\\")
}
# A heredoc the reader never closed means it stopped reading somewhere above, so the remaining
# call sites were skipped in silence, which is the one failure a per-file count cannot describe.
END { if (heredoc != "") print "unterminated\t" heredoc }
function emit(w, nextc, atcmd) {
  # A counter, not a flag: an inner `esac` cleared it and the outer arm patterns then read as
  # command positions.
  if (w == "case") { incase++; cmd = 1; pat = 1; return }
  if (w == "esac") { if (incase > 0) incase--; cmd = 0; pat = (incase > 0); return }
  # Never `in`: the words after `for x in` are data, and a `case` arm is a pattern either way.
  if (w ~ /^(if|then|else|elif|do|while|until|time|done|fi|coproc)$/) { cmd = 1; return }
  if (w == "for" || w == "select" || w == "function") { cmd = 1; skipnext = 1; return }
  atcmd = (cmd && !pat)
  cmd = 0
  if (skipnext) { skipnext = 0; return }
  if (w ~ /=/) { if (atcmd) { cmd = 1; assign = 1 }; return }
  assign = 0
  # Underscored names only — the helper convention here, and the one class no external program
  # collides with. A single-word helper is outside it.
  if (w !~ /^[a-z_][a-z0-9_]*$/ || w !~ /_/) return
  # `word`: a bare occurrence that is neither a call nor a definition — the shape a helper takes
  # when it is handed to a wrapper rather than run, which step 7 asks about.
  if (!atcmd) { if (!pat) print "word\t" w; return }
  if (nextc == "[" || nextc == "+") return
  if (nextc == "(") { print "def\t" w } else { print "call\t" w }
}
'

# `-g`, so both routes below and the case driving them read one map built from one file.
read_lib_definitions() { # $1 the library
  local fn
  declare -gA DEFINED=()
  while IFS= read -r fn; do DEFINED["$fn"]=1; done \
    < <(grep -oE '^[a-z_]+\(\)' "$1" | tr -d '()')
}
read_lib_definitions scripts/lib/_lib.sh
CALL_SITES=0
for f in "${RUNNABLE[@]}"; do
  [[ -f "scripts/$f" ]] || continue
  sites="${SELFCHECK_TMP}/call-sites.tsv"
  # awk's own status, because a reader that failed reports the same nothing as a script calling no
  # helper at all — and that nothing would read as a pass.
  if ! awk "$CMD_WORDS" "scripts/$f" > "$sites" 2>/dev/null; then
    note_fail "$f: its call sites could not be read, so no helper of its was checked"
    continue
  fi
  # A definition may sit below its first call, so the whole file is read for definitions first.
  declare -A LOCAL_DEF=()
  defs=0; stalled=""
  while IFS=$'\t' read -r kind name || [[ -n "$kind" ]]; do
    case "$kind" in
      def)          LOCAL_DEF["$name"]=1; defs=$(( defs + 1 )) ;;
      unterminated) stalled="$name" ;;
    esac
  done < "$sites"
  missing=""; seen=0
  while IFS=$'\t' read -r kind name || [[ -n "$kind" ]]; do
    [[ "$kind" == call ]] || continue
    seen=$(( seen + 1 ))
    [[ -n "${DEFINED["$name"]:-}" || -n "${LOCAL_DEF["$name"]:-}" ]] && continue
    [[ "$missing" == *" ${name}"* ]] || missing+=" $name"
  done < "$sites"
  CALL_SITES=$(( CALL_SITES + seen ))
  if [[ -n "$stalled" ]]; then
    note_fail "$f: a heredoc opened with '${stalled}' was never closed, so the reader stopped there and every call site below it went unread"
  elif [[ -n "$missing" ]]; then
    note_fail "$f calls undefined helper(s):$missing"
  # One file collapsing is invisible to the run-wide floor below, and a file holding a definition
  # while calling nothing is the reader having stopped rather than a file with nothing to check.
  elif (( defs > 0 && seen == 0 )); then
    note_fail "$f defines ${defs} helper(s) and calls none, so the reader stopped somewhere inside it"
  else
    # The count is part of the verdict: a reader with nothing to read also has nothing to report.
    info "$f — ${seen} helper call site(s), all resolve"
  fi
  unset LOCAL_DEF
done
if (( CALL_SITES == 0 )); then
  note_fail "no helper call site was found in any script, so nothing this step printed was proven"
fi

# The reader's bound drops single-word helpers, `die` and `ok` among them. `docs/ops/spec.md` names
# them by a route that is not `_lib.sh`, so a name it documents and `_lib.sh` has stopped carrying
# is a finding here.
VOCAB_SHEET="docs/ops/spec.md"

# Two lead-ins, one reader: a walk that ended at the first table would leave the second documented
# for a reader and checked by nobody.
check_documented_helpers() { # $1 the sheet
  local documented rc=0 name undefined="" vocab="${SELFCHECK_TMP}/documented-helpers.txt"
  awk '
    /^\*\*The output standard\./ { armed = 1; inside = 0; next }
    /^\*\*The helpers a script leans on\./ { armed = 1; inside = 0; next }
    armed && /^\|/ { inside = 1; if (match($0, /^\| `[a-z_]+`/)) print substr($0, RSTART + 3, RLENGTH - 4); next }
    # Disarmed rather than done: the second table sits further down the same sheet.
    inside { armed = 0; inside = 0 }
  ' "$1" > "$vocab" 2>/dev/null || rc=$?
  # Skips, not findings: editing the sheet selects `docs` and `format`, never `scripts`, so a
  # reformatted table would redden a job its own gate cannot run. The undefined arm stays a
  # finding: only a `_lib.sh` edit reaches it.
  if (( rc != 0 )); then
    note_skip "$1 could not be read (awk exit ${rc}), so the documented helpers were not checked"
    return 0
  fi
  if [[ ! -s "$vocab" ]]; then
    note_skip "no name was read out of $1's two tables, so the documented helpers were not checked — a table's shape moved"
    return 0
  fi
  while IFS= read -r name || [[ -n "$name" ]]; do
    [[ -n "${DEFINED["$name"]:-}" ]] || undefined+=" $name"
  done < "$vocab"
  if [[ -n "$undefined" ]]; then
    note_fail "$1 documents helper(s) _lib.sh does not define —${undefined} — so every script reaching for one reaches nothing"
  else
    documented="$(wc -l < "$vocab" | tr -d ' ')"
    info "${documented} documented helper(s), each still defined in _lib.sh"
  fi
}
check_documented_helpers "$VOCAB_SHEET"

step "5. --help works from an unrelated directory"
unit_help() { # $1 index · $2 script name · $3 label
  if ( cd / && bash "${REPO_ROOT}/scripts/$2" --help >/dev/null 2>&1 ); then
    printf 'info\t%s --help\n' "$2"
  else
    printf 'fail\t%s --help failed (a relative path that stops resolving after the cd?)\n' "$2"
  fi
}
for f in "${RUNNABLE[@]}"; do par_add "$f" "$f"; done
par_run unit_help

step "6. Unknown options are rejected, without requiring Docker"
# Captured into a variable first: under `set -o pipefail`, `script | grep -q …` fails the pipeline
# for the non-zero exit the script under test is supposed to have.
unit_unknown_option() { # $1 index · $2 script name · $3 label
  local out
  out="$(bash "scripts/$2" --definitely-not-an-option 2>&1 || true)"
  if [[ "$out" == *"Unknown option"* ]]; then
    printf 'info\t%s\n' "$2"
  else
    printf 'fail\t%s did not reject an unknown option (is the arg loop after an environmental check?)\n' "$2"
  fi
}
for f in "${RUNNABLE[@]}"; do par_add "$f" "$f"; done
par_run unit_unknown_option

step "7. Machine-specific scripts declare a target platform"
# Only the scripts that MUST run on one machine: the read-and-build ones would be pinned to an OS
# for nothing, and that also blocks CI.

# Through the reader above, not a text search: `grep -q require_platform` is satisfied by the name
# sitting in a comment. Run, or handed to a wrapper, both count; a mention in a comment or a string
# does not. Wired is all this proves, not that it fires.
for f in ops/local.sh ops/deploy.sh; do
  guard="${SELFCHECK_TMP}/platform-sites.tsv"
  if ! awk "$CMD_WORDS" "scripts/$f" > "$guard" 2>/dev/null; then
    note_fail "$f: its call sites could not be read, so its platform guard was not checked"
    continue
  fi
  guard_rc=0
  grep -qE "^(call|word)$(printf '\t')require_platform\$" "$guard" || guard_rc=$?
  case "$guard_rc" in
    0) info "$f" ;;
    1) note_fail "$f does not invoke require_platform — the name appearing in a comment or a string is not a guard" ;;
    *) note_fail "$f: its call sites could not be searched (grep exit ${guard_rc}), so its platform guard was not checked" ;;
  esac
done

step "8. Documented flags match accepted flags"
# Compared by READING both, never by running the script: invoking each flag for real tears down
# the local stack as a side effect of a documentation test.
unit_flags() { # $1 index · $2 script name · $3 label
  local usage doc code
  # The header's invocation lines, each up to the two spaces opening its description: prose may
  # name another tool's flag, and a fixed line range would reach the case statement and compare the
  # code against itself.
  usage="$(awk 'NR>1 { if ($0 !~ /^#/) exit; print }' "scripts/$2" \
    | sed -nE 's/^#[[:space:]]+(([A-Z_]+=[^[:space:]]+[[:space:]]+)*\.\/scripts\/[^[:space:]]+.*)$/\1/p' \
    | sed -E 's/ {2,}.*$//')"
  # Refused rather than compared: no line read documents no flag, which a script accepting none
  # matches, so a header this reader stopped parsing would pass.
  if [[ -z "$usage" ]]; then
    printf 'fail\t%s: its header yields no invocation line, so no documented flag was compared\n' "$2"
    return
  fi
  doc="$(grep -oE -- '--[a-z-]+' <<< "$usage" | sort -u | tr '\n' ' ')"
  code="$(grep -oE '^[[:space:]]+--[a-z|[:space:]-]+\)' "scripts/$2" | tr -d ' )' | tr '|' '\n' | grep -oE -- '--[a-z-]+' | sort -u | tr '\n' ' ')"
  if [[ "$doc" == "$code" ]]; then
    printf 'info\t%s\n' "$2"
  else
    printf 'fail\t%s: --help documents [%s] but the code accepts [%s]\n' "$2" "$doc" "$code"
  fi
}
for f in "${RUNNABLE[@]}"; do par_add "$f" "$f"; done
par_run unit_flags

step "9. Every scope verify.sh declares has a CI job, and every CI job names a scope"
# A scope added to verify.sh with no job behind it never runs in CI, with every gate green: step 8
# reads verify.sh against itself. Two listings, two routes, per PRE-4.

# What verify.sh declares is its `add_scope` lines; what CI runs is every flag handed to
# `verify.sh` in a workflow `run:` line — a job's key is a label, and naming one after a scope binds nothing.
WORKFLOW=".github/workflows/verify.yml"
declared="${SELFCHECK_TMP}/scopes-declared.txt"
ran="${SELFCHECK_TMP}/scopes-in-ci.txt"
declared_rc=0; ran_rc=0
# A scope name may carry a hyphen, and a class stopping at one reads `frontend-units` as `frontend`.
grep -oE '^add_scope[[:space:]]+[a-z][a-z-]*' scripts/gate/verify.sh | awk '{ print $2 }' | sort -u > "$declared" || declared_rc=$?
# The workflow read stands alone, its status kept: under `pipefail` a later stage's 1 for "nothing
# came through" would hide this stage's 2 for a file it could not open.
grep -E '^[[:space:]]+(-[[:space:]]+)?run:[[:space:]]+\./scripts/gate/verify\.sh([[:space:]]|$)' "$WORKFLOW" \
  > "${ran}.lines" 2>/dev/null || ran_rc=$?
if (( ran_rc <= 1 )); then
  grep -oE -- '--[a-z][a-z-]*' "${ran}.lines" | sed 's/^--//' | sort -u > "$ran" || true
fi
# grep's 1 is "no match", a real answer graded below; 2 and above is a file it could not read.
if (( declared_rc > 1 || ran_rc > 1 )); then
  note_fail "the scope listings could not be read (grep exit ${declared_rc} on verify.sh, ${ran_rc} on ${WORKFLOW}), so nothing here was compared"
elif [[ ! -s "$declared" ]]; then
  note_fail "verify.sh declares no scope through add_scope, so there was nothing to compare against the workflow"
elif [[ ! -s "$ran" ]]; then
  note_fail "${WORKFLOW} hands verify.sh no flag in any run: line, so no scope is proven to run in CI"
else
  unjobbed="$(comm -23 "$declared" "$ran" | tr '\n' ' ')"
  unscoped="$(comm -13 "$declared" "$ran" | tr '\n' ' ')"
  if [[ -n "$unjobbed" ]]; then
    note_fail "verify.sh declares scope(s) no CI job runs — ${unjobbed% } — so each never runs in CI. Add a job to ${WORKFLOW} whose run: line hands verify.sh the flag."
  fi
  if [[ -n "$unscoped" ]]; then
    note_fail "${WORKFLOW} hands verify.sh flag(s) it declares as no scope — ${unscoped% } — so that job runs nothing it names. A CI invocation names scopes alone."
  fi
  if [[ -z "$unjobbed" && -z "$unscoped" ]]; then
    info "$(wc -l < "$declared" | tr -d ' ') scope(s), each declared by verify.sh and each run by a job in ${WORKFLOW##*/}"
  fi
fi

step "10. shellcheck"
wait "$SC_PID" 2>/dev/null || true
if [[ -s "$SC_RC" ]]; then sc_rc="$(cat "$SC_RC")"; else sc_rc="unfinished"; fi

if command -v shellcheck >/dev/null 2>&1; then
  sc_have="$(shellcheck --version 2>/dev/null | awk '$1 == "version:" { print $2 }')"
  if [[ "$sc_have" != "$SHELLCHECK_VERSION" ]]; then
    note_warn "shellcheck ${sc_have:-(unreadable version)} is on PATH but this gate pins ${SHELLCHECK_VERSION}, so a finding here need not reproduce elsewhere."
  fi
# Neutral detail, not an advisory: the step ran and its verdict stands whole.
elif [[ "$sc_rc" != "unavailable" ]]; then
  info "no shellcheck on PATH, so this step ran the pinned image through Docker — about nine seconds instead of one.
Install shellcheck once and it stops being the slowest thing here."
fi
case "$sc_rc" in
  0) info "no findings in any script" ;;
  # CI installs the pinned binary for this step, so an unavailable one there is that install gone
  # rather than a machine without the tool.
  unavailable)
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
      note_fail "no shellcheck and no Docker, and this is CI, where the scripts job installs the pinned binary before this step"
    else
      note_skip "shellcheck did not run — no local binary and no Docker"
    fi ;;
  # Its own code for a file it could not open, which is no verdict on any script: as findings a
  # reader hunts a defect in the shell, and as a skip nobody looks at all.
  2) note_fail "shellcheck could not read a file it was given, so the scripts were not all linted:"
     excerpt 40 < "$SC_OUT" ;;
  unfinished) note_fail "shellcheck left no exit status behind, so it did not run to completion" ;;
  *) note_fail "shellcheck reported findings:"; excerpt 40 < "$SC_OUT" ;;
esac

step "11. actionlint on the workflows"
# The class of bug that otherwise surfaces on the first live run. Same ladder as shellcheck's.
wait "$AL_PID" 2>/dev/null || true
if [[ -s "$AL_RC" ]]; then al_rc="$(cat "$AL_RC")"; else al_rc="unfinished"; fi
case "$al_rc" in
  0) info "no findings in any workflow" ;;
  # Nothing installs actionlint in CI: the runner's own daemon carries this step, so an
  # unavailable one names a runner whose `docker version` stopped answering.
  unavailable)
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
      note_fail "no actionlint and no Docker, and this is CI, where the runner's daemon is what runs the pinned image"
    else
      note_skip "actionlint did not run — no local binary and no Docker"
    fi ;;
  unfinished) note_fail "actionlint left no exit status behind, so it did not run to completion" ;;
  *) note_fail "actionlint reported findings:"; excerpt 40 < "$AL_OUT" ;;
esac

step "12. The hooks say what they exist to say"
# Every hook here is silent on its failure path by design, so one that stopped answering looks
# exactly like one with nothing to say, and only a driven case tells the two apart.
if ! command -v node >/dev/null 2>&1; then
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    note_fail "node is absent, and this is CI, whose runner image ships it so these probes can run"
  else
    note_skip "the hook probes did not run, and neither did the registration read, which parses the settings through node — node is absent, and the standard's hook answers through it"
  fi
else
  HOOKS_DIR="${REPO_ROOT}/.claude/hooks"

  # A registration naming a script that is not there runs nothing on its event, and the harness
  # reports nothing either.
  check_hook_registrations() { # $1 the settings file · $2 the hooks directory
    local registrations rc=0 event hook
    if [[ ! -f "$1" ]]; then
      note_fail "the hook registrations could not be read — ${1} is not there."
      return 0
    fi
    registrations="$(node -e '
const fs = require("fs");
const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const events = Object.entries(settings.hooks || {});
const registered = events.flatMap(([event, groups]) => (groups || []).flatMap((group) => (group.hooks || []).map((entry) => [event, entry])));
for (const [event, entry] of registered) {
  // A registration runs a shell line, so the hook it registers is the .sh path inside that line.
  const named = /([A-Za-z0-9._-]+\.sh)/.exec(entry.command || "");
  if (named) process.stdout.write(event + "\t" + named[1] + "\n");
}
' "$1" 2>/dev/null)" || rc=$?
    if (( rc != 0 )) || [[ -z "$registrations" ]]; then
      note_fail "no hook registration was read out of ${1} (node exit ${rc}), so no registered script was looked for."
      return 0
    fi
    while IFS=$'\t' read -r event hook; do
      [[ -n "$hook" ]] || continue
      if [[ -f "${2}/${hook}" ]]; then
        info "${hook}: registered on ${event}, and there"
      else
        note_fail "${1} registers ${hook} on ${event}, and it is not in ${2}, so the harness runs nothing for it."
      fi
    done <<< "$registrations"
  }
  check_hook_registrations "${REPO_ROOT}/.claude/settings.json" "$HOOKS_DIR"

  # Failing silently either way: stop emitting and no write sees the standard, stop staying quiet
  # and every write outside the scope pays for a slice it cannot use.
  standard_hook="${REPO_ROOT}/.claude/hooks/docs-standard.sh"
  # A crash is silent, and silence is this hook's pass — so the status and stderr are turned into
  # output of their own rather than dropped, and every reader below sees a crash as a wrong answer.
  standard_err="${SELFCHECK_TMP}/standard-hook.err"
  probe_standard() { # $1 payload on stdin — from the repository root
    local rc=0 out
    out="$(printf '%s' "$1" | bash "$standard_hook" 2>"$standard_err")" || rc=$?
    if (( rc != 0 )); then
      printf 'crashed (exit %s): %s' "$rc" "$(tr '\n\t' '  ' < "$standard_err" | cut -c1-200)"
    elif [[ -z "$out" && -s "$standard_err" ]]; then
      printf 'crashed (wrote to stderr): %s' "$(tr '\n\t' '  ' < "$standard_err" | cut -c1-200)"
    else
      printf '%s' "$out"
    fi
  }
  expect_silent() { # $1 label · $2 hook output — the contract is silence
    if [[ -z "$2" ]]; then info "$1 — silent"; else note_fail "$1: expected silence, got '$2'"; fi
  }
  expect_emission() { # $1 label · $2 hook output — the contract is a slice
    case "$2" in
      # Read before the emission arm: a crash reported through stderr can carry the very marker the
      # arm below looks for, and a crash is not an emission.
      crashed*)             note_fail "$1 — $2" ;;
      *hookSpecificOutput*) info "$1 — emitted" ;;
      *)                    note_fail "$1: expected a slice of the standard, got '${2:-nothing}'" ;;
    esac
  }
  standard_md_payload()  { printf '{"tool_input":{"file_path":"%s","content":"x"}}' "$1"; }
  standard_src_payload() { printf '{"tool_input":{"file_path":"%s","new_string":"const a = 1;"}}' "$1"; }

  # The root as the hook sees it: a payload built from the MSYS spelling in REPO_ROOT resolves to
  # a different drive inside node.
  standard_root="$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null)"
  # The same path twice: the hook keeps no per-session state, so every documentation-shaped write
  # owes the same slice, and one that answered the first alone would serve nobody after it.
  expect_emission "standard hook: repo .md write"      "$(probe_standard "$(standard_md_payload "${standard_root}/docs/README.md")")"
  expect_emission "standard hook: the same file again" "$(probe_standard "$(standard_md_payload "${standard_root}/docs/README.md")")"
  # Spelled in neither case: the gate's prose register folds case, and a hook comparing the name
  # exactly goes silent for every other spelling while the gate still reads the file.
  expect_emission "standard hook: a NOTICE of any case" "$(probe_standard "$(standard_md_payload "${standard_root}/Notice")")"
  expect_silent "standard hook: comment-free source"   "$(probe_standard "$(standard_src_payload "${standard_root}/fl_frontend/src/probe.ts")")"
  expect_silent "standard hook: path outside the repo" "$(probe_standard "$(standard_md_payload "${standard_root}/../outside.md")")"

  # This hook reads no payload, and its answer comes from netstat, which a shim replaces so the
  # verdict is the hook's rather than this machine's own port 3000.
  ORPHAN_HOOK="${REPO_ROOT}/.claude/hooks/warn-orphan-server.sh"
  orphan_fx="${SELFCHECK_TMP}/orphan"
  # Goes on PATH as it stands, mktemp's path already being POSIX-spelled here: a drive letter's
  # colon would be read as the PATH separator, leaving the real netstat to answer.
  orphan_shim="${orphan_fx}/shim"
  mkdir -p "$orphan_shim"
  # shellcheck disable=SC2016  # the shim reads the name at its own run time, not at this one
  printf '#!/usr/bin/env bash\ncat "$FL_NETSTAT_FIXTURE"\n' > "${orphan_shim}/netstat"
  printf '#!/usr/bin/env bash\nprintf %%s "\\"node.exe\\",\\"4242\\"\\n"\n' > "${orphan_shim}/tasklist"
  chmod +x "${orphan_shim}/netstat" "${orphan_shim}/tasklist"

  # ABHÖREN, not LISTENING: this machine localises the state column, so a hook reading that column
  # is silently dead here. The foreign address is what the hook reads instead.
  printf '  TCP    0.0.0.0:3000    0.0.0.0:0    ABH\xc3\x96REN    4242\n' > "${orphan_fx}/ns-listen"
  # A browser tab on localhost:3000 is a connection, not a listener, and would fire every turn.
  printf '  TCP    127.0.0.1:3000  127.0.0.1:55123    HERGESTELLT    777\n' > "${orphan_fx}/ns-connected"
  printf '  TCP    0.0.0.0:30000   0.0.0.0:0    ABH\xc3\x96REN    555\n' > "${orphan_fx}/ns-port30000"

  orphan_drive() { # $1 netstat fixture, or empty for no netstat at all — prints what the hook said
    local rc=0 out
    if [[ -n "$1" ]]; then
      out="$(FL_NETSTAT_FIXTURE="$1" PATH="${orphan_shim}:${PATH}" bash "$ORPHAN_HOOK" </dev/null 2>&1)" || rc=$?
    else
      out="$(PATH=/nonexistent "$BASH" "$ORPHAN_HOOK" </dev/null 2>&1)" || rc=$?
    fi
    # Advisory means exit 0 always: a Stop hook that fails takes the turn's ending with it.
    if (( rc != 0 )); then printf 'exit %s: %s' "$rc" "${out:0:120}"; else printf '%s' "$out"; fi
  }
  orphan_out="$(orphan_drive "${orphan_fx}/ns-listen")"
  case "$orphan_out" in
    *'"systemMessage"'*node.exe*4242*) info 'orphan server hook: a localised listener — named' ;;
    *) note_fail "orphan server hook: a listener on 3000 went unnamed, got '${orphan_out:-nothing}'" ;;
  esac
  for orphan_case in ns-connected ns-port30000; do
    orphan_out="$(orphan_drive "${orphan_fx}/${orphan_case}")"
    if [[ -z "$orphan_out" ]]; then info "orphan server hook: ${orphan_case#ns-} — silent"
    else note_fail "orphan server hook: ${orphan_case#ns-} must say nothing, got '${orphan_out}'"; fi
  done
  orphan_out="$(orphan_drive "")"
  if [[ -z "$orphan_out" ]]; then info 'orphan server hook: no netstat — silent, exit 0'
  else note_fail "orphan server hook: without netstat it must say nothing and exit 0, got '${orphan_out}'"; fi

  # A registration whose matcher misses a tool runs its script for none of that tool's calls, and
  # the script's own probes stay green.
  check_hook_matcher() { # $1 the settings file · $2 event · $3 hook script · $4… each name its matcher must take
    local missing rc=0 name IFS=' '
    missing="$(node -e '
const fs = require("fs");
const [file, event, script, ...names] = process.argv.slice(1);
const groups = ((JSON.parse(fs.readFileSync(file, "utf8")).hooks || {})[event] || []).filter((group) =>
  (group.hooks || []).some((entry) => (entry.command || "").includes("/" + script)));
// The harness reads a matcher of plain names as an exact list, and anything else as a pattern.
const takes = (matcher, name) =>
  matcher === "" || matcher === "*" ? true
  : /^[A-Za-z0-9_\- ,|]+$/.test(matcher) ? matcher.split(/[|,]/).map((one) => one.trim()).includes(name)
  : new RegExp(matcher).test(name);
for (const name of names) if (!groups.some((group) => takes(group.matcher || "", name))) process.stdout.write(name + "\n");
' "$1" "$2" "$3" "${@:4}" 2>/dev/null)" || rc=$?
    if (( rc != 0 )); then
      note_fail "${3}'s ${2} registration in ${1} could not be read (node exit ${rc}), so its matcher was not checked."
      return 0
    fi
    if [[ -z "$missing" ]]; then
      info "${3}: registered on ${2} for ${*:4}"
      return 0
    fi
    while IFS= read -r name; do
      note_fail "${1} registers ${3} on ${2} with no matcher taking ${name}, so the harness runs it for none of those calls."
    done <<< "$missing"
  }

  # An implementer's whole run refused, and nothing else: a refusal that stopped firing and one that
  # refuses a targeted run both read as the agent's own choice.
  SUITE_HOOK="${REPO_ROOT}/.claude/hooks/implementer-whole-suite.sh"
  check_hook_matcher "${REPO_ROOT}/.claude/settings.json" PreToolUse implementer-whole-suite.sh Bash Monitor PowerShell
  suite_err="${SELFCHECK_TMP}/suite-hook.err"
  suite_drive() { # $1 agent type, empty for the main session · $2 tool · $3 command — prints the exit status and stderr
    local payload rc=0
    payload="$(node -e '
const [agent, tool, command] = process.argv.slice(1);
const input = { session_id: "probe", hook_event_name: "PreToolUse", tool_name: tool, tool_input: { command } };
if (agent) input.agent_type = agent;
process.stdout.write(JSON.stringify(input));
' "$1" "$2" "$3")"
    # Bounded as the harness bounds the hook, so a reader that hangs fails its probe instead of the step.
    printf '%s' "$payload" | timeout 10 bash "$SUITE_HOOK" >/dev/null 2>"$suite_err" || rc=$?
    printf '%s %s' "$rc" "$(tr '\n' ' ' < "$suite_err")"
  }
  expect_refused() { # $1 tool · $2 command
    local said
    said="$(suite_drive implementer "$1" "$2")"
    case "$said" in
      "2 Refused by .claude/hooks/implementer-whole-suite.sh"*) info "whole-suite hook: ${1} '${2}' — refused" ;;
      *) note_fail "whole-suite hook: ${1} '${2}' must exit 2 naming the hook, got '${said:0:200}'" ;;
    esac
  }
  expect_let_through() { # $1 agent type · $2 tool · $3 command
    local said
    said="$(suite_drive "$1" "$2" "$3")"
    if [[ "$said" == "0 " ]]; then info "whole-suite hook: ${1:-the main session} ${2} '${3}' — let through"
    else note_fail "whole-suite hook: ${1:-the main session} ${2} '${3}' must exit 0 silently, got '${said:0:200}'"; fi
  }
  # One probe per arm of the reader, every member of its word lists included: an arm no probe reaches
  # can be deleted with the step green. The runners and the operands that narrow nothing first.
  expect_refused Bash 'pnpm test'
  expect_refused Bash 'npm test'
  expect_refused Bash 'npm run test'
  expect_refused Bash 'pnpm run test -- --test-name-pattern one'
  expect_refused Bash 'pnpm --dir fl_frontend run test:db'
  expect_refused Bash 'pnpm -C fl_frontend test'
  expect_refused Bash 'pnpm --filter fl_frontend test'
  expect_refused Bash 'pnpm run test:base'
  expect_refused Bash 'pnpm run test:base -- --test-name-pattern one'
  for suite_tree in . ./src/ src fl_frontend fl_frontend/src '"**/*.test.ts"'; do
    expect_refused Bash "pnpm run test:base ${suite_tree}"
  done
  expect_refused Bash 'node --import ./scripts/tsconfig-alias-hook.mjs --test'
  expect_refused Bash 'node --test --test-name-pattern one'
  expect_refused Bash 'pnpm exec node --test'
  expect_refused Bash 'pytest'
  expect_refused Bash 'python3 -m pytest'
  expect_refused Bash 'uv run --frozen pytest -q'
  expect_refused Bash 'uv run --frozen pytest -k spiele'
  for suite_tree in tests ./tests/ fl_backend fl_backend/tests; do
    expect_refused Bash "uv run --frozen pytest ${suite_tree}"
  done
  # A narrowing operand names a test file or a node id, so a directory, a glob or a flag's value is none.
  for suite_tree in tests/api 'tests/*' '-n auto' '-p no:cacheprovider --maxfail 1'; do
    expect_refused Bash "uv run --frozen pytest ${suite_tree}"
  done
  expect_refused Bash 'uv run --project fl_backend --frozen python -m pytest -m db'
  expect_refused Bash 'uv run --frozen pytest -m db -n 2'
  expect_refused Bash 'uv run --frozen pytest -m db tests/api/test_spiele.py tests/api/test_teams.py'
  expect_refused Bash 'node --test --test-reporter spec'
  expect_refused Bash 'pnpm run test:base -- --test-reporter dot'
  expect_refused Bash 'npm t'
  expect_refused Bash 'bash -x ./scripts/gate/verify.sh'
  expect_refused Bash 'uv run --directory fl_backend pytest'
  expect_refused Bash './scripts/gate/verify.sh --docs'
  expect_refused Bash 'bash scripts/ops/local.sh --down'
  # Then each route to a runner: a wrapper, a quote, a separator, a redirect, another shell.
  expect_refused Bash 'CI=1 pnpm test'
  expect_refused Bash 'env CI=1 pnpm test'
  expect_refused Bash 'cross-env CI=1 pnpm test'
  expect_refused Bash 'timeout 600 pnpm test'
  for suite_word in 'time' 'exec' 'command' '!' 'if' 'then' 'else' 'do' 'while' 'until'; do
    expect_refused Bash "${suite_word} pnpm test"
  done
  expect_refused Bash 'cd fl_backend && uv run --frozen pytest > out.txt 2>&1'
  expect_refused Bash 'uv run --frozen pytest < /dev/null'
  expect_refused Bash "uv run --frozen \\"$'\n'"pytest"
  expect_refused Bash "echo \$(uv run --frozen pytest)"
  suite_tick='`'
  expect_refused Bash "echo ${suite_tick}pnpm test${suite_tick}"
  expect_refused Bash '(cd fl_frontend && pnpm test)'
  expect_refused Bash '{ pnpm test; }'
  expect_refused Bash 'bash -c "cd fl_frontend && pnpm test"'
  expect_refused Bash "sh -c 'pnpm test'"
  expect_refused Bash 'bash -lc "pnpm test"'
  # A double quote's escapes are read, so the escaped quotes inside close nothing.
  expect_refused Bash 'bash -c "pnpm test \"x\""'
  expect_refused Monitor 'pnpm test 2>&1 | tail -5'
  expect_refused PowerShell 'cd fl_frontend; pnpm test'
  # PowerShell's backslash separates a path rather than escaping the character after it.
  expect_refused PowerShell 'uv run --frozen pytest fl_backend\tests'
  expect_let_through implementer Bash 'pnpm run test:base src/core/apiContract.test.ts'
  expect_let_through implementer Bash 'node --test src/core/apiContract.test.ts'
  expect_let_through implementer Bash 'uv run --frozen pytest tests/api/test_spiele.py'
  expect_let_through implementer Bash 'uv run --frozen pytest tests/api/test_spiele.py::test_one'
  expect_let_through implementer Bash 'uv run --frozen pytest -m db tests/api/test_spiele.py'
  # A substitution's output is the operand, whatever it lists.
  expect_let_through implementer Bash "uv run --frozen pytest \$(git diff --name-only HEAD~1 -- tests)"
  expect_let_through implementer Bash "uv run --frozen pytest ${suite_tick}cat files.txt${suite_tick}"
  expect_let_through implementer Bash "pnpm run test:base \$(git ls-files 'src/features/x/*.test.ts')"
  expect_let_through implementer PowerShell "uv run --frozen pytest ${suite_tick}"$'\n'"  tests/api/test_spiele.py"
  expect_let_through implementer Bash 'uv run --frozen pytest --collect-only -q'
  expect_let_through implementer Bash 'uv run --frozen pytest --co'
  expect_let_through implementer Bash 'uv run --frozen pytest --version'
  expect_let_through implementer Bash 'uv run --frozen pytest -h'
  expect_let_through implementer Bash 'git log -- scripts/gate/verify.sh'
  expect_let_through implementer Bash "git commit -F - <<'EOF'"$'\n''pnpm test'$'\n''EOF'
  expect_let_through implementer Bash 'true # ; pnpm test'
  expect_let_through implementer Bash 'echo "an unterminated quote'
  # A call the reader cannot read is let through, and in time.
  expect_let_through implementer Bash 'pnpm test "x'
  expect_let_through implementer Bash "pnpm test 'x"
  expect_let_through driving-reauditor Bash 'pnpm test'
  # Past the shell script's word match, the reader's own agent check.
  expect_let_through driving-reauditor Bash 'pnpm test # implementer'
  expect_let_through '' Bash 'pnpm test'
  # Without node the hook cannot read the call, and lets it through rather than refusing blind.
  suite_rc=0
  printf '{"agent_type":"implementer","tool_input":{"command":"pnpm test"}}' |
    PATH=/nonexistent "$BASH" "$SUITE_HOOK" >/dev/null 2>&1 || suite_rc=$?
  if (( suite_rc == 0 )); then info 'whole-suite hook: no node — let through'
  else note_fail "whole-suite hook: without node it must let the call through, got exit ${suite_rc}"; fi

  # Its whole contract is reaching a coordinator and nobody else, so each arm is a payload that
  # must be told apart from the one that speaks.
  COMPACT_HOOK="${REPO_ROOT}/.claude/hooks/orchestration-compact.sh"
  check_hook_matcher "${REPO_ROOT}/.claude/settings.json" SessionStart orchestration-compact.sh compact
  compact_home="${SELFCHECK_TMP}/compact-home"
  mkdir -p "${compact_home}/.claude/plans/programme"
  printf '# Agent register\n\nCoordinator session id: probe-1\n' > "${compact_home}/.claude/plans/programme/REGISTER-one.md"
  compact_drive() { # $1 payload — prints the exit status and what the hook said
    local rc=0 out
    out="$(printf '%s' "$1" | HOME="$compact_home" bash "$COMPACT_HOOK" 2>&1)" || rc=$?
    printf '%s %s' "$rc" "$out"
  }
  compact_said="$(compact_drive '{"session_id":"probe-1","source":"compact","hook_event_name":"SessionStart"}')"
  if [[ "$compact_said" == "0 "* ]] && node -e '
const said = JSON.parse(process.argv[1]).hookSpecificOutput;
const text = said.additionalContext;
// The core as the file on disk, the resume point and the register: the hook owes all three.
const pointers = /\.claude\/skills\/orchestration\/SKILL\.md as it is on disk/.test(text) && /resume point/.test(text);
process.exit(said.hookEventName === "SessionStart" && pointers && /REGISTER-one\.md/.test(text) ? 0 : 1);
' "${compact_said#0 }" 2>/dev/null; then
    info 'compaction hook: the coordinator — told its core, its register and its resume point'
  else
    note_fail "compaction hook: the coordinator's compaction must name the core, the resume point and its register as JSON, got '${compact_said:0:200}'"
  fi
  for compact_case in \
    'another session|{"session_id":"probe-2","source":"compact","hook_event_name":"SessionStart"}' \
    'a startup|{"session_id":"probe-1","source":"startup","hook_event_name":"SessionStart"}' \
    'a subagent|{"session_id":"probe-1","source":"compact","agent_id":"a1","hook_event_name":"SessionStart"}' \
    'a pattern for an id|{"session_id":"probe-.*","source":"compact","hook_event_name":"SessionStart"}' \
    'unreadable input|not json'; do
    compact_said="$(compact_drive "${compact_case#*|}")"
    if [[ "$compact_said" == "0 " ]]; then info "compaction hook: ${compact_case%%|*} — silent"
    else note_fail "compaction hook: ${compact_case%%|*} must exit 0 silently, got '${compact_said:0:200}'"; fi
  done

  # The coordinator's send is recorded once, in the recipient's file, through uv; a subagent's send to
  # the coordinator writes nothing. The recording's cases are scripts/tests/test_orchestration_tools.py's.
  MESSAGES_HOOK="${REPO_ROOT}/.claude/hooks/orchestration-messages.sh"
  check_hook_matcher "${REPO_ROOT}/.claude/settings.json" PostToolUse orchestration-messages.sh SendMessage
  if ! command -v uv >/dev/null 2>&1; then
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then note_fail "uv is absent, and this is CI, which installs it for every python scope"
    else note_skip "the messages hook's probe did not run: uv is absent, and the hook records through it"; fi
  else
    messages_home="${SELFCHECK_TMP}/messages-home"
    messages_briefs="${messages_home}/.claude/plans/programme/briefs"
    mkdir -p "$messages_briefs"
    # Python opens the register's path as written, so a native program spells it: node resolves its
    # argument as the platform's own tools do.
    printf '# Agent register\n\nCoordinator session id: probe-1\nBriefs: %s\n\n## Live agents\n\n| Agent | Status |\n| --- | --- |\n| WORKER | RUNNING |\n' \
      "$(node -e 'process.stdout.write(require("path").resolve(process.argv[1]))' "$messages_briefs")" > "${messages_home}/.claude/plans/programme/REGISTER-one.md"
    printf '# WORKER\n' > "${messages_briefs}/WORKER-messages.md"
    messages_drive() { # $1 payload — prints the exit status and what the hook said
      local rc=0 out
      out="$(printf '%s' "$1" | HOME="$messages_home" bash "$MESSAGES_HOOK" 2>&1)" || rc=$?
      printf '%s %s' "$rc" "$out"
    }
    messages_said="$(messages_drive '{"session_id":"probe-1","tool_name":"SendMessage","tool_input":{"to":"WORKER","message":"probe order"}}')"
    if [[ "$messages_said" == "0 " ]] && grep -q '^probe order$' "${messages_briefs}/WORKER-messages.md"; then
      info 'messages hook: the coordinator'"'"'s send — recorded in the recipient'"'"'s file'
    else note_fail "messages hook: the coordinator's send must be appended to WORKER-messages.md silently, got '${messages_said:0:200}'"; fi
    messages_said="$(messages_drive '{"session_id":"probe-1","agent_id":"a1","tool_name":"SendMessage","tool_input":{"to":"WORKER","message":"subagent reply"}}')"
    if [[ "$messages_said" == "0 " ]] && ! grep -q 'subagent reply' "${messages_briefs}/WORKER-messages.md"; then
      info 'messages hook: a subagent'"'"'s send — silent, nothing written'
    else note_fail "messages hook: a subagent's send must write nothing and stay silent, got '${messages_said:0:200}'"; fi
  fi

  # A writing or driving agent's MCP and Skill calls refused, because the app ignores the
  # definitions' `disallowedTools`; every other caller and tool let through.
  TOOLS_HOOK="${REPO_ROOT}/.claude/hooks/writer-tools.sh"
  check_hook_matcher "${REPO_ROOT}/.claude/settings.json" PreToolUse writer-tools.sh Skill mcp__Claude_Browser__navigate mcp__ccd_session__spawn_task
  tools_drive() { # $1 payload — prints the exit status and stderr
    local rc=0 out
    out="$(printf '%s' "$1" | timeout 10 bash "$TOOLS_HOOK" 2>&1 >/dev/null)" || rc=$?
    printf '%s %s' "$rc" "$out"
  }
  for tools_case in \
    'implementer|mcp__Claude_Browser__navigate' 'implementer|Skill' 'driving-reauditor|mcp__ccd_session__spawn_task'; do
    tools_said="$(tools_drive "{\"agent_type\":\"${tools_case%%|*}\",\"tool_name\":\"${tools_case#*|}\",\"tool_input\":{}}")"
    case "$tools_said" in
      "2 Refused by .claude/hooks/writer-tools.sh"*) info "writer-tools hook: ${tools_case%%|*} ${tools_case#*|} — refused" ;;
      *) note_fail "writer-tools hook: ${tools_case%%|*} ${tools_case#*|} must exit 2 naming the hook, got '${tools_said:0:200}'" ;;
    esac
  done
  for tools_case in \
    'the main session|{"tool_name":"mcp__Claude_Browser__navigate","tool_input":{"note":"implementer"}}' \
    'a researcher|{"agent_type":"researcher","tool_name":"mcp__Claude_Browser__navigate","tool_input":{}}' \
    'an implementer reading|{"agent_type":"implementer","tool_name":"Read","tool_input":{}}' \
    'unreadable input|implementer {'; do
    tools_said="$(tools_drive "${tools_case#*|}")"
    if [[ "$tools_said" == "0 " ]]; then info "writer-tools hook: ${tools_case%%|*} — let through"
    else note_fail "writer-tools hook: ${tools_case%%|*} must exit 0 silently, got '${tools_said:0:200}'"; fi
  done

  # Every spawned or resumed agent with a definition file is told that file binds, by the checkout's
  # absolute path, its worktree's copy being as old as its fork; a Windows path must still parse.
  DEFINITION_HOOK="${REPO_ROOT}/.claude/hooks/agent-definition.sh"
  check_hook_matcher "${REPO_ROOT}/.claude/settings.json" SubagentStart agent-definition.sh implementer driving-reauditor researcher cold-auditor
  for definition_type in implementer driving-reauditor researcher cold-auditor; do
    definition_said="$(printf '{"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"%s"}' "$definition_type" | CLAUDE_PROJECT_DIR='C:\probe\checkout' bash "$DEFINITION_HOOK" 2>&1)"
    if node -e '
const said = JSON.parse(process.argv[1]).hookSpecificOutput;
const text = said.additionalContext;
const absolute = text.includes("C:\\probe\\checkout/.claude/agents/" + process.argv[2] + ".md");
process.exit(said.hookEventName === "SubagentStart" && absolute && /own worktree can be older/.test(text) ? 0 : 1);
' "$definition_said" "$definition_type" 2>/dev/null; then info "definition hook: ${definition_type} — told its definition file by absolute path"
    else note_fail "definition hook: ${definition_type} must be told the project directory's .claude/agents/${definition_type}.md, and that its worktree's copy can be older, as JSON, got '${definition_said:0:200}'"; fi
  done
  # With no project directory the hook falls back to its own checkout, which must name a file that exists.
  definition_said="$(printf '{"hook_event_name":"SubagentStart","agent_type":"implementer"}' | (unset CLAUDE_PROJECT_DIR; bash "$DEFINITION_HOOK") 2>&1)"
  if [[ "$definition_said" == *"${REPO_ROOT}/.claude/agents/implementer.md as it is on disk"* ]]; then
    info "definition hook: no project directory — told its own checkout's file"
  else note_fail "definition hook: with no project directory it must name ${REPO_ROOT}/.claude/agents/implementer.md, got '${definition_said:0:200}'"; fi
  for definition_case in \
    'a built-in agent|{"hook_event_name":"SubagentStart","agent_type":"Explore"}' \
    'a path in the type|{"hook_event_name":"SubagentStart","agent_type":"../settings"}' \
    'unreadable input|not json'; do
    definition_said="$(printf '%s' "${definition_case#*|}" | bash "$DEFINITION_HOOK" 2>&1)"
    if [[ -z "$definition_said" ]]; then info "definition hook: ${definition_case%%|*} — silent"
    else note_fail "definition hook: ${definition_case%%|*} must stay silent, got '${definition_said:0:200}'"; fi
  done
fi

step "13. Every deliberate non-run reaches the gate"
# Any message shape, not a quoted one alone, so `skip bareword` is caught too.

# The sweep's own status is kept and the exclusions are one pattern: `grep … || true` reports a file
# it could not read exactly as it reports a clean one, and under `pipefail` a second stage exiting 1
# hides a first exiting 2.
SWEEP="${SELFCHECK_TMP}/ledger-sweep.txt"
sweep_rc=0
grep -nE '(^|[^_[:alnum:]])(skip|warn)[[:space:]]+[^[:space:]]' scripts/gate/selfcheck.sh > "$SWEEP" 2>/dev/null \
  || sweep_rc=$?
sweep_lines=0
if [[ -s "$SWEEP" ]]; then sweep_lines="$(wc -l < "$SWEEP")"; fi
# The exclusions: prose using the word, and the two definitions themselves.
stray=""
stray_rc=0
if (( sweep_rc <= 1 )); then
  stray="$(grep -vE '^[0-9]+:([[:space:]]*#|(note_skip|note_warn)\(\))' "$SWEEP")" || stray_rc=$?
fi
if (( sweep_rc > 1 )); then
  note_fail "this file could not be swept for unledgered shortfalls (grep exit ${sweep_rc}), so nothing below was checked"
elif (( stray_rc > 1 )); then
  note_fail "the sweep's result could not be filtered (grep exit ${stray_rc}), so nothing below was checked"
# The definitions of note_skip and note_warn match the sweep and are then excluded, so a run that
# matched nothing at all read something other than this file.
elif (( sweep_lines == 0 )); then
  note_fail "the sweep matched nothing whatever, not even the two definitions it excludes — it did not read this file"
elif [[ -n "$stray" ]]; then
  note_fail "these lines announce a shortfall the gate cannot see — call note_skip or note_warn instead:"
  printf '%s\n' "$stray" | excerpt 5
else
  info "every deliberate non-run here is written to the ledger verify.sh replays (${sweep_lines} line(s) swept)"
fi

step "14. The container-log redaction"
# Wrong in either direction and silent in both: a credential reaching the operator's terminal, or
# the host redacted out of the log a failing deploy is read from. Each case below is a real
# error-message shape, the bound being a regex nobody re-derives.
REDACTED_OK=0
redact_case() { # $1 the line as a container printed it - $2 what must reach the screen
  local got
  got="$(printf '%s\n' "$1" | redact_uri_credentials)"
  if [[ "$got" == "$2" ]]; then
    REDACTED_OK=$(( REDACTED_OK + 1 ))
  else
    note_fail "redaction: '${1}' became '${got}', expected '${2}'"
  fi
}

# Replaced: the userinfo, and nothing past it.
redact_case 'Invalid connection string "mongodb://u:pw@host.example.net/db"' \
            'Invalid connection string "mongodb://<redacted>@host.example.net/db"'
redact_case 'mongodb+srv://u:pw@cluster.example.net/db' \
            'mongodb+srv://<redacted>@cluster.example.net/db'
redact_case 'MONGODB://u:pw@host.example.net/db' \
            'MONGODB://<redacted>@host.example.net/db'
# An encoded `@` inside the password, which is the only way a MongoDB URI may carry one.
redact_case 'mongodb://u:pw%40x@host.example.net/db' \
            'mongodb://<redacted>@host.example.net/db'
# A comma is a sub-delimiter userinfo may hold unencoded, so the bound may not stop at one.
redact_case 'mongodb://u:pw,x@host.example.net/db' \
            'mongodb://<redacted>@host.example.net/db'
# A seed list, where the same comma separates hosts instead.
redact_case 'mongodb://u:pw@h1.example.net,h2.example.net/db?replicaSet=rs' \
            'mongodb://<redacted>@h1.example.net,h2.example.net/db?replicaSet=rs'

# Fails OPEN where the bound is a character class: a delimiter in the password leaves no `@` inside
# the class, so nothing matches — and ill-formed is the very string a driver could not parse.
redact_case 'mongodb://admin:S3cr3t/Pw@host.example.net/db' \
            'mongodb://<redacted>@host.example.net/db'
redact_case 'mongodb://admin:S3cr3t?Pw@host.example.net/db' \
            'mongodb://<redacted>@host.example.net/db'
redact_case 'mongodb://admin:S3cr3t"Pw@host.example.net/db' \
            'mongodb://<redacted>@host.example.net/db'
redact_case 'mongodb://admin:S3cr3t Pw@host.example.net/db' \
            'mongodb://<redacted>@host.example.net/db'
redact_case $'mongodb://admin:S3cr3t\tPw@host.example.net/db' \
            'mongodb://<redacted>@host.example.net/db'

# Bounded: an `@` further along the line is not the userinfo's, and reaching it costs the host.
redact_case 'mongodb://u:pw@host.example.net/db?authSource=admin&appName=x@y' \
            'mongodb://<redacted>@host.example.net/db?authSource=admin&appName=x@y'
redact_case 'mongodb://u:pw@host.example.net?appName=x@y' \
            'mongodb://<redacted>@host.example.net?appName=x@y'
# A bare `@` past a comma: any class wide enough for a password holding one admits it too, so only
# stopping at the FIRST `@` keeps the host, which is what a failing deploy is read from.
redact_case 'uri=mongodb://u1:p1@h1.example.net:27017,ops@example.com' \
            'uri=mongodb://<redacted>@h1.example.net:27017,ops@example.com'
redact_case 'MONGODB_URI=mongodb://u:p@rs0.example.net:27017,AUTH_USER=admin@example.com' \
            'MONGODB_URI=mongodb://<redacted>@rs0.example.net:27017,AUTH_USER=admin@example.com'
# Two URIs in one JSON object, which is the shape a log line carries them in: nothing between them.
redact_case 'a:"mongodb://u:pw@h1.example.net/","mongodb://v:qw@h2.example.net/"' \
            'a:"mongodb://<redacted>@h1.example.net/","mongodb://<redacted>@h2.example.net/"'
redact_case 'mongodb://u:pw@h1.example.net/ mongodb://v:qw@h2.example.net/' \
            'mongodb://<redacted>@h1.example.net/ mongodb://<redacted>@h2.example.net/'

# Untouched: no userinfo to replace, and lines the filter must leave alone.
redact_case 'mongodb://localhost:27017' 'mongodb://localhost:27017'
redact_case 'mongodb+srv://cluster.example.net/db' 'mongodb+srv://cluster.example.net/db'
redact_case 'write to nobody@example.net about it' 'write to nobody@example.net about it'
# The gap docs/logging/spec.md section 4 records: no URI around it, so nothing matches.
redact_case 'MONGO_PASSWORD=pw' 'MONGO_PASSWORD=pw'

# The second gap that page records: no userinfo, so the first `@` after the scheme belongs to
# somebody else and the host goes with it. Nothing on this line was ever secret.
redact_case 'mongodb://localhost:27017 and mail nobody@example.net' \
            'mongodb://<redacted>@example.net'

info "${REDACTED_OK} redaction fixture(s) came back exactly as specified"

# Every tag the image's file names is judged on its own, one per matching line: read as one value,
# two stages' tags hand the series check a string its glob matches across the line break.
first_disagreeing_tag() { # $1 exact, or series for a pin naming a series · $2 the pin · $3… the tags
  local mode="$1" pin="$2" tag
  shift 2
  for tag in "$@"; do
    [[ "$tag" == "$pin" || ( "$mode" == series && "$tag" == "${pin}."* ) ]] && continue
    printf '%s' "$tag"
    return 0
  done
}

# The one judgement every pin step makes; each step's reader differs and hands it the two values.
judge_pin() { # $1 what is pinned · $2 exact, or series · $3 the manifest · $4 the Dockerfile · $5 what a disagreement costs · $6 the pin · $7… the tags
  local what="$1" mode="$2" manifest="$3" dockerfile="$4" cost="$5" pin="$6" other
  shift 6
  if [[ -z "$pin" || $# -eq 0 ]]; then
    # Not a skip: a spelling this cannot read is the same silence the step exists to remove.
    note_fail "could not read the ${what} version from both files — ${manifest} '${pin:-none}', ${dockerfile} '${*:-none}'"
    return 0
  fi
  other="$(first_disagreeing_tag "$mode" "$pin" "$@")"
  if [[ -n "$other" ]]; then
    note_fail "${manifest} pins ${what} ${pin} and ${dockerfile} carries ${other}; ${cost}"
  elif [[ "$mode" == series ]]; then
    info "${what} ${*} in the image, inside the ${pin} the repository pins"
  else
    info "${what} ${pin} in the manifest and the image"
  fi
}

check_uv_pin() { # $1 the manifest · $2 the Dockerfile
  local pin
  local -a tags
  pin="$(sed -n 's/^required-version = "==\([0-9][^"]*\)"/\1/p' "$1")"
  mapfile -t tags < <(sed -n 's|^FROM ghcr.io/astral-sh/uv:\([^ @]*\)[@ ].*|\1|p' "$2")
  judge_pin uv exact "$1" "$2" "uv sync refuses the pair, so the backend image cannot build" "$pin" "${tags[@]}"
}

check_node_pin() { # $1 the manifest · $2 the Dockerfile
  local pin
  local -a tags
  # Scoped to `devEngines` then `runtime`: the manifest's own top-level `version` names the package.
  pin="$(awk '
    /"devEngines"[[:space:]]*:/ { dev = 1 }
    dev && /"runtime"[[:space:]]*:/ { runtime = 1 }
    runtime && match($0, /"version"[[:space:]]*:[[:space:]]*"[^"]*"/) {
      pin = substr($0, RSTART, RLENGTH); sub(/^"version"[[:space:]]*:[[:space:]]*"/, "", pin); sub(/"$/, "", pin)
      print pin; exit
    }
  ' "$1")"
  mapfile -t tags < <(sed -n 's|^FROM node:\([0-9][^-@ ]*\)[-@ ].*|\1|p' "$2")
  judge_pin Node exact "$1" "$2" "move the one the bot left behind, and the lockfile with the manifest (pnpm install)" "$pin" "${tags[@]}"
}

check_pnpm_pin() { # $1 the manifest · $2 the Dockerfile
  local pin
  local -a tags
  pin="$(sed -n 's/^[[:space:]]*"packageManager":[[:space:]]*"pnpm@\([0-9][^"+]*\).*/\1/p' "$1")"
  mapfile -t tags < <(sed -n 's/^ARG PNPM_VERSION=\([^[:space:]]*\).*/\1/p' "$2")
  judge_pin pnpm exact "$1" "$2" "bump both" "$pin" "${tags[@]}"
}

check_python_series() { # $1 the .python-version file · $2 the Dockerfile
  local pin
  local -a tags
  pin="$(sed -n '1s/^\([0-9][0-9.]*\)[[:space:]]*$/\1/p' "$1")"
  mapfile -t tags < <(sed -n 's|^FROM python:\([0-9][^-@ ]*\)[-@ ].*|\1|p' "$2")
  judge_pin Python series "$1" "$2" "CI and the virtualenv test a Python production does not run" "$pin" "${tags[@]}"
}

step "15. The uv version is one number in two files"
# A bot moves one and not the other, and `uv sync` then refuses outright, so the backend image
# stops building on every branch at once — including branches that touched neither file.
check_uv_pin fl_backend/pyproject.toml fl_backend/Dockerfile

step "16. The Node version is one number in two files"
# pnpm downloads the pinned Node for the checkout and CI, and the image runs its base's own, so a
# bot moving the tag alone ships a Node no test ran on (`docs/ops/spec.md :: I511`).
check_node_pin fl_frontend/package.json fl_frontend/Dockerfile

step "17. The pnpm version is one number in two files"
# Nothing moves either by itself (`.github/dependabot.yml`), so a hand bump of one installs the image
# with a pnpm the lockfile was never written by (`docs/ops/spec.md :: I512`).
check_pnpm_pin fl_frontend/package.json fl_frontend/Dockerfile

step "18. The Python series is one number in two files"
# The file names a series and the tag a release inside it, so the tag's leading numbers are compared:
# every CI job's interpreter comes from the file, and production's from the tag (`docs/ops/spec.md :: I513`).
check_python_series fl_backend/.python-version fl_backend/Dockerfile

# The only thing that tells a run with nothing to report from one that stopped reporting.
if [[ -n "${FL_SELFCHECK_LEDGER:-}" ]]; then
  printf 'end\t%s\n' "$LEDGERED" >> "$FL_SELFCHECK_LEDGER"
fi

printf '\n'
if (( FAILURES == 0 )); then
  ok "All script self-checks passed."
else
  die "${FAILURES} script self-check(s) failed."
fi
