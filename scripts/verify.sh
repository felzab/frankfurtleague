#!/usr/bin/env bash
#
# SCRIPTS · the pre-merge gate — everything, or exactly the surfaces a change touched.
#
# Read-only as a formatter: prettier runs in check mode everywhere, so no run reformats a tracked
# file — with one write this script does not control, `next build` rewriting the tracked
# `fl_frontend/tsconfig.json` when a `compilerOptions` key is absent, which the frontend CI job
# catches by diffing that one path (not ADR-0065's retired whole-tree compensation). Before any
# scope runs, `scripts/check_scope.py` refuses a run narrower than the branch's diff (ADR-0030).
# Never name another tool's flag in this block: `scripts/selfcheck.sh` reads every double-dashed
# word here as a flag this script must accept.
#
#   ./scripts/verify.sh                   every scope — the full gate; the image builds take minutes
#   ./scripts/verify.sh --scripts --docs --backend --format --frontend --ops --db --images
#   ./scripts/verify.sh --quick           the scopes needing no Docker: not ops, not db, not images
#   ./scripts/verify.sh --verbose         stream each tool's own output instead of capturing it
#   ./scripts/verify.sh --serial          one scope at a time, in the order the output already reads
#   ./scripts/verify.sh --help
#
# See:
# - docs/ops/spec.md — the scope table, what each scope needs, and the cheapest-to-fail order

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

# The frontend scope reads exactly the files the formatter governs, so naming it names the formatter
# too — without this, `check_scope.py` reports a format scope unproven on a run that proved it.

# Never in a worker: the parent has made the implication already and given the formatter a unit of
# its own, so a worker repeating it runs prettier over the repository twice and hands back a
# second `format` row for one section.
if (( RUN_FRONTEND )) && ! worker; then RUN_FORMAT=1; fi

# Fail on a missing prerequisite NOW: without this, a full run on a machine whose Docker is asleep
# discovers it only at the db tier, minutes of green checks in.
if (( RUN_OPS || RUN_DB || RUN_IMAGES )); then
  require_docker
fi

# One EXIT trap serves every Docker scope's cleanup: `die` exits directly, so an inline cleanup
# line after a failed check would never run.

# Ctrl-C runs it too, an EXIT trap being enough for that. INT and TERM must NOT be added here: they
# are `_lib.sh`'s, and re-trapping either replaces the interrupted closing statement with nothing.

# One trap, installed whatever this run covers, because bash keeps exactly one and a worker owes its
# parent a ledger on every exit path. `cleanup` is a no-op until a scope that makes something
# replaces it.
cleanup() { :; }
gate_exit() {
  # From the trap and not the end of the body: `die`, `refuse` and `on_error` exit where they stand,
  # so a body-final call would miss exactly the rows whose verdict matters most.
  if worker; then end_section; emit_section_ledger > "${FL_GATE_LEDGER:?}"; fi
  cleanup
  if [[ -n "${POOL_DIR:-}" ]]; then rm -rf "$POOL_DIR"; fi
  if [[ -n "${FL_SELFCHECK_LEDGER:-}" ]]; then rm -f "$FL_SELFCHECK_LEDGER"; fi
}
trap gate_exit EXIT

if (( RUN_OPS || RUN_IMAGES )); then
  STANDIN_BE=0; STANDIN_FE=0
  # The tag carries this run's pid, so the forced removal below can only ever reach images this run
  # built. Fixed tags let a second gate run anywhere on the machine delete the images another run is
  # still building against, and `-f` asks no questions.
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

# The scopes this run covers, settled before anything runs. Stated up front and read back by the
# closing table, so a run that stopped early can be seen to have stopped: an exit code alone cannot
# say which scopes it never reached.
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

# Told once, before anything can end. A worker is given one scope, so its own answer would be every
# other scope in the gate — and the parent's is the only one that describes the run.
if ! worker; then set_not_run "$NOT_RUN"; fi

