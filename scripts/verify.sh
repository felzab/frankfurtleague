#!/usr/bin/env bash
#
# SCRIPTS · the pre-merge gate — everything, or exactly the surfaces a change touched.
#
# Never writes, but `next build` rewrites the tracked `fl_frontend/tsconfig.json` when a
# `compilerOptions` key is absent; the frontend CI job diffs that path. Name no other tool's flag
# in this block: `scripts/selfcheck.sh` reads every double-dashed word here as one this takes.
#
#   ./scripts/verify.sh                   every scope — the full gate; the image builds take minutes
#   ./scripts/verify.sh --scripts --docs --backend --format --frontend --ops --db --images
#   ./scripts/verify.sh --quick           the scopes needing no Docker: not ops, not db, not images
#   ./scripts/verify.sh --verbose         stream each tool's own output instead of capturing it
#   ./scripts/verify.sh --serial          one scope at a time, in the order the output already reads
#   ./scripts/verify.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

RUN_SCRIPTS=0; RUN_DOCS=0; RUN_BACKEND=0; RUN_FORMAT=0; RUN_FRONTEND=0; RUN_OPS=0; RUN_DB=0; RUN_IMAGES=0
SERIAL=0
# shellcheck disable=SC2034  # VERBOSE is consumed by _lib.sh, which shellcheck cannot follow into
for arg in "$@"; do
  case "$arg" in
    --scripts)  RUN_SCRIPTS=1 ;;
    --docs)     RUN_DOCS=1 ;;
    --backend)  RUN_BACKEND=1 ;;
    --format)   RUN_FORMAT=1 ;;
    --frontend) RUN_FRONTEND=1 ;;
    --ops)      RUN_OPS=1 ;;
    --db)       RUN_DB=1 ;;
    --images)   RUN_IMAGES=1 ;;
    --quick)    RUN_SCRIPTS=1; RUN_DOCS=1; RUN_BACKEND=1; RUN_FRONTEND=1 ;;
    --verbose)  VERBOSE=1 ;;
    --serial)   SERIAL=1 ;;
    --help|-h)  usage ;;
    *)          die "Unknown option: ${arg}. Try --help." ;;
  esac
done

if (( ! (RUN_SCRIPTS || RUN_DOCS || RUN_BACKEND || RUN_FORMAT || RUN_FRONTEND || RUN_OPS || RUN_DB || RUN_IMAGES) )); then
  RUN_SCRIPTS=1; RUN_DOCS=1; RUN_BACKEND=1; RUN_FORMAT=1; RUN_FRONTEND=1; RUN_OPS=1; RUN_DB=1; RUN_IMAGES=1
fi

# The frontend scope reads exactly the files the formatter governs, so naming it names the
# formatter too, or `check_scope.py` calls format unproven on a run that proved it. Never in a
# worker, where it would run prettier twice.
if (( RUN_FRONTEND )) && ! worker; then RUN_FORMAT=1; fi

# Fail on a missing prerequisite now: otherwise a full run on a sleeping Docker discovers it at
# the db tier, minutes of green checks in.
if (( RUN_OPS || RUN_DB || RUN_IMAGES )); then
  require_docker
fi

# The scripts scope's checks run beside each other and are collected one step at a time. Declared
# up here because the EXIT trap below reaps them, and `set -u` refuses an array that does not exist.
BG_DIR=""
declare -A BG_PID=()

