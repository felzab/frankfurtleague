#!/usr/bin/env bash
#
# SCRIPTS · the pre-merge gate — every scope, or the scopes a run names.
#
# Never writes, but `next typegen` rewrites the tracked `fl_frontend/tsconfig.json` when a
# `compilerOptions` key is absent; the frontend CI job diffs that path.
#
#   ./scripts/gate/verify.sh                   every scope, side by side — the run a pull request is called ready to merge on
#   ./scripts/gate/verify.sh --scripts --docs --backend --format --frontend-units --frontend --ops --db --images
#   ./scripts/gate/verify.sh --quick           the scripts, backend and frontend scopes alone, the scripts scope needing Docker for shellcheck and actionlint
#   ./scripts/gate/verify.sh --verbose         stream each tool's own output instead of capturing it
#   ./scripts/gate/verify.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh" || exit 3

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
  # list and then fail to read; handed its store, pnpm writes none. Where pnpm cannot name it, no store
  # is handed on, and the format scope's own start-up guard, which asks pnpm to start, gives the verdict.
  store=""
  if [[ -n "${RUN[format]:-}" ]] && store="$(pnpm --dir fl_frontend store path 2>/dev/null)"; then
    export pnpm_config_store_dir="$store"
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
  while (( ${#PID[@]} )); do
    rc=0
    wait -n -p reaped || rc=$?
    scope="${SCOPE_OF[$reaped]}"
    unset 'PID[$scope]'
    # A run that ended before its closing statement left no count, and found nothing it could report.
    count=0
    if [[ -s "${RUNS_DIR}/${scope}.findings" ]]; then read -r count < "${RUNS_DIR}/${scope}.findings"; fi
    # The exit contract's classes, any other code a crash.
    case "$rc" in 0|1|2|130) class="$rc" ;; *) class=3 ;; esac
    end_row "${ROW[$scope]}" "${RANK_OF_CLASS[$class]}" "$(( $(_now_ms) - started ))" "$count"
  done
  for scope in "${SELECTED[@]}"; do cat "${RUNS_DIR}/${scope}.log"; done

  if (( ${#SELECTED[@]} == ${#SCOPES[@]} )); then finish --what "every scope" "Safe to merge."; fi
  finish --what "${#SELECTED[@]} scopes"
fi

# --- one scope ------------------------------------------------------------------------------------

SCOPE="${SELECTED[0]}"

# A command's status read into the exit contract: 0 a pass, 1 what it found, 130 an interrupt, and
# anything else a tool that never reached a verdict. `--checker` adds the 2 by which a program on the
# contract, a script of this repository or a checker of ours, says it could not judge its input.
# `--summary` is for a tool raising an annotation per finding itself under Actions, as Vitest and a
# script on this library do: what is said then sums them. `--pytest` raises those annotations for
# pytest, one per case its summary names (`annotate_cases`).
check() { # [--checker] [--summary | --pytest] $1 what to say on a finding · the command
  local said rc=0 command
  local -a flags=()
  while [[ "$1" == --checker || "$1" == --summary || "$1" == --pytest ]]; do flags+=("$1"); shift; done
  said="$1"; shift
  # Joined on spaces here: `$*` joins on the repository's IFS, a newline, and a crash would print the
  # command one word to a line.
  printf -v command '%s ' "$@"
  quietly "$@" || rc=$?
  verdict "${flags[@]}" "$said" "$rc" "${BASH_LINENO[0]}" "${command% }"
}

# pnpm answers 1 for a registry it could not reach, an offline run without the metadata it needs and a
# registry answering an HTTP error alike, each of which judged nothing, and its error reference
# (https://pnpm.io/errors) says the code, never the message, is what a script matches on.
PNPM_UNREACHED='ERR_PNPM_(META_FETCH_FAIL|NO_OFFLINE_META|FETCH_[0-9]+)'

# `check`'s reading of a status the command has already answered, its output in `QUIETLY_OUTPUT`.
verdict() { # [--checker] [--summary | --pytest] $1 what to say on a finding · $2 the status · $3 the caller's line · $4 the command
  local checker=0 pytest=0
  local -a summary=()
  if [[ "$1" == --checker ]]; then checker=1; shift; fi
  if [[ "$1" == --summary ]]; then summary=(--summary); shift; fi
  if [[ "$1" == --pytest ]]; then pytest=1; shift; fi
  case "$2" in
    0) return 0 ;;
    1) if [[ " $4 " == *" pnpm "* ]]; then
         if [[ "$QUIETLY_OUTPUT" =~ $PNPM_UNREACHED ]]; then
           refuse "pnpm could not read the registry, so ${_STEP_LABEL} judged nothing. Its own reason is above."
         fi
         # A script the manifest does not declare, so no tool ran at all.
         if [[ "$QUIETLY_OUTPUT" == *ERR_PNPM_NO_SCRIPT* ]]; then on_error "$2" "$3" "$4"; fi
       fi
       if (( pytest )) && annotate_cases; then summary=(--summary); fi
       fail "${summary[@]}" "$1"; return 1 ;;
    2) if (( checker )); then
         refuse "${summary[@]}" "${_STEP_LABEL} could not judge its input, so nothing here stands as a verdict on the
change. Its own reason is above."
       fi ;;
    130) on_interrupt ;;
  esac
  on_error "$2" "$3" "$4"
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

# A directory it cannot enter answers 3, a crash: cd's own 1 would read as the tool's finding.
in_dir() { # $1 the directory · the command
  local dir="$1"
  shift
  ( cd -- "$dir" || exit 3; "$@" )
}

# ruff's lint, then its formatter in check mode, over the paths named from inside `$1`.
ruff_both() { # $1 the directory · the paths
  local dir="$1"
  shift
  ( cd -- "$dir" || exit 3; "$PY" -m ruff check "$@" && "$PY" -m ruff format --check "$@" )
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
beside_verdict() { # $1 its files · [--checker] [--summary | --pytest] $2 what to say on a finding · $3 the command, as a crash names it
  local at="$1" rc=3 ms=0
  local -a said=()
  shift
  # A command that left no status ended before it could write one, which reads as a crash.
  # Split on the space `run_beside` writes, which the repository's IFS leaves out.
  if [[ -f "${at}.status" ]]; then IFS=' ' read -r rc ms < "${at}.status"; fi
  QUIETLY_OUTPUT=""
  if [[ -f "${at}.log" ]]; then QUIETLY_OUTPUT="$(<"${at}.log")"; fi
  _STEP_MS0=$(( $(_now_ms) - ms ))
  if (( VERBOSE || rc )); then mapfile -t said <<<"$QUIETLY_OUTPUT"; detail "${said[@]}"; fi
  verdict "${@:1:$#-1}" "$rc" "${BASH_LINENO[0]}" "${!#}"
}

# A stalled case's stack is dumped inside every CI job's timeout. Each suite's own configuration says
# how its cases spread over the workers. Under pytest-xdist a test module that does not collect is a
# failure, where pytest alone answers it with its interrupt's 2. Each `--maxprocesses` below is its
# suite's optimum on 16 cores.
PYTEST_SPREAD=(-n auto -o faulthandler_timeout=180)

case "$SCOPE" in
  docs|ops|db|images) require_docker ;;
esac
if [[ "$SCOPE" == ops ]]; then require_compose; fi
case "$SCOPE" in
  format|frontend-units|frontend|db)
    require_dir fl_frontend/node_modules "Every frontend tool runs out of it. Install it with:  cd fl_frontend && pnpm install"
    require_pnpm_starts ;;
