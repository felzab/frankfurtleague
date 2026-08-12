#!/usr/bin/env bash
#
# SCRIPTS · test the scripts themselves.
#
# `bash -n` checks syntax only: a script can call a helper that does not exist and pass every syntax
# check, because that failure is discoverable at run time alone. Run this after touching anything in
# `scripts/`, `.claude/hooks/` or `.githooks/`, whose shell it lints and whose guards it probes. Each
# check announces itself with a `step` title, so what runs is the run's own output rather than a copy
# here that can disagree with it.
#
# What did not run reaches the gate as well as the screen: `verify.sh` captures this output and
# prints it only on failure, so every `skip` and every advisory is recorded in the file
# `$FL_SELFCHECK_LEDGER` names, for the gate to replay in its own voice.
#
#   ./scripts/selfcheck.sh
#   ./scripts/selfcheck.sh --verbose     one check at a time, and every finding in full
#   ./scripts/selfcheck.sh --help
#
# See:
# - docs/ops/spec.md — the gate this feeds, and the script conventions it holds them to

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

# Arguments are read before anything else, and this script joins RUNNABLE only below: checks 5 and 6
# run every runnable script with a flag, so a suite answering neither would run itself recursively.

# shellcheck disable=SC2034  # VERBOSE is consumed by _lib.sh, which shellcheck cannot follow into
for arg in "$@"; do
  case "$arg" in
    --verbose)  VERBOSE=1 ;;
    --help|-h)  usage ;;
    *)          die "Unknown option: ${arg}. Try --help." ;;
  esac
done

RUNNABLE=(local.sh verify.sh publish.sh deploy.sh ci_scopes.sh selfcheck.sh)

