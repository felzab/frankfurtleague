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

RUNNABLE=(ops/local.sh gate/verify.sh ops/deploy.sh gate/scope_map.sh gate/selfcheck.sh)

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
# call. Underscored names only — the helper convention here, and the one class no external program
# collides with. A single-word helper is outside it.

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
  if (w ~ /^(if|then|else|elif|do|while|until|time|in|done|fi|coproc)$/) { cmd = 1; return }
  if (w == "for" || w == "select" || w == "function") { cmd = 1; skipnext = 1; return }
  atcmd = (cmd && !pat)
  cmd = 0
  if (skipnext) { skipnext = 0; return }
  if (w ~ /=/) { if (atcmd) { cmd = 1; assign = 1 }; return }
  assign = 0
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
# reads verify.sh against itself, and `scripts/tests/test_scope_decisions.py ::
# test_the_two_lists_of_scope_names_agree` guards the mapping's direction alone.
# Two listings, two routes, per PRE-4.

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

step "15. The uv version is one number in two files"
# A bot moves one and not the other, and `uv sync` then refuses outright, so the backend image
# stops building on every branch at once — including branches that touched neither file.
UV_PIN="$(sed -n 's/^required-version = "==\([0-9][^"]*\)"/\1/p' fl_backend/pyproject.toml)"
UV_TAG="$(sed -n 's|^FROM ghcr.io/astral-sh/uv:\([^ @]*\)[@ ].*|\1|p' fl_backend/Dockerfile)"
if [[ -z "$UV_PIN" || -z "$UV_TAG" ]]; then
  # Not a skip: a spelling this cannot read is the same silence the step exists to remove.
  note_fail "could not read the uv version from both files — pin '${UV_PIN:-none}', image tag '${UV_TAG:-none}'"
elif [[ "$UV_PIN" != "$UV_TAG" ]]; then
  note_fail "fl_backend/pyproject.toml pins uv ${UV_PIN} and fl_backend/Dockerfile copies in ${UV_TAG}; uv sync refuses the pair, so the backend image cannot build"
else
  info "uv ${UV_PIN} in the manifest and the image"
fi

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