esac
PY=""
case "$SCOPE" in
  scripts|backend|ops|db)
    PY="$(venv_python)" || refuse "No fl_backend virtualenv found. Create it with:  uv sync --project fl_backend --dev"
    # On a runner the job's own `uv sync --locked` has just run.
    if [[ -z "${GITHUB_ACTIONS:-}" ]]; then require_synced_venv; fi ;;
esac

# --- scripts ---------------------------------------------------------------------------------------

scope_scripts() {
  section scripts
  step "scripts · selfcheck"
  check --checker --summary "scripts/gate/selfcheck.sh found the findings above." bash scripts/gate/selfcheck.sh \
    && ok "the shell scripts parse, are executable in git and lint clean, and the workflows lint clean"

  step "scripts · ruff  (lint, and format in check mode)"
  check "ruff failed in scripts. Fix with:  uv run --project fl_backend ruff format scripts" ruff_both . scripts \
    && ok "the gate's own python is clean"

  # From inside scripts/, where pyright finds its config; no PyPI release lookup, uv.lock pins what runs.
  step "scripts · pyright"
  check "pyright found type errors in scripts." in_dir scripts env PYRIGHT_PYTHON_IGNORE_WARNINGS=1 "$PY" -m pyright \
    && ok "the gate's own types are clean"

  step "scripts · pytest"
  check --pytest "pytest over scripts/tests failed; the failing test names which." \
    "$PY" -m pytest scripts/tests "${PYTEST_SPREAD[@]}" --maxprocesses 8 \
    && ok "the scripts' own tests pass"
  return 0
}

