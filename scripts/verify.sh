#!/usr/bin/env bash
# Target platform: Windows (dev machine). The complete pre-merge gate.
#
# `pnpm verify` is Part 4 of the audit ledger and covers types, lint, format, build and tests.
# It does NOT cover the Docker image build, and that gap has bitten twice:
#   - a module-scope read of AUTH_URL that only fails in the builder stage (no .env there);
#   - instrumentation.ts at the repo root, which compiles and is then dropped from the image,
#     silently disabling the env gate AND all production error logging.
# Both passed `pnpm verify`. So this script runs both, in the order that fails cheapest first.
#
# Usage:
#   ./scripts/verify.sh          # pnpm verify, then the image build
#   ./scripts/verify.sh --quick  # pnpm verify only (skip the ~4 min image build)

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_platform windows

QUICK=0
[[ "${1:-}" == "--quick" ]] && QUICK=1
[[ -n "${1:-}" && "${1:-}" != "--quick" ]] && die "Unknown option: $1"

step "pnpm verify  (tsc, eslint, prettier, next build, node --test)"
( cd fl_frontend && pnpm verify ) || die "pnpm verify failed. Fix that before looking at anything else."
ok "pnpm verify exit 0"

step "pnpm audit:prod  (runtime advisories only)"
if ( cd fl_frontend && pnpm audit:prod ); then
  ok "no known runtime vulnerabilities"
else
  warn "runtime advisories present — see the audit ledger R3b-S10.1"
fi

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
