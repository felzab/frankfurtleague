#!/usr/bin/env bash
# Target platform: Linux (production server). Pulls published images and restarts the stack.
#
# Replaces restart_server.sh, which ran `docker compose down` and then `up` — a window where the site
# was simply gone — and never checked whether what came back was healthy. Since Wave 3 the frontend
# refuses to serve at all on a bad environment variable, so "it restarted" and "it works" are now
# genuinely different statements.
#
# This script NEVER builds. A server that builds is a server that can fail a build.
#
# Usage:
#   ./scripts/deploy.sh                  # deploy the current :frontend / :backend tags
#   ./scripts/deploy.sh sha-1a2b3c4      # deploy (or roll back to) a specific published tag

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
require_platform linux
require_docker

COMPOSE="docker-compose.yml"
PIN="${1:-}"

require_env_file "fl_frontend/.env"
require_env_file "fl_backend/.env"
[[ -f nginx.conf ]] || die "Missing nginx.conf — nginx mounts it read-only and will not start."
[[ -d certs ]]      || die "Missing certs/ — nginx mounts it read-only and will not start."

if [[ -n "$PIN" ]]; then
  step "Pinning to $PIN"
  docker pull "felzab/frankfurtleague:$PIN-frontend" || die "No such published tag: $PIN-frontend"
  docker pull "felzab/frankfurtleague:$PIN-backend"  || die "No such published tag: $PIN-backend"
  docker tag "felzab/frankfurtleague:$PIN-frontend" "$IMAGE_FRONTEND"
  docker tag "felzab/frankfurtleague:$PIN-backend"  "$IMAGE_BACKEND"
  ok "local :frontend / :backend now point at $PIN"
else
  step "Pulling the current images"
  docker pull "$IMAGE_FRONTEND" || die "pull failed for $IMAGE_FRONTEND"
  docker pull "$IMAGE_BACKEND"  || die "pull failed for $IMAGE_BACKEND"
fi

# Record what is running now, so a failed deploy has something to go back to.
PREV_FRONTEND="$(docker inspect --format '{{.Image}}' "$(docker compose -f "$COMPOSE" ps -q frontend 2>/dev/null)" 2>/dev/null || true)"
[[ -n "$PREV_FRONTEND" ]] && ok "previous frontend image recorded for rollback"

step "Recreating containers"
# No `down` first: compose recreates changed services in place, so the outage is seconds, not minutes.
docker compose -f "$COMPOSE" up -d --force-recreate --remove-orphans

step "Waiting for health"
if wait_healthy "$COMPOSE" backend 150 && wait_healthy "$COMPOSE" frontend 180; then
  printf '\n'; ok "Deploy healthy"
  step "Confirming the security headers reached the edge"
  curl -sI https://frankfurtleague.de 2>/dev/null | grep -iE "content-security-policy|strict-transport" | sed 's/^/      /' \
    || warn "Could not read headers over HTTPS — check nginx and the certificates."
  printf '\n      %s\n' "Logs: docker compose -f $COMPOSE logs -f frontend"
else
  printf '\n'
  warn "The new version is NOT healthy."
  warn "If the log says 'Invalid environment variables', that is the startup gate: fix those names in"
  warn "the .env and redeploy. nginx will not serve traffic while the frontend is unhealthy."
  if [[ -n "$PREV_FRONTEND" ]]; then
    printf '\n'
    warn "To roll back:  ./scripts/deploy.sh <previous sha- tag>"
    warn "Published tags:  docker image ls 'felzab/frankfurtleague'"
  fi
  exit 1
fi