# What a scope shares mutable state with, and therefore may not run beside. Everything absent is
# independent of every other scope, which is what lets the pool below start it at once.
scope_shares() { # $1 scope · prints the scopes it must follow
  case "$1" in
    # Both test tiers write fl_backend/__pycache__ and .pytest_cache.
    db)  printf 'backend' ;;
    # Its stand-in .env files appear and vanish in both trees, which the backend's tests and
    # `next build` read while they run.
    ops) printf 'backend db frontend' ;;
  esac
  return 0
}

# One `scope[:after,after]` per unit, in the order the scopes are replayed in.

# Named only where this run covers them: the pool refuses a constraint naming a scope it was not
# given, which makes a typo above an error rather than a guarantee quietly dropped.
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

# The one way this script ends a run it is still in control of. `finish` appends its sentence to the
# green ending alone, so a stopped run cannot inherit "safe to merge" from a call site that expected
# to be the last one.
wrap_up() {
  # In a worker the ending belongs to the parent, which holds every scope's rows and can say the
  # half no single scope knows — what the run as a whole left unproven.
  if worker; then end_worker; fi
  end_section
  # The scopes left out are named by the ending itself, whichever one this run reaches. All that is
  # withheld here is "Safe to merge.", which a run covering only part of the tree has not earned.
  if [[ -n "$NOT_RUN" ]]; then finish; else finish "Safe to merge."; fi
}

# The checkers' exit contract, `scripts/checker_kernel.py :: run`: 0 nothing to report, 1 findings,
# 2 it read its input and would not judge it, 3 and up it could not run, 130 interrupted. A refusal
# is satisfied; a crash is repaired.

# `stop` ends the run at the first finding, which is what cheapest-to-fail order buys. `collect`
# records it and returns 1, for a pair of cheap checks whose findings a reader wants together.
run_checker() {
  local mode="$1" label="$2" message="$3"; shift 3
  local rc=0
  quietly "$@" || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) if [[ "$mode" == "collect" ]]; then fail "$message"; return 1; fi
       die "$message" ;;
    # A refusal ends the run in both modes, `collect` included: a pair collects so that two sets of
    # findings reach the reader together, and a check that could not judge its input has none.
    2) refuse "${label} could not judge its input, so nothing here stands as a verdict on the
change. Its own reason is above." ;;
    130) on_interrupt ;;
    # `skip` is right for the scope check below and wrong here: a named scope whose checker never
    # ran has proved nothing, so this ends the run as the crash it is rather than passing it.
    *) on_error "$rc" "${BASH_LINENO[0]}" "$label" ;;
  esac
}

# --- scope -------------------------------------------------------------------------------------------

# Before any scope runs, because refusing an undersized run in two seconds is the point: the same
# refusal after a next build has already cost the minutes it exists to save. This is where ADR-0030
# stops depending on memory.

# Parent only. A worker is given one scope and the parent has already asked this question for the
# whole run, so asking again would put a second `scope` row in the table it replays into.
if ! worker; then
  section scope
  info "this run covers: ${SCOPES_RAN% }"

  # Skipped in CI, where the scopes are separate jobs and the mapping is derived from paths rather than
  # typed: there is no single invocation for the question to be about, and `--docs` would fail for a
  # missing images scope another job is running.
  if [[ -n "${CI:-}" ]]; then
    skip "scope check: CI maps scopes from paths itself, so there is no typed scope to check"
  else
    step "scope · does this run cover what the branch changed?"
    SCOPE_PY="$(any_python || true)"
    SCOPE_RC=0
    if [[ -z "$SCOPE_PY" ]]; then
      skip "no python found — this run was not checked against the diff"
    else
      # Not through `quietly`: the advisory findings are the useful half and a green run should still
      # print them.
      "$SCOPE_PY" scripts/check_scope.py --ran "$SCOPES_RAN" || SCOPE_RC=$?
      case "$SCOPE_RC" in
        0) ok "the scopes named cover the change" ;;
        1) refuse "This run is not wide enough to merge on. The finding above names the file and the flag." ;;
        # A refusal that names something, which only a checker that read its input can return. The
        # reason is on screen because this step deliberately bypasses `quietly`.
        2) refuse "The scope check could not judge its input, so this run was not checked against the