# --- docs ------------------------------------------------------------------------------------------

# Offline, every link and fragment inside the repository, through the pinned image with no network;
# links leaving it are no part of this gate. lychee answers 2 for a broken link and 1 for its own
# failure (its README, "Exit codes").
check_links() { # $1 the image · $2 the checkout as a mount source
  local rc=0
  MSYS_NO_PATHCONV=1 docker run --rm --network none -v "${2}:/input:ro" -w /input \
    "$1" --config lychee.toml --no-progress . || rc=$?
  case "$rc" in 1) return 3 ;; 2) return 1 ;; esac
  return "$rc"
}

scope_docs() {
  local image checkout
  section docs
  step "docs · every link and fragment inside the repository resolves"
  image="$(tool_image lychee)" \
    || die "${TOOLS_FILE} names no single FROM line for lychee, so no link was checked."
  checkout="$(mount_source)"
  check "lychee names each broken link or fragment above, with the file it stands in." \
    check_links "$image" "$checkout" \
    && ok "every link inside the repository resolves"
  return 0
}

# --- backend ---------------------------------------------------------------------------------------

scope_backend() {
  section backend
  # First and alone: every tool below runs out of the virtualenv this lockfile describes.
  step "backend · uv  (manifest and lockfile agree)"
  check "fl_backend/uv.lock no longer answers pyproject.toml. Fix with:  cd fl_backend && uv lock  -- then commit the lockfile." \
    in_dir fl_backend uv lock --check || finish
  ok "manifest and lockfile agree"

  step "backend · ruff  (lint, and format in check mode)"
  check "ruff failed in fl_backend. Fix with:  cd fl_backend && uv run ruff format app tests" ruff_both fl_backend app tests \
    && ok "ruff clean"

  step "backend · pyright"
  check "pyright found type errors in fl_backend." in_dir fl_backend env PYRIGHT_PYTHON_IGNORE_WARNINGS=1 "$PY" -m pyright \
    && ok "no type errors"

  # No server starts: the controller starts none for the default tier's own `-m`.
  step "backend · pytest  (default tier)"
  check --pytest "fl_backend tests failed." in_dir fl_backend "$PY" -m pytest "${PYTEST_SPREAD[@]}" --maxprocesses 6 \
    && ok "default-tier tests pass"

  # `app/` alone, deptry's default: `tests/` imports the dev group by design.
  step "backend · deptry  (what app/ imports against what the manifest declares)"
  check "fl_backend/pyproject.toml and what app/ imports disagree. The finding above names the package and its rule (https://deptry.com/rules-violations/)." \
    in_dir fl_backend "$PY" -m deptry . \
    && ok "the manifest declares what app/ imports"
  return 0
}

# --- format ----------------------------------------------------------------------------------------

# Its own scope: prettier governs markdown, YAML and the compose files too.
scope_format() {
  section format
  step "format · prettier  (check mode, so it reports on the tree it was pointed at)"
  check "Prettier names the unformatted files above. Fix with:  cd fl_frontend && pnpm format  -- then commit the result." \
    in_dir fl_frontend pnpm format:check \
    && ok "the tree is formatted"

  # markdownlint-cli2 is installed beside Prettier, and reads its configuration from the root.
  step "format · markdownlint"
  check "markdownlint names each finding above with its file, line and rule." in_dir fl_frontend pnpm run lint:md \
    && ok "the Markdown keeps its rules"

  step "format · no conflict marker or whitespace error in any tracked file"
  check "A tracked file above carries a conflict marker or a whitespace error, each named by its line." diff_check \
    && ok "no conflict marker or whitespace error"

  step "format · no invisible or bidirectional character in any tracked file"
  check "A tracked file above carries an invisible or bidirectional character, each named by its line." invisible_check \
    && ok "no invisible or bidirectional character"
  return 0
}

