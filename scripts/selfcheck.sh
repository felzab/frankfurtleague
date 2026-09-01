#!/usr/bin/env bash
#
# SCRIPTS · test the scripts themselves.
#
# `bash -n` checks syntax alone: a script can call a helper that does not exist and pass it. What
# did not run reaches the gate as well as the screen, through `$FL_SELFCHECK_LEDGER`.
#
#   ./scripts/selfcheck.sh
#   ./scripts/selfcheck.sh --verbose     one check at a time, and every finding in full
#   ./scripts/selfcheck.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

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

RUNNABLE=(local.sh verify.sh publish.sh deploy.sh ci_scopes.sh selfcheck.sh)

# The `.githooks/` entries carry no suffix, so they are taken by directory: nothing else lints
# them, and a commit-msg hook that does not parse breaks committing where it was installed.
SHELL_FILES=()
for f in scripts/*.sh .claude/hooks/*.sh .githooks/*; do
  if [[ -f "$f" ]]; then SHELL_FILES+=("$f"); fi
done

# The roots keep the names `.gitignore` documents, and each run owns a subdirectory inside them:
# concurrent runs share a path, and one run's setup would delete another's tree from under it.
SCOPE_FIXTURES="${REPO_ROOT}/.tmp-scope-fixtures"
HOOK_FIXTURES="${REPO_ROOT}/.tmp-hook-fixtures"
RUN_ID="$$"

# One EXIT trap for the whole run: bash keeps one, so a second `trap … EXIT` below would silently
# replace it. INT and TERM stay `scripts/_lib.sh`'s, which exits 130 and so fires this.
SELFCHECK_TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$SELFCHECK_TMP" "${SCOPE_FIXTURES:?}/${RUN_ID}" "${HOOK_FIXTURES:?}/${RUN_ID}"
  # Only when this was the last run holding one — a concurrent run's subdirectory keeps it alive.
  rmdir "$SCOPE_FIXTURES" "$HOOK_FIXTURES" 2>/dev/null || true
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

# --- Running the independent checks concurrently -------------------------------------------------

# No unit reads what another writes, so the parent replays their files in the queued order and the
# output is the serial one byte for byte. An empty file is a unit that failed, not a quiet pass.

# One at a time under `--verbose`, which is also the oracle: a disagreement between the widths is
# the parallel machinery being wrong, and there has to be a way to see it.
PAR_WIDTH=16
if verbose; then PAR_WIDTH=1; fi

PAR_ITEMS=()
PAR_LABELS=()
PROBE_HOOK=()
PROBE_WANT=()
PROBE_KIND=()
PROBE_SUBJ=()

# The probe arrays are index-aligned with the queue, so they clear with it: a group inheriting the
# previous group's rows would probe one hook while reporting another's label.
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
  # Every worker takes every width'th item, not a contiguous block: the queue is grouped by subject,
  # and blocks would hand one worker every cheap unit and another every expensive one.
  for (( w = 0; w < width; w++ )); do
    # `set +e` inside: a unit's own failure must end that unit, not the rest of its share. The ERR
    # trap is not inherited into a subshell, so nothing outside sees it either.
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
    # An empty file is a worker that died before deciding — a failed spawn, not a verdict. Asked
    # again in the parent, because a real silence answers twice.
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
# annotated at the line instead, so a new unused-looking assignment justifies itself where written.

# New releases add checks, so a difference nobody names is the drift this pin exists to remove.
# Nothing bumps either line here: dependabot reads `uses:` references, not shell strings. A version
# bumped by hand replaces the digest below.
SHELLCHECK_VERSION="0.11.0"

# GitHub's own digest for that release's `linux.x86_64.tar.xz`: CI unpacks it as root onto PATH, so
# an asset replaced under a tag that never moved is caught rather than trusted.
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
    "koalaman/shellcheck:v${SHELLCHECK_VERSION}" -e SC1091 "$@"
}

run_actionlint() {
  if command -v actionlint >/dev/null 2>&1; then
    actionlint
    return
  fi
  # 1.7.8 is the floor: earlier versions reject `using: node24`, which GitHub documents and
  # supports. Nothing bumps this either, for the reason the shellcheck pin above records.
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(mount_source):/repo" -w /repo rhysd/actionlint:1.7.12
}

# Each reads files this run never writes and is the slowest thing in its step, so each starts here
# and is collected later: the wait then overlaps every cheap check instead of following them.
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
# Out of an array rather than a `grep` per name, which would be a process per script-and-helper
# pair — most of this check's cost.
declare -A DEFINED=()
while IFS= read -r fn; do DEFINED["$fn"]=1; done \
  < <(grep -oE '^[a-z_]+\(\)' scripts/_lib.sh | tr -d '()')
for f in "${RUNNABLE[@]}"; do
  [[ -f "scripts/$f" ]] || continue
  # Anything that looks like one of our helpers: our naming is consistent enough to enumerate.
  called="$(grep -oE '\b(require_[a-z_]+|wait_healthy|redact_uri_credentials|image_[a-z_]+|git_[a-z_]+|any_python|venv_python|end_section|section|finish|refuse|add_findings|spinner_start|spinner_stop|fmt_duration|fmt_ms|excerpt|verbose|step_took_ms|step|ok|info|skip|warn|fail|die|detail|quietly|usage|on_error|on_interrupt|emit_section_ledger|adopt_section|adopt_ending|end_worker|worker)\b' "scripts/$f" | sort -u || true)"
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
for f in local.sh publish.sh deploy.sh; do
  if grep -q "require_platform" "scripts/$f"; then info "$f"; else note_fail "$f has no require_platform guard"; fi
done

step "8. Documented flags match accepted flags"
# Compared by READING both, never by running the script: invoking each flag for real tears down
# the local stack as a side effect of a documentation test.
unit_flags() { # $1 index · $2 script name · $3 label
  local doc code
  # Header only, stopping at the first line of code: a fixed line range would reach the case
  # statement and compare the code against itself.
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
# Sourcing one fragment instead fails OPEN: with it missing the guard exits 0 and prints nothing,
# and a PreToolUse hook printing no verdict has denied nothing. Duplication fails loud, here.

# Bounded by the sentinels the hooks carry, not by a line count that rots on the first edit.
# `opener` and `ender`, because gawk refuses `close` as a variable name.
sentinel_block() { # $1 sentinel name · $2 hook path
  awk -v opener="# >>> $1" -v ender="# <<< $1 END" '
    index($0, opener) == 1 { inside = 1 }
    inside { print }
    inside && index($0, ender) == 1 { exit }
  ' "$2"
}

# The closing sentinel is asserted on each copy before they are compared: two empty extractions
# compare equal, so a reworded marker would report as agreement.
compare_sentinel_block() { # $1 sentinel name · $2 hook path · $3 hook path
  local name="$1" one two
  # Asked before the extraction: awk on an absent file returns the same nothing as a reworded
  # marker, and the two want different fixes.
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

step "12. The gate's comment-only classifier"
# A wrong answer is silent: classify a real code change as comments and the image build never runs
# before the push. The fixtures pin each direction for every language the classifier parses.

# They sit under the repo root and are passed as relative paths: MSYS rewrites an absolute POSIX
# path such as mktemp's into a Windows one the interpreter cannot open (`scripts/README.md`).
CLASSIFIER="$(any_python || true)"
CLASSIFIER_FLOOR=0
if [[ -n "$CLASSIFIER" ]]; then
  # `any_python` answers whether an interpreter exists; the question is whether it can host the
  # checkers. Asked of the kernel, so one file owns the floor.
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
# 3 is `checker_kernel.py :: EXIT_CRASH`, raised by its import-time floor guard. A stale literal
# here stops matching, and a broken classifier is then reported where an old python is the story.
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
  # JSX, because the script kind follows the extension and this misparses as plain TypeScript: the
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

  # The TypeScript half is the only one needing a toolchain, and this scope stays runnable on a
  # clone that has never run pnpm install.

  # A probe that cannot answer is either a missing typescript or a broken normalizer, so locally
  # the safe degradation is asserted instead. CI installs the frontend, so there silence fails.
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
# nothing, and neither does an exemption that swallows too much.

# A throwaway repository whose branch, .gitignore and index each case controls, fed a JSON payload
# on stdin the way the runner does. Under the repo root for the classifier fixtures' MSYS reason.
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

  # A .gitignore, a tracked tree and a file force-added inside the ignored tree, because the
  # exemption asks git both questions and a bare repository answers neither meaningfully.
  build_hook_fixture() {
    (
      set -e
      mkdir -p "$HOOK_REPO"
      cd "$HOOK_REPO"
      git init -q -b main
      git config core.autocrlf false
      mkdir -p docs/audit scripts src \
        fl_frontend/src/app fl_frontend/src/features .vscode
      # certs/ is here because the real repository ignores it: without that line the credential
      # override never decides a certs path here, and the probes on it cannot fail.
      printf 'docs/audit/\n.vscode/\ncerts/\n' > .gitignore
      for tracked in notes.md scripts/verify.sh scripts/check_docs.py src/tracked.py \
        fl_frontend/package.json fl_frontend/src/app.ts fl_frontend/src/clean.ts \
        fl_frontend/src/features/keep.ts docs/standard.md \
        docs/audit/tracked-note.md docs/audit/note.md \
        docs/audit/r.md docs/audit/a.md docs/audit/change.patch docs/audit/helper.sh \
        docs/audit/msg.txt; do
        printf 'x\n' > "$tracked"
      done
      # The stale-class hook needs the string on disk, in scope and out, because it reads the file
      # the payload names rather than the payload.
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

  # Sets _JSON rather than printing, so building a payload spawns nothing: one per probe, and a
  # subshell each would be visible at this count.
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
    # The root AS THE HOOK SEES IT: it asks git from its working directory, so a probe must build
    # its payload from the same answer rather than from a path this script composed.
    hook_root="$(cd "$HOOK_REPO" && git rev-parse --show-toplevel)"
    # The MSYS drive spelling of the same root — one of the classes the guard must place.
    hook_msys="/$(printf '%s' "$hook_root" | sed -E 's#^([A-Za-z]):#\L\1#')"

    hb=guard-branch-bash.sh;   hs=guard-standard-bash.sh;   ht=guard-branch.sh
    he=guard-standard-edit.sh; hc=guard-local-compose.sh;   hk=guard-stale-type-class.sh
    hp=guard-branch-powershell.sh

    # --- guard-branch.sh on main: the tool route -------------------------------------------------

    # A write inside the repository is refused however the path is spelt, and every cheap textual
    # containment test lets one spelling through.
    probe "$ht" denied  file "${hook_root}/inside.py"                'branch guard: plain inside path'
    probe "$ht" denied  file "${hook_root}/./inside.py"              'branch guard: ./ segment'
    probe "$ht" denied  file "${hook_root}/sub/../inside.py"         'branch guard: .. re-entry'
    probe "$ht" denied  file "${hook_root}//inside.py"               'branch guard: doubled separator'
    probe "$ht" denied  raw  '{"tool_input":{}}'                     'branch guard: payload without a path'
    probe "$ht" denied  raw  'not json'                              'branch guard: unparseable payload'
    probe "$ht" allowed file "${hook_root}/../outside.py"            'branch guard: path outside the repo'
    # A file that does not exist yet is neither tracked nor ignored — the answer a textual test
    # reads as "moved nothing".
    probe "$ht" denied  file "${hook_root}/fl_frontend/src/leaked.ts"          'branch guard: a file that does not exist yet'
    probe "$ht" denied  file "${hook_root}/fl_frontend/src/app/new-page.tsx"   'branch guard: a new route file'
    probe "$ht" denied  file "${hook_root}/fl_frontend/src/features/new/x.ts"  'branch guard: inside a new feature dir'
    probe "$ht" denied  file "${hook_root}/scripts/verify.sh"                  'branch guard: a tracked script'
    probe "$ht" denied  file "${hook_root}/Makefile"                           'branch guard: bare extensionless root file'

    # The gitignore exemption, still on main: ignored AND untracked is "writes no tracked file",
    # which is what lets the audit commands write their reports with no branch step.
    probe "$ht" allowed file "${hook_root}/docs/audit/report.md"      'branch guard: gitignored, untracked'
    probe "$ht" allowed file "${hook_root}/docs/audit/2026/report.md" 'branch guard: gitignored subdir'
    probe "$ht" allowed file "${hook_root}/docs/audit/x/y/z/deep.md"  'branch guard: deep gitignored path'
    probe "$ht" denied  file "${hook_root}/src/tracked.py"            'branch guard: tracked file'
    # The case a reader expects to be exempt and is not: `git check-ignore` reports a tracked path
    # as not ignored, so it refuses on the first half already.
    probe "$ht" denied  file "${hook_root}/docs/audit/tracked-note.md" 'branch guard: ignored but tracked'

    # The credential override, checked before the exemption and beating it. Nothing is written, the
    # hook deciding from the payload. A case naming a DIRECTORY is one a basename test would miss.
    for cred in .env .env.local server.pem server.key bundle.p12 id_rsa credentials.json \
      gcp-service-account.json kubeconfig .env.d/note.md certs/ca.crt; do
      probe "$ht" denied file "${hook_root}/docs/audit/${cred}" "branch guard: ${cred} under a gitignored dir"
    done
    # Why it is a segment test and not a substring one.
    probe "$ht" allowed file "${hook_root}/docs/audit/my-certs/notes.md" 'branch guard: a name ending in certs is not a certs directory'

    # --- guard-branch-bash.sh on main: the shell route -------------------------------------------

    # Exempt: one simple command, a program writing only where its arguments say, every path-like
    # token outside the tree or gitignored and untracked. `git checkout -b` matches no write shape.
    probe "$hb" allowed cmd 'git log --oneline -5'                             'bash guard: a read'
    # A payload nobody could read is a question nobody answered. Every guard answers it alike.
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
    # `-o` names a destination with no `>` and no `--output ` in sight, so the shape scan missed
    # every one of these; it is read only behind a program that writes with it, which leaves the
    # far commoner `grep -o` a read.
    probe "$hb" denied  cmd 'docker compose config -o rendered.yml'            'bash guard: a compose rendering saved with -o'
    probe "$hb" denied  cmd 'docker compose config --lock-image-digests'       'bash guard: a compose override file'
    probe "$hb" denied  cmd 'sort -o notes.md notes.md'                        'bash guard: sort writing through -o'
    probe "$hb" denied  cmd 'curl -o notes.md https://example.invalid/x'       'bash guard: curl writing through -o'
    probe "$hb" allowed cmd 'grep -o docker notes.md'                          'bash guard: -o as a match selector'
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

    # Data, not substitutions: the hook has to see the characters a session would type.

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

    # Each satisfies every stated condition and still writes into the tracked tree, through a path
    # git cannot place.
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

    # A program has to be shown argument-transparent before its arguments may speak for it.
    probe "$hb" denied cmd 'git apply docs/audit/change.patch'                 'bash guard: arbitrary tracked edits'
    probe "$hb" denied cmd 'git commit -F docs/audit/msg.txt'                  'bash guard: a commit on main'
    probe "$hb" denied cmd 'git commit -am "Audit: record docs/audit/state.md"' 'bash guard: a commit on main, inline message'
    probe "$hb" denied cmd 'git merge -m docs/audit/note.md topic'             'bash guard: a local merge on main'
    probe "$hb" denied cmd 'bash docs/audit/helper.sh > docs/audit/log.txt'    'bash guard: an interpreter'
    probe "$hb" denied cmd 'pnpm format > docs/audit/format.log'              'bash guard: a formatter'
    probe "$hb" denied cmd "$(printf 'printf x > docs/audit/log.txt\ngit commit -am wip')" 'bash guard: newline then commit'
    probe "$hb" denied cmd "$(printf 'printf x > docs/audit/log.txt\npnpm format')"        'bash guard: newline then format'

    # Every git occurrence is stepped, not the first alone: a leading git read must not shadow the
    # write chained behind it, and a newline or carriage return fronts a git as surely as a space.
    probe "$hb" denied cmd 'git status && git reset --hard'                    'bash guard: a reset behind a leading git read'
    probe "$hb" denied cmd 'git add -A && git commit -m x'                     'bash guard: an add in front of a commit'
    probe "$hb" denied cmd 'git fetch && git rebase main'                      'bash guard: a fetch in front of a rebase'
    probe "$hb" denied cmd "$(printf 'cd fl_backend\ngit commit -am wip')"     'bash guard: a git write on a second line'
    probe "$hb" denied cmd "$(printf 'echo start\rgit reset --hard')"          'bash guard: a carriage return fronting a git write'
    probe "$hb" denied cmd "$(printf 'ls\ngit stash\necho done')"              'bash guard: a subcommand ended by a newline'

    # --- An interpreter's own write API, one probe per pattern -----------------------------------

    # Each line matches one pattern and no other: delete that pattern and this probe alone goes
    # green on a tracked file.
    probe "$hb" denied cmd 'python -c open("fl_frontend/src/app.ts","w")'        'bash guard: open() in program source'
    probe "$hb" denied cmd 'node -e fs.openSync("fl_frontend/src/app.ts","w")'   'bash guard: openSync'
    probe "$hb" denied cmd 'node -e s.write("fl_frontend/src/app.ts")'           'bash guard: a write method'
    probe "$hb" denied cmd 'python -c write_text("fl_frontend/src/app.ts")'      'bash guard: write_text, undotted'
    probe "$hb" denied cmd 'python -c write_bytes("fl_frontend/src/app.ts")'     'bash guard: write_bytes, undotted'
    probe "$hb" denied cmd 'node -e writeFile("fl_frontend/src/app.ts","x")'     'bash guard: writeFile, destructured'
    probe "$hb" denied cmd 'node -e appendFile("fl_frontend/src/app.ts","x")'    'bash guard: appendFile'
    probe "$hb" denied cmd 'node -e createWriteStream("fl_frontend/src/app.ts")' 'bash guard: createWriteStream'
    probe "$hb" denied cmd 'python -c os.rename("t","fl_frontend/src/app.ts")'   'bash guard: a rename'
    probe "$hb" denied cmd 'python -c os.replace("t","fl_frontend/src/app.ts")'  'bash guard: an atomic replace'
    probe "$hb" denied cmd 'python -c os.remove("fl_frontend/src/app.ts")'       'bash guard: a remove'
    probe "$hb" denied cmd 'python -c os.unlink("fl_frontend/src/app.ts")'       'bash guard: an unlink'
    probe "$hb" denied cmd 'python -c os.truncate("fl_frontend/src/app.ts",0)'   'bash guard: a truncate'
    probe "$hb" denied cmd 'python -c os.chmod("fl_frontend/src/app.ts",384)'    'bash guard: a chmod'
    probe "$hb" denied cmd 'python -c Path("fl_frontend/src/app.ts").touch()'    'bash guard: a pathlib touch'
    probe "$hb" denied cmd 'python -c os.mkdir("fl_frontend/src/new")'           'bash guard: a mkdir in source'
    probe "$hb" denied cmd 'python -c os.makedirs("fl_frontend/src/new")'        'bash guard: a makedirs'
    probe "$hb" denied cmd 'python -c os.rmdir("fl_frontend/src/new")'           'bash guard: an rmdir in source'
    probe "$hb" denied cmd 'python -c os.symlink("t","fl_frontend/src/app.ts")'  'bash guard: a symlink'
    probe "$hb" denied cmd 'python -c os.link("t","fl_frontend/src/app.ts")'     'bash guard: a hard link'
    probe "$hb" denied cmd 'python -c Path("fl_frontend/src/a.ts").hardlink_to("t")' 'bash guard: hardlink_to'
    probe "$hb" denied cmd 'python -c shutil.copytree("t","fl_frontend/src/d")'  'bash guard: a shutil operation'
    probe "$hb" denied cmd 'node -e copyFileSync("t","fl_frontend/src/app.ts")'  'bash guard: copyFile'
    probe "$hb" denied cmd 'node -e rmSync("fl_frontend/src/app.ts")'            'bash guard: rmSync'
    probe "$hb" denied cmd 'node -e cpSync("t","fl_frontend/src/app.ts")'        'bash guard: cpSync'
    probe "$hb" denied cmd 'python -c zipfile.ZipFile("fl_frontend/src/a.zip","w")' 'bash guard: an archive opened to write'

    # The cost of reading `open(` without its mode, pinned so it stays a decision: a python READ
    # refuses here too, one `git checkout -b` from resolved.
    probe "$hb" denied cmd 'python -c print(open("notes.md").read())'            'bash guard: a read spelled like a write'

    # A redirect into the null device must not release the command carrying it.
    probe "$hb" denied  cmd 'echo hack > fl_frontend/src/app.ts 2>/dev/null'   'bash guard: stderr to the null device'
    probe "$hb" denied  cmd 'mv fl_frontend/src/app.ts fl_frontend/b.ts >/dev/null' 'bash guard: stdout to the null device'
    probe "$hb" allowed cmd 'ls docs/standard.md > /dev/null'                  'bash guard: null device, nothing written'
    probe "$hb" denied  cmd 'printf x >fl_frontend/package.json'               'bash guard: spaceless redirect'
    probe "$hb" denied  cmd 'git checkout -- fl_frontend/package.json'         'bash guard: git checkout --'
    probe "$hb" denied  cmd 'git switch --discard-changes topic'               'bash guard: git switch, discarding'

    # --- One write, spelled many ways ------------------------------------------------------------

    # The write-shape test is a substring scan of a normalised command, so it falls one respelling
    # at a time; a family is as close to the mechanism as a payload suite reaches.

    # No case outside the platform block at the end of this table may carry a literal backslash: the
    # token classifier answers differently under POSIX path grammar, so CI would disagree.
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
    # Each commits, merges or patches on main while naming a git subcommand a raw-string scan
    # does not see.
    probe "$hb" denied  cmd 'git -c user.name=x commit -am wip'                'bash guard: a commit on main behind -c'
    probe "$hb" denied  cmd 'git -C . commit -am wip'                          'bash guard: a commit on main behind -C'
    probe "$hb" denied  cmd 'git  commit -am wip'                              'bash guard: a commit on main, doubled space'
    probe "$hb" denied  cmd 'git  apply docs/audit/change.patch'               'bash guard: git apply, doubled space'
    probe "$hb" denied  cmd 'git -C . merge topic'                             'bash guard: a merge behind -C'
    probe "$hb" denied  cmd 'git  restore fl_frontend/package.json'            'bash guard: git restore, doubled space'
    # The allowlist boundary has to survive a respelt redirect, or only the expected spelling
    # ever reaches it.
    probe "$hb" denied  cmd 'pnpm format >&docs/audit/format.log'              'bash guard: a formatter behind a >& redirect'
    probe "$hb" denied  cmd 'bash docs/audit/helper.sh ->docs/audit/log.txt'   'bash guard: an interpreter behind a -> redirect'
    # The flag skip must not read a dashed destination as a flag once `--` has named it.
    probe "$hb" denied  cmd 'printf x > -weird docs/audit/note.md'             'bash guard: a redirect target starting with a dash'
    probe "$hb" denied  cmd 'touch -- -newfile.ts docs/audit/note.md'          'bash guard: a dash-leading path after --'
    # A guard a session cannot escape is the one failure this hook may never have.
    probe "$hb" allowed cmd 'git  checkout -b my-topic-branch'                 'bash guard: the escape hatch, doubled space'
    probe "$hb" allowed cmd 'git  log --oneline -5'                            'bash guard: a read, doubled space'
    probe "$hb" allowed cmd 'printf x > docs/audit/note.md 2>&1'               'bash guard: a real descriptor dup still allowed'

    # What the refusals above must not have taken with them.
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
    # The fixture force-adds a file under docs/audit, so the DIRECTORY matches something tracked.
    probe "$hb" denied  cmd 'grep -rn foo docs/audit > docs/audit/hits.txt'    'bash guard: an ignored dir holding a tracked file'
    # git quotes a non-ASCII path back, and a quoted answer matches nothing the shell asked for.
    probe "$hb" allowed cmd 'printf x > docs/audit/übersicht.md'               'bash guard: a non-ASCII name in the ignored tree'
    # An accepted cost, not a defect: honouring it needs real shell tokenisation.
    probe "$hb" denied  cmd 'cp docs/audit/a.md "docs/audit/b c.md"'           'bash guard: a quoted name holding a space'

    # --- Word boundaries the shell honours where a space is absent -------------------------------

    # A separator binds a verb to whatever stands beside it, so each line here carries a write shape
    # no pattern spelled with spaces reaches. None of them carries a redirect, which would raise the
    # write flag on its own account and hide what is being tested.
    probe "$hb" denied cmd 'echo x;rm -rf fl_frontend/src'      'bash guard: a semicolon in front of rm'
    probe "$hb" denied cmd 'echo x&&rm -rf fl_frontend/src'     'bash guard: && in front of rm'
    probe "$hb" denied cmd 'echo x||mv notes.md b.md'           'bash guard: || in front of mv'
    probe "$hb" denied cmd 'echo x;sed -i s/a/b/ scripts/verify.sh' 'bash guard: a semicolon in front of sed -i'
    probe "$hb" denied cmd 'echo x;git commit -am wip'          'bash guard: a semicolon in front of git'
    probe "$hb" denied cmd 'git status&&git reset --hard'       'bash guard: && in front of a git write'
    probe "$hb" denied cmd '(git commit -am wip)'               'bash guard: a git write inside a subshell'
    probe "$hb" denied cmd 'ls docs/audit | xargs rm'           'bash guard: a verb ending the command'
    # A quote is stripped by the token stage, so the scan has to strip one too — otherwise the verb
    # that stage would judge never reaches the flag that sends it there.
    probe "$hb" denied cmd '"sed" -i s/a/b/ scripts/verify.sh'  'bash guard: a quoted program name'
    probe "$hb" denied cmd "'rm' -rf fl_frontend/src"           'bash guard: a quoted rm'

    # The token stage alone answers these: the shape scan fires on the redirect, and the ignored
    # target is the only placed path, so the chained command rides out on that one's exemption.
    probe "$hb" denied cmd 'printf x > docs/audit/log.txt & git commit -am wip' 'bash guard: a commit backgrounded behind an ignored write'
    probe "$hb" denied cmd 'printf x > docs/audit/log.txt & pnpm format'        'bash guard: a formatter backgrounded behind an ignored write'
    # The shell expands this and the guard cannot, so the path judged and the path written differ —
    # the hazard guard-branch-powershell.sh refuses a variable for.
    # shellcheck disable=SC2016
    probe "$hb" denied cmd 'printf x > docs/audit/${AUDIT}note.md'              'bash guard: a brace expansion inside an ignored path'
    # shellcheck disable=SC2016
    probe "$hb" denied cmd 'printf x > docs/audit/$AUDIT/note.md'               'bash guard: a bare variable inside an ignored path'

    # --- In-place editing, one spelling at a time ------------------------------------------------

    # The flag is read by shape, so each line here is a spelling the one above it does not reach.
    probe "$hb" denied  cmd 'perl -i -pe s/a/b/ scripts/verify.sh'             'bash guard: perl -i'
    probe "$hb" denied  cmd 'perl -pi -e s/a/b/ scripts/verify.sh'             'bash guard: perl -i bundled behind -p'
    probe "$hb" denied  cmd 'perl -i.bak -pe s/a/b/ scripts/verify.sh'         'bash guard: perl -i carrying a suffix'
    probe "$hb" denied  cmd 'perl -nli.orig -e print scripts/verify.sh'        'bash guard: perl -i bundled and suffixed'
    probe "$hb" denied  cmd 'perl -e s/a/b/ -i scripts/verify.sh'              'bash guard: perl with -i behind another flag'
    probe "$hb" denied  cmd 'ruby -i -pe s/a/b/ scripts/verify.sh'             'bash guard: ruby -i'
    probe "$hb" denied  cmd 'ruby -pi.bak -e s/a/b/ scripts/verify.sh'         'bash guard: ruby -i bundled and suffixed'
    probe "$hb" denied  cmd 'sed --in-place s/a/b/ scripts/verify.sh'          'bash guard: the long in-place spelling'
    probe "$hb" denied  cmd 'sed -i.bak s/a/b/ scripts/verify.sh'              'bash guard: sed -i carrying a suffix'
    probe "$hb" denied  cmd 'gawk -i inplace {print} scripts/verify.sh'        'bash guard: gawk -i inplace'
    probe "$hb" denied  cmd 'awk -i inplace {print} scripts/verify.sh'         'bash guard: awk -i inplace'
    probe "$hb" denied  cmd 'gawk --include=inplace -f p.awk scripts/verify.sh' 'bash guard: gawk naming the extension'
    probe "$hb" denied  cmd 'yq -i .a=1 fl_frontend/package.json'              'bash guard: yq -i'
    probe "$hb" denied  cmd '/usr/bin/sed -i s/a/b/ scripts/verify.sh'         'bash guard: an in-place editor spelled with a path'
    probe "$hb" denied  cmd 'perl5.36 -i -pe s/a/b/ scripts/verify.sh'         'bash guard: an in-place editor spelled with a version'
    # perl is not argument-transparent, so the exempt class never reaches it: a refusal, not a hole.
    probe "$hb" denied  cmd 'perl -i -pe s/a/b/ docs/audit/note.md'            'bash guard: perl -i aimed at an ignored path'

    # `-i` belongs to programs that only read, so each refuses the day the program gate is dropped.
    probe "$hb" allowed cmd 'grep -i foo scripts/verify.sh'                    'bash guard: grep -i is not an in-place edit'
    probe "$hb" allowed cmd 'rg -i foo scripts/verify.sh'                      'bash guard: rg -i is not an in-place edit'
    probe "$hb" allowed cmd 'diff -i notes.md docs/audit/a.md'                 'bash guard: diff -i is not an in-place edit'
    probe "$hb" allowed cmd 'sed -n 5p scripts/verify.sh'                      'bash guard: sed with no in-place flag'
    probe "$hb" allowed cmd 'awk {print} scripts/verify.sh'                    'bash guard: awk with no in-place flag'
    # An uppercase cluster carries a module or an include path, never the flag.
    probe "$hb" allowed cmd 'perl -MList::Util -e print notes.md'              'bash guard: an uppercase cluster is not the flag'

    # Deliberate tightenings, each with a route left open.
    probe "$hb" denied  cmd 'touch Makefile docs/audit/note.md'                'bash guard: bare extensionless root file'
    probe "$hb" denied  cmd 'cp docs/audit/note.md Makefile'                   'bash guard: bare word as a copy target'
    probe "$hb" denied  cmd 'grep -rn foo fl_frontend/src > docs/audit/hits.txt' 'bash guard: reads tracked, writes ignored'
    probe "$hb" denied  cmd 'cp docs/audit/note.md .'                          'bash guard: the repository root itself'
    probe "$hb" denied  cmd "$(printf 'cat > /tmp/x.sh <<EOF\nhello\nEOF')"    'bash guard: multi-line scratch heredoc'
    probe "$hb" denied  cmd 'sort -o Makefile docs/audit/a.md'                 'bash guard: sort writing to a bare root file through -o'
    probe "$hb" denied  cmd 'sort -o Makefile docs/audit/a.md > docs/audit/x'  'bash guard: the same writer, redirect present too'
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

    # One probe per decision, not per spelling: a tightening breaks a permission silently while
    # every refusal stays green.
    probe "$hp" denied  cmd 'Set-Content -Path fl_frontend/src/app.ts -Value x' 'powershell guard: a tracked write on main'
    # Names a path the exemption WOULD release, so this fails the day the verb joins a write list;
    # aimed at a tracked tree it would refuse for being tracked instead.
    probe "$hp" denied  cmd 'Remove-Item docs/audit/note.md'                    'powershell guard: a deletion has no exemption'
    # PowerShell expands a variable inside double quotes and this guard cannot, so the literal it
    # judges and the file written are different paths.
    # shellcheck disable=SC2016
    probe "$hp" denied  cmd 'Set-Content -Path "docs/audit/$null../../notes.md" -Value x' 'powershell guard: a variable expands past the exempt tree'
    # The one command string the two shell guards can answer differently.
    probe "$hp" denied  cmd 'git diff --output=notes.md'                        'powershell guard: a read subcommand that writes'
    # A junction is a second name for the tracked tree — the shape guard-branch-bash.sh drops ln for.
    probe "$hp" denied  cmd 'New-Item -ItemType Junction -Path docs/audit/j -Value src' 'powershell guard: a link out of the exempt tree'
    # Falls back to the CURRENT directory with nothing bound to -Destination, writing a basename
    # the command never spells.
    probe "$hp" denied  cmd 'Copy-Item docs/audit/note.md'                      'powershell guard: a copy with no destination'
    # Under the ignored tree deliberately: at the root the same name refuses for not being ignored,
    # so the probe would stay green with the credential list emptied.
    probe "$hp" denied  cmd 'Set-Content -Path docs/audit/server.key -Value y'  'powershell guard: a credential shape beats the exemption'
    # The second copy of the segment regex, which a probe on a name shape would leave unrun.
    probe "$hp" denied  cmd 'Set-Content -Path docs/audit/certs/ca.crt -Value y' 'powershell guard: under a certs directory'
    probe "$hp" allowed cmd 'Get-Content notes.md'                              'powershell guard: a read'
    # No dollar, no semicolon and no path, so the read list is the only thing that can refuse it.
    probe "$hp" denied  cmd 'Get-Random'                                        'powershell guard: a program the list does not name'
    probe "$hp" allowed cmd 'Set-Content -Path docs/audit/x.md -Value y'        'powershell guard: the gitignored exemption'
    # Braces reach the structure ban only if the lexer stops stripping single quotes.
    probe "$hp" allowed cmd "Set-Content -Path .vscode/settings.json -Value '{}'" 'powershell guard: quoted content is not structure'
    probe "$hp" allowed cmd 'Write-Output y > docs/audit/note.md'               'powershell guard: a redirect into the exempt tree'
    # Named rather than positional, so the POSITIONS table is what releases it; the positional
    # spelling reaches its verdict by the route the probe below holds.
    probe "$hp" allowed cmd 'Copy-Item -Path docs/audit/a.md -Destination docs/audit/b.md' 'powershell guard: a named copy inside the exempt tree'
    # A switch missing from the guard's set reads as value-taking and swallows the destination.
    probe "$hp" allowed cmd 'Copy-Item -Force docs/audit/a.md docs/audit/b.md'  'powershell guard: the switch set is current'
    # The matcher names both shells, so this hook is handed Bash payloads it must never answer for.
    probe "$hp" allowed raw '{"tool_name":"Bash","tool_input":{"command":"rm -rf src"}}' 'powershell guard: another tool payload'

    # --- guard-standard-bash.sh: the sign-off gate on every branch -------------------------------
    probe "$hs" asked   cmd 'printf x > docs/standard.md'                      'standard bash guard: a plain write'
    probe "$hs" asked   cmd 'cp /tmp/x docs/standard.md >/dev/null'            'standard bash guard: null device'
    probe "$hs" asked   cmd 'rmdir docs/standard.md'                           'standard bash guard: rmdir'
    probe "$hs" asked   cmd 'echo x > "docs/"standard.md'                      'standard bash guard: quote-split path'
    probe "$hs" asked   cmd 'echo x >docs/standard.md'                         'standard bash guard: spaceless redirect'
    # The same write-shape block, so the same respellings have to reach the question here.
    probe "$hs" asked   cmd 'printf x >&docs/standard.md'                      'standard bash guard: >& redirect'
    probe "$hs" asked   cmd 'printf x ->docs/standard.md'                      'standard bash guard: -> redirect'
    probe "$hs" asked   cmd 'sed -e s/a/b/ -i docs/standard.md'                'standard bash guard: sed -i behind another flag'
    probe "$hs" asked   cmd 'echo x;sed -i s/a/b/ docs/standard.md'            'standard bash guard: a semicolon in front of sed -i'
    # The shared block moves in lockstep, so the `-o` shape has to reach this copy as well.
    probe "$hs" asked   cmd 'sort -o docs/standard.md docs/standard.md'        'standard bash guard: sort writing through -o'
    probe "$hs" asked   cmd 'git checkout -- docs/standard.md'                 'standard bash guard: git checkout --'
    probe "$hs" asked   cmd "$(printf 'echo start\ngit checkout -- docs/standard.md')" 'standard bash guard: a discard on a second line'
    probe "$hs" asked   cmd 'git status && git checkout -- docs/standard.md'   'standard bash guard: a discard behind a git read'
    probe "$hs" asked   cmd 'rm docs/standard.md'                              'standard bash guard: a deletion'
    probe "$hs" asked   raw 'not json'                                         'standard bash guard: unparseable payload'
    # Neither program is on the interpreter list beside it, so the in-place arm is what answers.
    probe "$hs" asked   cmd 'awk -i inplace {print} docs/standard.md'          'standard bash guard: awk -i inplace'
    probe "$hs" asked   cmd '/usr/bin/sed -i s/a/b/ docs/standard.md'          'standard bash guard: an editor spelled with a path'
    # The guard asks on path EQUALITY, so a name sharing the standard's prefix must pass untouched.
    probe "$hs" allowed cmd 'printf x > docs/standard-notes.md'                'standard bash guard: a sibling name is not the standard'
    probe "$hs" allowed cmd 'grep -i foo docs/standard.md'                     'standard bash guard: grep -i is not an in-place edit'
    probe "$hs" allowed cmd 'ls docs/standard.md > /dev/null'                  'standard bash guard: nothing written'
    probe "$hs" allowed cmd 'cat docs/standard.md'                             'standard bash guard: a read'
    probe "$hs" allowed cmd 'git switch topic'                                 'standard bash guard: leaving a branch'
    probe "$hs" allowed cmd 'printf x > docs/audit/note.md'                    'standard bash guard: a write elsewhere'

    # --- guard-standard-edit.sh: the same sign-off, on the tool route ----------------------------
    probe "$he" asked   file "${hook_root}/docs/standard.md"         'standard edit guard: a plain absolute path'
    probe "$he" asked   file "${hook_root}/docs/./standard.md"       'standard edit guard: ./ segment'
    probe "$he" asked   file "docs/standard.md"                      'standard edit guard: a relative path'
    probe "$he" asked   file "${hook_root}/docs/x/../standard.md"    'standard edit guard: .. re-entry'
    probe "$he" asked   raw  '{"tool_input":{}}'                     'standard edit guard: payload without a path'
    probe "$he" asked   raw  'not json'                              'standard edit guard: unparseable payload'
    probe "$he" asked   raw  "$(printf '{"tool_input":{"notebook_path":"%s/docs/standard.md"}}' "$hook_root")" 'standard edit guard: a notebook path'
    # Equality on the RESOLVED path: the raw spelling below contains the standard's whole name and
    # still lands elsewhere, so a textual prefix test would ask where this must not.
    probe "$he" allowed file "${hook_root}/docs/standard.md/../elsewhere.md" 'standard edit guard: .. climbs out'
    probe "$he" allowed file "${hook_root}/docs/standard-notes.md"   'standard edit guard: a sibling name is not the standard'
    probe "$he" allowed file "${hook_root}/docs/README.md"           'standard edit guard: elsewhere in the repo'
    probe "$he" allowed file "${hook_root}/../outside.md"            'standard edit guard: outside the repo'

    # --- guard-stale-type-class.sh: it reads the file, not the payload ---------------------------
    probe "$hk" blocked file "${hook_root}/fl_frontend/src/stale.ts"   'stale-class guard: an in-scope ts file'
    probe "$hk" blocked file "${hook_root}/fl_frontend/src/stale.tsx"  'stale-class guard: an in-scope tsx file'
    probe "$hk" blocked resp "${hook_root}/fl_frontend/src/stale.ts"   'stale-class guard: named by the tool response'
    probe "$hk" allowed file "${hook_root}/fl_frontend/src/clean.ts"   'stale-class guard: a clean in-scope file'
    probe "$hk" allowed file "${hook_root}/fl_frontend/src/app/globals.css" 'stale-class guard: the string in a stylesheet'
    # It has to EXIST, or the hook stops at its own file test and never reaches the scope arm.
    probe "$hk" allowed file "${hook_root}/scripts/outside.ts"         'stale-class guard: the string out of scope'
    probe "$hk" allowed file "${hook_root}/fl_frontend/src/gone.ts"    'stale-class guard: a file that is not there'

    # --- guard-local-compose.sh: an invocation is a word position, not a phrase ------------------
    probe "$hc" denied  cmd 'docker compose up -d'                             'compose guard: bare docker compose'
    probe "$hc" denied  cmd 'docker-compose up -d'                             'compose guard: the hyphenated spelling'
    probe "$hc" denied  cmd 'sudo docker compose up -d'                        'compose guard: behind sudo'
    probe "$hc" denied  cmd 'MSYS_NO_PATHCONV=1 docker compose up -d'          'compose guard: behind an env assignment'
    probe "$hc" denied  cmd 'docker compose --project-name x up'               'compose guard: a flag before the subcommand'
    probe "$hc" denied  cmd 'echo ok && docker compose up -d'                  'compose guard: an invocation after a separator'
    probe "$hc" denied  cmd 'docker compose down # docker-compose.local.yml'   'compose guard: the local file outside a -f value'
    probe "$hc" denied  cmd 'grep x docker-compose.local.yml && docker compose down' 'compose guard: a mention in one command releases no other'
    probe "$hc" allowed cmd 'docker compose -f docker-compose.local.yml up -d' 'compose guard: local file named'
    probe "$hc" allowed cmd 'docker compose --file=docker-compose.local.yml up' 'compose guard: the long flag spelling'
    probe "$hc" allowed cmd 'docker ps'                                        'compose guard: not compose at all'
    probe "$hc" allowed cmd 'grep -rn "docker compose" docs'                   'compose guard: a mention is not an invocation'
    # A heredoc body is data the shell never runs — which is a fact about `cat`, not about the
    # heredoc. `sh` runs what arrives, so the two halves are pinned apart.
    probe "$hc" allowed cmd "$(printf 'cat <<EOF\nDrive local Docker only through ./scripts/local.sh, never bare docker compose\nEOF')" 'compose guard: a heredoc into a program that runs neither an argument nor its input'
    probe "$hc" denied  cmd "$(printf 'sh <<EOF\ndocker compose config\nEOF')" 'compose guard: a heredoc into an interpreter'
    probe "$hc" denied  cmd "$(printf "bash <<'X'\ndocker compose up -d\nX")" 'compose guard: a quoted heredoc into an interpreter'

    # `config` resolves every env_file into the rendered environment block, so it PRINTS
    # ./fl_backend/.env, and -o saves it anywhere. It refuses whichever file is named: consent to a
    # local stack was never consent to disclosure.
    probe "$hc" denied  cmd 'docker compose config'                            'compose guard: config renders the production env_file'
    probe "$hc" denied  cmd 'docker compose -f docker-compose.yml config'      'compose guard: config, production file named'
    probe "$hc" denied  cmd 'docker compose -f docker-compose.local.yml config' 'compose guard: config on the local file discloses the same .env'
    probe "$hc" denied  cmd 'docker compose config -o rendered.yml'            'compose guard: config writes its rendering with -o'
    probe "$hc" denied  cmd 'docker compose config --lock-image-digests'       'compose guard: config writes an override file'
    probe "$hc" allowed cmd 'docker compose ps'                                'compose guard: a container listing'
    probe "$hc" allowed cmd 'docker compose logs -f backend'                   'compose guard: following logs'
    probe "$hc" allowed cmd 'docker compose --help'                            'compose guard: an invocation naming no subcommand'
    # Each reaches a container the read list cannot, and each is a spelling the line above misses.
    probe "$hc" denied  cmd 'docker compose exec db mongosh'                   'compose guard: a shell inside a production container'
    probe "$hc" denied  cmd 'docker compose run --rm backend sh'               'compose guard: a one-off command'
    probe "$hc" denied  cmd 'docker compose build'                             'compose guard: a build'
    # --down-project drops the project, so the name is the only read-only thing about it.
    probe "$hc" denied  cmd 'docker compose wait'                              'compose guard: wait is not a read'
    # The read list is closed, so a verb a later compose release adds refuses until someone reads
    # its flags — the direction that costs a question rather than the production database.
    probe "$hc" denied  cmd 'docker compose frobnicate'                        'compose guard: an unrecognised subcommand'
    # A global option and its value stand between the program and the subcommand, so each has to be
    # stepped over rather than read as one.
    probe "$hc" denied  cmd 'docker compose -p x up'                           'compose guard: a global option before the subcommand'
    probe "$hc" denied  cmd 'docker compose --env-file .env.local up'          'compose guard: a global option carrying a value'
    probe "$hc" denied  cmd 'env docker compose up -d'                         'compose guard: behind an env prefix'
    probe "$hc" denied  cmd '{ docker compose up -d; }'                        'compose guard: inside a brace group'
    probe "$hc" denied  cmd 'docker compose exec db sh -f docker-compose.local.yml' 'compose guard: the local file named behind the subcommand'
    # The local file is the developer's own stack, whatever is run against it.
    probe "$hc" allowed cmd 'docker compose -f docker-compose.local.yml down -v' 'compose guard: a teardown of the local stack'
    # A separator inside quotes separates nothing, so nothing behind it is a command position.
    probe "$hc" allowed cmd 'grep -rn "docker compose\|docker-compose" docs'   'compose guard: an alternation inside a quoted pattern'

    # The shell reads a quote and an unquoted backslash as punctuation, so the program word has to
    # be judged with both taken off — testing the payload as typed reads docker as something else.
    probe "$hc" denied  cmd 'doc"ker" compose up -d'                          'compose guard: a quote inside the program name'
    probe "$hc" denied  cmd 'd"o"cker compose up -d'                          'compose guard: a quote splitting the program name'
    probe "$hc" denied  cmd '\docker compose up -d'                           'compose guard: a leading backslash'
    probe "$hc" denied  cmd 'doc\ker compose up -d'                           'compose guard: a backslash inside the program name'
    # An unrecognised leading word means "cannot tell", never "not docker": an interpreter runs the
    # rest of the segment, and a path holding a space splits into a program word that is not one.
    probe "$hc" denied  cmd 'bash -c "docker compose up -d"'                  'compose guard: behind an interpreter'
    probe "$hc" denied  cmd "sh -c 'docker compose up -d'"                    'compose guard: behind sh -c'
    probe "$hc" denied  cmd 'eval "docker compose up -d"'                     'compose guard: behind eval'
    probe "$hc" denied  cmd 'xargs docker compose up -d'                      'compose guard: behind xargs'
    probe "$hc" denied  cmd 'echo up -d | xargs docker compose'               'compose guard: the subcommand arriving on stdin'
    probe "$hc" denied  cmd '/c/Program Files/Docker/docker compose up -d'    'compose guard: a program path holding a space'
    # Each of these hands a segment its input, so the invocation is in what arrives rather than
    # in this payload, and the receiving segment's own words prove nothing about it.
    probe "$hc" denied  cmd "echo 'docker compose config' | sh"               'compose guard: the command arriving down a pipe'
    probe "$hc" denied  cmd "printf 'docker compose up -d' |& bash"           'compose guard: a pipe carrying stderr with it'
    probe "$hc" denied  cmd "sh < <(printf 'docker compose config')"          'compose guard: a process substitution'
    probe "$hc" denied  cmd "sh <<<'docker compose config'"                   'compose guard: a here-string'
    probe "$hc" allowed cmd 'docker compose logs -f backend | grep error'     'compose guard: a read piped into a program that cannot run it'
    probe "$hc" allowed cmd 'docker compose ps || echo none'                  'compose guard: an or-list separates rather than feeds'
    # Dev is Windows, where a program word and its extension resolve case-insensitively: the
    # uppercase spellings run there, and a byte comparison released every shape below.
    probe "$hc" denied  cmd 'DOCKER compose config'                           'compose guard: the uppercase program spelling'
    probe "$hc" denied  cmd 'docker.EXE compose config'                       'compose guard: an uppercase executable extension'
    probe "$hc" denied  cmd 'Docker Compose up -d'                            'compose guard: a mixed-case spelling the hook cannot place'
    probe "$hc" allowed cmd 'docker.Exe compose ps'                           'compose guard: a case-folded read is still a read'
    # A substitution spells any program and any file name, so it is answered rather than parsed.
    # The literals are the point here — expanding one would probe a different command.
    # shellcheck disable=SC2016
    {
      probe "$hc" denied cmd '$(echo docker) compose up -d'                   'compose guard: a command substitution as the program'
      probe "$hc" denied cmd '`echo docker` compose up -d'                    'compose guard: the backtick substitution form'
      probe "$hc" denied cmd 'DOCKER=docker; $DOCKER compose up -d'           'compose guard: a variable as the program'
    }
    # A prefix keeps its own flags and operands, so the program is the next docker word rather than
    # the next word — and any of these left behind released the whole segment.
    probe "$hc" denied  cmd 'sudo -u root docker compose up -d'               'compose guard: sudo carrying a flag'
    probe "$hc" denied  cmd 'env -i docker compose up -d'                     'compose guard: env carrying a flag'
    probe "$hc" denied  cmd 'nice -n 5 docker compose up -d'                  'compose guard: nice carrying a flag'
    probe "$hc" denied  cmd 'timeout 5 docker compose up -d'                  'compose guard: timeout carrying a duration'
    probe "$hc" denied  cmd 'stdbuf -oL docker compose up -d'                 'compose guard: stdbuf carrying a flag'
    probe "$hc" denied  cmd 'nohup docker compose up -d'                      'compose guard: behind nohup'
    probe "$hc" denied  cmd 'command docker compose up -d'                    'compose guard: behind command'
    probe "$hc" denied  cmd 'time docker compose up -d'                       'compose guard: behind time'
    probe "$hc" denied  cmd 'setsid docker compose up -d'                     'compose guard: behind setsid'
    probe "$hc" denied  cmd 'exec docker compose up -d'                       'compose guard: behind exec'
    # Consent to the local stack is consent to that file ALONE: compose merges what a second -f
    # names, and a basename match would make any file so named consent wherever it was written.
    probe "$hc" denied  cmd 'docker compose -f docker-compose.local.yml -f docker-compose.yml up -d' 'compose guard: the production file merged in behind the local one'
    probe "$hc" denied  cmd 'docker compose -f /tmp/anywhere/docker-compose.local.yml up -d' 'compose guard: the local basename somewhere else'
    # A global option missing its value eats the verb, which is not an invocation naming none.
    probe "$hc" denied  cmd 'docker compose --ansi up -d'                     'compose guard: a global flag swallowing the subcommand'
    probe "$hc" denied  cmd 'docker compose --profile up -d'                  'compose guard: --profile swallowing the subcommand'
    # This guard stands in front of the production database, so a payload it could not read is a
    # question nobody answered. An empty command is a real answer: there is nothing to guard.
    probe "$hc" denied  raw  'not json'                                       'compose guard: an unparseable payload'
    probe "$hc" denied  raw  '{"tool_input":{}}'                              'compose guard: a payload naming no command'
    probe "$hc" allowed raw  '{"tool_input":{"command":""}}'                  'compose guard: an empty command'

    # Absolute paths only here: elsewhere a backslash is an ordinary character and a `/c/…` name is
    # a directory outside the tree.
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        probe "$ht" denied  file "//?/${hook_root}/inside.py"                  'branch guard: //?/ device form'
        probe "$ht" denied  file "${hook_root}/SCRIPTS/VERIFY.SH"              'branch guard: case-varied tracked path'
        probe "$hb" allowed cmd  'sed -i s/a/b/ docs\audit\note.md'            'bash guard: backslashes, ignored'
        probe "$hb" allowed cmd  'sed -i s/a/b/ docs\audit/note.md'            'bash guard: mixed separators, ignored'
        probe "$hb" allowed cmd  "sed -i s/a/b/ ${hook_root//\//\\}\\docs\\audit\\note.md" 'bash guard: drive letter and backslashes, ignored'
        probe "$hb" allowed cmd  "sed -i s/a/b/ ${hook_msys}/docs/audit/note.md" 'bash guard: MSYS /c/ spelling, ignored'
        probe "$hb" denied  cmd  'cp docs/audit/note.md scripts\verify.sh'     'bash guard: backslashes, tracked'
        # A forward-slash probe separates neither, and on Linux the branch rule refuses these tokens
        # whatever the class holds — so only a Windows run can.
        probe "$hb" denied  cmd  'touch docs\audit\certs\ca.crt'               'bash guard: a certs directory, backslashes'
        probe "$hb" denied  cmd  'touch C:certs\a.md'                          'bash guard: a certs directory, drive-relative'
        probe "$hp" denied  cmd  'Set-Content -Path C:certs\a.md -Value y'     'powershell guard: a certs directory, drive-relative'
        probe "$hb" denied  cmd  "cp docs/audit/note.md ${hook_root//\//\\}\\scripts\\verify.sh" 'bash guard: drive letter, tracked'
        probe "$hb" denied  cmd  "cp docs/audit/note.md ${hook_msys}/scripts/verify.sh" 'bash guard: MSYS /c/ spelling, tracked'
        probe "$hs" asked   cmd  "printf x > ${hook_msys}/docs/standard.md"    'standard bash guard: MSYS /c/ spelling'
        probe "$he" asked   file "${hook_root}/DOCS/STANDARD.MD"               'standard edit guard: a case respelling'
        ;;
    esac
    par_run unit_probe

    # git MISSING is not an answer: with no git the guard cannot know which branch it stands on,
    # so it refuses. Outside the probe table, which runs every hook in the runner's own
    # environment. bash by absolute path, the stripped PATH being what hides git.
    nogit="${HOOKFX}/nogit"
    mkdir -p "$nogit"
    blind="$( cd "$HOOK_REPO" && cmd_payload 'printf x > scripts/verify.sh' |
      PATH="$nogit" "$BASH" "${HOOKS_DIR}/${hb}" 2>/dev/null )" || true
    case "$blind" in
      *'"permissionDecision":"deny"'*) info 'bash guard: git absent from PATH — denied' ;;
      *) note_fail "bash guard: git absent from PATH: expected denied, got '${blind:-allowed}'" ;;
    esac

    # Off main: a detached HEAD allows too, a rebase or a bisect not losing every write.
    ( cd "$HOOK_REPO" && git checkout -q topic )
    probe "$ht" allowed file "${hook_root}/inside.py"      'branch guard: topic branch'
    probe "$hb" allowed cmd  'printf x > notes.md'         'bash guard: a redirect off main'
    probe "$hs" asked   cmd  'printf x > docs/standard.md' 'standard bash guard: still asks off main'
    par_run unit_probe

    ( cd "$HOOK_REPO" && git checkout -q --detach )
    probe "$ht" allowed file "${hook_root}/inside.py"      'branch guard: detached HEAD'
    par_run unit_probe
  fi

  # The one informational hook, failing silently either way: stop emitting and no session sees the
  # standard, stop staying quiet and it is restated on every edit. Serial, because the dedupe
  # marker is state the probes share.
  standard_hook="${REPO_ROOT}/.claude/hooks/docs-standard.sh"
  probe_standard() { # $1 payload on stdin — from the repository root
    printf '%s' "$1" | bash "$standard_hook" 2>/dev/null || true
  }
  expect_silent() { # $1 label · $2 hook output — the contract is silence
    if [[ -z "$2" ]]; then info "$1 — silent"; else note_fail "$1: expected silence, got '$2'"; fi
  }
  standard_md_payload()  { printf '{"session_id":"%s","tool_input":{"file_path":"%s","content":"x"}}' "$1" "$2"; }
  standard_src_payload() { printf '{"session_id":"%s","tool_input":{"file_path":"%s","new_string":"const a = 1;"}}' "$1" "$2"; }

  # The root as the hook sees it: a payload built from the MSYS spelling in REPO_ROOT resolves to
  # a different drive inside node.
  standard_root="$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null)"
  # The session id and the sweep below belong to this run alone: the dedupe marker lives in the
  # shared temp directory, and a wildcard would delete a concurrent run's mid-probe.
  sid="sc-${RUN_ID}-${RANDOM}"
  out="$(probe_standard "$(standard_md_payload "$sid" "${standard_root}/docs/README.md")")"
  case "$out" in
    *hookSpecificOutput*) info "standard hook: first repo .md edit — emitted" ;;
    *) note_fail "standard hook: expected the standard on a first repo .md edit, got '${out:-nothing}'" ;;
  esac
  expect_silent "standard hook: same session again"    "$(probe_standard "$(standard_md_payload "$sid" "${standard_root}/docs/README.md")")"
  expect_silent "standard hook: comment-free source"   "$(probe_standard "$(standard_src_payload "${sid}-b" "${standard_root}/fl_frontend/src/probe.ts")")"
  expect_silent "standard hook: path outside the repo" "$(probe_standard "$(standard_md_payload "${sid}-c" "${standard_root}/../outside.md")")"
  rm -f "$(node -e 'process.stdout.write(require("os").tmpdir())')"/claude-docs-standard-"${sid}"* 2>/dev/null || true
fi

step "14. Every deliberate non-run reaches the gate"
# Any message shape, not a quoted one alone, so `skip bareword` is caught too. The first exclusion
# drops prose using the word; the second exempts the definitions themselves.
stray="$(grep -nE '(^|[^_[:alnum:]])(skip|warn)[[:space:]]+[^[:space:]]' scripts/selfcheck.sh \
  | grep -vE '^[0-9]+:[[:space:]]*#' \
  | grep -vE '^[0-9]+:(note_skip|note_warn)\(\)' || true)"
if [[ -n "$stray" ]]; then
  note_fail "these lines announce a shortfall the gate cannot see — call note_skip or note_warn instead:"
  printf '%s\n' "$stray" | excerpt 5
else
  info "every deliberate non-run here is written to the ledger verify.sh replays"
fi

step "15. The container-log redaction"
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
