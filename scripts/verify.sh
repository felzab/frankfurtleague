#!/usr/bin/env bash
#
# SCRIPTS · the pre-merge gate — everything, or exactly the surfaces a change touched.
#
# Read-only but for the frontend scope, which runs prettier in write mode first, so a run can leave
# formatting to commit and every later check measures a tree that has stopped moving. Before any
# scope runs, `scripts/check_scope.py` refuses a run narrower than the branch's diff (ADR-0030).
# Never name another tool's flag in this block: `scripts/selfcheck.sh` reads every double-dashed
# word here as a flag this script must accept.
#
#   ./scripts/verify.sh                   every scope — the full gate; the image builds take minutes
#   ./scripts/verify.sh --scripts --docs --backend --frontend --ops --db --images
#   ./scripts/verify.sh --quick           the scopes needing no Docker: not ops, not db, not images
#   ./scripts/verify.sh --verbose         stream each tool's own output instead of capturing it
#   ./scripts/verify.sh --help
#
# See:
# - docs/ops/spec.md — the scope table, what each scope needs, and the cheapest-to-fail order

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

RUN_SCRIPTS=0; RUN_DOCS=0; RUN_BACKEND=0; RUN_FRONTEND=0; RUN_OPS=0; RUN_DB=0; RUN_IMAGES=0
# shellcheck disable=SC2034  # consumed by _lib.sh's `quietly`, which shellcheck cannot follow
VERBOSE=0
# shellcheck disable=SC2034  # same: the loop's `--verbose` arm assigns for `quietly`
for arg in "$@"; do
  case "$arg" in
    --scripts)  RUN_SCRIPTS=1 ;;
    --docs)     RUN_DOCS=1 ;;
    --backend)  RUN_BACKEND=1 ;;
    --frontend) RUN_FRONTEND=1 ;;
    --ops)      RUN_OPS=1 ;;
    --db)       RUN_DB=1 ;;
    --images)   RUN_IMAGES=1 ;;
    --quick)    RUN_SCRIPTS=1; RUN_DOCS=1; RUN_BACKEND=1; RUN_FRONTEND=1 ;;
    --verbose)  VERBOSE=1 ;;
    --help|-h)  usage ;;
    *)          die "Unknown option: ${arg}. Try --help." ;;
  esac
done

if (( ! (RUN_SCRIPTS || RUN_DOCS || RUN_BACKEND || RUN_FRONTEND || RUN_OPS || RUN_DB || RUN_IMAGES) )); then
  RUN_SCRIPTS=1; RUN_DOCS=1; RUN_BACKEND=1; RUN_FRONTEND=1; RUN_OPS=1; RUN_DB=1; RUN_IMAGES=1
fi

# Fail on a missing prerequisite NOW: without this, a full run on a machine whose Docker is asleep
# discovers it only at the db tier, minutes of green checks in.
if (( RUN_OPS || RUN_DB || RUN_IMAGES )); then
  require_docker
fi

# One EXIT trap serves every Docker scope's cleanup: `die` exits directly, so an inline cleanup
# line after a failed check would never run.
if (( RUN_OPS || RUN_IMAGES )); then
  STANDIN_BE=0; STANDIN_FE=0
  cleanup() {
    rm -rf "${REPO_ROOT}/.tmp-nginx-check"
    if (( STANDIN_BE )); then rm -f fl_backend/.env; fi
    if (( STANDIN_FE )); then rm -f fl_frontend/.env; fi
    docker image rm -f frankfurtleague-verify:frontend frankfurtleague-verify:backend >/dev/null 2>&1 || true
  }
  trap cleanup EXIT
fi
PY=""
if (( RUN_SCRIPTS || RUN_DOCS || RUN_BACKEND || RUN_DB )); then
  PY="$(venv_python)"
fi

# --- scope -------------------------------------------------------------------------------------------

# Before any scope runs, because refusing an undersized run in two seconds is the point: the same
# refusal after a next build has already cost the minutes it exists to save. This is where ADR-0030
# stops depending on memory.

# Skipped in CI, where the scopes are separate jobs and the mapping is derived from paths rather than
# typed: there is no single invocation for the question to be about, and `--docs` would fail for a
# missing images scope another job is running.
if [[ -n "${CI:-}" ]]; then
  skip "scope check: CI maps scopes from paths itself, so there is no typed scope to check"
else
  step "scope · does this run cover what the branch changed?"
  SCOPES_RAN=""
  add_scope() { if (( $2 )); then SCOPES_RAN+="$1 "; fi; }
  add_scope scripts  "$RUN_SCRIPTS"
  add_scope docs     "$RUN_DOCS"
  add_scope backend  "$RUN_BACKEND"
  add_scope frontend "$RUN_FRONTEND"
  add_scope ops      "$RUN_OPS"
  add_scope db       "$RUN_DB"
  add_scope images   "$RUN_IMAGES"

  SCOPE_PY="$(any_python || true)"
  if [[ -z "$SCOPE_PY" ]]; then
    skip "no python found — this run was not checked against the diff"
  # Not through `quietly`: the advisory findings are the useful half and a green run should still
  # print them.
  elif "$SCOPE_PY" scripts/check_scope.py --ran "$SCOPES_RAN"; then
    ok "the scopes named cover the change"
  else
    die "This run is not wide enough to merge on. The finding above names the file and the flag."
  fi
fi

# --- scripts ---------------------------------------------------------------------------------------

