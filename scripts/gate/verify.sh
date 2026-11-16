#!/usr/bin/env bash
#
# SCRIPTS · the pre-merge gate — every scope, or the scopes a run names.
#
# Never writes, but `next build` rewrites the tracked `fl_frontend/tsconfig.json` when a
# `compilerOptions` key is absent; the frontend CI job diffs that path.
#
#   ./scripts/gate/verify.sh                   every scope, side by side — the run a pull request is called ready to merge on
#   ./scripts/gate/verify.sh --scripts --docs --backend --format --frontend-units --frontend --ops --db --images
#   ./scripts/gate/verify.sh --quick           the scripts, backend and frontend scopes alone, the scripts scope needing Docker for shellcheck and actionlint
#   ./scripts/gate/verify.sh --verbose         stream each tool's own output instead of capturing it
#   ./scripts/gate/verify.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

SCOPES=(scripts docs backend format frontend-units frontend ops db images)
declare -A RUN=() KNOWN=()
for scope in "${SCOPES[@]}"; do KNOWN[$scope]=1; done
for arg in "$@"; do
  case "$arg" in
    --quick)   RUN[scripts]=1; RUN[backend]=1; RUN[frontend]=1 ;;
    # Exported, so a scope run beside others streams too.
    --verbose) export VERBOSE=1 ;;
    --help|-h) usage ;;
    *)
      if [[ "$arg" == --* && -n "${KNOWN[${arg#--}]:-}" ]]; then RUN[${arg#--}]=1
      else refuse "Unknown option: ${arg}. Try --help."; fi ;;
  esac
done
if (( ${#RUN[@]} == 0 )); then
  for scope in "${SCOPES[@]}"; do RUN[$scope]=1; done
fi
# In the written order, whatever order the flags came in.
SELECTED=()
for scope in "${SCOPES[@]}"; do
  if [[ -n "${RUN[$scope]:-}" ]]; then SELECTED+=("$scope"); fi
done

# --- several scopes: each its own run of this script, side by side ---------------------------------

# Every scope reads the tree and writes only its own caches, so they run together and the run costs
# the longest rather than the sum. Each run's row prints as it ends, and its whole output is captured
# and replayed in the written order once every run has ended.
RUNS_DIR=""
# The runs not yet reaped. A reaped run's group id is free for the system to reuse, so it is never
# signalled again.
declare -A PID=()
# Every process a run started, its tools among them, gets the SIGINT a terminal's Ctrl-C hands a lone
# run: a run's shell signalled alone defers its trap until its tool ends, and the tool hears nothing.
# Waited on, so no run outlives the gate.
stop_runs() {
  local pid
  for pid in "${PID[@]}"; do kill -INT -- "-${pid}" 2>/dev/null || true; done
  for pid in "${PID[@]}"; do wait "$pid" 2>/dev/null || true; done
  if [[ -n "$RUNS_DIR" ]]; then rm -rf "$RUNS_DIR" || true; fi
}

if (( ${#SELECTED[@]} > 1 )); then
  trap stop_runs EXIT
  RUNS_DIR="$(mktemp -d)"
  # A run's stdout is a file, so it cannot tell a terminal is waiting for its colours.
  if [[ -n "$C_RED" ]]; then export FL_GATE_COLOR=1; else export FL_GATE_COLOR=0; fi
  # pnpm writes and deletes a probe file in its store's directory, which the format scope's walk can
  # list and then fail to read; handed its store, pnpm writes none.
  if [[ -n "${RUN[format]:-}" ]]; then
    export pnpm_config_store_dir
    pnpm_config_store_dir="$(cd fl_frontend && pnpm store path)"
  fi

  declare -A SCOPE_OF=() ROW=()
  started="$(_now_ms)"
  # Job control while the runs start, and only then: each run leads a process group of its own, which
  # `stop_runs` signals whole, and takes SIGINT and SIGQUIT as a lone run does, where bash would start
  # it with both ignored and a non-interactive shell can never trap a signal ignored on entry. A
  # terminal's Ctrl-C reaches this script alone, and its exit hands the signal on through `stop_runs`.
  # Stdin is the empty file a run had without job control, never the terminal, which a background
  # group reading it would stop on.
  set -m
  for scope in "${SELECTED[@]}"; do
    # Its count of findings in a file of its own, which the library reads at start-up.
    FL_GATE_FINDINGS_FILE="${RUNS_DIR}/${scope}.findings" "$BASH" "$SELF" "--${scope}" \
      < /dev/null > "${RUNS_DIR}/${scope}.log" 2>&1 &
    PID[$scope]=$!
    SCOPE_OF[$!]=$scope
  done
  set +m

  info "running side by side: $(IFS=' '; printf '%s' "${SELECTED[*]}")"
  for scope in "${SELECTED[@]}"; do
    ROW[$scope]=${#ROW[@]}
    add_row "$scope"
  done
  # In the order they end: `wait -n -p`, bash 5.1's, names the run it reaped. Each run's own exit
  # code is its row's verdict, and its count of findings fills the row's column alone: a run that
  # counted a finding and then refused ends as the refusal it ended on alone.
  declare -A RANK_OF=([0]=1 [1]=4 [2]=3 [3]=5 [130]=6)
  while (( ${#PID[@]} )); do
    rc=0
    wait -n -p reaped || rc=$?
    scope="${SCOPE_OF[$reaped]}"
    unset 'PID[$scope]'
    # A run that ended before its closing statement left no count, and found nothing it could report.
    count=0
    if [[ -s "${RUNS_DIR}/${scope}.findings" ]]; then read -r count < "${RUNS_DIR}/${scope}.findings"; fi
    class=0
    exit_class contract "$rc" || class=$?
    end_row "${ROW[$scope]}" "${RANK_OF[$class]}" "$(( $(_now_ms) - started ))" "$count"
  done
  for scope in "${SELECTED[@]}"; do cat "${RUNS_DIR}/${scope}.log"; done

  if (( ${#SELECTED[@]} == ${#SCOPES[@]} )); then finish --what "every scope" "Safe to merge."; fi
  finish --what "${#SELECTED[@]} scopes"
fi

# --- one scope ------------------------------------------------------------------------------------

SCOPE="${SELECTED[0]}"

# A command's status read into the exit contract through the `EXIT_CODES` tables `--exits` names
# (`pytest` under `--pytest`, and none by default): what it found is a finding, what it could not
# judge a refusal, anything else a crash. `--summary` is for a tool raising an annotation per
# finding itself under Actions, as Vitest does: what is said then sums them, `fail --summary`.
# `--annotated` is for a script on this library, which annotates its own findings, refusals and
# crashes, so none is raised again. `--pytest` raises those annotations for pytest, one per case its
# summary names.
check() { # [--exits <tables>] [--summary | --annotated | --pytest] $1 what to say on a finding · the command
  local said rc=0 command
  local -a flags=()
  while [[ "$1" == --exits || "$1" == --summary || "$1" == --annotated || "$1" == --pytest ]]; do
    if [[ "$1" == --exits ]]; then flags+=("$1" "$2"); shift 2; else flags+=("$1"); shift; fi
  done
  said="$1"; shift
  # Joined on spaces here: `$*` joins on the repository's IFS, a newline, and a crash would print the
  # command one word to a line.
  printf -v command '%s ' "$@"
  quietly --exits "$(exits_of "${flags[@]}")" "$@" || rc=$?
  verdict "${flags[@]}" "$said" "$rc" "${BASH_LINENO[0]}" "${command% }"
}

# The tables `check`'s and `beside_verdict`'s flags name: `--exits`'s, else `pytest` under `--pytest`,
# else none, which `exit_class` answers as a crash.
exits_of() { # the flags
  local exits="" pytest=0
  while (( $# )); do
    case "$1" in
      --exits) exits="$2"; shift ;;
      --pytest) pytest=1 ;;
    esac
    shift
  done
  if [[ -z "$exits" ]] && (( pytest )); then exits=pytest; fi
  printf '%s' "$exits"
}

# `check`'s reading of a status the command has already answered, its output in `QUIETLY_OUTPUT`.
verdict() { # [--exits <tables>] [--summary | --annotated | --pytest] $1 what to say on a finding · $2 the status · $3 the caller's line · $4 the command
  local exits pytest=0 class=0
  local -a summary=() annotated=()
  exits="$(exits_of "$@")"
  if [[ "$1" == --exits ]]; then shift 2; fi
  if [[ "$1" == --summary ]]; then summary=(--summary); shift; fi
  if [[ "$1" == --annotated ]]; then summary=(--summary); annotated=(--summary); shift; fi
  if [[ "$1" == --pytest ]]; then pytest=1; shift; fi
  settle "${annotated[@]}" "$exits" "$2" "$3" "$4" "$QUIETLY_OUTPUT" || class=$?
  case "$class" in
    0) return 0 ;;
    1) if (( pytest )) && annotate_cases; then summary=(--summary); fi
       fail "${summary[@]}" "$1"; return 1 ;;
    2) refuse "${annotated[@]}" "${_STEP_LABEL} could not judge its input, so nothing here stands as a verdict on the
change. Its own reason is above (exit status $2)." ;;
  esac
}

# pytest's short summary gives each case that failed or errored a line of its own, `FAILED <case>` or
# `ERROR <case>` and any reason after it, at the end of a log the step's fold hides: each becomes an
# annotation through `_annotate`, so the run page names the case. Answers 1 where no line names one.
annotate_cases() {
  local line found=1
  while IFS= read -r line; do
    if [[ "$line" == "FAILED "* || "$line" == "ERROR "* ]]; then
      _annotate "${_STEP_LABEL}: ${line}"
      found=0
    fi
  done <<< "$QUIETLY_OUTPUT"
  return "$found"
}

in_dir() { # $1 the directory · the command
  local dir="$1"
  shift
  ( cd "$dir" && "$@" )
}

ruff_both() { # $1 the directory · the paths
  local dir="$1"
  shift
  ( cd "$dir" && "$PY" -m ruff check "$@" && "$PY" -m ruff format --check "$@" )
}

# A command run beside others, its output kept in `$1.log` and its status, with the milliseconds it
# took, in `$1.status`. Bash starts an `&` command of a script with SIGINT and SIGQUIT ignored,
# which would leave a step running past a Ctrl-C, so both are reset. Called in a subshell, so the
# reset never reaches the scope's own shell.
run_beside() { # $1 where its files go · the command
  local at="$1" t0 rc=0
  shift
  trap - INT QUIT
  t0="$(_now_ms)"
  "$@" > "${at}.log" 2>&1 || rc=$?
  printf '%s %s\n' "$rc" "$(( $(_now_ms) - t0 ))" > "${at}.status"
}

# A command `run_beside` ran, read under the open step as `check` reads its own: its output where
# it failed, or under `--verbose` whole, since two steps streaming at once would interleave. The
# step's time is the command's own rather than the moment its step was printed.
beside_verdict() { # $1 its files · [--exits <tables>] [--summary | --annotated | --pytest] $2 what to say on a finding · $3 the command, as a crash names it
  local at="$1" rc=3 ms=0 class=0
  local -a said=()
  shift
  # A command that left no status ended before it could write one, which reads as a crash.
  # Split on the space `run_beside` writes, which the repository's IFS leaves out.
  if [[ -f "${at}.status" ]]; then IFS=' ' read -r rc ms < "${at}.status"; fi
  QUIETLY_OUTPUT=""
  if [[ -f "${at}.log" ]]; then QUIETLY_OUTPUT="$(<"${at}.log")"; fi
  _STEP_MS0=$(( $(_now_ms) - ms ))
  exit_class "$(exits_of "$@")" "$rc" "$QUIETLY_OUTPUT" || class=$?
  if (( VERBOSE || class )); then mapfile -t said <<<"$QUIETLY_OUTPUT"; detail "${said[@]}"; fi
  verdict "${@:1:$#-1}" "$rc" "${BASH_LINENO[0]}" "${!#}"
}

# By file, so a module's fixtures stay on one worker; a stalled case's stack is dumped inside every CI
# job's timeout. Under pytest-xdist a test module that does not collect is a failure, where pytest alone
# answers it with its interrupt's 2. Each `--maxprocesses` below is its suite's optimum on 16 cores.
PYTEST_SPREAD=(-n auto --dist loadfile -o faulthandler_timeout=180)

case "$SCOPE" in
  docs|ops|db|images) require_docker ;;
esac
# Compose is a plugin of the Docker CLI, so an engine that answers is no proof it is installed, and
# without it every compose file would read as one that does not parse.
if [[ "$SCOPE" == ops ]]; then
  docker compose version >/dev/null 2>&1 \
    || refuse "Docker Compose did not answer 'docker compose version', so no compose file was parsed.
Install the Compose plugin, or start Docker Desktop, which carries it, then try again."
fi
case "$SCOPE" in
  scripts|format|frontend-units|frontend|db)
    require_dir fl_frontend/node_modules "Every frontend tool runs out of it. Install it with:  cd fl_frontend && pnpm install"
    # pnpm's dependency check (`verifyDepsBeforeRun`) runs on every `pnpm run` and `pnpm exec`, so
    # one exec answers for every step below before any of them runs.
    quietly in_dir fl_frontend pnpm exec node -e "" \
      || refuse "pnpm would not start a command in fl_frontend: node_modules does not answer the manifest
and lockfile, or pnpm itself did not start (its own words are above). Fix with:  cd fl_frontend && pnpm install" ;;
esac
PY=""
case "$SCOPE" in
  scripts|backend|ops|db)
    PY="$(venv_python)" || refuse "No fl_backend virtualenv found. Create it with:  uv sync --project fl_backend --dev"
    # On a runner the job's own `uv sync --locked` has just run. `--frozen`, so the virtualenv is held to
    # the lockfile alone: whether the lockfile answers pyproject.toml is the change's, which the backend
    # scope's `uv lock --check` reports as a finding.
    if [[ -z "${GITHUB_ACTIONS:-}" ]]; then
      quietly uv sync --project fl_backend --dev --check --frozen \
        || refuse "fl_backend/.venv does not match fl_backend/uv.lock, so a finding here would be about this
machine rather than the change. Sync it with:  uv sync --project fl_backend --dev --frozen"
    fi ;;
esac

# --- scripts ---------------------------------------------------------------------------------------

scope_scripts() {
  section scripts
  step "scripts · selfcheck"
  check --exits contract --annotated "scripts/gate/selfcheck.sh found the findings above." bash scripts/gate/selfcheck.sh \
    && ok "the shell scripts parse, are executable in git and lint clean, and the workflows lint clean"

  step "scripts · ruff  (lint, and format in check mode)"
  check --exits ruff "ruff failed in scripts. Fix with:  uv run --project fl_backend ruff format scripts" ruff_both . scripts \
    && ok "the gate's own python is clean"

  # From inside scripts/, where pyright finds its config; no PyPI release lookup, uv.lock pins what runs.
  step "scripts · pyright"
  check --exits pyright "pyright found type errors in scripts." in_dir scripts env PYRIGHT_PYTHON_IGNORE_WARNINGS=1 "$PY" -m pyright \
    && ok "the gate's own types are clean"

  step "scripts · pytest"
  check --pytest "pytest over scripts/tests failed; the failing test names which." \
    "$PY" -m pytest scripts/tests "${PYTEST_SPREAD[@]}" --maxprocesses 8 \
    && ok "the scripts' own tests pass"
  return 0
}

# --- docs ------------------------------------------------------------------------------------------

# Offline, every link and fragment inside the repository, through the pinned image with no network;
# links leaving it are no part of this gate.
check_links() { # $1 the image
  MSYS_NO_PATHCONV=1 docker run --rm --network none -v "$(mount_source):/input:ro" -w /input \
    "$1" --config lychee.toml --no-progress .
}

scope_docs() {
  local image
  section docs
  step "docs · every link and fragment inside the repository resolves"
  image="$(tool_image lychee)" \
    || die "${TOOLS_FILE} names no single FROM line for lychee, so no link was checked."
  check --exits docker+lychee "lychee names each broken link or fragment above, with the file it stands in." check_links "$image" \
    && ok "every link inside the repository resolves"
  return 0
}

# --- backend ---------------------------------------------------------------------------------------

scope_backend() {
  section backend
  # First and alone: every tool below runs out of the virtualenv this lockfile describes.
  step "backend · uv  (manifest and lockfile agree)"
  check --exits uv "fl_backend/uv.lock no longer answers pyproject.toml. Fix with:  cd fl_backend && uv lock  -- then commit the lockfile." \
    in_dir fl_backend uv lock --check || finish
  ok "manifest and lockfile agree"

  step "backend · ruff  (lint, and format in check mode)"
  check --exits ruff "ruff failed in fl_backend. Fix with:  cd fl_backend && uv run ruff format app tests" ruff_both fl_backend app tests \
    && ok "ruff clean"

  step "backend · pyright"
  check --exits pyright "pyright found type errors in fl_backend." in_dir fl_backend env PYRIGHT_PYTHON_IGNORE_WARNINGS=1 "$PY" -m pyright \
    && ok "no type errors"

  # No server starts: the controller starts none for the default tier's own `-m`.
  step "backend · pytest  (default tier)"
  check --pytest "fl_backend tests failed." in_dir fl_backend "$PY" -m pytest "${PYTEST_SPREAD[@]}" --maxprocesses 6 \
    && ok "default-tier tests pass"

  # `app/` alone, deptry's default: `tests/` imports the dev group by design.
  step "backend · deptry  (what app/ imports against what the manifest declares)"
  check --exits deptry "fl_backend/pyproject.toml and what app/ imports disagree. The finding above names the package and its rule (https://deptry.com/rules-violations/)." \
    in_dir fl_backend "$PY" -m deptry . \
    && ok "the manifest declares what app/ imports"
  return 0
}

# --- format ----------------------------------------------------------------------------------------

# Its own scope: prettier governs markdown, YAML and the compose files too.
scope_format() {
  section format
  step "format · prettier  (check mode — this gate never writes)"
  check --exits pnpm+prettier "Prettier names the unformatted files above. Fix with:  cd fl_frontend && pnpm format  -- then commit the result." \
    in_dir fl_frontend pnpm format:check \
    && ok "the tree is formatted"

  # markdownlint-cli2 is installed beside Prettier, and reads its configuration from the root.
  step "format · markdownlint"
  check --exits pnpm+markdownlint "markdownlint names each finding above with its file, line and rule." in_dir fl_frontend pnpm run lint:md \
    && ok "the Markdown keeps its rules"

  # The empty tree against the working tree: every tracked file is read whole, and a shallow clone
  # needs no history for it.
  step "format · no conflict marker or whitespace error in any tracked file"
  check --exits git-diff-check "A tracked file above carries a conflict marker or a whitespace error, each named by its line." \
    git diff --check "$(git hash-object -t tree /dev/null)" \
    && ok "no conflict marker or whitespace error"

  # Every tracked text file, for the zero-width, bidirectional and line-separator characters that hide
  # or reorder what a reviewer reads (CVE-2021-42574), the Arabic letter mark U+061C the one
  # bidirectional mark outside U+2000's block, and the other invisible ones the address fixtures type:
  # the soft hyphen U+00AD, U+180E, the word joiner U+2060 and U+FEFF. Those fixtures write each as an
  # escape. A UTF-8 locale, which `-P` needs to read a code point past U+00FF.
  step "format · no invisible or bidirectional character in any tracked file"
  check --exits git-grep "A tracked file above carries an invisible or bidirectional character, each named by its line." \
    env LC_ALL=C.UTF-8 git grep -I -n -P \
    '[\x{00AD}\x{061C}\x{180E}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}\x{2066}-\x{2069}\x{2028}\x{2029}\x{FEFF}]' \
    -- . \
    && ok "no invisible or bidirectional character"
  return 0
}

# --- frontend-units --------------------------------------------------------------------------------

scope_frontend_units() {
  section frontend-units
  step "frontend-units · unit tests"
  check --exits pnpm+vitest --summary "frontend unit tests failed." in_dir fl_frontend pnpm test \
    && ok "unit tests pass"
  return 0
}

# --- frontend --------------------------------------------------------------------------------------

# tsc answers 2 for the errors it found where it wrote its build information and 1 where that was
# current already (`ExitStatus.DiagnosticsPresent_OutputsGenerated`, `_OutputsSkipped`), and 1 too
# where it stopped before there was a program to check, a project path it could not read among
# them, as Node does for an uncaught exception. So its words decide: an error at a file's line and
# column is a finding, and a failure naming none is no verdict on the change.
typecheck() {
  local rc=0 out line
  out="$(in_dir fl_frontend pnpm typecheck:only 2>&1)" || rc=$?
  printf '%s\n' "$out"
  case "$rc" in
    0) return 0 ;;
    1|2)
      while IFS= read -r line; do
        if [[ "$line" =~ \([0-9]+,[0-9]+\):\ error\ TS[0-9]+: ]]; then return 1; fi
      done <<< "$out"
      return 3 ;;
    *) return "$rc" ;;
  esac
}

# Global, for the EXIT trap, which runs after the scope has returned.
FRONTEND_STEPS=""

# Every step before the build but typegen reads the tree and writes nothing another step reads, so
# those run side by side, each into its own capture, and report in the written order once all have
# ended.
scope_frontend() {
  section frontend
  trap 'rm -rf ${FRONTEND_STEPS:+"$FRONTEND_STEPS"}' EXIT
  FRONTEND_STEPS="$(mktemp -d)"
  local at="$FRONTEND_STEPS" typegen=3 pid
  local -a running=()
  # The lockfile's three checks read the manifest and the lockfile alone, so they run beside every
  # step before the build. `--frozen-lockfile` makes `--lockfile-only`'s write impossible, and the
  # repeat-install shortcut would answer from mtimes rather than from the manifest.
  ( run_beside "${at}/frozen" in_dir fl_frontend pnpm install --frozen-lockfile --lockfile-only --no-optimistic-repeat-install ) &
  running+=("$!")
  ( run_beside "${at}/peers" in_dir fl_frontend pnpm peers check ) &
  running+=("$!")
  ( run_beside "${at}/dedupe" in_dir fl_frontend pnpm dedupe --check ) &
  running+=("$!")
  # The route types tsc checks against; it rewrites tsconfig.json where a key is absent, so it ends
  # before any reader of that file starts.
  ( run_beside "${at}/typegen" in_dir fl_frontend pnpm typegen )
  if [[ -f "${at}/typegen.status" ]]; then IFS=' ' read -r typegen _ < "${at}/typegen.status"; fi
  if (( typegen == 0 )); then
    ( run_beside "${at}/tsc" typecheck ) &
    running+=("$!")
    ( run_beside "${at}/eslint" in_dir fl_frontend pnpm lint:only ) &
    running+=("$!")
    ( run_beside "${at}/knip" in_dir fl_frontend pnpm knip ) &
    running+=("$!")
    ( run_beside "${at}/knip-prod" in_dir fl_frontend pnpm knip:prod ) &
    running+=("$!")
  fi
  # Every step ended before the first verdict, since a crash's verdict ends the scope where it stands.
  for pid in "${running[@]}"; do wait "$pid" || true; done

  step "frontend · pnpm  (manifest and lockfile agree)"
  beside_verdict "${at}/frozen" --exits pnpm "fl_frontend's lockfile no longer answers its manifest or pnpm-workspace.yaml — pnpm names what differs above.
Fix with:  cd fl_frontend && pnpm install  -- then commit the lockfile." \
    "pnpm install --frozen-lockfile --lockfile-only --no-optimistic-repeat-install" \
    && ok "manifest and lockfile agree"

  # `strictPeerDependencies` refuses an out-of-range peer only while `pnpm install` resolves.
  step "frontend · pnpm  (every peer in range)"
  beside_verdict "${at}/peers" --exits pnpm+pnpm-peers "fl_frontend's lockfile installs a peer outside the range a package asks for — pnpm names it above." \
    "pnpm peers check" \
    && ok "every peer in range"

  # `pnpm add` keeps every copy the lockfile already pins, so an added range can leave two copies of
  # one package, and two copies of React Aria split the contexts its components share.
  step "frontend · pnpm  (no copy a dedupe would remove)"
  beside_verdict "${at}/dedupe" --exits pnpm "fl_frontend's lockfile holds a copy a dedupe would remove — pnpm names each change above.
Fix with:  cd fl_frontend && pnpm dedupe  -- then commit the lockfile." \
    "pnpm dedupe --check" \
    && ok "no copy a dedupe would remove"

  step "frontend · next typegen"
  beside_verdict "${at}/typegen" --exits pnpm+next "next typegen failed — its own output is above." "pnpm typegen" || finish
  ok "route types generated"

  step "frontend · tsc"
  beside_verdict "${at}/tsc" --exits contract "tsc found type errors." "pnpm typecheck:only" && ok "no type errors"

  step "frontend · eslint"
  beside_verdict "${at}/eslint" --exits pnpm+eslint "eslint failed." "pnpm lint:only" && ok "lint clean"

  step "frontend · knip  (unused files, exports and dependencies)"
  beside_verdict "${at}/knip" --exits pnpm+knip "knip found something nothing uses, named above. Delete it, or name the reader knip cannot see in fl_frontend/knip.json." \
    "pnpm knip" \
    && ok "nothing unused"

  step "frontend · knip, production  (what only tests still read)"
  beside_verdict "${at}/knip-prod" --exits pnpm+knip "knip's production run found code only tests still read, named above. Delete it with the cases testing it,
or name production code knip cannot see in fl_frontend/knip.production.json." \
    "pnpm knip:prod" \
    && ok "nothing only tests read"

  # After every reader of tsconfig.json: it writes `.next/`, which that file's `include` covers. No
  # environment is set for the build, so the startup gate's validation is skipped, as the image's
  # builder skips it.
  step "frontend · next build"
  check --exits pnpm+next "next build failed." in_dir fl_frontend env SKIP_ENV_VALIDATION=true NEXT_TELEMETRY_DISABLED=1 pnpm build \
    && ok "build succeeds"
  return 0
}

# --- ops -------------------------------------------------------------------------------------------

OPS_SCRATCH=""
cleanup_ops() { if [[ -n "$OPS_SCRATCH" ]]; then rm -rf "$OPS_SCRATCH" || true; fi; }

# The release is the backend lockfile's, from the `zizmor` dependency group. Its wheel installs the
# program alone, with no module `-m` could run, so it runs from beside the interpreter.
run_zizmor() {
  local bin="${PY%/*}/zizmor"
  local -a network=(--offline)
  [[ -x "$bin" ]] || bin="${PY%/*}/zizmor.exe"
  # Online under Actions alone, with the job's read-only token, where the audits reading GitHub's API
  # run: an action pinned to a commit gets no Dependabot alert, so `known-vulnerable-actions` is what
  # names one. Offline everywhere else, or a token in a person's environment turns those audits on.
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then network=(); fi
  # `--strict-collection`, or a malformed `.github/dependabot.yml` is a warning it exits 0 on.
  "$bin" "${network[@]}" --strict-collection --persona regular .
}

# The compose files, the nginx configuration and the GitHub Actions surface have no compiler and no
# test suite: without this scope a typo in either of the first two reaches the server.
scope_ops() {
  section ops
  trap cleanup_ops EXIT
  OPS_SCRATCH="$(mktemp -d)"

  step "ops · zizmor audits the GitHub Actions surface"
  check --exits zizmor "zizmor found a finding in the GitHub Actions surface, each naming its file and rule. A rule this
repository cannot act on belongs in zizmor.yml with its reason, never suppressed at this call site." run_zizmor \
    && ok "the workflows, the composite actions and the Dependabot config are clean"

  # A scratch copy, never the real trees, which other scopes read while they run.
  step "ops · compose files parse"
  stage_compose_models "$OPS_SCRATCH"
  render_compose_model "$OPS_SCRATCH" production || die "docker-compose.yml does not parse."
  render_compose_model "$OPS_SCRATCH" local || die "docker-compose.local.yml does not merge over docker-compose.yml."
  render_compose_model "$OPS_SCRATCH" e2e || die "docker-compose.e2e.yml does not merge over the local stack."
  ok "the three stacks parse"

  # A parse accepts a published port and a database alike.
  step "ops · what each stack exposes, mounts, trusts, hands out and keeps"
  check --exits contract "A stack exposes, mounts, trusts, hands out or keeps more than the rule it breaks allows. The
findings above name the service and the rule." \
    "$PY" scripts/lib/checker_kernel.py scripts/checks/check_compose_model.py \
    "${OPS_SCRATCH}/production.json" "${OPS_SCRATCH}/local.json" "${OPS_SCRATCH}/e2e.json" \
    && ok "each stack publishes, mounts, trusts and holds only what its rules allow"

  step "ops · every route handler, link page and metadata convention is metered at the edge"
  check --exits contract "The route accounting is out. Each finding above names the handler, the location or the reason." \
    "$PY" scripts/lib/checker_kernel.py scripts/checks/check_public_routes.py \
    && ok "every route handler is accounted for at the edge"

  step "ops · every address, site and telephone number a test invents is a reserved one"
  check --exits contract "A test invents a value a third party may hold. Each finding above names the file, the line and the value." \
    "$PY" scripts/lib/checker_kernel.py scripts/checks/check_invented_data.py \
    && ok "every invented address, site and number is reserved"

  # A parse sees neither a log line nor a response, and both edges starting is the parse.
  step "ops · the edge starts, logs no credential and sends every security header once"
  check --exits contract --annotated "The running edge failed a case. Each failing case above is what nginx WROTE or SENT, and the
files under nginx/shared/ decide it." bash scripts/checks/edge_test.sh \
    && ok "the edge logged and sent every case as written"
  return 0
}

# --- db --------------------------------------------------------------------------------------------

CONTRACT_PATHS=(fl_backend/openapi.json fl_frontend/src/core/generated)
# Beside the tree, never in it, since the other scopes read the committed files while this check
# runs; inside the repository, so Orval's Prettier pass finds the repository's config.
CONTRACT_SCRATCH=.tmp-contract

# The published document regenerated from the routes and models, the client regenerated from that,
# both into the scratch folder, and each compared with the tree's: a route, a model or a docstring the
# committed files do not hold is a finding. An untracked file in the tree's folders is one a
# generation added and nobody committed, which the comparison alone would pass. A generator that fails
# reaches no verdict, and neither does a comparison git could not make.
contract_check() {
  local rc=0 untracked i class
  # Each committed path beside the one regenerated into the scratch folder.
  local -a compared=(fl_backend/openapi.json "${CONTRACT_SCRATCH}/openapi.json"
    fl_frontend/src/core/generated "${CONTRACT_SCRATCH}/generated")
  rm -rf "$CONTRACT_SCRATCH" && mkdir "$CONTRACT_SCRATCH" || return 3
  in_dir fl_backend "$PY" -m app.openapi_document "../${CONTRACT_SCRATCH}/openapi.json" || return 3
  ( cd fl_frontend && CONTRACT_SCRATCH="../${CONTRACT_SCRATCH}" pnpm exec orval --fail-on-warnings ) || return 3
  untracked="$(git ls-files --others --exclude-standard -- "${CONTRACT_PATHS[@]}")"
  if [[ -n "$untracked" ]]; then printf 'Not committed:\n%s\n' "$untracked"; rc=1; fi
  for (( i = 0; i < ${#compared[@]}; i += 2 )); do
    class=0
    git diff --no-index -- "${compared[i]}" "${compared[i + 1]}" || exit_class git-diff "$?" || class=$?
    if (( class == 1 )); then rc=1; elif (( class )); then return "$class"; fi
  done
  return "$rc"
}

# Global, for the EXIT trap, which runs after the scope has returned.
DB_TIERS=""

# Split from the default tier because it needs the Docker daemon the quick scope avoids.
scope_db() {
  section db
  trap 'rm -rf "$CONTRACT_SCRATCH" ${DB_TIERS:+"$DB_TIERS"}' EXIT
  # Side by side, each into its own capture: the tiers share no container, each starting its own on
  # ports Docker picks, and the contract check writes only its scratch folder.
  DB_TIERS="$(mktemp -d)"
  local contract backend frontend
  # This scope because it alone has both the backend's virtualenv and the frontend's install.
  ( run_beside "${DB_TIERS}/contract" contract_check ) &
  contract=$!
  # `loadfile` for isolation too: the commit fail points' cases set the server's one
  # `failCommand`, so they run one after another on one worker.
  ( run_beside "${DB_TIERS}/backend" in_dir fl_backend "$PY" -m pytest -m db "${PYTEST_SPREAD[@]}" --maxprocesses 6 ) &
  backend=$!
  # Each file starts its own replica set through `@testcontainers/mongodb`.
  ( run_beside "${DB_TIERS}/frontend" in_dir fl_frontend pnpm run test:db ) &
  frontend=$!
  wait "$contract" || true
  wait "$backend" || true
  wait "$frontend" || true

  step "db · the contract and its generated client match the code they are built from"
  beside_verdict "${DB_TIERS}/contract" --exits contract "The committed contract no longer matches the code it is generated from; the diff above names each file.
Fix with:  (cd fl_frontend && pnpm run contract)  -- then commit both." "contract_check" \
    && ok "the contract and the client are current"

  step "db · pytest -m db, distributed over one shared replica set"
  beside_verdict "${DB_TIERS}/backend" --pytest "fl_backend db-tier tests failed. A failing test and a mongo that never started both end here: each case's
own message above says which." "pytest -m db" \
    && ok "db-tier tests pass"

  step "db · the frontend's *.db.test.ts files"
  beside_verdict "${DB_TIERS}/frontend" --exits pnpm+vitest --summary "fl_frontend db-tier tests failed. A failing test and a mongo that never started both end here: each file's
own message above says which." "pnpm run test:db" \
    && ok "frontend db-tier tests pass"
  return 0
}

# --- images ----------------------------------------------------------------------------------------

# Global, for the EXIT trap, which runs after the scope has returned. The default carries this run's
# pid, so the images a local run removes on the way out are its own.
IMAGES_TAG="${VERIFY_TAG:-frankfurtleague-verify-$$}"
cleanup_images() { docker image rm -f "${IMAGES_TAG}:frontend" "${IMAGES_TAG}:backend" >/dev/null 2>&1 || true; }

# Both in one bake of the definition CI builds, so each target's context, Dockerfile and arguments are
# `docker-bake.hcl`'s alone. Only where they land is this run's: loaded into the local image store
# under this run's tag through `--set`, where CI writes the tarballs its publish pushes.
build_images() {
  check --exits buildx "The images failed to build — the failure the frontend scope cannot see. Docker's own output above names the target." \
    docker buildx bake --file docker-bake.hcl --set '*.output=type=docker' \
    --set "frontend.tags=${IMAGES_TAG}:frontend" --set "backend.tags=${IMAGES_TAG}:backend" \
    frontend backend || finish
}

# What a successful build does not prove, asked of each image. In CI the workflow builds both in one
# bake through `docker/bake-action`, which carries the layer cache, and hands them over by `VERIFY_TAG`.
scope_images() {
  section images
  if [[ -z "${VERIFY_IMAGES_BUILT:-}" ]]; then
    trap cleanup_images EXIT
    step "images · docker buildx bake frontend backend"
    build_images
    ok "both images build"
  fi

  # Each assertion answers 1 for what it found, and for a probe that did not run the class Docker's
  # own status reads as.
  step "images · instrumentation.js is in the frontend image"
  check --exits contract "instrumentation.js is MISSING from the image. It must live at fl_frontend/src/instrumentation.ts, not the repository root." \
    image_has_instrumentation "${IMAGES_TAG}:frontend" \
    && ok "instrumentation.js present — the environment gate and error logging will run"

  step "images · neither image runs as root"
  check --exits contract "An image runs as root, which a build reports as success. The USER line in that image's Dockerfile sets it." \
    image_runs_unprivileged "${IMAGES_TAG}:frontend" "${IMAGES_TAG}:backend" \
    && ok "both images drop to an unprivileged user"

  step "images · the dockerignore kept its promise about the build context"
  check --exits contract "A build context carried a file its dockerignore exists to exclude, named above." \
    image_context_clean "${IMAGES_TAG}:frontend" "${IMAGES_TAG}:backend" \
    && ok "no environment file, key, certificate or npm configuration reached either image"
  return 0
}

"scope_${SCOPE//-/_}"
finish