# Every file with a shell interpreter, wherever it lives. The `.githooks/` entries carry no suffix,
# so they are taken by directory: nothing else lints them, and a commit-msg hook that does not parse
# breaks committing on the machine that installed it.
SHELL_FILES=()
for f in scripts/*.sh .claude/hooks/*.sh .githooks/*; do
  if [[ -f "$f" ]]; then SHELL_FILES+=("$f"); fi
done

# The fixture roots keep the names `.gitignore` documents, and each run owns a subdirectory inside
# them: the gate runs from several sessions at once, and a shared fixture path means one run's setup
# deletes another run's tree from under it.
SCOPE_FIXTURES="${REPO_ROOT}/.tmp-scope-fixtures"
HOOK_FIXTURES="${REPO_ROOT}/.tmp-hook-fixtures"
RUN_ID="$$"

# One EXIT trap for the whole run: bash keeps exactly one, so a second `trap … EXIT` further down
# would silently replace this one. INT and TERM stay `scripts/_lib.sh`'s, which exits 130 and so
# fires this.
SELFCHECK_TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$SELFCHECK_TMP" "${SCOPE_FIXTURES:?}/${RUN_ID}" "${HOOK_FIXTURES:?}/${RUN_ID}"
  # Only when this was the last run holding one — a concurrent run's subdirectory keeps it alive.
  rmdir "$SCOPE_FIXTURES" "$HOOK_FIXTURES" 2>/dev/null || true
}
trap cleanup EXIT

FAILURES=0
note_fail() { fail "$*"; FAILURES=$(( FAILURES + 1 )); }

# `verify.sh` captures this script's output and prints it only when it fails, so a bare `skip` or
# `warn` reaches nobody on the green run that most needs it. These record one for the gate to
# replay, and step 14 keeps them the only route.

# One record per line, so a newline inside a message is folded rather than read back as a record of
# its own. Absent the variable there is no gate to answer, and a direct run has said it on screen.
LEDGERED=0
_ledger() { # $1 verb · $2 message
  LEDGERED=$(( LEDGERED + 1 ))
  if [[ -n "${FL_SELFCHECK_LEDGER:-}" ]]; then
    printf '%s\t%s\n' "$1" "${2//$'\n'/ }" >> "$FL_SELFCHECK_LEDGER"
  fi
}
note_skip() { skip "$*"; _ledger skip "$*"; }
note_warn() { warn "$*"; _ledger warn "$*"; }

# --- Running the independent checks concurrently -------------------------------------------------

# Every unit below is one function that reads, decides, and prints `<verb>\t<message>` lines to a
# file of its own. No unit reads what another writes, so a group's units are order-independent, and
# the parent replays their files in the queued order.

# That buys the guarantee as much as the seconds: what is printed is the serial output byte for byte
# whatever order the workers finished in, and a unit whose file came back empty failed rather than
# passed quietly.

# One at a time under `--verbose`, which is also the serial oracle: a disagreement between the two
# widths is the parallel machinery being wrong, and there has to be a way to see it.
PAR_WIDTH=16
if verbose; then PAR_WIDTH=1; fi

PAR_ITEMS=()
PAR_LABELS=()
PROBE_HOOK=()
PROBE_WANT=()
PROBE_KIND=()
PROBE_SUBJ=()

# The probe arrays are index-aligned with the queue, so they are cleared with it — a group inheriting
# the previous group's rows would probe one hook while reporting another's label.
par_reset() {
  PAR_ITEMS=(); PAR_LABELS=()
  PROBE_HOOK=(); PROBE_WANT=(); PROBE_KIND=(); PROBE_SUBJ=()
}

par_add() { # $1 label · $2 item
  PAR_LABELS+=("$1"); PAR_ITEMS+=("$2")
}

par_run() { # $1 unit function, called as `$1 <index> <item> <label>` once per queued item
  local fn="$1" total="${#PAR_ITEMS[@]}" width w i idx dir f verb msg p
  local -a pids=()
  if (( total == 0 )); then return 0; fi
  width=$PAR_WIDTH
  if (( width > total )); then width=$total; fi
  dir="${SELFCHECK_TMP}/par"
  rm -rf "$dir"; mkdir -p "$dir"
  # Every worker takes every width'th item rather than one contiguous block: the queue is grouped by
  # subject, and blocks would hand one worker every cheap unit and another every expensive one.
  for (( w = 0; w < width; w++ )); do
    # `set +e` inside, because a unit's own failure must end that unit and not the rest of its share.
    # The ERR trap is not inherited into a subshell, so nothing outside sees it either.
    (
      set +e
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
    # An empty file is a worker that died before it decided, which on this platform is a spawn that
    # failed under the width rather than a verdict. Asked again here, in the parent, on its own: a
    # unit that genuinely cannot answer has just answered that twice.
    if [[ ! -s "$f" ]]; then
      "$fn" "$i" "${PAR_ITEMS[i]}" "${PAR_LABELS[i]}" > "$f" 2>/dev/null || true
    fi
    if [[ ! -s "$f" ]]; then
      note_fail "${PAR_LABELS[i]}: this check produced no verdict, twice"
      continue
    fi
    while IFS=$'\t' read -r verb msg; do
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

# SC1091 is excluded throughout: shellcheck cannot follow the sourced `scripts/_lib.sh`. SC2034 is
# annotated at the line rather than excluded globally, so a new unused-looking assignment justifies
# itself where it is written.

# The version the Docker fallback pulls, and the one step 10 reports a local binary against. New
# releases add checks, so a difference nobody names is drift the pin exists to remove.

# Nothing bumps this automatically — dependabot reads `uses:` references, and this is a version
# string inside a shell script.
SHELLCHECK_VERSION="0.11.0"

# Availability is decided here, not encoded in a status: shellcheck's own 2 means "a file could not
# be read", so a numeric sentinel reports a real failure as an absent tool.
shellcheck_available() { command -v shellcheck >/dev/null 2>&1 || docker version >/dev/null 2>&1; }
actionlint_available() { command -v actionlint >/dev/null 2>&1 || docker version >/dev/null 2>&1; }

run_shellcheck() {
  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck -e SC1091 "$@"
    return
  fi
  # No local binary: the pinned official image, which is how shellcheck is reachable on a Windows dev
  # machine. MSYS_NO_PATHCONV stops Git Bash rewriting the container path into a Windows one.
  MSYS_NO_PATHCONV=1 docker run --rm -v "/${REPO_ROOT}:/mnt" -w /mnt \
    "koalaman/shellcheck:v${SHELLCHECK_VERSION}" -e SC1091 "$@"
}

run_actionlint() {
  if command -v actionlint >/dev/null 2>&1; then
    actionlint
    return
  fi
  # 1.7.8 is the floor: earlier versions reject `using: node24`, which GitHub documents and
  # supports. Nothing bumps this automatically — dependabot's github-actions ecosystem covers
  # `uses:` references, and this is a `docker run`.
  MSYS_NO_PATHCONV=1 docker run --rm -v "/${REPO_ROOT}:/repo" -w /repo rhysd/actionlint:1.7.12
}

# Both read files this run never writes, and each is the slowest thing in the step it belongs to, so
# both start here and are collected at their own steps: the wait then overlaps every cheap check
# instead of following them.
SC_OUT="${SELFCHECK_TMP}/shellcheck.out"; SC_RC="${SELFCHECK_TMP}/shellcheck.rc"
AL_OUT="${SELFCHECK_TMP}/actionlint.out"; AL_RC="${SELFCHECK_TMP}/actionlint.rc"
( set +e
  if shellcheck_available; then
    run_shellcheck "${SHELL_FILES[@]}" > "$SC_OUT" 2>&1; printf '%s' "$?" > "$SC_RC"
  else
    printf 'unavailable' > "$SC_RC"
  fi ) &
SC_PID=$!
( set +e
  if actionlint_available; then
    run_actionlint > "$AL_OUT" 2>&1; printf '%s' "$?" > "$AL_RC"
  else
    printf 'unavailable' > "$AL_RC"
  fi ) &
AL_PID=$!

step "1. Syntax"
# `.claude/hooks/` and `.githooks/` are included: nothing else parses them, and a hook that does not
# parse fails on the session, or the commit, it was meant to guard.
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
# A shell script with CRLF fails outright on Linux — `/usr/bin/env bash^M: bad interpreter` — and
# deploy.sh runs on the Linux server, so this is not cosmetic.

# `.gitattributes` (`* text=auto eol=lf`) means git stores LF and a fresh Linux checkout is safe, but
# a file copied directly, or an editor writing CRLF, bypasses it. Windows tolerates CRLF, so the
# defect is invisible on the machine that introduces it.

# `tr` is byte-oriented and interprets the escape itself, so no carriage return appears in this file.
# Two alternatives fail a known-CRLF fixture: MSYS awk strips CR on input, and grepping for a
# literal CR puts that character into the detector.
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
# Checks the mode git records, not the filesystem's: on Windows core.fileMode is false, so `chmod +x`
# in Git Bash is cosmetic and git keeps storing 100644 — the script then reaches the Linux server
# non-executable and `./scripts/deploy.sh` fails.

# Invisible on Windows, because bash runs a non-executable file when you name the interpreter.
# Fix:  git update-index --chmod=+x scripts/<name>.sh
# _lib.sh is excluded: it is sourced, never executed.

# One query for the whole set rather than one per file: the answers are read out of the index below,
# and on Windows the process this saves costs more than the work it does.
declare -A GIT_MODE=()
while IFS=$'\t' read -r meta path; do
  GIT_MODE["$path"]="${meta%% *}"
done < <(git ls-files -s -- "${RUNNABLE[@]/#/scripts/}" 2>/dev/null)
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

step "4. Every helper called is defined"
# Membership is answered out of an array rather than by a `grep` per name: a grep per name would be
# one process for every script-and-helper pair, which is most of this check's cost.
declare -A DEFINED=()
while IFS= read -r fn; do DEFINED["$fn"]=1; done \
  < <(grep -oE '^[a-z_]+\(\)' scripts/_lib.sh | tr -d '()')
for f in "${RUNNABLE[@]}"; do
  [[ -f "scripts/$f" ]] || continue
  # Anything that looks like one of our helpers: our naming is consistent enough to enumerate.
  called="$(grep -oE '\b(require_[a-z_]+|wait_healthy|image_[a-z_]+|git_[a-z_]+|any_python|venv_python|end_section|section|finish|refuse|add_findings|spinner_start|spinner_stop|fmt_duration|fmt_ms|excerpt|verbose|step|ok|info|skip|warn|fail|die|detail|quietly|usage|on_error|on_interrupt|emit_section_ledger|adopt_section|adopt_ending|end_worker|worker)\b' "scripts/$f" | sort -u || true)"
  missing=""
  while IFS= read -r fn; do
    [[ -z "$fn" ]] && continue
    [[ -n "${DEFINED["$fn"]:-}" ]] || missing+=" $fn"
  done <<< "$called"
  if [[ -n "$missing" ]]; then
    note_fail "$f calls undefined helper(s):$missing"
  else
    info "$f — all helpers resolve"
  fi
done

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
# Captured into a variable first: `script | grep -q …` is wrong here, because `set -o pipefail` fails
# a pipeline if any stage failed and the script under test is supposed to exit non-zero. Capturing
# separates the exit status from what the script said.
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
# Only the scripts that MUST run on one machine. verify.sh and selfcheck.sh only read and build, so
# pinning them to one OS would be an artificial restriction that also blocks CI.
for f in local.sh publish.sh deploy.sh; do
  if grep -q "require_platform" "scripts/$f"; then info "$f"; else note_fail "$f has no require_platform guard"; fi
done

step "8. Documented flags match accepted flags"
# Catches drift between a script's --help header and its case statement. Compared by READING both,
# never by running the script: invoking each flag for real means `local.sh --fresh` tears down the
# local stack as a side effect of a documentation test.
unit_flags() { # $1 index · $2 script name · $3 label
  local doc code
  # Header only: take the contiguous comment block and STOP at the first line of code. A fixed line
  # range would reach the case statement and compare the code against itself.
  doc="$(awk 'NR>1 { if ($0 !~ /^#/) exit; print }' "scripts/$2" | grep -oE -- '--[a-z-]+' | sort -u | tr '\n' ' ')"
  code="$(grep -oE '^[[:space:]]+--[a-z|[:space:]-]+\)' "scripts/$2" | tr -d ' )' | tr '|' '\n' | grep -oE -- '--[a-z-]+' | sort -u | tr '\n' ' ')"
  if [[ "$doc" == "$code" ]]; then
    printf 'info\t%s\n' "$2"
  else
    printf 'fail\t%s: --help documents [%s] but the code accepts [%s]\n' "$2" "$doc" "$code"
  fi
}
for f in "${RUNNABLE[@]}"; do par_add "$f" "$f"; done
par_run unit_flags

step "9. The guards keep one copy of each shared block"
# Two blocks are duplicated rather than sourced (ADR-0067): the write shapes the bash guards share,
# and the exemption tail the branch guards share. Nothing else compares the copies, so drift stays
# silent until a guard misses a write.

# Bounded by the sentinels the hooks carry, not by a line count that rots on the first edit nor by
# prose, which moves whenever either guard's own consumer line does.

# The sentinel name is a parameter because there are two pairs now and a third would otherwise mean
# a third copy of this awk. `opener` and `ender`, because gawk refuses `close` as a variable name.
sentinel_block() { # $1 sentinel name · $2 hook path
  awk -v opener="# >>> $1" -v ender="# <<< $1 END" '
    index($0, opener) == 1 { inside = 1 }
    inside { print }
    inside && index($0, ender) == 1 { exit }
  ' "$2"
}

# The closing sentinel is asserted on both copies before they are compared, because two empty
# extractions compare equal — so a reworded marker would report as agreement (ADR-0067).
compare_sentinel_block() { # $1 sentinel name · $2 hook path · $3 hook path
  local name="$1" one two
  # Asked before the extraction: awk on a file that is not there returns the same nothing as a
  # reworded marker, and the two want different fixes.
  if [[ ! -f "$2" || ! -f "$3" ]]; then
    note_fail "the ${name} block could not be compared — ${2} or ${3} is not there."
    return 0
  fi
  one="$(sentinel_block "$name" "$2")"
  two="$(sentinel_block "$name" "$3")"
  if [[ "${one##*$'\n'}" != *"$name END"* || "${two##*$'\n'}" != *"$name END"* ]]; then
    note_fail "the ${name} block's sentinels are gone from ${2##*/} or ${3##*/}, so nothing was compared. It runs between the '>>> ${name}' and '<<< ${name} END' comment lines."
  elif [[ "$one" != "$two" ]]; then
    note_fail "${2##*/} and ${3##*/} have drifted apart inside ${name} — the copy is deliberate, so make them identical again:"
    diff <(printf '%s\n' "$one") <(printf '%s\n' "$two") | excerpt 20 || true
  else
    info "${name}: byte-identical in ${2##*/} and ${3##*/} ($(printf '%s\n' "$one" | wc -l) lines)"
  fi
}

compare_sentinel_block 'SHARED WRITE SHAPES' .claude/hooks/guard-branch-bash.sh .claude/hooks/guard-standard-bash.sh
compare_sentinel_block 'SHARED EXEMPTION' .claude/hooks/guard-branch-bash.sh .claude/hooks/guard-branch-powershell.sh

step "10. shellcheck"
wait "$SC_PID" 2>/dev/null || true
if [[ -s "$SC_RC" ]]; then sc_rc="$(cat "$SC_RC")"; else sc_rc="unfinished"; fi

# The version actually used, named whenever it is not the pinned one: an unreported difference is
# exactly the drift the pin exists to remove.
if command -v shellcheck >/dev/null 2>&1; then
  sc_have="$(shellcheck --version 2>/dev/null | awk '$1 == "version:" { print $2 }')"
  if [[ "$sc_have" != "$SHELLCHECK_VERSION" ]]; then
    note_warn "shellcheck ${sc_have:-(unreadable version)} is on PATH but this gate pins ${SHELLCHECK_VERSION}, so a finding here need not reproduce elsewhere."
  fi