# One EXIT trap for every scope's cleanup: `die` exits directly, so an inline cleanup line after a
# failed check never runs. Never add INT or TERM — `_lib.sh` owns them, and re-trapping either
# loses the interrupted closing statement.
cleanup() { :; }
gate_exit() {
  # From the trap, not the end of the body: `die`, `refuse` and `on_error` exit where they stand,
  # so a body-final call misses exactly the rows whose verdict matters most.
  if worker; then end_section; emit_section_ledger > "${FL_GATE_LEDGER:?}"; fi
  cleanup
  if [[ -n "${POOL_DIR:-}" ]]; then rm -rf "$POOL_DIR"; fi
  # Only the job shells are signalled: a started tool tears its own fixtures down, and bash cannot
  # portably reach a grandchild. The `rm` is best-effort for the same reason -- Windows will not
  # unlink a file a surviving tool holds open.
  if (( ${#BG_PID[@]} )); then kill "${BG_PID[@]}" 2>/dev/null || true; fi
  if [[ -n "$BG_DIR" ]]; then rm -rf "$BG_DIR" 2>/dev/null || true; fi
  if [[ -n "${FL_SELFCHECK_LEDGER:-}" ]]; then rm -f "$FL_SELFCHECK_LEDGER"; fi
}
trap gate_exit EXIT

if (( RUN_OPS || RUN_IMAGES )); then
  STANDIN_BE=0; STANDIN_FE=0
  # The tag carries this run's pid, so the forced removal below reaches only what this run built.
  # Under a fixed tag a concurrent run would delete them, and `-f` asks no questions.
  VERIFY_TAG="frankfurtleague-verify-$$"
  cleanup() {
    rm -rf "${REPO_ROOT}/.tmp-nginx-check"
    if (( STANDIN_BE )); then rm -f fl_backend/.env; fi
    if (( STANDIN_FE )); then rm -f fl_frontend/.env; fi
    docker image rm -f "${VERIFY_TAG}:frontend" "${VERIFY_TAG}:backend" >/dev/null 2>&1 || true
  }
fi
PY=""
if (( RUN_SCRIPTS || RUN_DOCS || RUN_BACKEND || RUN_DB )); then
  # The failure is the caller's, for the reason `scripts/_lib.sh :: venv_python` records.
  PY="$(venv_python)" \
    || die "No fl_backend virtualenv found. Create it with:  cd fl_backend && uv sync --dev"
fi

# Settled before anything runs and read back by the closing table: an exit code alone cannot say
# which scopes a run never reached.
SCOPES_RAN=""; NOT_RUN=""; SCOPE_ORDER=()
add_scope() { if (( $2 )); then SCOPES_RAN+="$1 "; SCOPE_ORDER+=("$1"); else NOT_RUN+=" $1"; fi; }
add_scope scripts  "$RUN_SCRIPTS"
add_scope docs     "$RUN_DOCS"
add_scope backend  "$RUN_BACKEND"
add_scope format   "$RUN_FORMAT"
add_scope frontend "$RUN_FRONTEND"
add_scope ops      "$RUN_OPS"
add_scope db       "$RUN_DB"
add_scope images   "$RUN_IMAGES"

# A worker is given one scope, so its own answer would be every other scope in the gate.
if ! worker; then set_not_run "$NOT_RUN"; fi

# Absence means independent of every other scope, which is what lets the pool start it at once.
scope_shares() { # $1 scope · prints the scopes it must follow
  case "$1" in
    # Its stand-in .env files appear and vanish in both trees, which the backend's tests and
    # `next build` read while they run.
    ops) printf 'backend db frontend' ;;
  esac
  return 0
}

# Named only where this run covers them: the pool refuses a constraint naming a scope it was not
# given, so a typo above is an error rather than a guarantee quietly dropped.
UNITS=()
build_units() {
  local IFS=' ' name other after
  for name in "${SCOPE_ORDER[@]}"; do
    after=""
    for other in $(scope_shares "$name"); do
      case " ${SCOPES_RAN} " in *" ${other} "*) after+="${other}," ;; esac
    done
    UNITS+=("${name}${after:+:${after%,}}")
  done
}
build_units

wrap_up() {
  # In a worker the ending belongs to the parent, which alone knows what the run left unproven.
  if worker; then end_worker; fi
  end_section
  # Only "Safe to merge." is withheld — a partial run has not earned it; the ending names the rest.
  if [[ -n "$NOT_RUN" ]]; then finish; else finish "Safe to merge."; fi
}

# The checkers' exit contract is `scripts/checker_kernel.py :: run`.

# `stop` ends the run at the first finding, which is what cheapest-to-fail order buys. `collect`
# records it and returns 1, for cheap checks whose findings a reader wants together.
run_checker() {
  local mode="$1" label="$2" message="$3"; shift 3
  local rc=0
  quietly "$@" || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) if [[ "$mode" == "collect" ]]; then fail "$message"; return 1; fi
       die "$message" ;;
    # A refusal ends the run in `collect` too: collecting exists so that findings reach the reader
    # together, and a check that could not judge its input has none.
    2) refuse "${label} could not judge its input, so nothing here stands as a verdict on the
change. Its own reason is above." ;;
    130) on_interrupt ;;
    # `skip` is right for the scope check below and wrong here: a named scope whose checker never
    # ran has proved nothing.
    *) on_error "$rc" "${BASH_LINENO[0]}" "$label" ;;
  esac
}

# --- scope -------------------------------------------------------------------------------------------