# The empty tree against the working tree: every tracked file is read whole, and a shallow clone
# needs no history for it. With --check, git answers 2 for what it found.
diff_check() {
  local empty rc=0
  empty="$(git hash-object -t tree /dev/null)" || return 3
  git diff --check "$empty" || rc=$?
  if (( rc == 2 )); then return 1; fi
  return "$rc"
}

# Every tracked text file, for the zero-width, bidirectional and line-separator characters that hide
# or reorder what a reviewer reads (CVE-2021-42574), the Arabic letter mark U+061C the one
# bidirectional mark outside U+2000's block, and the other invisible ones the address fixtures type:
# the soft hyphen U+00AD, U+180E, the word joiner U+2060 and U+FEFF. Those fixtures write each as an
# escape. A UTF-8 locale, which `-P` needs to read a code point past U+00FF. git grep answers 0 for a
# match, which is what it found, and 1 for none.
invisible_check() {
  local rc=0
  LC_ALL=C.UTF-8 git grep -I -n -P \
    '[\x{00AD}\x{061C}\x{180E}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}\x{2066}-\x{2069}\x{2028}\x{2029}\x{FEFF}]' \
    -- . || rc=$?
  case "$rc" in
    0) return 1 ;;
    1) return 0 ;;
  esac
  return "$rc"
}

# --- frontend-units --------------------------------------------------------------------------------

scope_frontend_units() {
  section frontend-units
  step "frontend-units · unit tests"
  check --summary "frontend unit tests failed." in_dir fl_frontend pnpm test \
    && ok "unit tests pass"
  return 0
}

# --- frontend --------------------------------------------------------------------------------------

# tsc answers 2 for the errors it found where it wrote its build information and 1 where that was
# current already, and 1 too where it stopped before there was a program to check, as Node does for an
# uncaught exception. So its words decide: an error at a file's line and column is a finding, and a
# failure naming none is no verdict on the change.
typecheck() {
  local rc=0 out
  out="$(in_dir fl_frontend pnpm typecheck:only 2>&1)" || rc=$?
  printf '%s\n' "$out"
  case "$rc" in
    1|2) if [[ "$out" =~ \([0-9]+,[0-9]+\):\ error\ TS[0-9]+: ]]; then return 1; fi
         return 3 ;;
  esac
  return "$rc"
}

# Global, for the EXIT trap, which runs after the scope has returned.
FRONTEND_STEPS=""

# Every step but typegen reads the tree and writes nothing another step reads, so
# those run side by side, each into its own capture, and report in the written order once all have
# ended.
scope_frontend() {
  section frontend
  trap 'rm -rf ${FRONTEND_STEPS:+"$FRONTEND_STEPS"}' EXIT
  FRONTEND_STEPS="$(mktemp -d)"
  local at="$FRONTEND_STEPS" typegen=3 pid
  local -a running=()
  # The lockfile's three checks read the manifest and the lockfile alone, so they run beside every
  # other step. `--frozen-lockfile` makes `--lockfile-only`'s write impossible, and the
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
  beside_verdict "${at}/frozen" "fl_frontend's lockfile no longer answers its manifest or pnpm-workspace.yaml — pnpm names what differs above.
Fix with:  cd fl_frontend && pnpm install  -- then commit the lockfile." \
    "pnpm install --frozen-lockfile --lockfile-only --no-optimistic-repeat-install" \
    && ok "manifest and lockfile agree"

  # `strictPeerDependencies` refuses an out-of-range peer only while `pnpm install` resolves.
  step "frontend · pnpm  (every peer in range)"
  beside_verdict "${at}/peers" "fl_frontend's lockfile installs a peer outside the range a package asks for — pnpm names it above." \
    "pnpm peers check" \
    && ok "every peer in range"

  # `pnpm add` keeps every copy the lockfile already pins, so an added range can leave two copies of
  # one package, and two copies of React Aria split the contexts its components share.
  step "frontend · pnpm  (no copy a dedupe would remove)"
  beside_verdict "${at}/dedupe" "fl_frontend's lockfile holds a copy a dedupe would remove — pnpm names each change above.
Fix with:  cd fl_frontend && pnpm dedupe  -- then commit the lockfile." \
    "pnpm dedupe --check" \
    && ok "no copy a dedupe would remove"

  step "frontend · next typegen"
  beside_verdict "${at}/typegen" "next typegen failed — its own output is above." "pnpm typegen" || finish
  ok "route types generated"

  step "frontend · tsc"
  beside_verdict "${at}/tsc" "tsc found type errors." "pnpm typecheck:only" && ok "no type errors"

  step "frontend · eslint"
  beside_verdict "${at}/eslint" "eslint failed." "pnpm lint:only" && ok "lint clean"

  step "frontend · knip  (unused files, exports and dependencies)"
  beside_verdict "${at}/knip" "knip found something nothing uses, named above. Delete it, or name the reader knip cannot see in fl_frontend/knip.json." \
    "pnpm knip" \
    && ok "nothing unused"

  step "frontend · knip, production  (what only tests still read)"
  beside_verdict "${at}/knip-prod" "knip's production run found code only tests still read, named above. Delete it with the cases testing it,
or name production code knip cannot see in fl_frontend/knip.production.json." \
    "pnpm knip:prod" \
    && ok "nothing only tests read"
  return 0
}