# Neutral detail rather than an advisory: the step ran and its verdict stands whole, and what this
# reports is the minute it cost and how to get that minute back.
elif [[ "$sc_rc" != "unavailable" ]]; then
  info "no shellcheck on PATH, so this step ran the pinned image through Docker — about nine seconds instead of one.
Install shellcheck once and it stops being the slowest thing here."
fi
case "$sc_rc" in
  0) info "no findings in any script" ;;
  # CI installs the pinned binary for this step, so an unavailable one there is that install gone
  # rather than a machine without the tool — the assertion steps 12 and 13 make for python and node.
  unavailable)
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
      note_fail "no shellcheck and no Docker, and this is CI, where the scripts job installs the pinned binary before this step"
    else
      note_skip "shellcheck did not run — no local binary and no Docker"
    fi ;;
  # Its own code for a file it could not open, which is not a verdict on any script: reported as
  # findings a reader looks for a defect in the shell, and reported as a skip nobody looks at all.
  2) note_fail "shellcheck could not read a file it was given, so the scripts were not all linted:"
     excerpt 40 < "$SC_OUT" ;;
  unfinished) note_fail "shellcheck left no exit status behind, so it did not run to completion" ;;
  *) note_fail "shellcheck reported findings:"; excerpt 40 < "$SC_OUT" ;;
esac

step "11. actionlint on the workflows"
# actionlint validates a workflow's expressions, job graph, action inputs and embedded shell — the
# class of bug that otherwise surfaces on the first live run. It takes check 10's ladder: local
# binary, else the pinned Docker image, else the arm below.
wait "$AL_PID" 2>/dev/null || true
if [[ -s "$AL_RC" ]]; then al_rc="$(cat "$AL_RC")"; else al_rc="unfinished"; fi
case "$al_rc" in
  0) info "no findings in any workflow" ;;
  # Nothing installs actionlint in CI: what carries this step there is the runner's own daemon, so
  # an unavailable one names a runner that answers `docker version` no more.
  unavailable)
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
      note_fail "no actionlint and no Docker, and this is CI, where the runner's daemon is what runs the pinned image"
    else
      note_skip "actionlint did not run — no local binary and no Docker"
    fi ;;
  unfinished) note_fail "actionlint left no exit status behind, so it did not run to completion" ;;
  *) note_fail "actionlint reported findings:"; excerpt 40 < "$AL_OUT" ;;
esac

step "12. The gate's comment-only classifier"
# check_scope.py decides whether a change to a packaging path is a documentation change, and a wrong
# answer is silent: classify a real code change as comments and the image build never runs before the
# push.

# These fixtures pin both directions for every language the classifier parses, including the two
# cases a line-level rule gets wrong — a `//` inside a string literal, and a Dockerfile, which is
# never classified at all (ADR-0030).

# The fixtures sit under the repo root and are passed as relative paths: MSYS rewrites an absolute
# POSIX path such as mktemp's into a Windows one the interpreter cannot open (`scripts/README.md`).
CLASSIFIER="$(any_python || true)"
CLASSIFIER_FLOOR=0
if [[ -n "$CLASSIFIER" ]]; then
  # `any_python` answers whether an interpreter exists; the question is whether it can host the
  # checkers. Asked of the kernel, so one file owns the floor, and read back below as the status its
  # import-time guard raises rather than as any other failure.
  quietly "$CLASSIFIER" -c "import sys; sys.path.insert(0, 'scripts'); import checker_kernel" \
    || CLASSIFIER_FLOOR=$?
fi
FIXTURES=".tmp-scope-fixtures/${RUN_ID}"
if [[ -z "$CLASSIFIER" ]]; then
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    note_fail "no python here, and this is CI, where the venv is installed for this check to run"
  else
    note_skip "no python found, so the classifier was not exercised"
  fi
# 3 is `checker_kernel.py :: EXIT_CRASH`, which its import-time floor guard raises. A stale literal
# here stops matching, and the fixtures then run on an interpreter that cannot host them —
# reporting a broken classifier where an old python is the story.
elif (( CLASSIFIER_FLOOR == 3 )); then
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    note_fail "this python is below the checkers' floor, and this is CI, where the venv is installed to clear it"
  else
    note_skip "this python is below the checkers' floor, so the classifier was not exercised"
  fi