diff. Its own reason is above." ;;
        130) on_interrupt ;;
        # Degraded exactly like the missing interpreter above, and never a refusal: a checker that
        # broke says nothing about the scope, and a refusal naming nothing is the defect A2 named.
        *) skip "the scope check itself failed (exit ${SCOPE_RC}), so this run was not checked against the diff" ;;
      esac
    fi
  fi
fi

# --- the scopes, concurrently ------------------------------------------------------------------------

# Every scope below runs in a process of its own, and this block replays what they printed in the
# order they are written in, so a parallel run reads as the serial one it must match.

# Nothing returns past the `wrap_up` at the end of it; the serial path below is what runs instead.

# Serial where concurrency cannot pay or cannot be watched. One scope has nothing to overlap, and
# CI runs one scope per job already.

# `--verbose` streams a tool's output as it arrives rather than replaying it, and `--serial` is the
# oracle a byte-identity comparison needs.
PARALLEL=1
if (( SERIAL || VERBOSE )) || worker || [[ -n "${CI:-}" ]] || (( ${#UNITS[@]} < 2 )); then PARALLEL=0; fi

POOL_PY=""
if (( PARALLEL )); then
  # The floor is asked of the kernel rather than restated here, exactly as the ops scope asks it: a
  # python too old to import it is too old to run the pool, and the answer costs a tenth of a second.
  POOL_PY="$(any_python || true)"
  if [[ -z "$POOL_PY" ]] \
    || ! "$POOL_PY" -c "import sys; sys.path.insert(0, 'scripts'); import checker_kernel" >/dev/null 2>&1; then
    PARALLEL=0
  fi
fi

if (( PARALLEL )); then
  # Closed before the pool starts rather than at the first replayed row: the scope section's row
  # prints its duration, and left open across the pool it would report the whole run's wall clock.
  end_section
  POOL_DIR="$(mktemp -d)"
  # The parent's own shell, spelled the way a Windows python can launch it. `cygpath` does not exist
  # on Linux, where `$BASH` is already an absolute path python can use.
  POOL_BASH="$(cygpath -w "$BASH" 2>/dev/null || printf '%s' "$BASH")"

  # This run's own answer, carried to the workers in the gate's own variable — never `FORCE_COLOR`
  # or `NO_COLOR`, which prettier, pnpm and eslint all read as instructions of their own.
  if [[ -n "$C_RED" ]]; then export FL_GATE_COLOR=1; else export FL_GATE_COLOR=0; fi

  # The parent spins for the whole pool: a worker's own spinner is dead, its stdout being a file,
  # and this is the one stretch of a gate run where nothing prints for a minute.
  spinner_start "${#UNITS[@]} scopes running concurrently"
  POOL_RC=0
  "$POOL_PY" scripts/gate_pool.py --dir "$POOL_DIR" --bash "$POOL_BASH" --verify scripts/verify.sh \
    "${UNITS[@]}" || POOL_RC=$?
  spinner_stop
  # The pool answers on the checkers' scale and never on the workers': a failure here is this
  # program failing, which is a crash whatever the scopes did.
  if (( POOL_RC )); then on_error "$POOL_RC" "${LINENO}" "scripts/gate_pool.py"; fi

  declare -A UNIT_STATUS=()
  while IFS=$'\t' read -r u_scope u_status _ _; do UNIT_STATUS["$u_scope"]="$u_status"; done \
    < "${POOL_DIR}/manifest.tsv"

  # One scope: its bytes, then its rows, then whatever its status says about the run. Bytes and rows
  # travel apart because a capture cannot carry a verdict, and `adopt_section` prints nothing.
  replay_scope() { # $1 scope
    local scope="$1" status="${UNIT_STATUS[$1]:-}" rank ms findings advisories name
    if [[ -s "${POOL_DIR}/${scope}.out" ]]; then cat "${POOL_DIR}/${scope}.out"; fi
    if [[ -s "${POOL_DIR}/${scope}.err" ]]; then cat "${POOL_DIR}/${scope}.err" >&2; fi
    if [[ -s "${POOL_DIR}/${scope}.ledger" ]]; then
      while IFS=$'\t' read -r rank ms findings advisories name; do
        adopt_section "$name" "$rank" "$ms" "$findings" "$advisories"
      done < "${POOL_DIR}/${scope}.ledger"
    else
      # A worker that died before it could write one. Rank 0 is what `finish` refuses to call green,
      # so the scope surfaces as the unproven thing it is rather than as a scope that passed.
      adopt_section "$scope" 0 0 0 0
    fi
    # The manifest's own word for a unit that never ran, which no exit code may spell: a number here
    # is always one a real process returned.
    if [[ ! "$status" =~ ^[0-9]+$ ]]; then
      on_error 3 "${LINENO}" "scripts/gate_pool.py did not run the ${scope} scope (${status:-no row})"
    fi
    # Crashed and interrupted end the run here, having no row that could say so. Findings and a
    # refusal are already in the rows, so `finish` reads back the ending the serial run would print.
    adopt_ending "$status"
    if (( status )); then finish; fi
  }
  for u_scope in "${SCOPE_ORDER[@]}"; do replay_scope "$u_scope"; done
  wrap_up
fi

# --- scripts ---------------------------------------------------------------------------------------

# First because it is instant and because a broken script would make everything below it unreliable.
# See selfcheck.sh for the class of bug bash -n cannot see.
if (( RUN_SCRIPTS )); then
  section scripts

  # `quietly` prints the self-check's output only on failure, so a `skip` inside it reaches nobody
  # on a green run, under a line reading as a pass — against the verb's own definition
  # (`docs/ops/spec.md` §1.7).
  FL_SELFCHECK_LEDGER="$(mktemp)"; export FL_SELFCHECK_LEDGER
  SELFCHECK_SKIPS=0

  # Required, never consulted: a self-check that stopped writing a ledger has gone quiet again, so
  # this ends the run rather than reporting a scope it cannot describe.

  # A broken ledger is this gate's own plumbing, never the change under test, so each fault below
  # crashes rather than reporting a finding — `replay_scope`'s idiom, and the ending ADR-0066 gives
  # an event nothing in the tree can fix.
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
    # An absent count is a ledger with no closing line, which is the self-check having stopped
    # writing one rather than having had nothing to report.
    [[ "$declared" == "$records" ]] \
      || on_error 3 "${LINENO}" "scripts/selfcheck.sh left ${records} ledger record(s) under a closing count of '${declared:-none}'"
  }

  step "scripts · selfcheck"
  run_checker stop "scripts/selfcheck.sh" "scripts/selfcheck.sh failed — its findings are above." \
    bash scripts/selfcheck.sh
  replay_selfcheck
  # A scope proved in part may not close on the sentence that describes proving all of it.
  if (( SELFCHECK_SKIPS )); then
    ok "scripts are internally consistent, apart from the ${SELFCHECK_SKIPS} check(s) skipped above"
  else
    ok "scripts are internally consistent"
  fi

  step "scripts · ruff  (lint, and format in check mode)"
  ( quietly "$PY" -m ruff check scripts && quietly "$PY" -m ruff format --check scripts ) \
    || die "ruff failed in scripts/. Fix with:  fl_backend/.venv/Scripts/python -m ruff format scripts"
  ok "the gate's own python is clean"

  # The types, for the reason `scripts/pyrightconfig.json` records: the gate is built from this
  # python, and a type error in `scripts/check_scope.py` is a gate that reports the wrong scope
  # (ADR-0030).

  # Run from inside scripts/, because that is where pyright finds its config. `$PY` is an absolute
  # path from `venv_python`, so the `cd` does not disturb it.
  step "scripts · pyright"
  ( cd "${REPO_ROOT}/scripts" && quietly "$PY" -m pyright ) || die "pyright found type errors in scripts/.
These are the same errors Pylance shows in the editor."
  ok "the gate's own types are clean"

  # After pyright, so a type error surfaces before this scope's slowest step. Every check
  # `scripts/check_docs.py :: CHECKS` registers runs against a fixture repo, so one that stopped
  # reporting fails here rather than passing unnoticed (CUR-5).

  # pytest answers its own codes, not the kernel's: 1 is a failing test and 2 is a collection error,
  # which `run_checker`'s kernel mapping would announce as a considered refusal.
  step "scripts · pytest  (the documentation gate's fixture net)"
  PYTEST_RC=0
  quietly "$PY" -m pytest scripts/tests || PYTEST_RC=$?
  case "$PYTEST_RC" in
    0) ;;
    1) die "The documentation gate's fixture net failed: a check stopped
