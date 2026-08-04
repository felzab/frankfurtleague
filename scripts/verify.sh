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
#   scripts    selfcheck.sh — the scripts themselves (instant)
#   docs       check_docs.py — citations, links and stamps (instant; needs the backend venv)
#   backend    ruff, pyright and the default pytest tier. No Docker
#   frontend   prettier, tsc, eslint, next build, unit tests, then the dependency audit
#   db         the db-marked pytest tier against a real mongod (ADR-0030). Needs Docker
#   images     both docker builds plus the instrumentation.js presence check. Needs Docker
#
# Each scope's reasoning — why it exists and what only it can catch — is in scripts/README.md.
#
# USAGE:
#   ./scripts/verify.sh              everything — the full gate. The image builds take minutes
#   ./scripts/verify.sh --quick      everything that runs without Docker: no db tier, no images.
#                                    NOT sufficient before a merge if you touched
#                                    fl_frontend/src/core/config.ts, src/core/auth.ts,
#                                    src/instrumentation.ts or a Dockerfile
#   ./scripts/verify.sh --scripts    one scope. Scope flags combine freely — for example
#   ./scripts/verify.sh --docs       a documentation-only change needs only this one, and
#   ./scripts/verify.sh --backend    a backend change pairs this
#   ./scripts/verify.sh --db         with this, its Docker-backed test tier
#   ./scripts/verify.sh --frontend
#   ./scripts/verify.sh --images
#   ./scripts/verify.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

RUN_SCRIPTS=0; RUN_DOCS=0; RUN_BACKEND=0; RUN_FRONTEND=0; RUN_DB=0; RUN_IMAGES=0
for arg in "$@"; do
  case "$arg" in
    --scripts)  RUN_SCRIPTS=1 ;;
    --docs)     RUN_DOCS=1 ;;
    --backend)  RUN_BACKEND=1 ;;
    --frontend) RUN_FRONTEND=1 ;;
    --db)       RUN_DB=1 ;;
    --images)   RUN_IMAGES=1 ;;
    --quick)    RUN_SCRIPTS=1; RUN_DOCS=1; RUN_BACKEND=1; RUN_FRONTEND=1 ;;
    --help|-h)  usage ;;
    *)          die "Unknown option: ${arg}. Try --help." ;;
  esac
done

# No scope named means every scope: the bare invocation stays the full gate.
if (( ! (RUN_SCRIPTS || RUN_DOCS || RUN_BACKEND || RUN_FRONTEND || RUN_DB || RUN_IMAGES) )); then
  RUN_SCRIPTS=1; RUN_DOCS=1; RUN_BACKEND=1; RUN_FRONTEND=1; RUN_DB=1; RUN_IMAGES=1
fi

# Fail on a missing prerequisite NOW: without this, a full run on a machine whose Docker is asleep
# discovers it only at the db tier, minutes of green checks in.
if (( RUN_DB || RUN_IMAGES )); then
  require_docker
fi
PY=""
if (( RUN_DOCS || RUN_BACKEND || RUN_DB )); then
  PY="$(venv_python)"
fi

# --- scripts ---------------------------------------------------------------------------------------
# First because it is instant and because a broken script would make everything below it unreliable.
# See selfcheck.sh for the class of bug bash -n cannot see.
if (( RUN_SCRIPTS )); then
  step "scripts/ self-check"
  if out="$(bash scripts/selfcheck.sh 2>&1)"; then
    ok "scripts are internally consistent"
  else
    printf '%s\n' "$out" | detail
    die "scripts/selfcheck.sh failed — its findings are above."
  fi
fi

# --- docs ------------------------------------------------------------------------------------------
# A dangling ADR number, a dead link and a citation whose anchor has gone are all invisible to every
# other check here, and all three read to a future reader as though they still mean something. The
# standard's other currency defences depend on somebody remembering; this one does not (DS18).
if (( RUN_DOCS )); then
  step "documentation gate  (citations, links, stamps)"
  "$PY" scripts/check_docs.py || die "The documentation gate failed. Each finding above names its file
and what no longer resolves. Rules: docs/_standard/5-currency.md"
  ok "documentation references resolve"
fi

