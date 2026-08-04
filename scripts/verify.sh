#!/usr/bin/env bash
#
# scripts/verify.sh — the pre-merge gate: everything, or exactly the surfaces a change touched.
# TARGET PLATFORM: any. Every check is read-only with one exception: the frontend scope runs
# prettier in write mode as its first command, so a run may leave formatting changes for you to
# commit. Every later check then measures the formatted tree rather than one that is still moving.
#
# NOTE: do not name any other tool's flags in this header. Check 8 of selfcheck.sh treats every
# double-dashed word in this comment block as a documented flag of THIS script, and fails when the
# case statement below has no match for it.
#
# THE SCOPES, in the order they run (cheapest to fail first — the backend tier runs in seconds,
# a next build in minutes, an image build in more):
#   scripts    selfcheck.sh, then ruff over scripts/*.py — the scripts themselves (instant;
#              the ruff step needs the backend venv)
#   docs       check_docs.py — citations, links and stamps, then check_commits.py — the branch's
#              commit messages, which are documentation here (instant; needs the backend venv)
#   backend    ruff, pyright and the default pytest tier. No Docker
#   frontend   prettier, tsc, eslint, next build, unit tests, then the dependency audit
#   ops        both compose files parse, and nginx accepts prod.conf. Needs Docker
#   db         the db-marked pytest tier against a real mongod (ADR-0030). Needs Docker
#   images     both docker builds plus the instrumentation.js presence check. Needs Docker
#
# The two Docker scopes stay last even though the db tier is quick when warm: everything before
# them runs daemon-free, which keeps the no-Docker form a strict prefix of the full gate.
#
# Each scope's reasoning — why it exists and what only it can catch — is in scripts/README.md.
#
# Tool output is captured and shown only when a step fails, so a green run reads as one line per
# step. Streaming everything back is one flag away.
#
# USAGE:
#   ./scripts/verify.sh              everything — the full gate. The image builds take minutes
#   ./scripts/verify.sh --quick      everything that runs without Docker: no db tier, no images.
#                                    NOT sufficient before a merge if you touched
#                                    fl_frontend/src/core/config.ts, src/core/auth.ts,
#                                    src/instrumentation.ts, next.config.ts, a lockfile or a
#                                    Dockerfile
#   ./scripts/verify.sh --scripts    one scope. Scope flags combine freely — for example
#   ./scripts/verify.sh --docs       a documentation-only change needs only this one, and
#   ./scripts/verify.sh --backend    a backend change pairs this
#   ./scripts/verify.sh --db         with this, its Docker-backed test tier
#   ./scripts/verify.sh --frontend
#   ./scripts/verify.sh --ops
#   ./scripts/verify.sh --images
#   ./scripts/verify.sh --verbose    stream every tool's own output instead of capturing it
#   ./scripts/verify.sh --help

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

# No scope named means every scope: the bare invocation stays the full gate.
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

# --- scripts ---------------------------------------------------------------------------------------
# First because it is instant and because a broken script would make everything below it unreliable.
# See selfcheck.sh for the class of bug bash -n cannot see.
if (( RUN_SCRIPTS )); then
  step "scripts · selfcheck"
  quietly bash scripts/selfcheck.sh || die "scripts/selfcheck.sh failed — its findings are above."
  ok "scripts are internally consistent"

  # Nothing linted the gate's own python until scripts/ruff.toml existed. ruff resolves its config
  # by walking up from the file it is checking, so fl_backend/pyproject.toml governed the backend
  # and nothing else, and these two files fell back to ruff's defaults — which is how an editor came
  # to report a finding this gate could not produce. That file points ruff back at the one config.
  step "scripts · ruff  (lint, and format in check mode)"
  ( quietly "$PY" -m ruff check scripts && quietly "$PY" -m ruff format --check scripts ) \
    || die "ruff failed in scripts/. Fix with:  fl_backend/.venv/Scripts/python -m ruff format scripts"
  ok "the gate's own python is clean"
fi

# --- docs ------------------------------------------------------------------------------------------
# A dangling ADR number, a dead link and a citation whose anchor has gone are all invisible to every
# other check here, and all three read to a future reader as though they still mean something. The
# standard's other currency defences depend on somebody remembering; this one does not (DS18).
if (( RUN_DOCS )); then
  step "docs · citations, links and stamps"
  quietly "$PY" scripts/check_docs.py || die "The documentation gate failed. Each finding above names its file
and what no longer resolves. Rules: docs/_standard/5-currency.md"
  ok "documentation references resolve"

  # Commit messages are checked in the docs scope, not a scope of their own, because in this
  # repository they ARE documentation — merges are never squashed so that they survive — and because
  # every gate combination CLAUDE.md prescribes already includes --docs. A --commits flag would be a
  # flag nobody remembers to pass on the change that needed it.
  step "docs · commit messages on this branch"
  quietly "$PY" scripts/check_commits.py || die "The commit message gate failed. Each finding above names the
commit and what is wrong with it. The form is docs/workflows/message-templates.md."
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

  # ruff does not check types and pytest only runs what it executes, so without this the gate was
  # green while Pylance showed errors in the editor -- and five reached main that way. Same checker,
  # same config: [tool.pyright] in fl_backend/pyproject.toml points at the venv, without which
  # pyright resolves no third-party import and reports over a hundred phantom errors.
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
  # `nginx -t` loads the certificates and resolves every proxy_pass host, so the check supplies a
  # throwaway self-signed pair and loopback entries for the two upstream names. The temp dir sits
  # under the repo root because MSYS rewrites /tmp in mount paths (scripts/README.md, Windows) —
  # the same reason both commands carry MSYS_NO_PATHCONV.
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
# The other test tier, split from the default one because it needs the Docker daemon that --quick
# exists to avoid. Locally this was the gap: `pytest -m db` ran only in CI, so a change that broke
# the pipeline against a real mongod passed every local gate (ADR-0030).
if (( RUN_DB )); then
  step "db · pytest -m db, against a real mongod"
  ( cd fl_backend && quietly "$PY" -m pytest -m db ) || die "fl_backend db-tier tests failed.
testcontainers starts and removes mongo:8 itself; a failure here is the code, not the daemon."
  ok "db-tier tests pass"
fi

# --- images ----------------------------------------------------------------------------------------
# The EXIT trap above reclaims the throwaway image tags on every exit path — without it, a failed
# gate leaves both tags behind, where the next run moves them onto fresh images and orphans the old
# ones as untagged 369 MB layers that nothing but `docker image prune` ever reclaims.
if (( RUN_IMAGES )); then
  # CI sets VERIFY_IMAGES_CACHE_DIR to carry layers across runs (verify.yml pairs it with
  # actions/cache and a docker-container builder, because the default docker driver cannot export
  # a cache). Unset — the local case — it is a plain docker build.
  build_image() {
    local name="$1" dockerfile="$2" context="$3"
    if [[ -n "${VERIFY_IMAGES_CACHE_DIR:-}" ]]; then
      quietly docker buildx build --load \
        --cache-from "type=local,src=${VERIFY_IMAGES_CACHE_DIR}/${name}" \
        --cache-to "type=local,dest=${VERIFY_IMAGES_CACHE_DIR}/${name},mode=max" \
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
  if (( ! RUN_IMAGES )); then
    warn "The image build did not run. Do NOT merge on this alone if you touched
fl_frontend/src/core/config.ts, src/core/auth.ts, src/instrumentation.ts, next.config.ts,
a lockfile or a Dockerfile. Locally that is:  ./scripts/verify.sh --images"
  fi
fi