# First because it is instant and because a broken script would make everything below it unreliable.
# See selfcheck.sh for the class of bug bash -n cannot see.
if (( RUN_SCRIPTS )); then
  step "scripts · selfcheck"
  quietly bash scripts/selfcheck.sh || die "scripts/selfcheck.sh failed — its findings are above."
  ok "scripts are internally consistent"

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
fi

# --- docs ------------------------------------------------------------------------------------------

# A dangling ADR number, a dead link and a citation whose anchor has gone are invisible to every
# other check here, and each still reads as though it means something. The standard's other currency
# defences depend on memory; this one does not (CUR-5).
if (( RUN_DOCS )); then
  step "docs · citations, links and stamps"
  quietly "$PY" scripts/check_docs.py || die "The documentation gate failed. Each finding above names its file
and what no longer resolves. Rules: docs/_standard/chapters/5-currency.md"
  ok "documentation references resolve"

  # Commit messages ride in this scope rather than one of their own; the argument is in
  # `scripts/check_commits.py`'s own header.
  step "docs · commit messages on this branch"
  quietly "$PY" scripts/check_commits.py || die "The commit message gate failed. Each finding above names the
commit and what is wrong with it. The form is docs/_git/templates.md."
  ok "commit messages follow the convention"
fi

# --- backend ---------------------------------------------------------------------------------------

# Before the frontend deliberately: this tier finishes in seconds while a next build takes minutes,
# and cheapest-to-fail-first is the ordering rule of this gate.
if (( RUN_BACKEND )); then
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

# --- frontend --------------------------------------------------------------------------------------
if (( RUN_FRONTEND )); then
  step "frontend · prettier  (write mode — commit what it reformats)"
  ( cd fl_frontend && quietly pnpm format ) || die "prettier failed."
  ok "tree formatted"

  step "frontend · tsc"
  ( cd fl_frontend && quietly pnpm typecheck ) || die "tsc found type errors."
  ok "no type errors"

  step "frontend · eslint"
  ( cd fl_frontend && quietly pnpm lint ) || die "eslint failed."
  ok "lint clean"

  step "frontend · next build"
  ( cd fl_frontend && quietly pnpm build ) || die "next build failed."
  ok "build succeeds"

  step "frontend · unit tests"
  ( cd fl_frontend && quietly pnpm test ) || die "frontend unit tests failed."
  ok "unit tests pass"

  # Advisory, not fatal: an advisory published upstream overnight should not block an unrelated
  # merge — which is exactly why this is not part of any hard-failing chain.
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
  MSYS_NO_PATHCONV=1 quietly docker run --rm \
    --add-host frontend:127.0.0.1 --add-host backend:127.0.0.1 \
    -v "/${REPO_ROOT}/nginx/prod.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "/${REPO_ROOT}/.tmp-nginx-check:/etc/nginx/certs:ro" \
    nginx:alpine nginx -t \
    || die "nginx refuses prod.conf — its own explanation is above."
  ok "nginx accepts prod.conf"
fi

# --- db --------------------------------------------------------------------------------------------

# The other test tier, split from the default one because it needs the Docker daemon `--quick` exists
# to avoid. Without it `pytest -m db` runs only in CI, so a change breaking the pipeline against a
# real mongod passes every local gate (ADR-0023).
if (( RUN_DB )); then
  step "db · pytest -m db, against a real mongod"
  ( cd fl_backend && quietly "$PY" -m pytest -m db ) || die "fl_backend db-tier tests failed.
testcontainers starts and removes mongo:8 itself; a failure here is the code, not the daemon."
  ok "db-tier tests pass"
fi

# --- images ----------------------------------------------------------------------------------------

# The EXIT trap above reclaims the throwaway image tags on every exit path. Without it a failed gate
# leaves both behind, and the next run moves them onto fresh images, orphaning untagged layers only
# `docker image prune` reclaims.
if (( RUN_IMAGES )); then
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
      quietly docker buildx build --load \
        --cache-from "type=gha,scope=${name}" \
        --cache-to "type=gha,scope=${name},mode=max" \
        -f "$dockerfile" -t "frankfurtleague-verify:${name}" "$context"
    else
      quietly docker build -f "$dockerfile" -t "frankfurtleague-verify:${name}" "$context"
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
  if quietly docker run --rm --entrypoint sh frankfurtleague-verify:frontend -c '[ -f .next/server/instrumentation.js ]'; then
    ok "instrumentation.js present — env gate and error logging will run"
  else
    die "instrumentation.js is MISSING from the image. It must live at fl_frontend/src/instrumentation.ts, not the repo root."
  fi
fi

# --- summary ---------------------------------------------------------------------------------------
ran=""; not_run=""
mark() { if (( $2 )); then ran+=" $1"; else not_run+=" $1"; fi; }
mark scripts  "$RUN_SCRIPTS"
mark docs     "$RUN_DOCS"
mark backend  "$RUN_BACKEND"
mark frontend "$RUN_FRONTEND"
mark ops      "$RUN_OPS"
mark db       "$RUN_DB"
mark images   "$RUN_IMAGES"

printf '\n'
_STEP_T0=""  # the summary lines carry their own total; the per-step timer would print twice
if [[ -z "$not_run" ]]; then
  ok "Full gate green — safe to merge. ($(fmt_duration "$SECONDS") total)"
else
  ok "Green:${ran}. ($(fmt_duration "$SECONDS") total)"
  skip "not run:${not_run}"
fi