# --- backend ---------------------------------------------------------------------------------------
# Before the frontend deliberately: this tier finishes in seconds while a next build takes minutes,
# and cheapest-to-fail-first is the ordering rule of this gate.
if (( RUN_BACKEND )); then
  step "fl_backend  (ruff, pyright, pytest — default tier)"
  ( cd fl_backend && "$PY" -m ruff check app tests && "$PY" -m ruff format --check app tests ) \
    || die "ruff failed in fl_backend. Fix with:  cd fl_backend && .venv/Scripts/python -m ruff format app tests"
  # ruff does not check types and pytest only runs what it executes, so without this the gate was
  # green while Pylance showed errors in the editor -- and five reached main that way. Same checker,
  # same config: [tool.pyright] in fl_backend/pyproject.toml points at the venv, without which
  # pyright resolves no third-party import and reports over a hundred phantom errors.
  ( cd fl_backend && "$PY" -m pyright ) || die "pyright found type errors in fl_backend.
These are the same errors Pylance shows in the editor."
  ( cd fl_backend && "$PY" -m pytest ) || die "fl_backend tests failed."
  ok "backend lint, types and default-tier tests pass"
fi

# --- frontend --------------------------------------------------------------------------------------
if (( RUN_FRONTEND )); then
  step "fl_frontend  (prettier in write mode, then tsc, eslint, next build, unit tests)"
  ( cd fl_frontend && pnpm verify ) || die "pnpm verify failed. Fix that before looking at anything else."
  ok "pnpm verify exit 0"

  # Advisory, not fatal: an advisory published upstream overnight should not block an unrelated
  # merge. It is a separate step, and NOT part of the pnpm verify chain, precisely so it can warn.
  step "pnpm audit:prod  (runtime advisories only)"
  if ( cd fl_frontend && pnpm audit:prod ); then
    ok "no known runtime vulnerabilities"
  else
    warn "runtime advisories present — triage with: cd fl_frontend && pnpm audit"
  fi
fi

# --- db --------------------------------------------------------------------------------------------
# The other test tier, split from the default one because it needs the Docker daemon that --quick
# exists to avoid. Locally this was the gap: `pytest -m db` ran only in CI, so a change that broke
# the pipeline against a real mongod passed every local gate (ADR-0030).
if (( RUN_DB )); then
  step "fl_backend  (pytest -m db, against a real mongod)"
  ( cd fl_backend && "$PY" -m pytest -m db ) || die "fl_backend db-tier tests failed.
testcontainers starts and removes mongo:8 itself; a failure here is the code, not the daemon."
  ok "db-tier tests pass"
fi

# --- images ----------------------------------------------------------------------------------------
if (( RUN_IMAGES )); then
  # Reclaim the throwaway images on EVERY exit path, registered before the first build that creates
  # them. It has to be a trap: `die` calls exit directly, so a plain line at the end of the script
  # only runs when the gate passes — and a failed gate then leaves both tags behind, where the next
  # run moves them onto fresh images and orphans the old ones as untagged 369 MB layers that
  # nothing but `docker image prune` ever reclaims.
  trap 'docker image rm -f frankfurtleague-verify:frontend frankfurtleague-verify:backend >/dev/null 2>&1 || true' EXIT

  step "docker build — frontend  (the check pnpm verify cannot do)"
  docker build -q -f fl_frontend/Dockerfile -t frankfurtleague-verify:frontend fl_frontend >/dev/null \
    || die "The frontend image failed to build. This is the failure pnpm verify cannot see."
  ok "frontend image builds"

  step "docker build — backend"
  docker build -q -f fl_backend/Dockerfile -t frankfurtleague-verify:backend fl_backend >/dev/null \
    || die "The backend image failed to build."
  ok "backend image builds"

  step "image sanity: is instrumentation.js actually in the frontend image?"
  # From the repo root this file compiles but is not traced into the standalone output, which
  # silently disables the startup env gate and onRequestError. One command is cheaper than
  # rediscovering it.
  if docker run --rm --entrypoint sh frankfurtleague-verify:frontend -c '[ -f .next/server/instrumentation.js ]'; then
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
fl_frontend/src/core/config.ts, src/core/auth.ts, src/instrumentation.ts or a Dockerfile.
Locally that is:  ./scripts/verify.sh --images"
  fi
fi
