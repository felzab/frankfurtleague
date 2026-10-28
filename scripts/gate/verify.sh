#!/usr/bin/env bash
#
# SCRIPTS · the pre-merge gate — every scope, or the scopes a run names.
#
# Never writes, but `next build` rewrites the tracked `fl_frontend/tsconfig.json` when a
# `compilerOptions` key is absent; the frontend CI job diffs that path.
#
#   ./scripts/gate/verify.sh                   every scope, side by side — the run a pull request is called ready to merge on
#   ./scripts/gate/verify.sh --scripts --docs --backend --format --frontend-units --frontend --ops --db --images
#   ./scripts/gate/verify.sh --quick           the scopes needing no Docker: not docs, ops, db or images
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
# the longest rather than the sum. Each run's output is captured and replayed in the written order.
RUNS_DIR=""
declare -A PID=()
# Ctrl-C reaches every run's process group already; a run killed otherwise is stopped here.
stop_runs() {
  local pid
  for pid in "${PID[@]}"; do kill "$pid" 2>/dev/null || true; done
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

  for scope in "${SELECTED[@]}"; do
    "$BASH" "$SELF" "--${scope}" > "${RUNS_DIR}/${scope}.log" 2>&1 &
    PID[$scope]=$!
  done

  info "running side by side: $(IFS=' '; printf '%s' "${SELECTED[*]}")"
  declare -A STATUS=()
  spinner_start "${#SELECTED[@]} scopes running side by side"
  for scope in "${SELECTED[@]}"; do
    rc=0
    wait "${PID[$scope]}" || rc=$?
    STATUS[$scope]=$rc
  done
  spinner_stop
  for scope in "${SELECTED[@]}"; do cat "${RUNS_DIR}/${scope}.log"; done

  # The exit contract's order, as `scripts/lib/_lib.sh :: finish` reads a single run's sections:
  # findings over a refusal over a crash.
  findings=0; refused=0; crashed=0
  printf '\n      %s%-16s  %s%s\n' "$C_DIM" "scope" "result" "$C_RESET"
  for scope in "${SELECTED[@]}"; do
    case "${STATUS[$scope]}" in
      0)   label=pass;        colour="$C_GREEN" ;;
      1)   label=findings;    colour="$C_RED"; findings=1 ;;
      2)   label=refused;     colour="$C_RED"; refused=1 ;;
      130) label=interrupted; colour="$C_YELLOW"; crashed=1 ;;
      *)   label="crashed (${STATUS[$scope]})"; colour="$C_RED"; crashed=1 ;;
    esac
    printf '      %-16s  %s%s%s\n' "$scope" "$colour" "$label" "$C_RESET"
  done
  elapsed="$(fmt_ms $(( $(_now_ms) - _RUN_T0 )))"
  if (( findings )); then
    printf '\n%s   ✗%s  A scope above has findings, each named in its own section — exit 1. (%s)\n' "$C_RED" "$C_RESET" "$elapsed" >&2
    exit 1
  fi
  if (( refused )); then
    printf '\n%s   ✗%s  A scope above refused, so it reached no verdict on the change — exit 2. (%s)\n' "$C_RED" "$C_RESET" "$elapsed" >&2
    exit 2
  fi
  if (( crashed )); then
    printf '\n%s   ✗%s  A scope above crashed or was stopped, so nothing past that point ran — exit 3. (%s)\n' "$C_RED" "$C_RESET" "$elapsed" >&2
    exit 3
  fi
  if (( ${#SELECTED[@]} == ${#SCOPES[@]} )); then
    ok "Green — every scope, no findings, ${elapsed}. Safe to merge."
  else
    ok "Green — ${#SELECTED[@]} scopes, no findings, ${elapsed}."
  fi
  exit 0
fi

# --- one scope ------------------------------------------------------------------------------------

SCOPE="${SELECTED[0]}"

# Each tool's status: 1 is what it found, 130 an interrupt, anything else a tool that never reached a
# verdict. `--checker` adds the 2 a checker built on `scripts/lib/checker_kernel.py :: run` answers
# for an input it could not judge.
check() { # [--checker] $1 what to say on a finding · the command
  local checker=0 said rc=0
  if [[ "$1" == --checker ]]; then checker=1; shift; fi
  said="$1"; shift
  quietly "$@" || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) fail "$said"; return 1 ;;
    130) on_interrupt ;;
    2) if (( checker )); then refuse "${_STEP_LABEL} could not judge its input, so nothing here stands as a verdict on the
change. Its own reason is above."; fi
       on_error "$rc" "${BASH_LINENO[0]}" "$*" ;;
    *) on_error "$rc" "${BASH_LINENO[0]}" "$*" ;;
  esac
}

