#!/usr/bin/env bash
# Target platform: Windows (dev machine). Runs the PRODUCTION image locally, behind the local nginx.
#
# This is the only environment that exercises the standalone build, the startup env gate, the nginx
# security headers and `output: "standalone"` file tracing. `next dev` exercises none of them, and
# Wave 3 found two defects that every dev-mode check passed.
#
# Usage:
#   ./scripts/local.sh            # build changed layers and start
#   ./scripts/local.sh --fresh    # also destroy volumes first (clears stale Next assets)
#   ./scripts/local.sh --logs     # start, then follow the frontend log
#   ./scripts/local.sh --down     # stop the stack and leave

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_platform windows

COMPOSE="docker-compose.local.yml"

# Arguments are parsed before any expensive or environmental check, so a typo fails instantly
# instead of demanding Docker be running first.
FRESH=0; FOLLOW=0; DOWN=0
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --logs)  FOLLOW=1 ;;
    --down)  DOWN=1 ;;
    *)       die "Unknown option: $arg (see the header of this script)" ;;
  esac
done

require_docker

if (( DOWN )); then
  step "Stopping the local stack"; docker compose -f "$COMPOSE" down; ok "stopped"; exit 0
fi

require_env_file "fl_frontend/.env"
require_env_file "fl_backend/.env"

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
