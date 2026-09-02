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
    # `refuse`, not `die`: an argument this script cannot read is "the input could not be judged",
    # which the exit contract spells 2 (`docs/ops/spec.md` §1.7). 1 is spoken for by findings.
    *)          refuse "Unknown option: ${arg}. Try --help." ;;
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

# One capture directory per pool run, holding its units file, their output and its manifest.
# Declared up here because the EXIT trap below reclaims them, and `set -u` refuses an array that
# does not exist.
POOL_DIRS=()

# A step worker is one check body, run as its own process. It creates none of the resources below
# and inherits every one, so its trap must reclaim nothing: they are the parent's, still running.
STEP_UNIT="${FL_GATE_STEP:-}"
step_worker() { [[ -n "$STEP_UNIT" ]]; }

# One EXIT trap for every scope's cleanup: `die` exits directly, so an inline cleanup line after a
# failed check never runs. Never add INT or TERM — `_lib.sh` owns them, and re-trapping either
# loses the interrupted closing statement.
cleanup() { :; }
gate_exit() {
  local dir
  if step_worker; then return 0; fi
  # From the trap, not the end of the body: `die`, `refuse` and `on_error` exit where they stand,
  # so a body-final call misses exactly the rows whose verdict matters most.
  if worker; then end_section; emit_section_ledger > "${FL_GATE_LEDGER:?}"; fi
  # Every reclaim below is best-effort: unguarded, one failing `rm` ends the trap where it stands,
  # skipping the reclaims after it and reporting the trap's own failure over a body that exited 0.
  cleanup || true
  if (( ${#POOL_DIRS[@]} )); then
    for dir in "${POOL_DIRS[@]}"; do rm -rf "$dir" || true; done
  fi
  if [[ -n "${FL_SELFCHECK_LEDGER:-}" ]]; then rm -f "$FL_SELFCHECK_LEDGER" || true; fi
}
trap gate_exit EXIT

if (( RUN_OPS || RUN_IMAGES )); then
  OPS_SCRATCH=""
  # The tag carries the pid of the process that opened the run, so the image one unit builds is the
  # one another runs and removes. Never the caller's own value: `cleanup` force-deletes whatever it
  # names, and a shared tag names a concurrent run's images.
  if worker || step_worker; then
    # No apostrophe in the message: a single quote inside `${var:?word}` opens a quoted run that
    # swallows the rest of the file, and `bash -n` then blames a line far below this one.
    : "${VERIFY_TAG:?the parent hands a unit the run tag, which no unit may invent}"
  else
    VERIFY_TAG="frankfurtleague-verify-$$"
    export VERIFY_TAG
  fi
  cleanup() {
    # Guarded by the scope that created it: these two run as separate processes, so unguarded,
    # whichever finished first reaches the other's certificate or its image. `|| true` for the
    # reason `gate_exit` records.
    if (( RUN_OPS )); then
      rm -rf "${REPO_ROOT}/.tmp-nginx-check" || true
      if [[ -n "$OPS_SCRATCH" ]]; then rm -rf "$OPS_SCRATCH" || true; fi
    fi
    if (( RUN_IMAGES )); then
      docker image rm -f "${VERIFY_TAG}:frontend" "${VERIFY_TAG}:backend" >/dev/null 2>&1 || true
    fi
  }
fi
PY=""
if (( RUN_SCRIPTS || RUN_DOCS || RUN_BACKEND || RUN_DB )); then
  # The failure is the caller's, for the reason `scripts/_lib.sh :: venv_python` records.
  PY="$(venv_python)" \
    || die "No fl_backend virtualenv found. Create it with:  cd fl_backend && uv sync --dev"
  # Existing is not current: a virtualenv holding what the lockfile dropped, or missing what it
  # added, fails the tools below in their own vocabulary rather than the environment's.
  if ! worker && ! step_worker && [[ -z "${CI:-}" ]] && command -v uv >/dev/null 2>&1; then
    # Never in CI, where `uv sync --dev` has just run, and once per run rather than once per unit.
    quietly uv sync --project fl_backend --dev --check \
      || refuse "fl_backend/.venv does not match fl_backend/uv.lock, so nothing this run reported
would be about the change rather than about this machine. Sync it with:
  uv sync --project fl_backend --dev"
  fi
fi

# --- how many workers a tool may start -----------------------------------------------------------

# A tool's width is a property of its WORK, the budget a property of the machine; `gate_width`
# reconciles the two.

# MEASURED 2026-09-02 on one contended 16-core machine: an upper bound, and no contract. Three
# interleaved readings each of `scripts/tests` -- `-n 16` gave 94.7/47.1/80.6s, `-n 8` gave
# 99.2/88.3/66.6s, overlapping outright, and `-n 4` gave 177.1s.
GATE_WIDTH_SCRIPTS_PYTEST=8

# MEASURED 2026-09-02, two interleaved pairs of the db tier: `--maxprocesses 8` gave 55.9/40.3s and
# `6` gave 47.2/28.5s, six faster in both. A cap on `auto`, never a floor: a two-core runner
# resolves `auto` below it and takes nothing up.
GATE_WIDTH_DB_PYTEST=6

gate_width() { # $1 the tool's own measured optimum
  local want="$1" budget="${FL_GATE_BUDGET:-0}" demand="${FL_GATE_DEMAND:-0}" share
  if (( budget <= 0 || demand <= 0 || budget >= demand )); then printf '%s' "$want"; return 0; fi
  # In proportion, never in equal shares: an equal split takes the most from the tool asking for the
  # most, which is the section already setting the run's wall clock.
  share=$(( want * budget / demand ))
  if (( share < 1 )); then share=1; fi
  printf '%s' "$share"
}

# --- what a unit runs --------------------------------------------------------------------------------

# Every check that runs beside its neighbours is a `do_<check>` function, called by name: the pool
# runs one as a process and `--serial` calls the same body in place, so the serial run is an oracle.

do_selfcheck() { bash scripts/selfcheck.sh; }
# Only a failing invocation speaks. Both share one capture, so a passing banner would print
# directly above the other's finding and read as a verdict on it.
do_ruff() {
  local lint
  lint="$("$PY" -m ruff check scripts 2>&1)" || { printf '%s\n' "$lint"; return 1; }
  "$PY" -m ruff format --check scripts
}
# From inside scripts/, where pyright finds its config; the absolute `$PY` survives the `cd`.
do_pyright() { ( cd "${REPO_ROOT}/scripts" && "$PY" -m pyright ); }
# `loadfile` keeps each module's session-scoped fixture repository whole: `load` would rebuild the
# copytree and its `git init` once per worker that draws a case from the module.
do_pytest() {
  "$PY" -m pytest scripts/tests -n auto --dist loadfile \
    --maxprocesses "$(gate_width "$GATE_WIDTH_SCRIPTS_PYTEST")"
}

# Only `check_docs.py` writes `.git/index` (`scripts/docs_gate/branch.py :: _added_by_file`), so
# the others read a repository nobody locks.
do_conflict_markers() { "$PY" scripts/check_conflict_markers.py; }
# The flag only under Actions: `github` mode prints workflow commands INSTEAD of the human report,
# so an unconditional one destroys the local report and leaves the run green while doing it.
do_docs_gate() {
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then "$PY" scripts/check_docs.py --output-format github
  else "$PY" scripts/check_docs.py; fi
}
do_commit_messages() { "$PY" scripts/check_commits.py; }
# `PYTHONPATH` rather than a `cd`, which `run_checker` cannot do: a subshell around it would run
# `fail` in a child, and the finding it counts would die with that child.
do_openapi() { env "PYTHONPATH=${REPO_ROOT}/fl_backend" "$PY" -m tests.openapi_document --check; }

# Only a failing invocation speaks, for `do_ruff`'s reason.
do_backend_lock()    { ( cd fl_backend && uv lock --check ); }
do_backend_ruff() {
  local lint rc=0
  # ruff's own status travels whole: its 2 is a ruff that could not run, and a 1 in its place would
  # send the reader to reformat code no tool read.
  lint="$( cd fl_backend && "$PY" -m ruff check app tests 2>&1 )" || rc=$?
  if (( rc )); then printf '%s\n' "$lint"; return "$rc"; fi
  ( cd fl_backend && "$PY" -m ruff format --check app tests )
}
do_backend_pyright() { ( cd fl_backend && "$PY" -m pyright ); }
do_backend_pytest()  { ( cd fl_backend && "$PY" -m pytest ); }

build_image() {
  local name="$1" dockerfile="$2" context="$3"
  if [[ "${VERIFY_IMAGES_CACHE:-}" == "gha" ]]; then
    # `scope` keeps the images' caches apart, buildx overwriting rather than merging a key. It stays
    # the bare image name: a run id would miss earlier runs' layers. `version` stays unpinned,
    # buildx picking the live cache service.
    docker buildx build --load \
      --cache-from "type=gha,scope=${name}" \
      --cache-to "type=gha,scope=${name},mode=max" \
      -f "$dockerfile" -t "${VERIFY_TAG}:${name}" "$context"
  else
    docker build -f "$dockerfile" -t "${VERIFY_TAG}:${name}" "$context"
  fi
}
do_build_frontend() { build_image frontend fl_frontend/Dockerfile fl_frontend; }
do_build_backend()  { build_image backend fl_backend/Dockerfile fl_backend; }

# Two promises a build keeps silently or not at all: a USER line lost in a refactor still builds,
# and so does a context the dockerignore stopped covering.
do_image_user() {
  local name uid rc
  for name in frontend backend; do
    rc=0
    uid="$(docker run --rm --entrypoint sh "${VERIFY_TAG}:${name}" -c 'id -u')" || rc=$?
    # 130 travels: flattened to 3 it reads as a refusal, and the caller cannot recover the interrupt.
    if (( rc == 130 )); then return 130; fi
    if (( rc )); then
      printf '%s\n' "the ${name} image would not run, so its runtime user was never read"
      return 3
    fi
    if [[ "$uid" == "0" ]]; then
      printf '%s\n' "the ${name} image runs as uid 0, so no USER line takes effect in it"
      return 1
    fi
  done
}

# The build context alone: filesystem-wide, the OS trust store and the dependency trees ship
# certificates of their own, and the check widens until it says nothing.

# The shapes both `.dockerignore` files exclude; `scripts/tests/test_image_assertions.py` holds the
# two lists together.
IMAGE_CONTEXT_FIND='find /app -xdev \( -name node_modules -o -name .venv \) -prune -o \( -name ".env" -o -name ".env.*" -o -name "*.pem" -o -name "*.key" -o -name "*.crt" -o -name ".npmrc" \) -print'
do_image_context() {
  local name found rc
  for name in frontend backend; do
    rc=0
    found="$(docker run --rm --entrypoint sh "${VERIFY_TAG}:${name}" -c "$IMAGE_CONTEXT_FIND")" || rc=$?
    # For `do_image_user`'s reason.
    if (( rc == 130 )); then return 130; fi
    if (( rc )); then
      printf '%s\n' "the ${name} image would not run, so its context was never read"
      return 3
    fi
    if [[ -n "$found" ]]; then
      printf '%s\n' "the ${name} image carries what its dockerignore exists to keep out:" "$found"
      return 1
    fi
  done
}

# Each `cd`s in a subshell: in the serial form the body runs in this process, whose directory every
# later step assumes.
do_prettier()   { ( cd fl_frontend && pnpm format:check ); }
do_lockfile()   { ( cd fl_frontend && pnpm install --frozen-lockfile --lockfile-only --no-optimistic-repeat-install ); }
do_typegen()    { ( cd fl_frontend && pnpm typegen ); }
do_typecheck()  { ( cd fl_frontend && pnpm typecheck:only ); }
do_eslint()     { ( cd fl_frontend && pnpm lint ); }
do_audit()      { ( cd fl_frontend && pnpm audit:prod ); }
do_unit_tests() { ( cd fl_frontend && pnpm test ); }
# The build's placeholders, for `fl_frontend/Dockerfile`'s reason; on this command alone.
do_next_build() {
  ( cd fl_frontend && SKIP_ENV_VALIDATION=true MONGODB_URI=mongodb://localhost:27017/placeholder \
      NEXT_TELEMETRY_DISABLED=1 pnpm build )
}

# The two phases: every pooled unit reads `fl_frontend/tsconfig.json`, and each writer rewrites it
# through Next's `writeConfigurationDefaults`, so a unit in both lists would read it mid-write.
FRONTEND_POOL=(typecheck eslint audit)
FRONTEND_WRITERS=(typegen next_build)
frontend_phases_disjoint() {
  local unit writer
  for unit in "${FRONTEND_POOL[@]}"; do
    for writer in "${FRONTEND_WRITERS[@]}"; do
      [[ "$unit" != "$writer" ]] \
        || on_error 3 "${LINENO}" "do_${unit} stands in FRONTEND_POOL and FRONTEND_WRITERS both, so the pool would read tsconfig.json while it is written"
    done
  done
}
frontend_phases_disjoint

# Only a listed writer runs, so the list decides the phase and a body moved by hand is refused
# rather than raced.
run_writer() { # $1 unit
  local writer
  for writer in "${FRONTEND_WRITERS[@]}"; do
    if [[ "$1" == "$writer" ]]; then quietly "do_$1"; return; fi
  done
  on_error 3 "${BASH_LINENO[0]}" "do_$1 is run as a writer, and FRONTEND_WRITERS does not name it"
}

# The other two scopes' phases, as data for the same reason. `uv lock --check` stands apart: it
# proves the lockfile before any tool runs out of the virtualenv, so a pool would run them
# beside that proof rather than behind it.
DOCS_POOL=(conflict_markers docs_gate commit_messages openapi)
BACKEND_SERIAL=(backend_lock)
BACKEND_POOL=(backend_ruff backend_pyright backend_pytest)

# A name with no body reaches `FL_GATE_STEP` as a child-process crash; refused here, where the
# list is written.
pool_bodies_declared() { # $1.. units
  local unit
  for unit in "$@"; do
    declare -F "do_${unit}" >/dev/null \
      || on_error 3 "${BASH_LINENO[0]}" "do_${unit} is named in a pool list and defined nowhere, so that unit could only answer with a crash"
  done
}
# `FRONTEND_WRITERS` is held to it too: `run_writer` reaches a missing body as a bare 127 out of
# `quietly`, which reads as a tool that ran and failed.
pool_bodies_declared "${DOCS_POOL[@]}" "${BACKEND_SERIAL[@]}" "${BACKEND_POOL[@]}" \
  "${FRONTEND_POOL[@]}" "${FRONTEND_WRITERS[@]}"

# Asked of `start_steps`, which the scopes naming their units inline reach too. A replay is a call
# site, so the file is read, comment lines dropped first.
_REPLAY_SOURCE=""
pool_units_replayed() { # $1.. units
  local unit
  # Command substitution strips the last newline, and the class below needs a character after a
  # name on the last line.
  if [[ -z "$_REPLAY_SOURCE" ]]; then _REPLAY_SOURCE="$(grep -v '^[[:space:]]*#' "$SELF")"$'\n'; fi
  for unit in "$@"; do
    # The class stops `docs` matching a `docs_gate` site; every real call site carries a space, a
    # semicolon or a line ending after the name.
    [[ "$_REPLAY_SOURCE" == *"unit_replay ${unit}"[!a-zA-Z0-9_]* ]] \
      || [[ "$_REPLAY_SOURCE" == *"unit_verdict ${unit}"[!a-zA-Z0-9_]* ]] \
      || on_error 3 "${BASH_LINENO[0]}" "the ${unit} unit is started by a pool and replayed nowhere in ${SELF##*/}, so its output and its status would be discarded and the scope would pass over a check nobody read"
  done
}

backend_phases_disjoint() {
  local unit serial
  for unit in "${BACKEND_POOL[@]}"; do
    for serial in "${BACKEND_SERIAL[@]}"; do
      [[ "$unit" != "$serial" ]] \
        || on_error 3 "${LINENO}" "do_${unit} stands in BACKEND_POOL and BACKEND_SERIAL both, so the lockfile check would run beside the tools it exists to run ahead of"
    done
  done
}
backend_phases_disjoint

# A step worker answers with the one body it was named, and reaches this before any section opens:
# its capture then holds the check's own output and none of the gate's chrome.
if step_worker; then
  declare -F "do_${STEP_UNIT}" >/dev/null \
    || on_error 3 "${LINENO}" "FL_GATE_STEP names '${STEP_UNIT}', which is no check in ${SELF##*/}"
  STEP_RC=0
  "do_${STEP_UNIT}" || STEP_RC=$?
  exit "$STEP_RC"
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

# A worker is given one scope, so its own answer would be every other scope in the gate. The
# selected list travels beside it: the run announces those as covered, and one it ends before
# opening leaves no row and belongs in neither list.
if ! worker; then set_not_run "$NOT_RUN"; set_selected "$SCOPES_RAN"; fi

wrap_up() {
  # In a worker the ending belongs to the parent, which alone knows what the run left unproven.
  if worker; then end_worker; fi
  end_section
  # Only "Safe to merge." is withheld — a partial run has not earned it; the ending names the rest.
  if [[ -n "$NOT_RUN" ]]; then finish; else finish "Safe to merge."; fi
}

# The checkers' exit contract is `scripts/checker_kernel.py :: run`.

# `annotate` is `collect` for a checker worth reading when it PASSES.
run_checker() {
  local mode="$1" label="$2" message="$3"; shift 3
  local rc=0
  # Streamed, not captured: the checker's own workflow commands must reach the runner unindented
  # and on a GREEN run too, and `quietly` does neither. Off Actions there is nothing to annotate.
  if [[ "$mode" == "annotate" && -n "${GITHUB_ACTIONS:-}" ]]; then
    "$@" || rc=$?
  else
    quietly "$@" || rc=$?
    # `quietly` prints its capture only on a non-zero status, and a passing checker's advisories
    # need printing. Guarded on rc, or a failure prints twice.
    if [[ "$mode" == "annotate" ]] && (( ! rc )) && [[ -n "$QUIETLY_OUTPUT" ]]; then
      printf '%s\n' "$QUIETLY_OUTPUT" | detail
    fi
  fi
  case "$rc" in
    0) return 0 ;;
    1) if [[ "$mode" == "collect" || "$mode" == "annotate" ]]; then fail "$message"; return 1; fi
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

# --- units, run concurrently -------------------------------------------------------------------------

# One mechanism for everything this gate runs beside itself. A unit is a process `gate_pool.py`
# starts and this file replays: a scope, or one `do_<check>` body. `docs/ops/spec.md` §1.6.

# Never while watched: `--verbose` streams each tool's output, and `--serial` is the oracle.
STEP_JOBS=1
if (( SERIAL || VERBOSE )); then STEP_JOBS=0; fi

# Replayed in written order, so a parallel run reads as the serial one it must match. Serial where
# concurrency cannot pay or be watched: CI runs one scope per job, streaming cannot be replayed.
PARALLEL=1
if (( SERIAL || VERBOSE )) || worker || [[ -n "${CI:-}" ]] || (( ${#SCOPE_ORDER[@]} < 2 )); then PARALLEL=0; fi

POOL_PY=""; POOL_BASH=""; POOL_FALLBACK=0
if (( PARALLEL || STEP_JOBS )); then
  # The floor is asked of the kernel rather than restated here, so one file owns it: a python too
  # old to import the kernel is too old to run the pool. With none, both forms fall back to the
  # serial path, which runs the same bodies in the same order.
  POOL_PY="$(any_python || true)"
  if [[ -z "$POOL_PY" ]] \
    || ! "$POOL_PY" -c "import sys; sys.path.insert(0, 'scripts'); import checker_kernel" >/dev/null 2>&1; then
    # Reported below rather than taken quietly: the fallback proves the same thing at the cost of
    # the sum rather than the longest, and a run nothing tells apart is one whose wall clock
    # nobody can account for.
    PARALLEL=0; STEP_JOBS=0; POOL_FALLBACK=1
  else
    # The parent's own shell, spelled the way a Windows python can launch it. `cygpath` does not
    # exist on Linux, where `$BASH` is already an absolute path python can use.
    POOL_BASH="$(cygpath -w "$BASH" 2>/dev/null || printf '%s' "$BASH")"
  fi
fi

POOL_DIR=""
declare -A UNIT_STATUS=()
declare -A UNIT_MS=()

pool_open() {
  POOL_DIR="$(mktemp -d)"
  POOL_DIRS+=("$POOL_DIR")
  : > "${POOL_DIR}/units.tsv"
}

# `scripts/gate_pool.py :: parse_units`' row. A scope owes its parent a ledger of rows; a step owes
# only its exit status.
pool_add_scope() { # $1 scope
  printf '%s\tFL_GATE_WORKER=1\tFL_GATE_LEDGER=%s\t%s\t%s\t--%s\n' \
    "$1" "${POOL_DIR}/${1}.ledger" "$POOL_BASH" "scripts/verify.sh" "$1" >> "${POOL_DIR}/units.tsv"
}
pool_add_step() { # $1 check · $2 the scope flag the run carrying its body is given
  printf '%s\tFL_GATE_STEP=%s\t%s\t%s\t%s\n' \
    "$1" "$1" "$POOL_BASH" "scripts/verify.sh" "$2" >> "${POOL_DIR}/units.tsv"
}

pool_wait() { # $1 merge each unit's two streams? · $2 the spinner's label
  local rc=0 name status began ended missing=""
  local -a want=()
  local -a pool_cmd=("$POOL_PY" scripts/gate_pool.py --dir "$POOL_DIR" --units "${POOL_DIR}/units.tsv")
  if (( $1 )); then pool_cmd+=(--merge); fi
  while IFS= read -r name; do want+=("${name%%$'\t'*}"); done < "${POOL_DIR}/units.tsv"
  # A unit's own spinner is dead, its stdout being a file, and this is the one stretch of a run
  # where nothing prints for a minute, so the parent spins for the whole pool.
  spinner_start "$2"
  "${pool_cmd[@]}" || rc=$?
  spinner_stop
  # The pool's own status, on the checkers' scale (`scripts/gate_pool.py :: main`).
  case "$rc" in
    0)   ;;
    130) on_interrupt ;;
    *)   on_error "$rc" "${BASH_LINENO[0]}" "scripts/gate_pool.py" ;;
  esac
  unset UNIT_STATUS UNIT_MS
  declare -gA UNIT_STATUS=() UNIT_MS=()
  # Before the redirect, whose own failure is a bare shell complaint that never reaches the
  # completeness check.
  [[ -r "${POOL_DIR}/manifest.tsv" ]] \
    || on_error 3 "${BASH_LINENO[0]}" "scripts/gate_pool.py left no manifest, so what its units did cannot be read (${POOL_DIR}/manifest.tsv)"
  while IFS=$'\t' read -r name status began ended; do
    UNIT_STATUS["$name"]="$status"
    UNIT_MS["$name"]=$(( ended - began ))
  done < "${POOL_DIR}/manifest.tsv"
  # By name, never by count: a row under the wrong name counts and leaves a unit unset, surfacing
  # only where something replays it.
  for name in "${want[@]}"; do
    if [[ -z "${UNIT_STATUS[$name]+set}" ]]; then missing+=" ${name}"; fi
  done
  if [[ -n "$missing" ]] || (( ${#UNIT_STATUS[@]} != ${#want[@]} )); then
    on_error 3 "${BASH_LINENO[0]}" "scripts/gate_pool.py answered for ${#UNIT_STATUS[@]} of ${#want[@]} unit(s)${missing:+, and for none of:${missing}}"
  fi
}

start_steps() { # $1 the scope flag their bodies' run is given · $2.. the checks
  local flag="$1" unit
  shift
  # Above the serial return: a run with no pool replays through the same call sites, so a unit with
  # none never runs in that form either.
  pool_units_replayed "$@"
  if (( ! STEP_JOBS )); then return 0; fi
  pool_open
  for unit in "$@"; do pool_add_step "$unit" "$flag"; done
  pool_wait 1 "$# check(s) running concurrently"
}

# A unit with no numeric status (`scripts/gate_pool.py :: NOT_STARTED`) reached no verdict: 3, the
# crash path.
unit_replay() { # $1 unit — its own output and exit status, wherever it ran
  # With no pool this IS the check, so `--verbose` and `--serial` share the call site rather than a
  # second path nobody reads.
  if (( ! STEP_JOBS )); then "do_$1"; return; fi
  local status="${UNIT_STATUS[$1]:-}"
  if [[ -s "${POOL_DIR}/${1}.out" ]]; then cat "${POOL_DIR}/${1}.out"; fi
  if [[ ! "$status" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "the ${1} check left no exit status behind (${status:-no row}), so it did not run to completion"
    return 3
  fi
  # `return` masks to a byte, and a Windows kill's 2304 masks to 0 and would read as a pass.
  # Classified before the mask, as `scripts/_lib.sh :: adopt_ending` classifies a scope's.
  if (( status > 255 )); then
    printf '%s\n' "the ${1} check ended on status ${status}, which is a kill rather than a verdict"
    return 3
  fi
  return "$status"
}

unit_join() { # $1 unit — re-date the step to the work's own length, which is not the wait for it
  if (( ! STEP_JOBS )); then return 0; fi
  local ms="${UNIT_MS[$1]:-}"
  if [[ "$ms" =~ ^[0-9]+$ ]]; then step_took_ms "$ms"; fi
}

unit_verdict() { # $1 unit · $2 the line to blame a crash on · $3 the remedy for a failure
  local rc=0
  quietly unit_replay "$1" || rc=$?
  case "$rc" in
    0)   ;;
    1)   die "$3" ;;
    130) on_interrupt ;;
    # `_STEP_LABEL`, not the unit name: a `step` line opens with its scope, and `selfcheck` names
    # none.
    *)   on_error "$rc" "$2" "${_STEP_LABEL:-$1}" ;;
  esac
}

# --- scope -------------------------------------------------------------------------------------------

# Before any scope runs: the same refusal after a `next build` has cost the minutes it exists to
# save. Parent only — the parent asks for the whole run, and a worker asking again would put
# another `scope` row in the table it replays into.
if ! worker; then
  section scope
  info "this run covers: ${SCOPES_RAN% }"

  # Here, not where the pool would have started: by then the scopes are already running.
  if (( POOL_FALLBACK )); then
    info "no python at the checkers' floor (\`scripts/checker_kernel.py :: PYTHON_FLOOR\`), so every
scope and every check runs one at a time — the same proof, at the cost of their sum rather than
their longest. \`cd fl_backend && uv sync --dev\` creates an interpreter that meets it."
  fi

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
      # Captured so the verdict below can count `scripts/check_scope.py :: check`'s report lines,
      # and printed, those being the useful half of a green answer.
      SCOPE_OUT="$("$SCOPE_PY" scripts/check_scope.py --ran "$SCOPES_RAN")" || SCOPE_RC=$?
      if [[ -n "$SCOPE_OUT" ]]; then printf '%s\n' "$SCOPE_OUT"; fi
      case "$SCOPE_RC" in
        # 0 is "nothing refuses this run", not "the run covers the change": an unproven surface
        # passes through as a `report` line (`scripts/checker_kernel.py :: report_findings`).
        0) SCOPE_UNPROVEN="$(printf '%s\n' "$SCOPE_OUT" | grep -c '^ *report  ' || true)"
           if (( SCOPE_UNPROVEN > 0 )); then
             ok "no file this branch changed refuses this run, and the ${SCOPE_UNPROVEN} report line(s) above
name a surface the run leaves unproven"
           else
             ok "the scopes named cover the change"
           fi ;;
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

if (( PARALLEL )); then
  # Closed before the pool, or the scope section's row reports the whole run's wall clock.
  end_section

  # Never `FORCE_COLOR` or `NO_COLOR`: prettier, pnpm and eslint each read those as instructions.
  # Only here: a scope is replayed to the parent's terminal, where a step's capture is read back
  # by the same `quietly` the serial run uses.
  if [[ -n "$C_RED" ]]; then export FL_GATE_COLOR=1; else export FL_GATE_COLOR=0; fi

  # Exported here alone: the scopes compete only in a pool, and elsewhere -- serial, verbose, a
  # worker, CI's one job per runner -- a tool keeps the optimum it was measured at.
  FL_GATE_BUDGET="$(nproc 2>/dev/null || printf '%s' "${NUMBER_OF_PROCESSORS:-0}")"
  if [[ ! "$FL_GATE_BUDGET" =~ ^[1-9][0-9]*$ ]]; then FL_GATE_BUDGET=0; fi
  # The self-check's 16 workers stay out of this sum. MEASURED 2026-09-02: counting them makes
  # demand 30 against 16 cores, cutting these two to 4 and 3, under the width each was measured
  # at, while the self-check still sets the scripts section.
  FL_GATE_DEMAND=0
  if (( RUN_SCRIPTS )); then FL_GATE_DEMAND=$(( FL_GATE_DEMAND + GATE_WIDTH_SCRIPTS_PYTEST )); fi
  if (( RUN_DB )); then FL_GATE_DEMAND=$(( FL_GATE_DEMAND + GATE_WIDTH_DB_PYTEST )); fi
  export FL_GATE_BUDGET FL_GATE_DEMAND

  pool_open
  for u_scope in "${SCOPE_ORDER[@]}"; do pool_add_scope "$u_scope"; done
  pool_wait 0 "${#SCOPE_ORDER[@]} scopes running concurrently"

  # One reader for both callers, or a ledgerless scope is unproven in the one and absent from the
  # table in the other.
  adopt_rows() { # $1 scope
    local scope="$1" rank ms findings advisories name
    if [[ ! -s "${POOL_DIR}/${scope}.ledger" ]]; then
      # A worker that died before it could write one. Rank 0 is what `finish` refuses to call
      # green, so the scope surfaces as unproven rather than as one that passed.
      adopt_section "$scope" 0 0 0 0
      return 0
    fi
    while IFS=$'\t' read -r rank ms findings advisories name; do
      adopt_section "$name" "$rank" "$ms" "$findings" "$advisories"
    done < "${POOL_DIR}/${scope}.ledger"
  }

  replay_scope() { # $1 scope
    local scope="$1" status="${UNIT_STATUS[$1]:-}"
    if [[ -s "${POOL_DIR}/${scope}.out" ]]; then cat "${POOL_DIR}/${scope}.out"; fi
    if [[ -s "${POOL_DIR}/${scope}.err" ]]; then cat "${POOL_DIR}/${scope}.err" >&2; fi
    adopt_rows "$scope"
    # Non-numeric is `scripts/gate_pool.py :: NOT_STARTED` or no row at all; a number here is
    # always one a real process returned.
    if [[ ! "$status" =~ ^[0-9]+$ ]]; then
      on_error 3 "${LINENO}" "scripts/gate_pool.py did not run the ${scope} scope (${status:-no row})"
    fi
    # Crash and interrupt end the run here, no row saying so; findings and a refusal are already
    # in the rows `finish` reads back.
    adopt_ending "$status" "the ${scope} scope"
    REPLAY_STATUS="$status"
  }

  # Past the first failure, rows alone: the table still tells a pass from a scope that never ran,
  # while the ending stays the failure's. A crash's rank-5 row would read as findings.
  adopt_finished() { # $1 scope
    local scope="$1" status="${UNIT_STATUS[$1]:-}"
    case "$status" in
      0|1|2) adopt_rows "$scope" ;;
      # Rank 0, for `adopt_rows`' reason: no row at all drops the scope out of the table.
      *)     adopt_section "$scope" 0 "${UNIT_MS[$scope]:-0}" 0 0 ;;
    esac
  }

  REPLAY_STATUS=0
  ENDING=0
  for u_scope in "${SCOPE_ORDER[@]}"; do
    if (( ! ENDING )); then replay_scope "$u_scope"; ENDING="$REPLAY_STATUS"; else adopt_finished "$u_scope"; fi
  done
  # After every row is in, so a refusal ahead of a later scope's findings still answers 1, the
  # definite verdict (`_RANK_LABELS`).
  if (( ENDING )); then finish; fi
  wrap_up
fi

# --- scripts ---------------------------------------------------------------------------------------

# First because it is instant, and because a broken script makes everything below it unreliable.
if (( RUN_SCRIPTS )); then
  section scripts

  # For `scripts/selfcheck.sh :: _ledger`'s reason.
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
    [[ "$declared" == "$records" ]] \
      || on_error 3 "${LINENO}" "scripts/selfcheck.sh left ${records} ledger record(s) under a closing count of '${declared:-none}'"
  }

  # Safe together: each writes only its own cache or a throwaway tree.
  start_steps --scripts selfcheck ruff pyright pytest

  step "scripts · selfcheck"
  unit_join selfcheck
  run_checker stop "scripts/selfcheck.sh" "scripts/selfcheck.sh failed — its findings are above." \
    unit_replay selfcheck
  replay_selfcheck
  if (( SELFCHECK_SKIPS )); then
    ok "scripts are internally consistent, apart from the ${SELFCHECK_SKIPS} check(s) skipped above"
  else
    ok "scripts are internally consistent"
  fi

  step "scripts · ruff  (lint, and format in check mode)"
  unit_join ruff
  unit_verdict ruff "${LINENO}" \
    "ruff failed in scripts/. Fix with:  fl_backend/.venv/Scripts/python -m ruff format scripts"
  ok "the gate's own python is clean"

  step "scripts · pyright"
  unit_join pyright
  unit_verdict pyright "${LINENO}" "pyright found type errors in scripts/.
These are the same errors Pylance shows in the editor."
  ok "the gate's own types are clean"

  # Every check `scripts/check_docs.py :: CHECKS` registers runs against a fixture repo (PRE-4).
  # pytest's own codes: 2 is a collection error, which `run_checker` would call a refusal.
  step "scripts · pytest  (the documentation gate's fixture net, and the kernel's floors)"
  unit_join pytest
  PYTEST_RC=0
  quietly unit_replay pytest || PYTEST_RC=$?
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
# other check here, and each still reads as though it means something.
if (( RUN_DOCS )); then
  section docs
  DOCS_OK=1

  # Safe together, for `do_conflict_markers`' reason.
  start_steps --docs "${DOCS_POOL[@]}"

  # Read first, and given no file list, so it reads the whole tracked tree rather than a branch's
  # diff: an unresolved conflict reaching main is what makes every finding below it unreliable.
  step "docs · no tracked file carries a conflict marker"
  unit_join conflict_markers
  if run_checker collect "scripts/check_conflict_markers.py" "A tracked file still holds a merge conflict marker. Each finding above names the
file and the line it stands on. Resolve the conflict and commit the resolution." \
    unit_replay conflict_markers; then
    ok "no tracked file carries a conflict marker"
  else
    DOCS_OK=0
  fi

  # They collect rather than stop: stopping at the first leaves the commit messages unexamined
  # while the exit code reads as though they were checked.
  step "docs · citations, links and shapes"
  unit_join docs_gate
  # `annotate`, for `run_checker`'s reason.
  if run_checker annotate "scripts/check_docs.py" "The documentation gate failed. Each finding above names its file
and what no longer resolves. Checks: scripts/docs_gate/kernel.py :: CHECKS" \
    unit_replay docs_gate; then
    ok "documentation references resolve"
  else
    DOCS_OK=0
  fi

  # Commit messages ride in this scope rather than one of their own; the argument is in
  # `scripts/check_commits.py`'s own header.
  step "docs · commit messages on this branch"
  unit_join commit_messages
  if run_checker collect "scripts/check_commits.py" "The commit message gate failed. Each finding above names the
commit and what is wrong with it. The form is docs/_git/templates.md." \
    unit_replay commit_messages; then
    ok "commit messages follow the convention"
  else
    DOCS_OK=0
  fi

  # `openapi.json` publishes every endpoint and model docstring as a `description`, so a reword
  # edits it -- and `check_scope.py` reads that edit as comment-only, asking for this scope and
  # not `--backend`, where the pytest case covering it lives.

  # Needs no database and no environment: `build_test_config` supplies the settings. The backend
  # virtualenv it does need is already this scope's prerequisite, above.

  step "docs · openapi.json matches the docstrings it publishes"
  unit_join openapi
  if run_checker collect "fl_backend/tests/openapi_document.py" "The published document no longer matches the models and docstrings it
is built from. Regenerate it with:  cd fl_backend && .venv/Scripts/python -m tests.openapi_document --write" \
    unit_replay openapi; then
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

  # First, for `BACKEND_SERIAL`'s reason.
  step "backend · uv  (manifest and lockfile agree)"
  if command -v uv >/dev/null 2>&1; then
    quietly do_backend_lock \
      || die "fl_backend/uv.lock no longer answers pyproject.toml. Fix with:  cd fl_backend && uv lock
-- then commit the lockfile."
    ok "manifest and lockfile agree"
  else
    skip "uv is not on PATH, so the backend lockfile was not checked against its manifest"
  fi

  # Below the lockfile check, for `BACKEND_SERIAL`'s reason; each writes only its own cache.
  start_steps --backend "${BACKEND_POOL[@]}"

  step "backend · ruff  (lint, and format in check mode)"
  unit_join backend_ruff
  unit_verdict backend_ruff "${LINENO}" \
    "ruff failed in fl_backend. Fix with:  cd fl_backend && .venv/Scripts/python -m ruff format app tests"
  ok "ruff clean"

  # ruff checks no types, and pytest only what it executes.
  step "backend · pyright"
  unit_join backend_pyright
  unit_verdict backend_pyright "${LINENO}" "pyright found type errors in fl_backend.
These are the same errors Pylance shows in the editor."
  ok "no type errors"

  step "backend · pytest  (default tier)"
  unit_join backend_pytest
  unit_verdict backend_pytest "${LINENO}" "fl_backend tests failed."
  ok "default-tier tests pass"
fi

# --- format ----------------------------------------------------------------------------------------

# Its own scope, not the frontend's first step: prettier governs markdown, YAML and the compose
# files too, and a branch touching only those still owes the check.
if (( RUN_FORMAT )); then
  section format

  # Check mode, never write: a gate that reformats measured a tree the author never saw. Never
  # pooled: the frontend pool opens below this section, after `next typegen` rewrites a file
  # prettier reads.
  step "format · prettier  (check mode — this gate never writes)"
  # No cause asserted: an unformatted file and a pnpm that would not start fail alike, and only
  # the capture above knows which.
  quietly do_prettier \
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
  # `--frozen-lockfile` makes `--lockfile-only`'s write impossible rather than unlikely: pnpm's
  # own words are "don't generate a lockfile and fail if an update is needed".
  quietly do_lockfile \
    || die "fl_frontend's manifest and lockfile disagree — the packages are named above.
Fix with:  cd fl_frontend && pnpm install  -- then commit the lockfile."
  ok "manifest and lockfile agree"

  # A `FRONTEND_WRITERS` entry, for that list's reason.
  step "frontend · next typegen  (the ambient types tsc checks against)"
  run_writer typegen || die "next typegen failed — its own output is above."
  ok "route types generated"

  # Readers only: each writes its own cache, and the audit is a network call touching nothing.
  start_steps --frontend "${FRONTEND_POOL[@]}"

  step "frontend · tsc"
  unit_join typecheck
  unit_verdict typecheck "${LINENO}" "tsc found type errors."
  ok "no type errors"

  step "frontend · eslint"
  unit_join eslint
  unit_verdict eslint "${LINENO}" "eslint failed."
  ok "lint clean"

  # Advisory, not fatal: something published upstream overnight must not block an unrelated merge.
  # Never `unit_verdict`, which turns this check's 1 into `die`.
  step "frontend · dependency audit  (runtime advisories only)"
  unit_join audit
  # pnpm audit answers 1 for an advisory and 0 otherwise; every other status is a check that made
  # none, `unit_replay`'s 3 included. An else-arm would close the scope green over one.
  AUDIT_RC=0
  quietly unit_replay audit || AUDIT_RC=$?
  case "$AUDIT_RC" in
    0)   ok "no known runtime vulnerabilities" ;;
    1)   warn "runtime advisories present — triage with: cd fl_frontend && pnpm audit" ;;
    130) on_interrupt ;;
    *)   on_error "$AUDIT_RC" "${LINENO}" "pnpm audit:prod" ;;
  esac

  # Alone and before the build: the tests already run one process per core less one, and the
  # build takes every core.
  step "frontend · unit tests"
  # The runner's own codes, not the kernel's: 1 is a failing test, and anything else -- no test file
  # collected, a crashed worker -- is a run that reached no verdict.
  UNIT_TESTS_RC=0
  quietly do_unit_tests || UNIT_TESTS_RC=$?
  case "$UNIT_TESTS_RC" in
    0) ;;
    1) die "frontend unit tests failed." ;;
    130) on_interrupt ;;
    *) on_error "$UNIT_TESTS_RC" "${LINENO}" "pnpm test" ;;
  esac
  ok "unit tests pass"

  # A writer, and last: it also writes `.next/`, which tsconfig.json's `include` covers.
  step "frontend · next build"
  run_writer next_build || die "next build failed."
  ok "build succeeds"
fi

# --- ops -------------------------------------------------------------------------------------------

# The compose files, the nginx config and the GitHub Actions surface have no compiler and no test
# suite. Without this scope a typo in the first two reaches the server, and a weakness in the third
# reaches a run.
if (( RUN_OPS )); then
  section ops

  # In ops rather than beside actionlint in `scripts`, the longest section of a full-form run; a
  # workflow is deployment configuration, which is what this scope checks.
  step "ops · zizmor audits the GitHub Actions surface"

  # zizmor's severity scale -- 11 to 14 findings, 1 its own failure -- inverts `run_checker`'s, so
  # it is translated to `scripts/checker_kernel.py :: run`'s.
  run_zizmor() {
    local rc=0
    # The root, not a file list: zizmor's default collection reaches a workflow added anywhere.

    # `--offline` spelled out: a token in the environment otherwise turns on rules that reach the
    # network.

    # `--strict-collection`, or a malformed `.github/dependabot.yml` is a warning zizmor exits 0
    # on, and nothing else in this repository reads that file.
    "$1" --offline --strict-collection --persona regular . || rc=$?
    case "$rc" in
      0) return 0 ;;
      11|12|13|14) return 1 ;;
      # Its own arm, or the `*` arm below reports Ctrl-C as a fault of the check.
      130) return 130 ;;
      *) return 3 ;;
    esac
  }

  # `venv_python`'s directory holds the venv's console scripts on either platform; zizmor is a
  # binary, not a module, so nothing goes in front of it.
  OPS_ZIZMOR="$(venv_python || true)"
  if [[ -z "$OPS_ZIZMOR" ]]; then
    skip "no fl_backend virtualenv, so the GitHub Actions surface was not audited"
  else
    run_checker stop "zizmor" "zizmor found a finding in the GitHub Actions surface. Each one above names its file
and its rule. A rule this repository cannot act on belongs in zizmor.yml with the reason
written at the rule, never suppressed at this call site." \
      run_zizmor "${OPS_ZIZMOR%/*}/zizmor"
    ok "the workflows, the composite actions and the Dependabot config are clean"
  fi

  step "ops · compose files parse"
  # Compose refuses to parse a file whose env_file is missing, so each file is parsed from a
  # scratch copy beside stand-in .envs -- never the real trees, which the backend, db and
  # frontend scopes read while they run. The EXIT trap removes the scratch.
  OPS_SCRATCH="$(mktemp -d)"
  mkdir -p "${OPS_SCRATCH}/fl_backend" "${OPS_SCRATCH}/fl_frontend"
  cp docker-compose.yml docker-compose.local.yml "${OPS_SCRATCH}/"
  : > "${OPS_SCRATCH}/fl_backend/.env"
  : > "${OPS_SCRATCH}/fl_frontend/.env"
  quietly docker compose -f "${OPS_SCRATCH}/docker-compose.yml" config --quiet \
    || die "docker-compose.yml does not parse."
  quietly docker compose -f "${OPS_SCRATCH}/docker-compose.local.yml" config --quiet \
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

  # A parse cannot see a log line, so nothing else here asserts what the access line CONTAINS
  # (`docs/logging/spec.md` L11). Below `nginx -t`, whose pull this reuses rather than paying twice.
  step "ops · the edge's access log carries no credential"
  # `nginx/local.conf` alone: prod.conf terminates TLS and could not serve a request without a
  # certificate, and its copy of the maps and the `log_format` is held in step by hand.
  run_checker stop "nginx/redaction_test.sh" "A credential reached an access line. Each failing case above is what nginx WROTE,
and nginx/local.conf's map blocks are what decide it." \
    bash nginx/redaction_test.sh
  ok "every spelling in the table logged with its token and address gone"
fi

# --- db --------------------------------------------------------------------------------------------

# Split from the default tier because it needs the Docker daemon the quick scope exists to avoid.
# Without it a change breaking the pipeline against a real mongod passes every local gate.
if (( RUN_DB )); then
  section db

  # `loadfile` for cost, not isolation: `fl_backend/tests/worker.py :: worker_database` is what
  # isolates, so `--dist load` would hold too.

  # Both mongods are shared (`fl_backend/tests/conftest.py :: pytest_configure_node`), so past
  # `GATE_WIDTH_DB_PYTEST` the workers fight over the same servers whatever the core count.
  step "db · pytest -m db, distributed over the two shared mongods"
  DB_WIDTH="$(gate_width "$GATE_WIDTH_DB_PYTEST")"
  # pytest answers its own codes, not this gate's: 2 is a collection error, 4 a usage error and 5
  # no test collected, and none is a db-tier failure. The width flag is the live route to a 4, an
  # empty one otherwise reading as the tests having failed.
  DB_RC=0
  ( cd fl_backend && quietly "$PY" -m pytest -m db -n auto --dist loadfile --maxprocesses "$DB_WIDTH" ) || DB_RC=$?
  case "$DB_RC" in
    0) ;;
    1) die "fl_backend db-tier tests failed.
testcontainers starts and removes mongo:8 itself; a failure here is the code, not the daemon.
Re-run without \`-n auto --dist loadfile --maxprocesses ${DB_WIDTH}\` to see whether distribution is what broke it." ;;
    130) on_interrupt ;;
    *) on_error "$DB_RC" "${LINENO}" "pytest -m db" ;;
  esac
  ok "db-tier tests pass"
fi

# --- images ----------------------------------------------------------------------------------------

# The EXIT trap reclaims this run's tags where it can. A kill leaves one behind, the signal
# reaching the unit's shell rather than the `docker build` under it.
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

  # Together: separate tags and separate cache scopes, so the scope costs the slower build.
  start_steps --images build_frontend build_backend

  step "images · docker build frontend  (the check the frontend scope cannot do)"
  unit_join build_frontend
  unit_verdict build_frontend "${LINENO}" \
    "The frontend image failed to build. This is the failure the frontend scope cannot see."
  ok "frontend image builds"

  step "images · docker build backend"
  unit_join build_backend
  unit_verdict build_backend "${LINENO}" "The backend image failed to build."
  ok "backend image builds"

  step "images · instrumentation.js is actually in the frontend image"
  # From the repo root this file compiles but is not traced into the standalone output, which
  # silently disables the startup env gate and onRequestError.

  # 1 is the test's answer, higher is docker's and says nothing about the file: refused, as
  # `scripts/publish.sh` grades the same probe. 130 is neither, here or below.
  PROBE_RC=0
  quietly docker run --rm --entrypoint sh "${VERIFY_TAG}:frontend" -c '[ -f .next/server/instrumentation.js ]' || PROBE_RC=$?
  if (( PROBE_RC == 0 )); then
    ok "instrumentation.js present — env gate and error logging will run"
  elif (( PROBE_RC == 1 )); then
    die "instrumentation.js is MISSING from the image. It must live at fl_frontend/src/instrumentation.ts, not the repo root."
  elif (( PROBE_RC == 130 )); then on_interrupt
  else
    refuse "the probe container did not run (exit ${PROBE_RC}), so whether instrumentation.js reached
the image is unknown. Ask the image directly:
  docker run --rm --entrypoint sh ${VERIFY_TAG}:frontend -c 'ls .next/server'"
  fi

  step "images · neither image runs as root"
  # Graded as the probe above: a `die` would send the reader to a USER line that is fine.
  IMAGE_USER_RC=0
  quietly do_image_user || IMAGE_USER_RC=$?
  if (( IMAGE_USER_RC == 0 )); then
    ok "both images drop to an unprivileged user"
  elif (( IMAGE_USER_RC == 1 )); then
    die "An image runs as root, which a build reports as success. The USER
line in that image's Dockerfile is what sets it; the capture above names which image."
  elif (( IMAGE_USER_RC == 130 )); then on_interrupt
  else
    refuse "an image would not run (exit ${IMAGE_USER_RC}), so the user it drops to was never read
and nothing here judges either USER line. The capture above names the image. Ask it directly:
  docker run --rm --entrypoint sh ${VERIFY_TAG}:frontend -c 'id -u'"
  fi

  step "images · the dockerignore kept its promise about the build context"
  # Graded as the probes above: an image that would not run is a context never read, which is not
  # a dockerignore that stopped covering it.
  IMAGE_CONTEXT_RC=0
  quietly do_image_context || IMAGE_CONTEXT_RC=$?
  if (( IMAGE_CONTEXT_RC == 0 )); then
    ok "no environment file, key, certificate or npm configuration reached either image"
  elif (( IMAGE_CONTEXT_RC == 1 )); then
    die "A build context carried a file its dockerignore exists to exclude.
The capture above names the image and the path inside it."
  elif (( IMAGE_CONTEXT_RC == 130 )); then on_interrupt
  else
    refuse "an image would not run (exit ${IMAGE_CONTEXT_RC}), so its build context was never read
and nothing here judges either dockerignore. The capture above names the image."
  fi
fi

# --- summary ---------------------------------------------------------------------------------------
wrap_up