else
  rm -rf "${FIXTURES:?}"; mkdir -p "$FIXTURES"

  printf 'const marker = "a//b";\n// first\n'          > "$FIXTURES/comment.old.ts"
  printf 'const marker = "a//b";\n// second\n'         > "$FIXTURES/comment.new.ts"
  printf 'const marker = "a//b";\n'                    > "$FIXTURES/code.old.ts"
  printf 'const marker = "a//c";\n'                    > "$FIXTURES/code.new.ts"
  # JSX, because the script kind follows the extension and this misparses as plain TypeScript — the
  # branch of `scripts/ts_normalize.mjs :: normalize` that nothing else exercises.
  printf 'const el = <div className="a">x</div>;\n// first\n'  > "$FIXTURES/comment.old.tsx"
  printf 'const el = <div className="a">x</div>;\n// second\n' > "$FIXTURES/comment.new.tsx"
  printf 'const el = <div className="a">x</div>;\n'            > "$FIXTURES/code.old.tsx"
  printf 'const el = <div className="b">x</div>;\n'            > "$FIXTURES/code.new.tsx"
  printf 'x = 1  # one\ndef f():\n    "doc"\n    return x\n'   > "$FIXTURES/comment.old.py"
  printf 'x = 1  # two\ndef f():\n    "other doc"\n    return x\n' > "$FIXTURES/comment.new.py"
  printf 'x = 1\n'                                     > "$FIXTURES/code.old.py"
  printf 'x = 2\n'                                     > "$FIXTURES/code.new.py"
  printf '# first\nname = "a"\n'                       > "$FIXTURES/comment.old.toml"
  printf '# second\nname = "a"\n'                      > "$FIXTURES/comment.new.toml"
  printf 'name = "a"\n'                                > "$FIXTURES/code.old.toml"
  printf 'name = "b"\n'                                > "$FIXTURES/code.new.toml"
  printf 'FROM node:26\n# first\n'                     > "$FIXTURES/dockerfile.old.Dockerfile"
  printf 'FROM node:26\n# second\n'                    > "$FIXTURES/dockerfile.new.Dockerfile"

  expect_verdict() { # $1 fixture name · $2 extension · $3 the verdict the classifier must give
    par_add "${1}.${2}" "${1}:${2}:${3}"
  }
  unit_compare() { # $1 index · $2 name:ext:want · $3 label
    local spec="$2" name ext want got
    name="${spec%%:*}"; spec="${spec#*:}"
    ext="${spec%%:*}"; want="${spec#*:}"
    got="$("$CLASSIFIER" scripts/check_scope.py --compare \
      "${FIXTURES}/${name}.old.${ext}" "${FIXTURES}/${name}.new.${ext}" 2>&1 || true)"
    if [[ "$got" == "$want" ]]; then
      printf 'info\t%s — %s\n' "$3" "$want"
    else
      printf 'fail\t%s: the classifier said %s, expected %s\n' "$3" "'${got//$'\n'/ }'" "'$want'"
    fi
  }

  # The TypeScript half is the only one needing a toolchain, and neither node nor the frontend's
  # typescript is a prerequisite of this scope: `--scripts` stays runnable on a clone that has never
  # run pnpm install.

  # A probe that cannot answer means one of two things — no typescript, or a broken normalizer — and
  # locally the safe degradation is asserted instead. CI installs the frontend for this half, so
  # there the same silence is a failure.
  if node scripts/ts_normalize.mjs "$FIXTURES/comment.old.ts" "$FIXTURES/comment.old.ts" >/dev/null 2>&1; then
    expect_verdict comment ts  comment-only
    expect_verdict comment tsx comment-only
  elif [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    note_fail "ts_normalize.mjs could not answer, and this is CI, where the scripts job installs the frontend so that it can: either typescript is missing from that install or the normalizer itself is broken, and the two look identical from here."
  else
    info "typescript does not resolve here — asserting the safe degradation, not the real answer"
    expect_verdict comment ts  code
    expect_verdict comment tsx code
  fi
  expect_verdict code       ts         code
  expect_verdict code       tsx        code
  expect_verdict comment    py         comment-only
  expect_verdict code       py         code
  expect_verdict comment    toml       comment-only
  expect_verdict code       toml       code
  # Not a gap: a `#` in a Dockerfile heredoc is not a comment, so it is never classified at all.
  expect_verdict dockerfile Dockerfile code
  par_run unit_compare

  rm -rf "${FIXTURES:?}"
fi

step "13. The hooks refuse what they exist to refuse"
# A guard is the code whose failure nobody observes: a refusal that does not happen announces
# nothing, and so does an exemption that swallows too much. These probes run a hook the way the
# runner does — a JSON payload on stdin, the verdict on stdout.

# The guards go against a throwaway repository whose branch, .gitignore and index each case controls;
# the rules-index hook goes against this repository, whose index it serves.

# The throwaway repo sits under the repo root for the same MSYS reason as the classifier fixtures: an
# absolute /tmp path is rewritten into a Windows one before bash can use it.
if ! command -v node >/dev/null 2>&1; then
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    note_fail "node is absent, and this is CI, which installs it so these probes can run"
  else
    note_skip "the hook probes did not run — node is absent, and without it the hooks deny by contract"
  fi
else
  HOOKS_DIR="${REPO_ROOT}/.claude/hooks"
  HOOKFX="${HOOK_FIXTURES}/${RUN_ID}"
  HOOK_REPO="${HOOKFX}/repo"

  # The fixture carries a .gitignore, a tracked tree and a file force-added inside the ignored tree,
  # because the exemption asks git both questions: a repository with neither answers "not ignored,
  # not tracked" to every path, which proves nothing.
  build_hook_fixture() {
    (
      set -e
      mkdir -p "$HOOK_REPO"
      cd "$HOOK_REPO"
      git init -q -b main
      git config core.autocrlf false
      mkdir -p docs/audit docs/_standard/chapters scripts src \
        fl_frontend/src/app fl_frontend/src/features .vscode
      # certs/ is here because the real repository ignores it: without that line the credential
      # override never decides a certs path in the fixture, and the probes on it cannot fail.
      printf 'docs/audit/\n.vscode/\ncerts/\n' > .gitignore
      for tracked in notes.md scripts/verify.sh scripts/check_docs.py src/tracked.py \
        fl_frontend/package.json fl_frontend/src/app.ts fl_frontend/src/clean.ts \
        fl_frontend/src/features/keep.ts docs/_standard/rules-index.md \
        docs/_standard/chapters/1-core.md docs/audit/tracked-note.md docs/audit/note.md \
        docs/audit/r.md docs/audit/a.md docs/audit/change.patch docs/audit/helper.sh \
        docs/audit/msg.txt; do
        printf 'x\n' > "$tracked"
      done
      # The stale-class hook needs the string on disk, in scope and out of it, because it reads the
      # file the payload names rather than the payload.
      printf 'const s = "text-fluid-sm";\n' > fl_frontend/src/stale.ts
      printf 'const s = "text-fluid-sm";\n' > fl_frontend/src/stale.tsx
      printf 'const s = "text-fluid-sm";\n' > scripts/outside.ts
      printf '.a { color: red } /* text-fluid-sm */\n' > fl_frontend/src/app/globals.css
      git add -A
      git add -f docs/audit/tracked-note.md
      git -c user.email=selfcheck@example.invalid -c user.name=selfcheck commit -q -m seed
      git branch -q topic
    )
  }

  # Sets _JSON rather than printing, so building a payload spawns nothing: the suite builds one per
  # probe and there are enough of them for a subshell each to be visible.
  _JSON=""
  json_string() { # $1 raw text
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\t'/\\t}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\n'/\\n}"
    _JSON="\"${s}\""
  }
  cmd_payload()  { json_string "$1"; printf '{"tool_input":{"command":%s}}' "$_JSON"; }
  file_payload() { json_string "$1"; printf '{"tool_input":{"file_path":%s}}' "$_JSON"; }
  resp_payload() { json_string "$1"; printf '{"tool_response":{"filePath":%s}}' "$_JSON"; }

  probe() { # $1 hook · $2 expected verdict · $3 payload kind · $4 subject · $5 label
    PROBE_HOOK+=("$1"); PROBE_WANT+=("$2"); PROBE_KIND+=("$3"); PROBE_SUBJ+=("$4")
    par_add "$5" ""
  }
  unit_probe() { # $1 index · $2 unused · $3 label
    local i="$1" payload out got
    case "${PROBE_KIND[i]}" in
      cmd)  payload="$(cmd_payload "${PROBE_SUBJ[i]}")" ;;
      file) payload="$(file_payload "${PROBE_SUBJ[i]}")" ;;
      resp) payload="$(resp_payload "${PROBE_SUBJ[i]}")" ;;
      *)    payload="${PROBE_SUBJ[i]}" ;;
    esac
    out="$( cd "$HOOK_REPO" && printf '%s' "$payload" | bash "${HOOKS_DIR}/${PROBE_HOOK[i]}" 2>/dev/null )" || true
    case "$out" in
      *'"permissionDecision":"deny"'*) got=denied ;;
      *'"permissionDecision":"ask"'*)  got=asked ;;
      *'"decision":"block"'*)          got=blocked ;;
      *hookSpecificOutput*)            got=emitted ;;
      "")                              got=allowed ;;
      *)                               got=unreadable ;;
    esac
    if [[ "$got" == "${PROBE_WANT[i]}" ]]; then
      printf 'info\t%s — %s\n' "$3" "$got"
    else
      printf 'fail\t%s: expected %s, got %s\n' "$3" "${PROBE_WANT[i]}" "$got"
    fi
  }

  rm -rf "${HOOKFX:?}"
  if ! quietly build_hook_fixture; then
    note_fail "could not build the throwaway repository for the hook probes"
  else
    # The root AS THE HOOK SEES IT: it asks git from its working directory, so the probes must build
    # their payloads from the same answer rather than from a path this script composed.
    hook_root="$(cd "$HOOK_REPO" && git rev-parse --show-toplevel)"
    # The MSYS drive spelling of the same root, which is one of ADR-0060's spelling classes.
    hook_msys="/$(printf '%s' "$hook_root" | sed -E 's#^([A-Za-z]):#\L\1#')"

    # Short names so the case table below stays scannable.
    hb=guard-branch-bash.sh;   hs=guard-standard-bash.sh;   ht=guard-branch.sh
    he=guard-standard-edit.sh; hc=guard-local-compose.sh;   hk=guard-stale-type-class.sh
    hp=guard-branch-powershell.sh

    # --- guard-branch.sh on main: the tool route -------------------------------------------------

    # A write inside the repository is refused however the path is spelt, and every cheap textual
    # containment test lets at least one spelling through.
    probe "$ht" denied  file "${hook_root}/inside.py"                'branch guard: plain inside path'
    probe "$ht" denied  file "${hook_root}/./inside.py"              'branch guard: ./ segment'
    probe "$ht" denied  file "${hook_root}/sub/../inside.py"         'branch guard: .. re-entry'
    probe "$ht" denied  file "${hook_root}//inside.py"               'branch guard: doubled separator'
    probe "$ht" denied  raw  '{"tool_input":{}}'                     'branch guard: payload without a path'
    probe "$ht" denied  raw  'not json'                              'branch guard: unparseable payload'
    probe "$ht" allowed file "${hook_root}/../outside.py"            'branch guard: path outside the repo'
    # A file that does not exist yet is neither tracked nor ignored, which is the answer a textual
    # test reads as "moved nothing".
    probe "$ht" denied  file "${hook_root}/fl_frontend/src/leaked.ts"          'branch guard: a file that does not exist yet'
    probe "$ht" denied  file "${hook_root}/fl_frontend/src/app/new-page.tsx"   'branch guard: a new route file'
    probe "$ht" denied  file "${hook_root}/fl_frontend/src/features/new/x.ts"  'branch guard: inside a new feature dir'
    probe "$ht" denied  file "${hook_root}/scripts/verify.sh"                  'branch guard: a tracked script'
    probe "$ht" denied  file "${hook_root}/Makefile"                           'branch guard: bare extensionless root file'

    # The gitignore exemption, still on main: ignored AND untracked is CLAUDE.md 2's "writes no
    # tracked file", which is what lets the audit commands write their reports with no branch step.
    probe "$ht" allowed file "${hook_root}/docs/audit/report.md"      'branch guard: gitignored, untracked'
    probe "$ht" allowed file "${hook_root}/docs/audit/2026/report.md" 'branch guard: gitignored subdir'
    probe "$ht" allowed file "${hook_root}/docs/audit/x/y/z/deep.md"  'branch guard: deep gitignored path'
    probe "$ht" denied  file "${hook_root}/src/tracked.py"            'branch guard: tracked file'
    # The force-added file is the case a reader expects to be exempt and is not: `git check-ignore`
    # reports a tracked path as not ignored, so it refuses on the first half already.
    probe "$ht" denied  file "${hook_root}/docs/audit/tracked-note.md" 'branch guard: ignored but tracked'

    # The credential override, checked before the exemption and beating it. Nothing is written: the
    # hook decides from the payload, so a name is all a probe needs. Two cases name a DIRECTORY
    # rather than a file, which a basename test would miss.
    for cred in .env .env.local server.pem server.key bundle.p12 id_rsa credentials.json \
      gcp-service-account.json kubeconfig .env.d/note.md certs/ca.crt; do
      probe "$ht" denied file "${hook_root}/docs/audit/${cred}" "branch guard: ${cred} under a gitignored dir"
    done
    # The segment test's negative, and the reason it is a segment test: a directory whose name merely
    # ends in the word carries no credential, and a bare substring would refuse it.
    probe "$ht" allowed file "${hook_root}/docs/audit/my-certs/notes.md" 'branch guard: a name ending in certs is not a certs directory'

    # --- guard-branch-bash.sh on main: the shell route -------------------------------------------

    # Exempt: one simple command, a program writing only where its arguments say, every path-like
    # token outside the tree or gitignored and untracked. `git checkout -b` matches no write shape.
    probe "$hb" allowed cmd 'git log --oneline -5'                             'bash guard: a read'
    # ADR-0060's posture on this route: a payload nobody could read is a question nobody answered,
    # and the other two guards answer the same input the same way.
    probe "$hb" denied  raw 'not json'                                         'bash guard: unparseable payload'
    probe "$hb" denied  cmd 'sed -i s/a/b/ scripts/verify.sh'                  'bash guard: sed -i on a tracked file'
    probe "$hb" denied  cmd 'printf x > scripts/verify.sh'                     'bash guard: redirect into a tracked file'
    probe "$hb" allowed cmd 'printf x > docs/audit/note.md'                    'bash guard: write an ignored path'
    probe "$hb" allowed cmd 'sed -i s/a/b/ docs/audit/note.md'                 'bash guard: sed -i on an ignored path'
    probe "$hb" allowed cmd 'mkdir docs/audit/newdir'                          'bash guard: mkdir under an ignored path'
    probe "$hb" allowed cmd 'touch .vscode/settings.json'                      'bash guard: a second ignored root'
    probe "$hb" denied  cmd 'rm docs/audit/note.md'                            'bash guard: delete an ignored path'
    probe "$hb" denied  cmd 'rm -rf docs/audit/newdir'                         'bash guard: delete, verb at position 0'
    probe "$hb" denied  cmd 'rmdir docs/audit/newdir'                          'bash guard: rmdir an ignored directory'
    probe "$hb" denied  cmd 'sed -i s/a/b/ fl_frontend/src/app/globals.css && cat docs/audit/r.md' 'bash guard: the substring hazard'
    probe "$hb" denied  cmd 'cp docs/audit/r.md fl_frontend/src/app/globals.css' 'bash guard: writes tracked, names ignored'
    probe "$hb" denied  cmd 'tee fl_frontend/src/app/globals.css < docs/audit/r.md' 'bash guard: through tee and an input redirect'
    probe "$hb" denied  cmd 'cp docs/audit/r.md docs/audit/credentials.json'   'bash guard: credential shape in an ignored dir'
    probe "$hb" denied  cmd 'touch docs/audit/server.pem'                      'bash guard: a pem in an ignored dir'
    probe "$hb" denied  cmd 'touch docs/audit/id_rsa_backup'                   'bash guard: an id_rsa in an ignored dir'
    probe "$hb" denied  cmd 'touch docs/audit/kubeconfig'                      'bash guard: a kubeconfig in an ignored dir'
    probe "$hb" denied  cmd 'touch docs/audit/server.key'                      'bash guard: a key in an ignored dir'
    probe "$hb" denied  cmd 'touch docs/audit/gcp-service-account.json'        'bash guard: a service-account json in an ignored dir'
    probe "$hb" denied  cmd 'touch docs/audit/certs/ca.crt'                    'bash guard: under a certs directory'
    probe "$hb" allowed cmd 'touch docs/audit/my-certs/notes.md'               'bash guard: a name ending in certs is not a certs directory'
    probe "$hb" denied  cmd 'printf x > docs/audit/log.txt && pnpm format'     'bash guard: chain with &&, second writes'
    probe "$hb" denied  cmd 'printf x > docs/audit/log.txt ; pnpm format'      'bash guard: chain with ;'
    probe "$hb" denied  cmd 'echo hi | tee docs/audit/log.txt'                 'bash guard: pipe'

    # The two substitution payloads are data: the hook has to see the characters a session would
    # type, so nothing here may expand.

    # shellcheck disable=SC2016
    probe "$hb" denied cmd 'printf x > docs/audit/$(date +%s).txt' 'bash guard: command substitution'
    # shellcheck disable=SC2016
    probe "$hb" denied cmd 'printf x > docs/audit/`date +%s`.txt'  'bash guard: backtick substitution'

    probe "$hb" denied  cmd 'xargs -I{} cd docs/audit > docs/audit/out.log'    'bash guard: cd in a simple command'
    probe "$hb" denied  cmd 'sed -i s/a/b/ scripts/*.py docs/audit/note.md'    'bash guard: glob over tracked files'
    probe "$hb" allowed cmd 'git checkout -b my-topic-branch'                  'bash guard: the escape hatch'
    probe "$hb" allowed cmd 'git switch -c my-topic-branch'                    'bash guard: the escape hatch, switch spelling'
    probe "$hb" allowed cmd "printf x > ${TMPDIR:-/tmp}/claude/x/scratchpad/note.txt" 'bash guard: a scratchpad write'
    probe "$hb" allowed cmd 'printf x > /tmp/note.txt'                         'bash guard: a /tmp write'

    # Commands that satisfy every stated condition and still write into the tracked tree, each
    # through a path git cannot place.
    probe "$hb" denied cmd 'cp docs/audit/note.md fl_frontend/src/leaked.ts'   'bash guard: new file in src/'
    probe "$hb" denied cmd 'mv docs/audit/note.md fl_frontend/src/leaked.ts'   'bash guard: mv into src/'
    probe "$hb" denied cmd 'touch fl_frontend/src/app/new-page.tsx docs/audit/note.md' 'bash guard: a new route file'
    probe "$hb" denied cmd "$(printf 'cat > fl_frontend/src/new.ts <<EOF\ndocs/audit/note.md\nEOF')" 'bash guard: heredoc into src/'
    probe "$hb" denied cmd 'mkdir -p fl_frontend/src/features/newthing docs/audit/tmp' 'bash guard: a new feature dir'
    probe "$hb" denied cmd 'cp --target-directory=fl_frontend/src docs/audit/note.md'  'bash guard: target hidden in a flag'
    probe "$hb" denied cmd 'git apply --directory=fl_frontend/src docs/audit/change.patch' 'bash guard: patch directory flag'
    probe "$hb" denied cmd 'sed -i s/a/b/ SCRIPTS/VERIFY.SH docs/audit/note.md' 'bash guard: case-varied tracked path'
    probe "$hb" denied cmd 'sed -i s/a/b/ scripts/Verify.sh docs/audit/note.md' 'bash guard: one flipped letter'
    probe "$hb" denied cmd "$(printf 'python - <<PYEOF\n# docs/audit/note.md\npathlib.Path("fl_frontend/src/app/globals.css").write_text("")\nPYEOF')" 'bash guard: a path inside program source'

    # A scan of arguments cannot see a write the arguments do not describe, so a program has to be
    # shown argument-transparent before its arguments are allowed to speak for it.
    probe "$hb" denied cmd 'git apply docs/audit/change.patch'                 'bash guard: arbitrary tracked edits'
    probe "$hb" denied cmd 'git commit -F docs/audit/msg.txt'                  'bash guard: a commit on main'
    probe "$hb" denied cmd 'git commit -am "Audit: record docs/audit/state.md"' 'bash guard: a commit on main, inline message'
    probe "$hb" denied cmd 'git merge -m docs/audit/note.md topic'             'bash guard: a local merge on main'
    probe "$hb" denied cmd 'bash docs/audit/helper.sh > docs/audit/log.txt'    'bash guard: an interpreter'
    probe "$hb" denied cmd 'pnpm format > docs/audit/format.log'              'bash guard: a formatter'
    probe "$hb" denied cmd "$(printf 'printf x > docs/audit/log.txt\ngit commit -am wip')" 'bash guard: newline then commit'
    probe "$hb" denied cmd "$(printf 'printf x > docs/audit/log.txt\npnpm format')"        'bash guard: newline then format'

    # The null device is not a destination, and a redirect into it must not release the command that
    # carries it.
    probe "$hb" denied  cmd 'echo hack > fl_frontend/src/app.ts 2>/dev/null'   'bash guard: stderr to the null device'
    probe "$hb" denied  cmd 'mv fl_frontend/src/app.ts fl_frontend/b.ts >/dev/null' 'bash guard: stdout to the null device'
    probe "$hb" allowed cmd 'ls docs/_standard > /dev/null'                    'bash guard: null device, nothing written'
    probe "$hb" denied  cmd 'printf x >fl_frontend/package.json'               'bash guard: spaceless redirect'
    probe "$hb" denied  cmd 'git checkout -- fl_frontend/package.json'         'bash guard: git checkout --'
    probe "$hb" denied  cmd 'git switch --discard-changes topic'               'bash guard: git switch, discarding'

    # --- One write, spelled many ways ------------------------------------------------------------

    # What must be refused is the write, not the spelling. The write-shape test is a substring scan
    # of the raw command, so it falls one respelling at a time. A family is as close to the
    # mechanism as a payload suite reaches.

    # No case outside the platform block at the end of this table may carry a literal backslash: the
    # token classifier answers differently under POSIX path grammar, so such a case would say one
    # thing on this machine and another in CI.
    probe "$hb" denied  cmd 'printf x >&scripts/verify.sh'                     'bash guard: >& redirect onto a tracked file'
    probe "$hb" denied  cmd 'printf x >& scripts/verify.sh'                    'bash guard: >& redirect, spaced'
    probe "$hb" denied  cmd 'printf x ->scripts/verify.sh'                     'bash guard: -> redirect onto a tracked file'
    probe "$hb" denied  cmd 'printf x =>scripts/verify.sh'                     'bash guard: => redirect onto a tracked file'
    probe "$hb" denied  cmd 'printf x >=scripts/verify.sh'                     'bash guard: >= redirect'
    probe "$hb" denied  cmd 'printf x &>scripts/verify.sh'                     'bash guard: &> redirect onto a tracked file'
    probe "$hb" denied  cmd 'echo x|tee scripts/verify.sh'                     'bash guard: tee, no spaces round the pipe'
    probe "$hb" denied  cmd 'echo x | tee scripts/verify.sh'                   'bash guard: tee, spaced'
    probe "$hb" denied  cmd 'sed  -i s/a/b/ scripts/verify.sh'                 'bash guard: sed -i, doubled space'
    probe "$hb" denied  cmd 'sed -e s/a/b/ -i scripts/verify.sh'               'bash guard: sed with -i behind another flag'
    # A prefix flag is not the subcommand, and neither is the second space. Each of these commits,
    # merges or patches on main while naming a git subcommand the raw-string scan does not see.
    probe "$hb" denied  cmd 'git -c user.name=x commit -am wip'                'bash guard: a commit on main behind -c'
    probe "$hb" denied  cmd 'git -C . commit -am wip'                          'bash guard: a commit on main behind -C'
    probe "$hb" denied  cmd 'git  commit -am wip'                              'bash guard: a commit on main, doubled space'
    probe "$hb" denied  cmd 'git  apply docs/audit/change.patch'               'bash guard: git apply, doubled space'
    probe "$hb" denied  cmd 'git -C . merge topic'                             'bash guard: a merge behind -C'
    probe "$hb" denied  cmd 'git  restore fl_frontend/package.json'            'bash guard: git restore, doubled space'
    # The V-2 boundary has to survive a respelt redirect too, or the allowlist is reached only by
    # the commands that spell their redirect the expected way.
    probe "$hb" denied  cmd 'pnpm format >&docs/audit/format.log'              'bash guard: a formatter behind a >& redirect'
    probe "$hb" denied  cmd 'bash docs/audit/helper.sh ->docs/audit/log.txt'   'bash guard: an interpreter behind a -> redirect'
    # A destination beginning with a dash is a destination, and the flag skip must not read it as a
    # flag once a redirect or a `--` has already named it.
    probe "$hb" denied  cmd 'printf x > -weird docs/audit/note.md'             'bash guard: a redirect target starting with a dash'
    probe "$hb" denied  cmd 'touch -- -newfile.ts docs/audit/note.md'          'bash guard: a dash-leading path after --'
    # Leaving main, and reading, must survive every one of those tightenings: a guard a session
    # cannot escape is the one failure this hook may never have.
    probe "$hb" allowed cmd 'git  checkout -b my-topic-branch'                 'bash guard: the escape hatch, doubled space'
    probe "$hb" allowed cmd 'git  log --oneline -5'                            'bash guard: a read, doubled space'
    probe "$hb" allowed cmd 'printf x > docs/audit/note.md 2>&1'               'bash guard: a real descriptor dup still allowed'

    # The capabilities a session on main depends on, which the refusals above must not have taken
    # with them.
    probe "$hb" allowed cmd 'git log --oneline -5 > docs/audit/log.txt'        'bash guard: a read dumped into the audit dir'
    probe "$hb" allowed cmd 'mkdir -p docs/audit/x/y/z'                        'bash guard: a deep ignored directory'
    probe "$hb" allowed cmd 'cp docs/audit/a.md docs/audit/b.md'               'bash guard: copy inside the ignored tree'
    probe "$hb" allowed cmd 'printf x >> docs/audit/note.md'                   'bash guard: append to an ignored file'
    probe "$hb" allowed cmd 'cp /tmp/x.txt docs/audit/y.txt'                   'bash guard: inbound copy from /tmp'
    probe "$hb" allowed cmd 'head -n 5 docs/audit/note.md > docs/audit/head.txt' 'bash guard: a flag with a separated value'
    probe "$hb" allowed cmd 'git checkout main && git pull --ff-only origin main && git checkout -b nm' 'bash guard: the documented branch step'
    probe "$hb" allowed cmd 'git switch topic'                                 'bash guard: leaving main by switch'
    probe "$hb" allowed cmd 'cat docs/audit/a.md > docs/audit/c.md'            'bash guard: cat into the ignored tree'
    probe "$hb" allowed cmd 'sed -i s/a/b/ docs/audit/note.md 2>/dev/null'     'bash guard: an ignored write, chatter dropped'
    probe "$hb" allowed cmd 'grep -rn foo docs/audit/a.md > docs/audit/hits.txt' 'bash guard: grep inside the ignored tree'
    probe "$hb" allowed cmd 'mv docs/audit/a.md /tmp/b.md'                     'bash guard: outbound copy to /tmp'
    probe "$hb" allowed cmd 'grep -rn foo .vscode > docs/audit/hits.txt'       'bash guard: an ignored directory as a whole'
    # The fixture force-adds a file under docs/audit, so the DIRECTORY matches something tracked —
    # the same answer the tool guard gives for that file, and not what this repository does.
    probe "$hb" denied  cmd 'grep -rn foo docs/audit > docs/audit/hits.txt'    'bash guard: an ignored dir holding a tracked file'
    # A German name under the ignored tree is an ordinary shape here, and the exemption has to place
    # it: git quotes a non-ASCII path back, and a quoted answer matches nothing the shell asked for.
    probe "$hb" allowed cmd 'printf x > docs/audit/übersicht.md'               'bash guard: a non-ASCII name in the ignored tree'
    # Recorded as an accepted cost rather than a defect: honouring it needs real shell tokenisation,
    # which is a larger change than this guard carries.
    probe "$hb" denied  cmd 'cp docs/audit/a.md "docs/audit/b c.md"'           'bash guard: a quoted name holding a space'

    # Deliberate tightenings, each with a route left open, and the adversarial spellings that reach
    # them.
    probe "$hb" denied  cmd 'touch Makefile docs/audit/note.md'                'bash guard: bare extensionless root file'
    probe "$hb" denied  cmd 'cp docs/audit/note.md Makefile'                   'bash guard: bare word as a copy target'
    probe "$hb" denied  cmd 'grep -rn foo fl_frontend/src > docs/audit/hits.txt' 'bash guard: reads tracked, writes ignored'
    probe "$hb" denied  cmd 'cp docs/audit/note.md .'                          'bash guard: the repository root itself'
    probe "$hb" denied  cmd "$(printf 'cat > /tmp/x.sh <<EOF\nhello\nEOF')"    'bash guard: multi-line scratch heredoc'
    probe "$hb" allowed cmd 'sort -o Makefile docs/audit/a.md'                 'bash guard: a writer with no write shape'
    probe "$hb" denied  cmd 'sort -o Makefile docs/audit/a.md > docs/audit/x'  'bash guard: the same writer, write shape present'
    probe "$hb" denied  cmd 'ls --color=auto docs/audit > docs/audit/x'        'bash guard: a flag value under a path program'
    probe "$hb" denied  cmd 'sed -i s/a/b/ "fl_frontend/src/app/globals.css" docs/audit/note.md' 'bash guard: a quoted tracked path'
    probe "$hb" denied  cmd 'sed -i s/a/b/ fl_"frontend"/src/app/globals.css docs/audit/note.md' 'bash guard: a quote-split tracked path'
    probe "$hb" allowed cmd 'printf x >docs/audit/note.md'                     'bash guard: spaceless redirect, ignored target'
    probe "$hb" denied  cmd 'env FOO=1 cp docs/audit/a.md fl_frontend/src/x.ts' 'bash guard: an env prefix is not a program'
    probe "$hb" denied  cmd 'tee docs/audit/x.md < fl_frontend/src/app.ts'     'bash guard: a tracked input redirect'
    probe "$hb" denied  cmd 'cp docs/audit/note.md fl_frontend/src/../../scripts/verify.sh' 'bash guard: a .. that climbs back in'
    probe "$hb" allowed cmd 'printf x > docs/audit/note.md 2>&1'               'bash guard: a descriptor dup beside a write'
    probe "$hb" denied  cmd 'node -e writeFileSync > docs/audit/log.txt'       'bash guard: an interpreter with an ignored redirect'
    probe "$hb" denied  cmd 'cp docs/audit/note.md fl_frontend/src/app/globals.CSS' 'bash guard: a case-varied tracked file'
    probe "$hb" denied  cmd 'cp docs/audit/note.md ./scripts/verify.sh'        'bash guard: ./ segment, tracked'
    probe "$hb" denied  cmd 'cp docs/audit/note.md fl_frontend/../scripts/verify.sh' 'bash guard: .. re-entry, tracked'
    probe "$hb" denied  cmd 'cp docs/audit/note.md scripts//verify.sh'         'bash guard: doubled separator, tracked'
    probe "$hb" denied  cmd "cp docs/audit/note.md ${hook_root}/scripts/verify.sh" 'bash guard: absolute spelling, tracked'
    probe "$hb" allowed cmd "sed -i s/a/b/ ${hook_root}/docs/audit/note.md"    'bash guard: absolute spelling, ignored'
    probe "$hb" allowed cmd "$(printf 'printf x > docs/audit/note.md\n')"      'bash guard: an ignored write, trailing newline'
    probe "$hb" allowed cmd '  printf x > docs/audit/note.md  '                'bash guard: an ignored write, padded with spaces'
    probe "$hb" allowed cmd 'ls -la'                                           'bash guard: a plain read'
    probe "$hb" allowed cmd 'git status --short'                               'bash guard: a plain git read'

    # --- guard-branch-powershell.sh on main: the second shell route ------------------------------

    # One probe per decision this guard makes, not per spelling: each refusal below is a
    # write-through an earlier revision allowed, and each permission is the capability half, which
    # a tightening breaks silently while every refusal here stays green.
    probe "$hp" denied  cmd 'Set-Content -Path fl_frontend/src/app.ts -Value x' 'powershell guard: a tracked write on main'
    # Names a path the exemption WOULD release, so the probe fails the day a hand adds the verb to
    # a write list. Aimed at a tracked tree it would refuse for being tracked instead.
    probe "$hp" denied  cmd 'Remove-Item docs/audit/note.md'                    'powershell guard: a deletion has no exemption'
    # PowerShell expands a variable inside double quotes and this guard cannot, so the literal it
    # judges and the file that gets written are two different paths.
    # shellcheck disable=SC2016
    probe "$hp" denied  cmd 'Set-Content -Path "docs/audit/$null../../notes.md" -Value x' 'powershell guard: a variable expands past the exempt tree'
    # The one command string the two shell guards once answered differently, which is what made the
    # composite refusal luck rather than depth.
    probe "$hp" denied  cmd 'git diff --output=notes.md'                        'powershell guard: a read subcommand that writes'
    # A junction is a second name for the tracked tree — the shape guard-branch-bash.sh drops ln for.
    probe "$hp" denied  cmd 'New-Item -ItemType Junction -Path docs/audit/j -Value src' 'powershell guard: a link out of the exempt tree'
    # Both cmdlets fall back to the CURRENT directory when nothing binds -Destination, and write a
    # basename the command never spells.
    probe "$hp" denied  cmd 'Copy-Item docs/audit/note.md'                      'powershell guard: a copy with no destination'
    # Under the ignored tree deliberately: at the repository root the same name refuses for not
    # being ignored, so the probe would stay green with the credential list emptied.
    probe "$hp" denied  cmd 'Set-Content -Path docs/audit/server.key -Value y'  'powershell guard: a credential shape beats the exemption'
    # The second copy of the segment regex. The list above it is a different test, so a probe on a
    # name shape would leave this route's `certs/` arm the one nothing runs.
    probe "$hp" denied  cmd 'Set-Content -Path docs/audit/certs/ca.crt -Value y' 'powershell guard: under a certs directory'
    probe "$hp" allowed cmd 'Get-Content notes.md'                              'powershell guard: a read'
    # The guard's stated premise, which nothing else here holds: it enumerates reads and refuses
    # what it does not recognise. This carries no dollar, no semicolon and no path, so the program
    # list is the only thing that can be refusing it.
    probe "$hp" denied  cmd 'Get-Random'                                        'powershell guard: a program the list does not name'
    probe "$hp" allowed cmd 'Set-Content -Path docs/audit/x.md -Value y'        'powershell guard: the gitignored exemption'
    # Braces are banned as structure, and reach that ban only if the lexer stops stripping single
    # quotes — which is the whole of the .vscode half of the required capability.
    probe "$hp" allowed cmd "Set-Content -Path .vscode/settings.json -Value '{}'" 'powershell guard: quoted content is not structure'
    probe "$hp" allowed cmd 'Write-Output y > docs/audit/note.md'               'powershell guard: a redirect into the exempt tree'
    # Named rather than positional, so the POSITIONS table is what releases it: the positional
    # spelling reaches its verdict by the route the probe below already holds, and would restate it.
    probe "$hp" allowed cmd 'Copy-Item -Path docs/audit/a.md -Destination docs/audit/b.md' 'powershell guard: a named copy inside the exempt tree'
    # A switch missing from the guard's set reads as value-taking and swallows the destination, so
    # this refuses the day PowerShell's own set moves and nobody re-reads it off Get-Command.
    probe "$hp" allowed cmd 'Copy-Item -Force docs/audit/a.md docs/audit/b.md'  'powershell guard: the switch set is current'
    # The matcher names both shells, so this hook is handed Bash payloads it must never answer for.
    probe "$hp" allowed raw '{"tool_name":"Bash","tool_input":{"command":"rm -rf src"}}' 'powershell guard: another tool payload'

    # --- guard-standard-bash.sh: the sign-off gate on every branch -------------------------------
    probe "$hs" asked   cmd 'printf x > docs/_standard/x.md'                   'standard bash guard: a plain write'
    probe "$hs" asked   cmd 'cp /tmp/x docs/_standard/y.md >/dev/null'         'standard bash guard: null device'
    probe "$hs" asked   cmd 'rmdir docs/_standard/chapters'                    'standard bash guard: rmdir'
    probe "$hs" asked   cmd 'echo x > "docs/"_standard/x.md'                   'standard bash guard: quote-split path'
    probe "$hs" asked   cmd 'echo x >docs/_standard/x.md'                      'standard bash guard: spaceless redirect'
    # The same write-shape block, so the same respellings have to reach the question here.
    probe "$hs" asked   cmd 'printf x >&docs/_standard/rules-index.md'         'standard bash guard: >& redirect'
    probe "$hs" asked   cmd 'printf x ->docs/_standard/x.md'                   'standard bash guard: -> redirect'
    probe "$hs" asked   cmd 'sed -e s/a/b/ -i docs/_standard/rules-index.md'   'standard bash guard: sed -i behind another flag'
    probe "$hs" asked   cmd 'git checkout -- docs/_standard/x.md'              'standard bash guard: git checkout --'
    probe "$hs" asked   cmd 'rm docs/_standard/rules-index.md'                 'standard bash guard: a deletion'
    probe "$hs" asked   raw 'not json'                                         'standard bash guard: unparseable payload'
    probe "$hs" allowed cmd 'ls docs/_standard > /dev/null'                    'standard bash guard: nothing written'
    probe "$hs" allowed cmd 'cat docs/_standard/rules-index.md'                'standard bash guard: a read'
    probe "$hs" allowed cmd 'git switch topic'                                 'standard bash guard: leaving a branch'
    probe "$hs" allowed cmd 'printf x > docs/audit/note.md'                    'standard bash guard: a write elsewhere'

    # --- guard-standard-edit.sh: the same sign-off, on the tool route ----------------------------
    probe "$he" asked   file "${hook_root}/docs/_standard/x.md"      'standard edit guard: a plain inside path'
    probe "$he" asked   file "${hook_root}/docs/_standard/./x.md"    'standard edit guard: ./ segment'
    probe "$he" asked   file "docs/_standard/x.md"                   'standard edit guard: a relative path'
    probe "$he" asked   file "${hook_root}/docs/_standard"           'standard edit guard: the folder itself'
    probe "$he" asked   raw  '{"tool_input":{}}'                     'standard edit guard: payload without a path'
    probe "$he" asked   raw  'not json'                              'standard edit guard: unparseable payload'
    probe "$he" asked   raw  "$(printf '{"tool_input":{"notebook_path":"%s/docs/_standard/x.ipynb"}}' "$hook_root")" 'standard edit guard: a notebook path'
    probe "$he" allowed file "${hook_root}/docs/_standard/../elsewhere.md" 'standard edit guard: .. climbs out'
    probe "$he" allowed file "${hook_root}/docs/README.md"           'standard edit guard: elsewhere in the repo'
    probe "$he" allowed file "${hook_root}/../outside.md"            'standard edit guard: outside the repo'

    # --- guard-stale-type-class.sh: it reads the file, not the payload ---------------------------
    probe "$hk" blocked file "${hook_root}/fl_frontend/src/stale.ts"   'stale-class guard: an in-scope ts file'
    probe "$hk" blocked file "${hook_root}/fl_frontend/src/stale.tsx"  'stale-class guard: an in-scope tsx file'
    probe "$hk" blocked resp "${hook_root}/fl_frontend/src/stale.ts"   'stale-class guard: named by the tool response'
    probe "$hk" allowed file "${hook_root}/fl_frontend/src/clean.ts"   'stale-class guard: a clean in-scope file'
    probe "$hk" allowed file "${hook_root}/fl_frontend/src/app/globals.css" 'stale-class guard: the string in a stylesheet'
    # The out-of-scope file has to EXIST, or the hook stops at its own file test and the probe passes
    # without ever reaching the scope arm it is about.
    probe "$hk" allowed file "${hook_root}/scripts/outside.ts"         'stale-class guard: the string out of scope'
    probe "$hk" allowed file "${hook_root}/fl_frontend/src/gone.ts"    'stale-class guard: a file that is not there'

    # --- guard-local-compose.sh ------------------------------------------------------------------
    probe "$hc" denied  cmd 'docker compose up -d'                             'compose guard: bare docker compose'
    probe "$hc" allowed cmd 'docker compose -f docker-compose.local.yml up -d' 'compose guard: local file named'
    probe "$hc" allowed cmd 'docker ps'                                        'compose guard: not compose at all'

    # The Windows spellings, which are absolute paths only here: elsewhere a backslash is an ordinary
    # character and a `/c/…` name is a directory outside the tree, so these would prove nothing.
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        probe "$ht" denied  file "//?/${hook_root}/inside.py"                  'branch guard: //?/ device form'
        probe "$ht" denied  file "${hook_root}/SCRIPTS/VERIFY.SH"              'branch guard: case-varied tracked path'
        probe "$hb" allowed cmd  'sed -i s/a/b/ docs\audit\note.md'            'bash guard: backslashes, ignored'
        probe "$hb" allowed cmd  'sed -i s/a/b/ docs\audit/note.md'            'bash guard: mixed separators, ignored'
        probe "$hb" allowed cmd  "sed -i s/a/b/ ${hook_root//\//\\}\\docs\\audit\\note.md" 'bash guard: drive letter and backslashes, ignored'
        probe "$hb" allowed cmd  "sed -i s/a/b/ ${hook_msys}/docs/audit/note.md" 'bash guard: MSYS /c/ spelling, ignored'
        probe "$hb" denied  cmd  'cp docs/audit/note.md scripts\verify.sh'     'bash guard: backslashes, tracked'
        # The spellings that separate the class from a collapsed one and from a colonless one. A
        # forward-slash probe sees neither, and on Linux the branch rule refuses these tokens whatever the
        # class holds — so only a Windows run can.
        probe "$hb" denied  cmd  'touch docs\audit\certs\ca.crt'               'bash guard: a certs directory, backslashes'
        probe "$hb" denied  cmd  'touch C:certs\a.md'                          'bash guard: a certs directory, drive-relative'
        probe "$hp" denied  cmd  'Set-Content -Path C:certs\a.md -Value y'     'powershell guard: a certs directory, drive-relative'
        probe "$hb" denied  cmd  "cp docs/audit/note.md ${hook_root//\//\\}\\scripts\\verify.sh" 'bash guard: drive letter, tracked'
        probe "$hb" denied  cmd  "cp docs/audit/note.md ${hook_msys}/scripts/verify.sh" 'bash guard: MSYS /c/ spelling, tracked'
        probe "$hs" asked   cmd  "printf x > ${hook_msys}/docs/_standard/x.md" 'standard bash guard: MSYS /c/ spelling'
        probe "$he" asked   file "${hook_root}/DOCS/_STANDARD/x.md"            'standard edit guard: a case respelling'
        ;;
    esac
    par_run unit_probe

    # The same guards off main: a topic branch allows, and so does a detached HEAD — a rebase or a
    # bisect must not lose every write.
    ( cd "$HOOK_REPO" && git checkout -q topic )
    probe "$ht" allowed file "${hook_root}/inside.py"      'branch guard: topic branch'
    probe "$hb" allowed cmd  'printf x > notes.md'         'bash guard: a redirect off main'
    probe "$hs" asked   cmd  'printf x > docs/_standard/x.md' 'standard bash guard: still asks off main'
    par_run unit_probe

    ( cd "$HOOK_REPO" && git checkout -q --detach )
    probe "$ht" allowed file "${hook_root}/inside.py"      'branch guard: detached HEAD'
    par_run unit_probe
  fi

  # docs-rules-index.sh is the one informational hook, and both directions fail silently: one that
  # stops emitting never shows the standard to a session, one that stops staying quiet restates a
  # page of rules on every edit.

  # Probed from the repo root, because the index it serves is this repository's, under throwaway
  # session ids cleaned up below. Serial, because the dedupe marker is state two of them share.
  rules_hook="${REPO_ROOT}/.claude/hooks/docs-rules-index.sh"
  probe_rules() { # $1 payload on stdin — from the repository root
    printf '%s' "$1" | bash "$rules_hook" 2>/dev/null || true
  }
  expect_silent() { # $1 label · $2 hook output — the contract is silence
    if [[ -z "$2" ]]; then info "$1 — silent"; else note_fail "$1: expected silence, got '$2'"; fi
  }
  rules_md_payload()  { printf '{"session_id":"%s","tool_input":{"file_path":"%s","content":"x"}}' "$1" "$2"; }
  rules_src_payload() { printf '{"session_id":"%s","tool_input":{"file_path":"%s","new_string":"const a = 1;"}}' "$1" "$2"; }

  # The root as the hook sees it: the hook asks git, git prints the Windows spelling, and a payload
  # built from the MSYS spelling in REPO_ROOT resolves to a different drive inside node.
  rules_root="$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null)"
  # The session id, and the sweep below, belong to this run alone: the hook's dedupe marker lives in
  # the shared temp directory, and a wildcard would delete a concurrent run's marker between its
  # first probe and the one asserting silence.
  sid="sc-${RUN_ID}-${RANDOM}"
  out="$(probe_rules "$(rules_md_payload "$sid" "${rules_root}/docs/README.md")")"
  case "$out" in
    *hookSpecificOutput*) info "rules hook: first repo .md edit — emitted" ;;
    *) note_fail "rules hook: expected the index on a first repo .md edit, got '${out:-nothing}'" ;;
  esac
  expect_silent "rules hook: same session again"    "$(probe_rules "$(rules_md_payload "$sid" "${rules_root}/docs/README.md")")"
  expect_silent "rules hook: comment-free source"   "$(probe_rules "$(rules_src_payload "${sid}-b" "${rules_root}/fl_frontend/src/probe.ts")")"
  expect_silent "rules hook: path outside the repo" "$(probe_rules "$(rules_md_payload "${sid}-c" "${rules_root}/../outside.md")")"
  rm -f "$(node -e 'process.stdout.write(require("os").tmpdir())')"/claude-docs-rules-index-"${sid}"* 2>/dev/null || true