# --- ops -------------------------------------------------------------------------------------------

OPS_SCRATCH=""
cleanup_ops() { if [[ -n "$OPS_SCRATCH" ]]; then rm -rf "$OPS_SCRATCH" || true; fi; }

# The release is the backend lockfile's, from its dev group. Its wheel installs the
# program alone, with no module `-m` could run, so it runs from beside the interpreter.
# zizmor answers 11 to 14 for findings by their highest severity, and 1 for an error during the audit
# (its usage page, "Exit codes").
run_zizmor() {
  local bin="${PY%/*}/zizmor" rc=0
  local -a network=(--offline)
  [[ -x "$bin" ]] || bin="${PY%/*}/zizmor.exe"
  # Online under Actions alone, with the job's read-only token, where the audits reading GitHub's API
  # run: an action pinned to a commit gets no Dependabot alert, so `known-vulnerable-actions` is what
  # names one. Offline everywhere else, or a token in a person's environment turns those audits on.
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then network=(); fi
  # `--strict-collection`, or a malformed `.github/dependabot.yml` is a warning it exits 0 on.
  "$bin" "${network[@]}" --strict-collection --persona regular . || rc=$?
  case "$rc" in 1) return 3 ;; 11|12|13|14) return 1 ;; esac
  return "$rc"
}