# A command run from inside one of the repository's directories.
in_dir() { # $1 the directory · the command
  local dir="$1"
  shift
  ( cd "$dir" && "$@" )
}

# ruff's lint, then its formatter in check mode, over the paths named from inside `$1`.
ruff_both() { # $1 the directory · the paths
  local dir="$1"
  shift
  ( cd "$dir" && "$PY" -m ruff check "$@" && "$PY" -m ruff format --check "$@" )
}

# Spread by file, so each module's fixtures stay on one worker; a stalled case's stack is dumped
# past 180 s, inside every CI job's timeout. Each `--maxprocesses` below is its measured optimum on a
# 16-core machine, which `-n auto` caps at the machine's cores (2026-09: `scripts/tests` flat from 8
# up, the db tier fastest at 6, the default tier level from 6 to 8).
PYTEST_SPREAD=(-n auto --dist loadfile -o faulthandler_timeout=180)

case "$SCOPE" in
  docs|ops|db|images) require_docker ;;
esac
case "$SCOPE" in
  format|frontend-units|frontend|db)
    require_dir fl_frontend/node_modules "Every frontend tool runs out of it. Install it with:  cd fl_frontend && pnpm install"
    # pnpm's dependency check (`verifyDepsBeforeRun` in fl_frontend/pnpm-workspace.yaml) runs on every
    # `pnpm run` and `pnpm exec`, so one exec answers for every step below before any of them runs.
    quietly in_dir fl_frontend pnpm exec node -e "" \
      || refuse "pnpm would not start a command in fl_frontend: node_modules does not answer the manifest
and lockfile, or pnpm itself did not start (its own words are above). Fix with:  cd fl_frontend && pnpm install" ;;
esac
PY=""
case "$SCOPE" in
  scripts|docs|backend|ops|db)
    PY="$(venv_python)" || refuse "No fl_backend virtualenv found. Create it with:  uv sync --project fl_backend --dev"
    # On a runner the job's own `uv sync --locked` has just run.
    if [[ -z "${GITHUB_ACTIONS:-}" ]]; then
      quietly uv sync --project fl_backend --dev --check \
        || refuse "fl_backend/.venv does not match fl_backend/uv.lock, so a finding here would be about this
machine rather than the change. Sync it with:  uv sync --project fl_backend --dev"
    fi ;;
esac

# --- scripts ---------------------------------------------------------------------------------------

scope_scripts() {
  section scripts
  step "scripts · selfcheck"
  check "scripts/gate/selfcheck.sh found the findings above." bash scripts/gate/selfcheck.sh \
    && ok "the shell scripts parse, are executable in git and lint clean, and the workflows lint clean"

  step "scripts · ruff  (lint, and format in check mode)"
  check "ruff failed in scripts. Fix with:  uv run --project fl_backend ruff format scripts" ruff_both . scripts \
    && ok "the gate's own python is clean"

  # From inside scripts/, where pyright finds its config; no PyPI release lookup, uv.lock pins what runs.
  step "scripts · pyright"
  check "pyright found type errors in scripts." in_dir scripts env PYRIGHT_PYTHON_IGNORE_WARNINGS=1 "$PY" -m pyright \
    && ok "the gate's own types are clean"

  step "scripts · pytest"
  check "pytest over scripts/tests failed; the failing test names which." \
    "$PY" -m pytest scripts/tests "${PYTEST_SPREAD[@]}" --maxprocesses 8 \
    && ok "the scripts' own tests pass"
  return 0
}

# --- docs ------------------------------------------------------------------------------------------

# The empty tree against the working tree: every tracked file is read whole, and a shallow clone needs
# no history for it. git answers 2 for what it found.
diff_check() {
  local rc=0
  git diff --check "$(git hash-object -t tree /dev/null)" || rc=$?
  if (( rc == 2 )); then return 1; fi
  return "$rc"
}

# Offline, every link and fragment inside the repository, through the pinned image with no network;
# links leaving it are no part of this gate. lychee answers 2 for a broken one.
check_links() {
  local rc=0
  MSYS_NO_PATHCONV=1 docker run --rm --network none -v "/${REPO_ROOT}:/input:ro" -w /input \
    lycheeverse/lychee:0.24.2@sha256:e2d19e57cf6ab037026f20b8e449a1f30d9d7f81eef4194763aab2eab20bd28d \
    --config lychee.toml --no-progress . || rc=$?
  if (( rc == 2 )); then return 1; fi
  return "$rc"
}