# Before any scope runs: the same refusal after a `next build` has cost the minutes it exists to
# save. Parent only — the parent asks for the whole run, and a worker asking again would put
# another `scope` row in the table it replays into.
if ! worker; then
  section scope
  info "this run covers: ${SCOPES_RAN% }"

  # Skipped in CI, where the scopes are separate jobs and the mapping comes from paths rather than
  # being typed: one job would fail for a scope another job is running.
  if [[ -n "${CI:-}" ]]; then
    skip "scope check: CI maps scopes from paths itself, so there is no typed scope to check"
  else
    step "scope · does this run cover what the branch changed?"
    SCOPE_PY="$(any_python || true)"
    SCOPE_RC=0
    if [[ -z "$SCOPE_PY" ]]; then
      skip "no python found — this run was not checked against the diff"
    else
      # Not through `quietly`: the advisory findings are the useful half, and a green run prints them.
      "$SCOPE_PY" scripts/check_scope.py --ran "$SCOPES_RAN" || SCOPE_RC=$?
      case "$SCOPE_RC" in
        0) ok "the scopes named cover the change" ;;
        1) refuse "This run is not wide enough to merge on. The finding above names the file and the flag." ;;
        2) refuse "The scope check could not judge its input, so this run was not checked against the
diff. Its own reason is above." ;;
        130) on_interrupt ;;
        # Never a refusal: a checker that broke says nothing about the scope, and a refusal naming
        # nothing is worse than a skip.
        *) skip "the scope check itself failed (exit ${SCOPE_RC}), so this run was not checked against the diff" ;;
      esac
    fi
  fi
fi

# --- the scopes, concurrently ------------------------------------------------------------------------