fi

step "14. Every deliberate non-run reaches the gate"
# The gate prints this script's output only when it fails, so a `skip` or a `warn` called directly
# announces its shortfall to nobody on a green run. This keeps a new call off that route:
# `note_skip` and `note_warn` write the ledger the gate replays.

# Any message shape, not a quoted one alone, so `skip bareword` is caught too. That reaches prose
# using the word, which the first exclusion drops; the second exempts the definitions themselves,
# by the names they open with.
stray="$(grep -nE '(^|[^_[:alnum:]])(skip|warn)[[:space:]]+[^[:space:]]' scripts/selfcheck.sh \
  | grep -vE '^[0-9]+:[[:space:]]*#' \
  | grep -vE '^[0-9]+:(note_skip|note_warn)\(\)' || true)"
if [[ -n "$stray" ]]; then
  note_fail "these lines announce a shortfall the gate cannot see — call note_skip or note_warn instead:"
  printf '%s\n' "$stray" | excerpt 5
else
  info "every deliberate non-run here is written to the ledger verify.sh replays"
fi

# The closing record, and the only thing that tells a run with nothing to report from one that
# stopped reporting: `verify.sh` requires it and stops the gate where it is absent.
if [[ -n "${FL_SELFCHECK_LEDGER:-}" ]]; then
  printf 'end\t%s\n' "$LEDGERED" >> "$FL_SELFCHECK_LEDGER"
fi

printf '\n'
if (( FAILURES == 0 )); then
  ok "All script self-checks passed."
else
  die "${FAILURES} script self-check(s) failed."
fi