scope_docs() {
  section docs
  step "docs · no conflict marker or whitespace error in any tracked file"
  check "A tracked file above carries a conflict marker or a whitespace error, each named by its line." diff_check \
    && ok "no conflict marker or whitespace error"

  step "docs · every link and fragment inside the repository resolves"
  check "lychee names each broken link or fragment above, with the file it stands in." check_links \
    && ok "every link inside the repository resolves"

  # This scope because the check reads the App Router tree and `nginx/shared/site.conf` together.
  step "docs · every route handler, link page and metadata convention is metered or accounted for"
  check --checker "The route accounting is out. Each finding above names the handler, the location or the reason." \
    "$PY" scripts/checks/check_public_routes.py \
    && ok "every route handler is accounted for at the edge"

  # `openapi.json` publishes every endpoint and model docstring, so a reword edits it. Needs the
  # virtualenv and no database: `build_test_config` supplies the settings.
  step "docs · openapi.json matches the docstrings it publishes"
  check --checker "The published document no longer matches the models and docstrings it is built from. The output above names the repair." \
    env "PYTHONPATH=${REPO_ROOT}/fl_backend" "$PY" -m tests.openapi_document --check \
    && ok "openapi.json is current"
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

  # No worker starts a server (`fl_backend/tests/conftest.py :: pytest_configure_node`).
  step "backend · pytest  (default tier)"
  check "fl_backend tests failed." in_dir fl_backend "$PY" -m pytest "${PYTEST_SPREAD[@]}" --maxprocesses 6 \
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
  step "format · prettier  (check mode — this gate never writes)"
  check "Prettier names the unformatted files above. Fix with:  cd fl_frontend && pnpm format  -- then commit the result." \
    in_dir fl_frontend pnpm format:check \
    && ok "the tree is formatted"

  # markdownlint-cli2 is installed beside Prettier, and reads its configuration from the root.
  step "format · markdownlint"
  check "markdownlint names each finding above with its file, line and rule." in_dir fl_frontend pnpm run lint:md \
    && ok "the Markdown keeps its rules"
  return 0
}

# --- frontend-units --------------------------------------------------------------------------------

scope_frontend_units() {
  section frontend-units
  step "frontend-units · unit tests"
  check "frontend unit tests failed." in_dir fl_frontend pnpm test \
    && ok "unit tests pass"
  return 0
}

# --- frontend --------------------------------------------------------------------------------------

scope_frontend() {
  section frontend
  # `--frozen-lockfile` makes `--lockfile-only`'s write impossible, and the repeat-install shortcut
  # would answer from mtimes rather than from the manifest.
  step "frontend · pnpm  (manifest and lockfile agree)"
  check "fl_frontend's lockfile no longer answers its manifest or pnpm-workspace.yaml — pnpm names what differs above.
Fix with:  cd fl_frontend && pnpm install  -- then commit the lockfile." \
    in_dir fl_frontend pnpm install --frozen-lockfile --lockfile-only --no-optimistic-repeat-install \
    && ok "manifest and lockfile agree"

  # `strictPeerDependencies` refuses an out-of-range peer only while `pnpm install` resolves.
  step "frontend · pnpm  (every peer in range)"
  check "fl_frontend's lockfile installs a peer outside the range a package asks for — pnpm names it above." \
    in_dir fl_frontend pnpm peers check \
    && ok "every peer in range"

  # `pnpm add` keeps every copy the lockfile already pins, so an added range can leave two copies of
  # one package; HeroUI's components then split React context with the app's.
  step "frontend · pnpm  (no copy a dedupe would remove)"
  check "fl_frontend's lockfile holds a copy a dedupe would remove — pnpm names each change above.
Fix with:  cd fl_frontend && pnpm dedupe  -- then commit the lockfile." \
    in_dir fl_frontend pnpm dedupe --check \
    && ok "no copy a dedupe would remove"

  # The route types tsc checks against; it rewrites tsconfig.json where a key is absent, so it runs
  # before every reader of that file.
  step "frontend · next typegen"
  check "next typegen failed — its own output is above." in_dir fl_frontend pnpm typegen || finish
  ok "route types generated"

  step "frontend · tsc"
  check "tsc found type errors." in_dir fl_frontend pnpm typecheck:only && ok "no type errors"

  step "frontend · eslint"
  check "eslint failed." in_dir fl_frontend pnpm lint && ok "lint clean"

  step "frontend · knip  (unused files, exports and dependencies)"
  check "knip found something nothing uses, named above. Delete it, or name the reader knip cannot see in fl_frontend/knip.json." \
    in_dir fl_frontend pnpm knip \
    && ok "nothing unused"

  step "frontend · knip, production  (what only tests still read)"
  check "knip's production run found code only tests still read, named above. Delete it with the cases testing it,
or name production code knip cannot see in fl_frontend/knip.production.json." \
    in_dir fl_frontend pnpm knip:prod \
    && ok "nothing only tests read"

  # Advisory: something published upstream overnight must not block an unrelated merge.
  step "frontend · dependency audit  (runtime advisories only)"
  local rc=0
  quietly in_dir fl_frontend pnpm audit:prod || rc=$?
  case "$rc" in
    0)   ok "no known runtime vulnerabilities" ;;
    1)   warn "runtime advisories present — triage with: cd fl_frontend && pnpm audit" ;;
    130) on_interrupt ;;
    *)   on_error "$rc" "${LINENO}" "pnpm audit:prod" ;;
  esac

  # Last: it writes `.next/`, which tsconfig.json's `include` covers. The builder's skipped
  # environment validation, for `fl_frontend/Dockerfile`'s reason.
  step "frontend · next build"
  check "next build failed." in_dir fl_frontend env SKIP_ENV_VALIDATION=true NEXT_TELEMETRY_DISABLED=1 pnpm build \
    && ok "build succeeds"
  return 0
}