# Each scope runs in its own process, replayed in written order so a parallel run reads as the
# serial one it must match. Serial where concurrency cannot pay or be watched: CI runs a scope
# per job, streaming cannot be replayed, serial is the oracle.
PARALLEL=1
if (( SERIAL || VERBOSE )) || worker || [[ -n "${CI:-}" ]] || (( ${#UNITS[@]} < 2 )); then PARALLEL=0; fi

POOL_PY=""
if (( PARALLEL )); then
  # The floor is asked of the kernel rather than restated here, so one file owns it: a python too
  # old to import the kernel is too old to run the pool.
  POOL_PY="$(any_python || true)"
  if [[ -z "$POOL_PY" ]] \
    || ! "$POOL_PY" -c "import sys; sys.path.insert(0, 'scripts'); import checker_kernel" >/dev/null 2>&1; then
    PARALLEL=0
  fi
fi

if (( PARALLEL )); then
  # Closed before the pool starts, not at the first replayed row: left open across the pool, the
  # scope section's row would report the whole run's wall clock as its duration.
  end_section
  POOL_DIR="$(mktemp -d)"
  # The parent's own shell, spelled the way a Windows python can launch it. `cygpath` does not
  # exist on Linux, where `$BASH` is already an absolute path python can use.
  POOL_BASH="$(cygpath -w "$BASH" 2>/dev/null || printf '%s' "$BASH")"

  # Never `FORCE_COLOR` or `NO_COLOR`: prettier, pnpm and eslint each read those as instructions.
  if [[ -n "$C_RED" ]]; then export FL_GATE_COLOR=1; else export FL_GATE_COLOR=0; fi

  # The parent spins for the whole pool: a worker's own spinner is dead, its stdout being a file,
  # and this is the one stretch of a run where nothing prints for a minute.
  spinner_start "${#UNITS[@]} scopes running concurrently"
  POOL_RC=0
  "$POOL_PY" scripts/gate_pool.py --dir "$POOL_DIR" --bash "$POOL_BASH" --verify scripts/verify.sh \
    "${UNITS[@]}" || POOL_RC=$?
  spinner_stop
  # The pool answers on the checkers' scale, never the workers': a failure here is this program
  # failing, which is a crash whatever the scopes did.
  if (( POOL_RC )); then on_error "$POOL_RC" "${LINENO}" "scripts/gate_pool.py"; fi

  declare -A UNIT_STATUS=()
  while IFS=$'\t' read -r u_scope u_status _ _; do UNIT_STATUS["$u_scope"]="$u_status"; done \
    < "${POOL_DIR}/manifest.tsv"

  replay_scope() { # $1 scope
    local scope="$1" status="${UNIT_STATUS[$1]:-}" rank ms findings advisories name
    if [[ -s "${POOL_DIR}/${scope}.out" ]]; then cat "${POOL_DIR}/${scope}.out"; fi
    if [[ -s "${POOL_DIR}/${scope}.err" ]]; then cat "${POOL_DIR}/${scope}.err" >&2; fi
    if [[ -s "${POOL_DIR}/${scope}.ledger" ]]; then
      while IFS=$'\t' read -r rank ms findings advisories name; do
        adopt_section "$name" "$rank" "$ms" "$findings" "$advisories"
      done < "${POOL_DIR}/${scope}.ledger"
    else
      # A worker that died before it could write one. Rank 0 is what `finish` refuses to call
      # green, so the scope surfaces as unproven rather than as one that passed.
      adopt_section "$scope" 0 0 0 0
    fi
    # The manifest's own word for a unit that never ran, which no exit code may spell: a number
    # here is always one a real process returned.
    if [[ ! "$status" =~ ^[0-9]+$ ]]; then
      on_error 3 "${LINENO}" "scripts/gate_pool.py did not run the ${scope} scope (${status:-no row})"
    fi
    # Crashed and interrupted end the run here, having no row that could say so. Findings and a
    # refusal are already in the rows, which `finish` reads back.
    adopt_ending "$status"
    if (( status )); then finish; fi
  }
  for u_scope in "${SCOPE_ORDER[@]}"; do replay_scope "$u_scope"; done
  wrap_up
fi

# --- scripts ---------------------------------------------------------------------------------------

# First because it is instant, and because a broken script makes everything below it unreliable.
if (( RUN_SCRIPTS )); then
  section scripts

  # `quietly` prints the self-check's output only on failure, so a `skip` inside it would reach
  # nobody on a green run, under a line reading as a pass.
  FL_SELFCHECK_LEDGER="$(mktemp)"; export FL_SELFCHECK_LEDGER
  SELFCHECK_SKIPS=0

  # A broken ledger is this gate's own plumbing, never the change under test, so each fault below
  # crashes rather than reporting a finding nothing in the tree can fix.
  replay_selfcheck() {
    local verb message records=0 declared=""
    [[ -r "$FL_SELFCHECK_LEDGER" ]] \
      || on_error 3 "${LINENO}" "scripts/selfcheck.sh left no ledger, so what it did not run cannot be reported (scripts/selfcheck.sh :: _ledger)"
    while IFS=$'\t' read -r verb message; do
      case "$verb" in
        skip) skip "$message"; SELFCHECK_SKIPS=$(( SELFCHECK_SKIPS + 1 )) ;;
        warn) warn "$message" ;;
        end)  declared="$message"; continue ;;
        *)    on_error 3 "${LINENO}" "scripts/selfcheck.sh's ledger holds '${verb}', which is none of its verbs" ;;
      esac
      records=$(( records + 1 ))
    done < "$FL_SELFCHECK_LEDGER"
    # An absent count is a ledger with no closing line: the self-check stopped writing one, rather
    # than having had nothing to report.
    [[ "$declared" == "$records" ]] \
      || on_error 3 "${LINENO}" "scripts/selfcheck.sh left ${records} ledger record(s) under a closing count of '${declared:-none}'"
  }

  # Safe to start together: each writes only its own cache or a throwaway tree. A job records a
  # status and never speaks, so every verdict is still reached below, in written order, and the
  # run still ends at the first failure. `docs/ops/spec.md` §1.6.
  do_selfcheck() { bash scripts/selfcheck.sh; }
  # Only a failing invocation speaks. Both share one capture file, so a passing banner would
  # print directly above the other's finding and read as a verdict on it.
  do_ruff() {
    local lint
    lint="$("$PY" -m ruff check scripts 2>&1)" || { printf '%s\n' "$lint"; return 1; }
    "$PY" -m ruff format --check scripts
  }
  # Run from inside scripts/, where pyright finds its config. `$PY` is absolute, so the `cd` does
  # not disturb it.
  do_pyright()   { ( cd "${REPO_ROOT}/scripts" && "$PY" -m pyright ); }
  do_pytest()    { "$PY" -m pytest scripts/tests; }

  # Never while a run is being watched: `--verbose` exists to stream each tool's own output, and a
  # stream held in a file until its step arrives is no longer one. `--serial` is the oracle the
  # concurrent form has to match, so it takes the same path.
  STEP_JOBS=1
  if (( SERIAL || VERBOSE )); then STEP_JOBS=0; fi
  if (( STEP_JOBS )); then BG_DIR="$(mktemp -d)"; fi

  bg_start() { # $1 the check, whose command is the function `do_<check>`
    if (( ! STEP_JOBS )); then return 0; fi
    # `set +e` inside, so a check's own non-zero status is recorded rather than ending the job
    # before it can be written. The duration lands first: with the status present, it is there too.
    (
      set +e
      _t0="$(_now_ms)"
      "do_$1" > "${BG_DIR}/${1}.out" 2>&1
      _rc=$?
      printf '%s' "$(( $(_now_ms) - _t0 ))" > "${BG_DIR}/${1}.ms"
      printf '%s' "$_rc" > "${BG_DIR}/${1}.rc"
    ) &
    BG_PID["$1"]=$!
  }

  bg_join() { # $1 the check — wait for it, and re-date the step to the work's own length
    if (( ! STEP_JOBS )); then return 0; fi
    local ms
    spinner_start "scripts · $1"
    wait "${BG_PID[$1]}" 2>/dev/null || true
    spinner_stop
    ms="$(cat "${BG_DIR}/${1}.ms" 2>/dev/null || true)"
    if [[ "$ms" =~ ^[0-9]+$ ]]; then step_took_ms "$ms"; fi
  }

  bg_replay() { # $1 the check — its own output and exit status, wherever it ran
    # With no job started this IS the check: one call site for both forms, so `--verbose` and
    # `--serial` take the path the gate has always taken rather than a second one nobody reads.
    if (( ! STEP_JOBS )); then "do_$1"; return; fi
    local rc
    if [[ -s "${BG_DIR}/${1}.out" ]]; then cat "${BG_DIR}/${1}.out"; fi
    rc="$(cat "${BG_DIR}/${1}.rc" 2>/dev/null || true)"
    # Never 1, 2 or 130: each is a verdict a check earns by finishing, and a job that left no
    # status earned none. `bg_verdict` and pytest's own case route it to the crash path.
    if [[ ! "$rc" =~ ^[0-9]+$ ]]; then
      printf '%s\n' "the ${1} check left no exit status behind, so it did not run to completion"
      return 3
    fi
    return "$rc"
  }

  # A remedy is owed only where the check reached a verdict. A job that left no status reached
  # none, so 3 takes the crash path instead of announcing findings the check never made.
  bg_verdict() { # $1 the check · $2 the line to blame a crash on · $3 the remedy for a failure
    local rc=0
    quietly bg_replay "$1" || rc=$?
    case "$rc" in
      0)   ;;
      1)   die "$3" ;;
      130) on_interrupt ;;
      *)   on_error "$rc" "$2" "scripts · $1" ;;
    esac
  }

  bg_start selfcheck; bg_start ruff; bg_start pyright; bg_start pytest

  step "scripts · selfcheck"
  bg_join selfcheck
  run_checker stop "scripts/selfcheck.sh" "scripts/selfcheck.sh failed — its findings are above." \
    bg_replay selfcheck
  replay_selfcheck
  # A scope proved in part may not close on the sentence that describes proving all of it.
  if (( SELFCHECK_SKIPS )); then
    ok "scripts are internally consistent, apart from the ${SELFCHECK_SKIPS} check(s) skipped above"
  else
    ok "scripts are internally consistent"
  fi

  step "scripts · ruff  (lint, and format in check mode)"
  bg_join ruff
  bg_verdict ruff "${LINENO}" \
    "ruff failed in scripts/. Fix with:  fl_backend/.venv/Scripts/python -m ruff format scripts"
  ok "the gate's own python is clean"

  step "scripts · pyright"
  bg_join pyright
  bg_verdict pyright "${LINENO}" "pyright found type errors in scripts/.