reporting its planted violation. scripts/tests/test_check_docs.py names which one." ;;
    130) on_interrupt ;;
    *) on_error "$PYTEST_RC" "${LINENO}" "pytest scripts/tests" ;;
  esac
  ok "every documentation check fires on a planted violation"
fi

# --- docs ------------------------------------------------------------------------------------------

# A dangling ADR number, a dead link and a citation whose anchor has gone are invisible to every
# other check here, and each still reads as though it means something. The standard's other currency
# defences depend on memory; this one does not (CUR-5).
if (( RUN_DOCS )); then
  section docs
  DOCS_OK=1

  # They collect rather than stop because they answer different questions and the second costs under
  # a second: stopping at the first leaves the commit messages unexamined while the exit code reads
  # as though they were checked.
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

  # Stopping here rather than at either finding keeps the expensive scopes below unrun, which is what
  # cheapest-to-fail order is for; what either check found is already reported and counted.
  if (( ! DOCS_OK )); then wrap_up; fi
fi

# --- backend ---------------------------------------------------------------------------------------

# Before the frontend deliberately: this tier finishes in seconds while a next build takes minutes,
# and cheapest-to-fail-first is the ordering rule of this gate.
if (( RUN_BACKEND )); then
  section backend

  # First, because every check below runs against the environment this file resolves to: a lockfile
  # that no longer answers its manifest builds one tree here and another in the image.
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

  # ruff checks no types and pytest runs only what it executes, so without this the gate goes green
  # while Pylance shows errors in the editor. [tool.pyright] in fl_backend/pyproject.toml points at
  # the venv, without which no third-party import resolves.
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
# files as much as `fl_frontend/src`, and a branch touching only those still owes the check.
if (( RUN_FORMAT )); then
  section format

  # Check mode, never write: a gate that reformats is a gate whose later steps measured a tree the
  # author never saw, and on `main` it is a tracked-file write nobody asked for. Formatting belongs
  # to `.githooks/pre-commit`.
  step "format · prettier  (check mode — this gate never writes)"
  # The message asserts no cause: this command fails for an unformatted file and for a pnpm that
  # would not start, and the captured output above is the only thing that knows which.
  ( cd fl_frontend && quietly pnpm format:check ) \
    || die "the formatter check did not pass — its own output is above.
