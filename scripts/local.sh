#!/usr/bin/env bash
#
# scripts/local.sh — run the REAL production image on your own machine, behind the real nginx.
# TARGET PLATFORM: Windows (your development machine).
#
# WHY THIS EXISTS, and why `pnpm dev` is not enough:
#   `next dev` runs the app from source. It never produces the standalone build, never runs the
#   startup environment gate, never goes through nginx, and never applies the security headers.
#   Wave 3 found two defects that EVERY dev-mode check passed:
#     - instrumentation.ts at the repo root compiles fine and is then dropped from the image,
#       silently disabling the env gate and all production error logging;
#     - a module-scope read of AUTH_URL that only fails in the builder stage, where there is no .env.
#   This script is the only place those are visible before a deploy.
#
# USAGE:
#   ./scripts/local.sh              build changed layers, start, wait for health
#   ./scripts/local.sh --fresh      ALSO delete the volumes first (see below)
#   ./scripts/local.sh --logs       start, then follow the frontend log
#   ./scripts/local.sh --down       stop the stack and exit
#   ./scripts/local.sh --help
#
# WHY --fresh IS NOT THE DEFAULT:
#   --fresh runs `docker compose down -v`, which deletes the named volumes. Those hold Next.js's
#   build cache, so the next build has to redo work it had already done — typically minutes rather
#   than seconds. The default is the fast path because it is correct the overwhelming majority of the
#   time: Docker rebuilds any layer whose inputs changed. Reach for --fresh when the stack behaves in
#   a way the code does not explain, which almost always means a stale cached asset.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_platform windows

COMPOSE="docker-compose.local.yml"

# Arguments are parsed before any expensive or environmental check, so a typo fails instantly
# instead of demanding Docker be running first.
FRESH=0; FOLLOW=0; DOWN=0
for arg in "${@:-}"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --logs)  FOLLOW=1 ;;
    --down)  DOWN=1 ;;
    --help|-h) usage ;;
    "")      ;;
    *)       die "Unknown option: ${arg}. Try --help." ;;
  esac
done

require_docker

if (( DOWN )); then
  step "Stopping the local stack"; docker compose -f "$COMPOSE" down; ok "stopped"; exit 0
fi

require_file "fl_frontend/.env" "The frontend container reads it via env_file. Copy it from your password manager."
require_file "fl_backend/.env"  "The backend container reads it via env_file."

# A running `next dev` holds .next open and makes the build fail with EBUSY on Windows.
if tasklist 2>/dev/null | grep -qi "node.exe"; then
  warn "node.exe is running. If the build fails with EBUSY, stop any 'pnpm dev' and retry."
fi

if (( FRESH )); then
  step "Tearing down, including volumes"
  docker compose -f "$COMPOSE" down -v
  ok "volumes removed — the next start rebuilds Next's cache from scratch"
fi

step "Building images from source"
docker compose -f "$COMPOSE" build

step "Starting the stack"
docker compose -f "$COMPOSE" up -d --force-recreate

step "Waiting for health"
if wait_healthy "$COMPOSE" frontend 150 && wait_healthy "$COMPOSE" backend 150; then
  printf '\n'
  ok "Local stack is up: http://localhost:3000"
  printf '      %s\n' "Security headers:  curl -sI http://localhost:3000 | grep -i content-security-policy"
  printf '      %s\n' "Logs:              docker compose -f $COMPOSE logs -f frontend"
  printf '      %s\n' "Stop:              ./scripts/local.sh --down"
else
  printf '\n'
  die "The stack came up unhealthy. If you see 'Invalid environment variables', fix those names in the .env files — that is the startup gate doing its job."
fi

(( FOLLOW )) && docker compose -f "$COMPOSE" logs -f frontend