# The compose files, the nginx configuration and the GitHub Actions surface have no compiler and no
# test suite: without this scope a typo in either of the first two reaches the server.
scope_ops() {
  section ops
  trap cleanup_ops EXIT
  OPS_SCRATCH="$(mktemp -d)"

  step "ops · zizmor audits the GitHub Actions surface"
  check "zizmor found a finding in the GitHub Actions surface, each naming its file and rule. A rule this
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
  check --checker "A stack exposes, mounts, trusts, hands out or keeps more than the rule it breaks allows. The
findings above name the service and the rule." \
    "$PY" scripts/checks/check_compose_model.py \
    "${OPS_SCRATCH}/production.json" "${OPS_SCRATCH}/local.json" "${OPS_SCRATCH}/e2e.json" \
    && ok "each stack publishes, mounts, trusts and holds only what its rules allow"

  step "ops · every route handler, link page and metadata convention is metered at the edge"
  check --checker "The route accounting is out. Each finding above names the handler, the location or the reason." \
    "$PY" scripts/checks/check_public_routes.py \
    && ok "every route handler is accounted for at the edge"

  # A parse sees neither a log line nor a response, and both edges starting is the parse.
  step "ops · the edge starts, logs no credential and sends every security header once"
  check --checker --summary "The running edge failed a case. Each failing case above is what nginx WROTE or SENT, and the
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
# generation added and nobody committed, which the comparison alone would pass. A generator that fails,
# or exits 0 having written nothing, reaches no verdict, and neither does a comparison git could not
# make. Orval answers 1 for a warning under `--fail-on-warnings` and for its own failure alike. Run
# beside the db tiers, where bash suspends `set -e`, so every step's failure is returned explicitly.
contract_check() {
  local rc=0 untracked i diff
  # Each committed path beside the one regenerated into the scratch folder.
  local -a compared=(fl_backend/openapi.json "${CONTRACT_SCRATCH}/openapi.json"
    fl_frontend/src/core/generated "${CONTRACT_SCRATCH}/generated")
  rm -rf "$CONTRACT_SCRATCH" || return 3
  mkdir "$CONTRACT_SCRATCH" || return 3
  in_dir fl_backend "$PY" -m app.openapi_document "../${CONTRACT_SCRATCH}/openapi.json" || return 3
  CONTRACT_SCRATCH="../${CONTRACT_SCRATCH}" pnpm --dir fl_frontend exec orval --fail-on-warnings || return
  untracked="$(git ls-files --others --exclude-standard -- "${CONTRACT_PATHS[@]}")" || return 3
  if [[ -n "$untracked" ]]; then printf 'Not committed:\n%s\n' "$untracked"; rc=1; fi
  for (( i = 0; i < ${#compared[@]}; i += 2 )); do
    # git answers a path it cannot access with a difference's 1: a regenerated one missing is the
    # generator's failure, and a committed one missing is the change's, which the diff would name.
    if [[ ! -e "${compared[i + 1]}" ]]; then printf '%s\n' "${compared[i + 1]} was not generated."; return 3; fi
    if [[ ! -e "${compared[i]}" ]]; then printf 'Not committed:\n%s\n' "${compared[i]}"; rc=1; continue; fi
    diff=0
    git diff --no-index -- "${compared[i]}" "${compared[i + 1]}" || diff=$?
    case "$diff" in 0) ;; 1) rc=1 ;; *) return 3 ;; esac
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
  ( run_beside "${DB_TIERS}/backend" in_dir fl_backend "$PY" -m pytest -m db "${PYTEST_SPREAD[@]}" --maxprocesses 6 ) &
  backend=$!
  # Each file starts its own replica set through `@testcontainers/mongodb`.
  ( run_beside "${DB_TIERS}/frontend" in_dir fl_frontend pnpm run test:db ) &
  frontend=$!
  wait "$contract" || true
  wait "$backend" || true
  wait "$frontend" || true

  step "db · the contract and its generated client match the code they are built from"
  beside_verdict "${DB_TIERS}/contract" "The committed contract no longer matches the code it is generated from, or Orval warned on the
regenerated document; the diff or Orval's own lines above name each. Fix with:  (cd fl_frontend && pnpm run contract)
-- then commit both." "contract_check" \
    && ok "the contract and the client are current"

  step "db · pytest -m db, distributed over one shared replica set"
  beside_verdict "${DB_TIERS}/backend" --pytest "fl_backend db-tier tests failed. A failing test and a mongo that never started both end here: each case's
own message above says which." "pytest -m db" \
    && ok "db-tier tests pass"

  step "db · the frontend's *.db.test.ts files"
  beside_verdict "${DB_TIERS}/frontend" --summary "fl_frontend db-tier tests failed. A failing test and a mongo that never started both end here: each file's
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
  require_buildx
  check "The images failed to build — the failure the frontend scope cannot see. Docker's own output above names the target." \
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

  # Each assertion answers 1 for what it found, and 3 for an image that would not run its probe.
  step "images · instrumentation.js is in the frontend image"
  check "instrumentation.js is MISSING from the image. It must live at fl_frontend/src/instrumentation.ts, not the repository root." \
    image_has_instrumentation "${IMAGES_TAG}:frontend" \
    && ok "instrumentation.js present — the environment gate and error logging will run"

  step "images · neither image runs as root"
  check "An image runs as root, which a build reports as success. The USER line in that image's Dockerfile sets it." \
    image_runs_unprivileged "${IMAGES_TAG}:frontend" "${IMAGES_TAG}:backend" \
    && ok "both images drop to an unprivileged user"

  step "images · the dockerignore kept its promise about the build context"
  check "A build context carried a file its dockerignore exists to exclude, named above." \
    image_context_clean "${IMAGES_TAG}:frontend" "${IMAGES_TAG}:backend" \
    && ok "no environment file, key, certificate or npm configuration reached either image"
  return 0
}

"scope_${SCOPE//-/_}"
finish