Where it names files, they are unformatted:  cd fl_frontend && pnpm format  -- then commit the result."
  ok "the tree is formatted"
fi

# --- frontend --------------------------------------------------------------------------------------
if (( RUN_FRONTEND )); then
  section frontend

  # First, and before anything reads node_modules: a lockfile disagreeing with its manifest resolves
  # one tree here and another on a clean clone, and today that surfaces in the image build.

  # `--lockfile-only` is what makes it a check rather than an install: it resolves and compares
  # without linking, so it writes nothing and costs seconds instead of minutes.

  # `--no-optimistic-repeat-install` is what makes it a check at all: the setting defaults to true
  # and answers from mtimes alone, so a manifest restored with its timestamp preserved passes here
  # while disagreeing with the lockfile.
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
  # The same variables the frontend CI job sets, for the reasons its own `env:` block records: the
  # build evaluates modules that read the environment, so a checkout with no .env dies at page-data
  # collection. Placeholders only; no .env is read or created.

  # Set on this command rather than exported, so only the build sees them. The schema itself is
  # enforced where it means something, by `scripts/local.sh` and by every deploy.
  ( cd fl_frontend && SKIP_ENV_VALIDATION=true MONGODB_URI=mongodb://localhost:27017/placeholder \
      NEXT_TELEMETRY_DISABLED=1 quietly pnpm build ) || die "next build failed."
  ok "build succeeds"

  step "frontend · unit tests"
  ( cd fl_frontend && quietly pnpm test ) || die "frontend unit tests failed."
  ok "unit tests pass"

  # Advisory, not fatal: an advisory published upstream overnight should not block an unrelated
  # merge. `warn` is what says so — it is counted as an advisory and never as a finding.
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
  # Stand-ins are created only where the file is absent and removed by the EXIT trap above — a
  # real .env is never touched.
  if [[ ! -f fl_backend/.env ]]; then : > fl_backend/.env; STANDIN_BE=1; fi
  if [[ ! -f fl_frontend/.env ]]; then : > fl_frontend/.env; STANDIN_FE=1; fi
  quietly docker compose -f docker-compose.yml config --quiet \
    || die "docker-compose.yml does not parse."
  quietly docker compose -f docker-compose.local.yml config --quiet \
    || die "docker-compose.local.yml does not parse."
  ok "both compose files parse"

  # Both files parse whatever they say, so nothing else holds the local stack to production's shape:
  # a setting production gains and the local stack does not is a difference local can never catch.
  step "ops · the local stack still mirrors production"

  # The interpreter is the only thing this step may skip for: `--ops` promises Docker and no python.
  # Past that guard the checker's verdict stands, refusals included — it read the files and would not
  # answer, which is a failure and not a degradation.
  OPS_PY="$(any_python || true)"
  OPS_FLOOR=0
  if [[ -n "$OPS_PY" ]]; then
    # Asked of the kernel rather than restated here, so one file owns the floor. Only the kernel's
    # own crash counts as too old; any other probe failure leaves the checker to answer for itself.
    quietly "$OPS_PY" -c "import sys; sys.path.insert(0, 'scripts'); import checker_kernel" || OPS_FLOOR=$?
  fi
  if [[ -z "$OPS_PY" ]]; then
    skip "no python found, so the compose files were not compared"
  # 3 is `checker_kernel.py :: EXIT_CRASH`, which its import-time floor guard raises. A stale literal
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
  # `nginx -t` loads the certificates and resolves every proxy_pass host, so this supplies a
  # throwaway self-signed pair and loopback entries. The temp dir sits under the repo root because
  # MSYS rewrites a POSIX-looking path (`scripts/README.md`).
  rm -rf "${REPO_ROOT}/.tmp-nginx-check"
  mkdir -p "${REPO_ROOT}/.tmp-nginx-check"
  # Relative output paths, because a Windows openssl cannot open an MSYS-style absolute path; the
  # exclusion protects only the subject from MSYS's path rewriting, and is inert on Linux.
  MSYS2_ARG_CONV_EXCL="/CN" quietly openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" \
    -keyout .tmp-nginx-check/key.pem -out .tmp-nginx-check/cert.pem \
    || die "could not generate a throwaway certificate for the nginx check."
  # The tag both compose files pin, so the nginx that accepts prod.conf here is the one that will
  # serve it. A floating tag would move this check to a version the servers do not run.
  MSYS_NO_PATHCONV=1 quietly docker run --rm \
    --add-host frontend:127.0.0.1 --add-host backend:127.0.0.1 \
    -v "/${REPO_ROOT}/nginx/prod.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "/${REPO_ROOT}/.tmp-nginx-check:/etc/nginx/certs:ro" \
    nginx:1.31-alpine nginx -t \
    || die "nginx refuses prod.conf — its own explanation is above."
  ok "nginx accepts prod.conf"