These are the same errors Pylance shows in the editor."
  ok "the gate's own types are clean"

  # Every check `scripts/check_docs.py :: CHECKS` registers runs against a fixture repo (CUR-5).
  # pytest answers its own codes, not the kernel's: 2 is a collection error, which `run_checker`
  # would announce as a considered refusal.
  step "scripts · pytest  (the documentation gate's fixture net, and the kernel's floors)"
  bg_join pytest
  PYTEST_RC=0
  quietly bg_replay pytest || PYTEST_RC=$?
  case "$PYTEST_RC" in
    0) ;;
    1) die "pytest over scripts/tests failed: a documentation check stopped reporting
its planted violation, or a floor the kernel declares does not match what reads it.
The failing test names which." ;;
    130) on_interrupt ;;
    *) on_error "$PYTEST_RC" "${LINENO}" "pytest scripts/tests" ;;
  esac
  ok "every documentation check fires on a planted violation, and the kernel's floors hold"
fi

# --- docs ------------------------------------------------------------------------------------------

# A dangling rule id, a dead link and a citation whose anchor has gone are invisible to every
# other check here, and each still reads as though it means something (CUR-5).
if (( RUN_DOCS )); then
  section docs
  DOCS_OK=1

  # They collect rather than stop: stopping at the first leaves the commit messages unexamined
  # while the exit code reads as though they were checked.
  step "docs · citations, links and stamps"
  if run_checker collect "scripts/check_docs.py" "The documentation gate failed. Each finding above names its file
