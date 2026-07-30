#!/usr/bin/env bash
#
# scripts/verify.sh — the complete pre-merge gate.
# TARGET PLATFORM: any. It builds and runs read-only checks, with one exception: step 2 reformats
# the working tree. `pnpm verify` now runs `pnpm format` (prettier in write mode) as its FIRST
# command, so a run may leave formatting changes for you to commit. Every later check then measures
# the formatted tree rather than one that is still moving. In CI, commit or diff those changes — do
# not assume the tree is untouched afterwards.
#
# NOTE: do not name any other tool's flags in this header. Check 8 of selfcheck.sh treats every
# double-dashed word in this comment block as a documented flag of THIS script, and fails when the
# case statement below has no match for it.
#
# WHAT IT RUNS, cheapest-to-fail first:
#   1. selfcheck.sh  — the scripts themselves (instant)
#   2. pnpm verify   — formats, then types, lint, next build, unit tests (audit ledger Part 4)
#   3. pnpm audit:prod — runtime dependency advisories only
#   4. ruff + pytest  — fl_backend lint and schema-constraint tests (audit ledger BE-5)
#   5. docker build  — BOTH images, which pnpm verify does not cover
#   6. an image check — is instrumentation.js actually inside the frontend image?
#
# WHY STEPS 5 AND 6 EXIST:
#   `pnpm verify` has been green while the image was broken. Twice.
#     - a module-scope read of AUTH_URL failed only in the builder stage, where there is no .env;
#     - instrumentation.ts at the repo root compiled, passed every test, and was then dropped from
#       output:"standalone" — silently disabling the startup env gate AND all production error
#       logging. Step 6 is a one-command check for exactly that.
#
# USAGE:
#   ./scripts/verify.sh           everything (the image build takes a few minutes)
#   ./scripts/verify.sh --quick   skip the image build — NOT sufficient before a merge if you
#                                 touched src/core/config.ts, src/core/auth.ts or src/instrumentation.ts
#   ./scripts/verify.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

QUICK=0
for arg in "$@"; do
  case "$arg" in
    --quick)   QUICK=1 ;;
    --help|-h) usage ;;
    *)         die "Unknown option: ${arg}. Try --help." ;;
  esac
done


# Runs first because it is instant and because a broken script would make everything below it
# unreliable. See selfcheck.sh for the class of bug bash -n cannot see.
step "scripts/ self-check"
if bash scripts/selfcheck.sh >/dev/null 2>&1; then
  ok "scripts are internally consistent"
else
  die "scripts/selfcheck.sh failed. Run it directly to see why:  ./scripts/selfcheck.sh"
fi

step "pnpm verify  (prettier --write, then tsc, eslint, next build, node --test)"
( cd fl_frontend && pnpm verify ) || die "pnpm verify failed. Fix that before looking at anything else."
ok "pnpm verify exit 0"

step "pnpm audit:prod  (runtime advisories only)"
if ( cd fl_frontend && pnpm audit:prod ); then
  ok "no known runtime vulnerabilities"
else
  warn "runtime advisories present — triage with: cd fl_frontend && pnpm audit --prod"
fi

step "fl_backend  (ruff + pytest)"
_py="$(venv_python)"
( cd fl_backend && "$_py" -m ruff check app tests && "$_py" -m ruff format --check app tests )   || die "ruff failed in fl_backend. Fix with:  cd fl_backend && .venv/Scripts/python -m ruff format app tests"
( cd fl_backend && "$_py" -m pytest ) || die "fl_backend tests failed."
ok "backend lint and schema tests pass"

if (( QUICK )); then
  printf '\n'; warn "Skipped the image build (--quick). Do NOT merge on this alone if you touched"
  printf '      %s\n' "src/core/config.ts, src/core/auth.ts or src/instrumentation.ts."
  exit 0
fi

require_docker
step "docker build — frontend  (the check pnpm verify cannot do)"
docker build -q -f fl_frontend/Dockerfile -t frankfurtleague-verify:frontend fl_frontend >/dev/null \
  || die "The frontend image failed to build. This is the failure pnpm verify cannot see."
ok "frontend image builds"

step "docker build — backend"
docker build -q -f fl_backend/Dockerfile -t frankfurtleague-verify:backend fl_backend >/dev/null \
  || die "The backend image failed to build."
ok "backend image builds"

step "Image sanity: is instrumentation.js actually in the frontend image?"
# From the repo root this file compiles but is not traced into output:"standalone", which silently
# disables the startup env gate and onRequestError. One command is cheaper than rediscovering it.
if docker run --rm --entrypoint sh frankfurtleague-verify:frontend -c '[ -f .next/server/instrumentation.js ]'; then
  ok "instrumentation.js present — env gate and error logging will run"
else
  die "instrumentation.js is MISSING from the image. It must live at fl_frontend/src/instrumentation.ts, not the repo root."
fi

docker image rm -f frankfurtleague-verify:frontend frankfurtleague-verify:backend >/dev/null 2>&1 || true
printf '\n'; ok "Full gate green — safe to merge."