fi

# --- db --------------------------------------------------------------------------------------------

# The other test tier, split from the default one because it needs the Docker daemon `--quick` exists
# to avoid. Without it `pytest -m db` runs only in CI, so a change breaking the pipeline against a
# real mongod passes every local gate (ADR-0023).
if (( RUN_DB )); then
  section db

  step "db · pytest -m db, against a real mongod"
  ( cd fl_backend && quietly "$PY" -m pytest -m db ) || die "fl_backend db-tier tests failed.
testcontainers starts and removes mongo:8 itself; a failure here is the code, not the daemon."
  ok "db-tier tests pass"
fi

# --- images ----------------------------------------------------------------------------------------

# The EXIT trap above reclaims this run's tags on every exit path it can see. A run killed outright
# leaves its pair behind and no later run reclaims them: the tag carries a pid nothing else builds
# against, so only `docker image rm` removes it.
if (( RUN_IMAGES )); then
  section images

  # CI sets VERIFY_IMAGES_CACHE=gha to carry layers between runs (ADR-0031), paired with a
  # docker-container builder because the default driver cannot export a cache. Unset, this is a plain
  # build against the daemon's own warm layer cache.

  # The guard below buys a better failure: the cache export runs after every layer is built, so an
  # unauthenticated backend costs the whole build before it names a missing token. Only names are
  # read or printed here; the token's value is never echoed.
  if [[ "${VERIFY_IMAGES_CACHE:-}" == "gha" && -z "${ACTIONS_RUNTIME_TOKEN:-}" ]]; then
    die "VERIFY_IMAGES_CACHE=gha, but ACTIONS_RUNTIME_TOKEN is not set, so the type=gha backend