and what no longer resolves. Rules: docs/_standard/chapters/5-currency.md" \
    "$PY" scripts/check_docs.py; then
    ok "documentation references resolve"
  else
    DOCS_OK=0
  fi

  # Commit messages ride in this scope rather than one of their own; the argument is in
  # `scripts/check_commits.py`'s own header.
  step "docs · commit messages on this branch"
  if run_checker collect "scripts/check_commits.py" "The commit message gate failed. Each finding above names the
commit and what is wrong with it. The form is docs/_git/templates.md." \
    "$PY" scripts/check_commits.py; then
    ok "commit messages follow the convention"
  else
    DOCS_OK=0
  fi

  # `openapi.json` publishes every endpoint and model docstring as a `description`, so a reword
  # edits it -- and `check_scope.py` reads that edit as comment-only, asking for this scope and
  # not `--backend`, where the pytest case covering it lives.

  # Needs no database and no environment: `build_test_config` supplies the settings. The backend
  # virtualenv it does need is already this scope's prerequisite, above.

  # `PYTHONPATH` rather than a `cd`, which `run_checker` cannot do: a subshell around it would run
  # `fail` in a child, and the finding it counts would die with that child.
  step "docs · openapi.json matches the docstrings it publishes"
  if run_checker collect "fl_backend/tests/openapi_document.py" "The published document no longer matches the models and docstrings it
is built from. Regenerate it with:  cd fl_backend && .venv/Scripts/python -m tests.openapi_document --write" \
    env "PYTHONPATH=${REPO_ROOT}/fl_backend" "$PY" -m tests.openapi_document --check; then
    ok "openapi.json is current"
  else
    DOCS_OK=0
  fi

  # Stopping here rather than at any one finding keeps the expensive scopes below unrun. What each
  # check found is already reported and counted.
  if (( ! DOCS_OK )); then wrap_up; fi
fi

# --- backend ---------------------------------------------------------------------------------------

# Before the frontend: this tier finishes in seconds while a next build takes minutes, and
# cheapest-to-fail-first is this gate's ordering rule.
if (( RUN_BACKEND )); then
  section backend

  # First, because every check below runs against the environment this file resolves to: a
  # lockfile disagreeing with its manifest builds one tree here and another in the image.
  step "backend · uv  (manifest and lockfile agree)"
  if command -v uv >/dev/null 2>&1; then
    ( cd fl_backend && quietly uv lock --check ) \
      || die "fl_backend/uv.lock no longer answers pyproject.toml. Fix with:  cd fl_backend && uv lock
-- then commit the lockfile."
    ok "manifest and lockfile agree"
  else
    skip "uv is not on PATH, so the backend lockfile was not checked against its manifest"
  fi

  step "backend · ruff  (lint, and format in check mode)"
  ( cd fl_backend && quietly "$PY" -m ruff check app tests && quietly "$PY" -m ruff format --check app tests ) \
    || die "ruff failed in fl_backend. Fix with:  cd fl_backend && .venv/Scripts/python -m ruff format app tests"
  ok "ruff clean"

  # ruff checks no types, and pytest only what it executes.
  step "backend · pyright"
  ( cd fl_backend && quietly "$PY" -m pyright ) || die "pyright found type errors in fl_backend.
These are the same errors Pylance shows in the editor."
  ok "no type errors"

  step "backend · pytest  (default tier)"
  ( cd fl_backend && quietly "$PY" -m pytest ) || die "fl_backend tests failed."
  ok "default-tier tests pass"
fi

# --- format ----------------------------------------------------------------------------------------

# Its own scope, not the frontend's first step: prettier governs markdown, YAML and the compose
# files too, and a branch touching only those still owes the check.
if (( RUN_FORMAT )); then
  section format

  # Check mode, never write: a gate that reformats measured a tree the author never saw.
  # Formatting belongs to `.githooks/pre-commit`.
  step "format · prettier  (check mode — this gate never writes)"
  # The message asserts no cause: this fails for an unformatted file and for a pnpm that would not
  # start, and the captured output above is the only thing that knows which.
  ( cd fl_frontend && quietly pnpm format:check ) \
    || die "the formatter check did not pass — its own output is above.
Where it names files, they are unformatted:  cd fl_frontend && pnpm format  -- then commit the result."
  ok "the tree is formatted"
