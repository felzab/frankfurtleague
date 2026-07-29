#!/usr/bin/env bash
# Shared helpers. Sourced, never executed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"   # every script runs from the repo root, so no caller can get this wrong

IMAGE_FRONTEND="felzab/frankfurtleague:frontend"
IMAGE_BACKEND="felzab/frankfurtleague:backend"

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BOLD=$'\033[1m'
else
  C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BOLD=""
fi

step() { printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_RESET"; }
ok()   { printf '%s  ok%s  %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s  !!%s  %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
die()  { printf '%s  xx%s  %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# Docker Desktop stops more often than you expect; a clear message beats a raw npipe error.
require_docker() {
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
    || die "Docker is not responding. Start Docker Desktop and wait for it to finish starting."
}

# Keeps prod scripts off a laptop and local scripts off the server.
require_platform() {
  local want="$1" have
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) have="windows" ;;
    Linux)                have="linux" ;;
    *)                    have="other" ;;
  esac
  [[ "$have" == "$want" ]] \
    || die "This script targets $want; this machine looks like $have. See scripts/README.md."
}

require_env_file() {
  [[ -f "$1" ]] || die "Missing $1 — the stack cannot start without it. Copy it from your password manager."
}

git_sha()   { git rev-parse --short HEAD; }
git_clean() { [[ -z "$(git status --porcelain)" ]]; }

# Waits for a compose service to report healthy, and surfaces the app's own log line if it does not.
# The env gate deliberately leaves the container running-but-500ing, so "not healthy" is the signal.
wait_healthy() {
  local compose_file="$1" service="$2" timeout="${3:-120}" waited=0 state
  while (( waited < timeout )); do
    state="$(docker compose -f "$compose_file" ps --format '{{.Health}}' "$service" 2>/dev/null | head -1)"
    [[ "$state" == "healthy" ]] && { ok "$service is healthy"; return 0; }
    if [[ "$state" == "unhealthy" ]]; then
      warn "$service went unhealthy. Its own explanation, if any:"
      docker compose -f "$compose_file" logs --tail=40 "$service" 2>&1 \
        | grep -iE "invalid environment|failed to prepare|error" | head -10 | sed 's/^/      /'
      return 1
    fi
    sleep 3; waited=$(( waited + 3 ))
  done
  warn "$service did not become healthy within ${timeout}s"
  docker compose -f "$compose_file" logs --tail=30 "$service" 2>&1 | sed 's/^/      /'
  return 1
}