# --- ops -------------------------------------------------------------------------------------------

OPS_SCRATCH=""
NGINX_CHECK="${REPO_ROOT}/.tmp-nginx-check"
cleanup_ops() { rm -rf "$NGINX_CHECK" || true; if [[ -n "$OPS_SCRATCH" ]]; then rm -rf "$OPS_SCRATCH" || true; fi; }

# zizmor answers 11 to 14 for findings by severity and 1 for its own failure, so its scale is
# translated to the one `check` reads. The root, so a workflow added anywhere is collected;
# `--offline`, so a token in the environment turns on no rule that reaches the network;
# `--strict-collection`, or a malformed `.github/dependabot.yml` is a warning it exits 0 on. Run by uv
# at an exact release, being no dependency of the backend; no Dependabot ecosystem reads this string,
# so a bump is by hand.
run_zizmor() {
  local rc=0
  uvx zizmor@1.31.1 --offline --strict-collection --persona regular . || rc=$?
  case "$rc" in
    0) return 0 ;;
    11|12|13|14) return 1 ;;
    130) return 130 ;;
    *) return 3 ;;
  esac
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
  ok "both stacks parse"

  # A parse accepts a published port and a database alike.
  step "ops · only the edge is reachable off this host"
  check --checker "A stack exposes, mounts, trusts, hands out or keeps more than the rule it breaks allows. The
findings above name the service and the rule (docs/ops/spec.md I1, I174, I355, I18, I429, I430, I471, I472, I507, I508 or I509)." \
    "$PY" scripts/checks/check_compose_model.py "${OPS_SCRATCH}/production.json" "${OPS_SCRATCH}/local.json" \
    && ok "each stack publishes, mounts, trusts and holds only what its rules allow"

  # `nginx -t` loads the certificates, hence the throwaway pair under the repository root, a path MSYS
  # leaves alone; `log/` because it opens every log the file declares, a bind mount in production.
  step "ops · nginx accepts prod.conf"
  rm -rf "$NGINX_CHECK"
  mkdir -p "${NGINX_CHECK}/log"
  # Relative output paths, which a Windows openssl can open; the exclusion protects the subject alone.
  MSYS2_ARG_CONV_EXCL="/CN" quietly openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" \
    -keyout .tmp-nginx-check/key.pem -out .tmp-nginx-check/cert.pem \
    || die "could not generate a throwaway certificate for the nginx check."
  # The image production's model names, so the nginx accepting prod.conf is the one that serves it.
  # `write`, not `print`: a Windows stdout would end the name in a carriage return.
  local nginx_image
  nginx_image="$("$PY" -c 'import json, sys; sys.stdout.write(json.loads(open(sys.argv[1], "rb").read())["services"]["nginx"]["image"])' \
    "${OPS_SCRATCH}/production.json")" \
    || refuse "production's model names no image for nginx, so there is no release to parse prod.conf with."
  if ! docker image inspect "$nginx_image" >/dev/null 2>&1; then
    quietly docker pull "$nginx_image" \
      || refuse "${nginx_image} could not be fetched, so prod.conf was not parsed. Docker's own reason is above."
  fi
  # No `--add-host`: nginx resolves a literal upstream as it loads, so this parse refuses one naming
  # `frontend` or `backend` (`docs/ops/spec.md :: I9`).
  MSYS_NO_PATHCONV=1 check "nginx refuses prod.conf — its own explanation is above." \
    docker run --rm --pull never \
    -v "/${REPO_ROOT}/nginx/prod:/etc/nginx/conf.d:ro" \
    -v "/${REPO_ROOT}/nginx/shared:/etc/nginx/shared:ro" \
    -v "/${NGINX_CHECK}:/etc/nginx/certs:ro" \
    -v "/${NGINX_CHECK}/log:/var/log/frankfurtleague/nginx" \
    "$nginx_image" nginx -t \
    && ok "${nginx_image} accepts prod.conf"

  # A parse sees neither a log line nor a response (`docs/logging/spec.md` L11, `docs/ops/spec.md` I2).
  step "ops · the edge logs no credential and sends every security header once"
  check --checker "The running edge failed a case. Each failing case above is what nginx WROTE or SENT, and the