fi

# --- frontend --------------------------------------------------------------------------------------
if (( RUN_FRONTEND )); then
  section frontend

  # Optimistic repeat installs are what would make this no check at all: that setting defaults to
  # true and answers from mtimes, so a manifest restored with its timestamp passes while
  # disagreeing with the lockfile.
  step "frontend · pnpm  (manifest and lockfile agree)"
  ( cd fl_frontend && quietly pnpm install --frozen-lockfile --lockfile-only --no-optimistic-repeat-install ) \
    || die "fl_frontend's manifest and lockfile disagree — the packages are named above.
Fix with:  cd fl_frontend && pnpm install  -- then commit the lockfile."
  ok "manifest and lockfile agree"

  step "frontend · tsc"
  ( cd fl_frontend && quietly pnpm typecheck ) || die "tsc found type errors."
  ok "no type errors"

  step "frontend · eslint"
  ( cd fl_frontend && quietly pnpm lint ) || die "eslint failed."
  ok "lint clean"

  step "frontend · next build"
  # The build evaluates modules that read the environment, so a checkout with no .env dies at
  # page-data collection. Placeholders, set on this command so only the build sees them; the
  # schema is enforced by `scripts/local.sh` and by every deploy.
  ( cd fl_frontend && SKIP_ENV_VALIDATION=true MONGODB_URI=mongodb://localhost:27017/placeholder \
      NEXT_TELEMETRY_DISABLED=1 quietly pnpm build ) || die "next build failed."
  ok "build succeeds"

  step "frontend · unit tests"
  ( cd fl_frontend && quietly pnpm test ) || die "frontend unit tests failed."
  ok "unit tests pass"

  # Advisory, not fatal: something published upstream overnight must not block an unrelated merge.
  step "frontend · dependency audit  (runtime advisories only)"
  if ( cd fl_frontend && quietly pnpm audit:prod ); then
    ok "no known runtime vulnerabilities"
  else
    warn "runtime advisories present — triage with: cd fl_frontend && pnpm audit"
  fi
fi

# --- ops -------------------------------------------------------------------------------------------

# The compose files and the nginx config have no compiler and no test suite; without this scope a
# typo in either surfaces on the server, at deploy time.
if (( RUN_OPS )); then
  section ops

  step "ops · compose files parse"
  # Compose refuses to parse a file whose env_file is missing, and a CI checkout has neither .env.
  # A stand-in is created only where the file is absent, and the EXIT trap removes it.
  if [[ ! -f fl_backend/.env ]]; then : > fl_backend/.env; STANDIN_BE=1; fi
  if [[ ! -f fl_frontend/.env ]]; then : > fl_frontend/.env; STANDIN_FE=1; fi
  quietly docker compose -f docker-compose.yml config --quiet \
    || die "docker-compose.yml does not parse."
  quietly docker compose -f docker-compose.local.yml config --quiet \
    || die "docker-compose.local.yml does not parse."
  ok "both compose files parse"

  # Both files parse whatever they say, so nothing else holds the local stack to production's
  # shape: a setting production gains and local does not is a difference local can never catch.
  step "ops · the local stack still mirrors production"

  # The interpreter is the only thing this step may skip for; past that guard the checker's
  # verdict stands, refusals included.
  OPS_PY="$(any_python || true)"
  OPS_FLOOR=0
  if [[ -n "$OPS_PY" ]]; then
    # Only the kernel's own crash counts as too old; any other probe failure leaves the checker to
    # answer for itself.
    quietly "$OPS_PY" -c "import sys; sys.path.insert(0, 'scripts'); import checker_kernel" || OPS_FLOOR=$?
  fi
  if [[ -z "$OPS_PY" ]]; then
    skip "no python found, so the compose files were not compared"
  # 3 is `checker_kernel.py :: EXIT_CRASH`, raised by its import-time floor guard. A stale literal
  # here stops matching and the checker runs, so this fails loudly rather than skipping quietly.
  elif (( OPS_FLOOR == 3 )); then
    skip "this python is below the checkers' floor, so the compose files were not compared"
  else
    run_checker stop "scripts/check_compose_mirror.py" "The compose files have drifted. The findings above name
