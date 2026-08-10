#!/usr/bin/env bash
#
# SCRIPTS · run the real production image on your own machine, behind the real nginx.
#
# `next dev` runs the app from source, so it exercises neither the standalone build, the startup
# environment gate, nginx nor the security headers. Two things it therefore cannot see:
# `instrumentation.ts` at the repository root compiles and is then dropped from the image, silently
# disabling the env gate and all production error logging; and a module-scope read of `AUTH_URL`
# fails only in the builder stage, where there is no .env.
#
#   ./scripts/local.sh              build changed layers, start, wait for health
#   ./scripts/local.sh --fresh      ALSO delete the volumes, and Next's build cache with them — for
#                                   when the stack behaves in a way the code does not explain
#   ./scripts/local.sh --logs       start, then follow the frontend log
#   ./scripts/local.sh --down       stop the stack; with --fresh, also delete the volumes
#   ./scripts/local.sh --help
#
# See:
# - docs/ops/spec.md — the environments, and what each of them does not cover

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

COMPOSE="docker-compose.local.yml"

# Arguments are parsed before any expensive or environmental check, so a typo fails instantly
# instead of demanding Docker be running first.
FRESH=0; FOLLOW=0; DOWN=0
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --logs)  FOLLOW=1 ;;
    --down)  DOWN=1 ;;
    --help|-h) usage ;;
    *)       die "Unknown option: ${arg}. Try --help." ;;
  esac
done

require_platform windows
require_docker

if (( DOWN )); then
  # --fresh combines: stop AND delete the volumes, instead of being silently ignored.
  if (( FRESH )); then
    step "Stopping the local stack and removing volumes"
    docker compose -f "$COMPOSE" down -v
    ok "stopped — the next start rebuilds Next's cache from scratch"
  else
    step "Stopping the local stack"
    docker compose -f "$COMPOSE" down
    ok "stopped"
  fi
  exit 0
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
  detail "Security headers:  curl -sI http://localhost:3000 | grep -i content-security-policy" \
         "Logs:              docker compose -f $COMPOSE logs -f frontend" \
         "Stop:              ./scripts/local.sh --down"
else
  printf '\n'
  die "The stack came up unhealthy. If you see 'Invalid environment variables', fix those names in the .env files — that is the startup gate doing its job."
fi

# An `if` block, not `(( FOLLOW )) && ...`: as the final command of the script, that compound
# evaluates to 1 whenever FOLLOW is 0, so a completely successful run exits non-zero and any caller
# checking the exit status reads every success as a failure.
if (( FOLLOW )); then
  docker compose -f "$COMPOSE" logs -f frontend
fi