cannot authenticate and buildx would fail the cache export after building everything.
The credential comes from .github/actions/actions-runtime-env, which must run before
this step in the job."
  fi

  build_image() {
    local name="$1" dockerfile="$2" context="$3"
    if [[ "${VERIFY_IMAGES_CACHE:-}" == "gha" ]]; then
      # `scope` keeps the two images' caches apart; without it the second build evicts the first's
      # entries, because a scope is one cache key and buildx overwrites rather than merges.

      # `version` is deliberately unpinned: buildx picks the live cache service from
      # ACTIONS_CACHE_SERVICE_V2, and naming a retired one silently disables the cache (ADR-0031).

      # The cache scope stays the bare image name while the tag carries the run: a scope holding a
      # run id would miss every previous run's layers, which is the cache switched off (ADR-0031).
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
  # silently disables the startup env gate and onRequestError. One command is cheaper than
  # rediscovering it.
  if quietly docker run --rm --entrypoint sh "${VERIFY_TAG}:frontend" -c '[ -f .next/server/instrumentation.js ]'; then
    ok "instrumentation.js present — env gate and error logging will run"
  else
    die "instrumentation.js is MISSING from the image. It must live at fl_frontend/src/instrumentation.ts, not the repo root."
  fi
fi

# --- summary ---------------------------------------------------------------------------------------

# The closing table has a row for every scope that ran; `wrap_up` adds the half no row can carry —
# what a partial run left unproven, and therefore why its green is not a merge.
wrap_up