files under nginx/shared/ decide it." bash nginx/edge_test.sh \
    && ok "the edge logged and sent every case as written"
  return 0
}

# --- db --------------------------------------------------------------------------------------------

# Split from the default tier because it needs the Docker daemon the quick scope avoids.
scope_db() {
  section db
  # `loadfile` for isolation too: `fl_backend/tests/api/test_erasure_commit_fail_points.py` sets the
  # server's one `failCommand`, so its cases run one after another on one worker.
  step "db · pytest -m db, distributed over the two shared mongods"
  check "fl_backend db-tier tests failed. A failing test and a mongo that never started both end here: each case's
own message above says which." \
    in_dir fl_backend "$PY" -m pytest -m db "${PYTEST_SPREAD[@]}" --maxprocesses 6 \
    && ok "db-tier tests pass"

  # Each file starts its own replica set through `@testcontainers/mongodb`.
  step "db · the frontend's *.db.test.ts files"
  check "fl_frontend db-tier tests failed. A failing test and a mongo that never started both end here: each file's
own message above says which." in_dir fl_frontend pnpm run test:db \
    && ok "frontend db-tier tests pass"
  return 0
}

# --- images ----------------------------------------------------------------------------------------

# Global, for the EXIT trap, which runs after the scope has returned. The default carries this run's
# pid, so the images a local run removes on the way out are its own.
IMAGES_TAG="${VERIFY_TAG:-frankfurtleague-verify-$$}"
cleanup_images() { docker image rm -f "${IMAGES_TAG}:frontend" "${IMAGES_TAG}:backend" >/dev/null 2>&1 || true; }

# Both at once, each into its own capture: BuildKit runs the two solves side by side.
build_images() {
  local image rc failed="" logs
  local -A build_pid=()
  logs="$(mktemp -d)"
  for image in frontend backend; do
    docker build -f "fl_${image}/Dockerfile" -t "${IMAGES_TAG}:${image}" "fl_${image}" > "${logs}/${image}" 2>&1 &
    build_pid[$image]=$!
  done
  for image in frontend backend; do
    rc=0
    wait "${build_pid[$image]}" || rc=$?
    if (( rc )); then failed+=" ${image}"; detail < "${logs}/${image}"; fi
  done
  rm -rf "$logs"
  if [[ -n "$failed" ]]; then
    fail "The image(s)${failed} failed to build — the failure the frontend scope cannot see. Docker's own output is above."
    finish
  fi
}

# What a successful build does not prove, asked of each image (`scripts/lib/_lib.sh`). Under CI the
# workflow builds both through `docker/build-push-action`, which carries the layer cache, and names
# them by `VERIFY_TAG` with `VERIFY_IMAGES_BUILT=1`; this scope then asks the same questions of them.
scope_images() {
  section images
  if [[ -z "${VERIFY_IMAGES_BUILT:-}" ]]; then
    trap cleanup_images EXIT
    step "images · docker build frontend and backend"
    build_images
    ok "both images build"
  fi

  # Each assertion answers 1 for what it found and 3 for an image that would not run.
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