the service and the key, and the declared deltas are the checker's own list." \
      "$OPS_PY" scripts/check_compose_mirror.py
    ok "every delta between the two files is a declared one"
  fi

  step "ops · nginx accepts prod.conf"
  # `nginx -t` loads the certificates and resolves every proxy_pass host, hence the throwaway pair
  # and loopback entries. The temp dir sits under the repo root because MSYS rewrites a
  # POSIX-looking path (`scripts/README.md`).
  rm -rf "${REPO_ROOT}/.tmp-nginx-check"
  mkdir -p "${REPO_ROOT}/.tmp-nginx-check"
  # Relative output paths, because a Windows openssl cannot open an MSYS-style absolute path. The
  # exclusion protects the subject alone from MSYS's rewriting, and is inert on Linux.
  MSYS2_ARG_CONV_EXCL="/CN" quietly openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" \
    -keyout .tmp-nginx-check/key.pem -out .tmp-nginx-check/cert.pem \
    || die "could not generate a throwaway certificate for the nginx check."
  # The tag both compose files pin, so the nginx accepting prod.conf here is the one that serves
  # it. A floating tag would move this check to a version the servers do not run.
  MSYS_NO_PATHCONV=1 quietly docker run --rm \
    --add-host frontend:127.0.0.1 --add-host backend:127.0.0.1 \
    -v "/${REPO_ROOT}/nginx/prod.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "/${REPO_ROOT}/.tmp-nginx-check:/etc/nginx/certs:ro" \
    nginx:1.31-alpine nginx -t \
    || die "nginx refuses prod.conf — its own explanation is above."
  ok "nginx accepts prod.conf"
fi

# --- db --------------------------------------------------------------------------------------------

# Split from the default tier because it needs the Docker daemon the quick scope exists to avoid.
# Without it a change breaking the pipeline against a real mongod passes every local gate.
if (( RUN_DB )); then
  section db

  step "db · pytest -m db, against a real mongod"
  ( cd fl_backend && quietly "$PY" -m pytest -m db ) || die "fl_backend db-tier tests failed.
testcontainers starts and removes mongo:8 itself; a failure here is the code, not the daemon."
  ok "db-tier tests pass"
fi

# --- images ----------------------------------------------------------------------------------------

# The EXIT trap reclaims this run's tags on every exit path it can see. A run killed outright
# leaves them behind, under a tag carrying a pid nothing else builds against.
if (( RUN_IMAGES )); then
  section images

  # CI sets VERIFY_IMAGES_CACHE=gha with a docker-container builder, the default driver being
  # unable to export a cache. The export runs after every layer, so an unauthenticated backend
  # costs the whole build before naming what is missing.
  if [[ "${VERIFY_IMAGES_CACHE:-}" == "gha" && -z "${ACTIONS_RUNTIME_TOKEN:-}" ]]; then
    die "VERIFY_IMAGES_CACHE=gha, but ACTIONS_RUNTIME_TOKEN is not set, so the type=gha backend
cannot authenticate and buildx would fail the cache export after building everything.
The credential comes from .github/actions/actions-runtime-env, which must run before
this step in the job."
  fi

  build_image() {
    local name="$1" dockerfile="$2" context="$3"
    if [[ "${VERIFY_IMAGES_CACHE:-}" == "gha" ]]; then
      # `scope` keeps the images' caches apart, buildx overwriting rather than merging a key. It stays
      # the bare image name: a run id would miss earlier runs' layers. `version` stays unpinned,
      # buildx picking the live cache service.
      quietly docker buildx build --load \
        --cache-from "type=gha,scope=${name}" \
        --cache-to "type=gha,scope=${name},mode=max" \
        -f "$dockerfile" -t "${VERIFY_TAG}:${name}" "$context"
    else
      quietly docker build -f "$dockerfile" -t "${VERIFY_TAG}:${name}" "$context"
    fi
  }

  step "images · docker build frontend  (the check the frontend scope cannot do)"
  build_image frontend fl_frontend/Dockerfile fl_frontend \
    || die "The frontend image failed to build. This is the failure the frontend scope cannot see."
  ok "frontend image builds"

  step "images · docker build backend"
  build_image backend fl_backend/Dockerfile fl_backend \
    || die "The backend image failed to build."
  ok "backend image builds"

  step "images · instrumentation.js is actually in the frontend image"
  # From the repo root this file compiles but is not traced into the standalone output, which
  # silently disables the startup env gate and onRequestError.
  if quietly docker run --rm --entrypoint sh "${VERIFY_TAG}:frontend" -c '[ -f .next/server/instrumentation.js ]'; then
    ok "instrumentation.js present — env gate and error logging will run"
  else
    die "instrumentation.js is MISSING from the image. It must live at fl_frontend/src/instrumentation.ts, not the repo root."
  fi
fi

# --- summary ---------------------------------------------------------------------------------------
wrap_up
