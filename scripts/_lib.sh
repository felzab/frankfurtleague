#!/usr/bin/env bash
#
# scripts/_lib.sh — shared helpers. SOURCED by the other scripts, never run directly.
#
# Anything used by more than one script lives here so there is exactly one copy to fix.
#
# ---------------------------------------------------------------------------------------------------
# Why the strict mode flags below matter (they are the difference between a script that stops on a
# problem and one that carries on doing damage):
#
#   set -e            stop at the first command that fails, instead of running the rest anyway
#   set -u            treat an unset variable as an error, so a typo cannot expand to an empty string
#                     (the classic disaster being `rm -rf "$DIR/"` where $DIR was misspelled)
#   set -o pipefail   a pipeline fails if ANY stage fails, not just the last one. Without it,
#                     `docker build ... | tee log` reports success whenever `tee` succeeds.
#   IFS=$'\n\t'       split words on newlines and tabs only, never on spaces, so a path containing a
#                     space stays one argument
# ---------------------------------------------------------------------------------------------------

set -euo pipefail
IFS=$'\n\t'

# Resolve the repo root from this file's own location and move there. Every script therefore behaves
# identically no matter which directory it was called from — the mistake that produced several
# confusing "path not found" build failures during the Wave 3 session.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Absolute path of the script that sourced this file, resolved BEFORE the cd below.
# --help reads a script's own header back, and a relative path stops resolving once we cd.
# BASH_SOURCE[1] is the sourcing script; [0] is this file.
# The ${x-default} form (no colon) survives `set -u` even when the array element does not exist.
_caller="${BASH_SOURCE[1]-${BASH_SOURCE[0]-$0}}"
SELF="$(cd "$(dirname "$_caller")" && pwd)/$(basename "$_caller")"
unset _caller

cd "$REPO_ROOT"

# --- Image naming -----------------------------------------------------------------------------------
# Docker Hub's free plan allows ONE private repository, so both services share it and are told apart
# by tag prefix. Tags are ordered <service>-<qualifier> rather than <qualifier>-<service> on purpose:
# Docker Hub and `docker image ls` sort alphabetically, so this groups every frontend tag together.
#
#   frankfurtleague:frontend                 <- moving pointer, what prod runs by default
#   frankfurtleague:frontend-sha-1a2b3c4     <- immutable, one per published commit
DOCKER_REPO="felzab/frankfurtleague"
# shellcheck disable=SC2034  # consumed by the scripts that source this file
IMAGE_FRONTEND="${DOCKER_REPO}:frontend"
# shellcheck disable=SC2034  # consumed by the scripts that source this file
IMAGE_BACKEND="${DOCKER_REPO}:backend"

# --- Output ----------------------------------------------------------------------------------------
# Colour only when writing to a terminal, so redirected logs stay clean of escape codes.
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'
else
  C_RESET=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''
fi

step() { printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_RESET"; }
ok()   { printf '%s  ok %s %s\n'  "$C_GREEN"  "$C_RESET" "$*"; }
info() { printf '%s   · %s %s\n'  "$C_BLUE"   "$C_RESET" "$*"; }
warn() { printf '%s  !! %s %s\n'  "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '\n%s  ✗ %s %s\n\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# Prints this script's own header comment as its help text, so usage can never drift from the
# code. Stops at the first line that is not a comment.
usage() {
  awk 'NR>1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$SELF"
  exit 0
}

# Report exactly what failed when a script dies unexpectedly.
#
# `set -e` otherwise exits in complete silence, leaving you to guess. The three values are passed in
# at the moment the trap FIRES, which is what makes them accurate:
#   $?            the exit status
#   $LINENO       the failing line. It MUST be passed as an argument — referencing it inside the trap
#                 body reports where the trap was defined, which is this file, not your script.
#   $BASH_COMMAND the text of the command that failed, which is usually all you need to see.
on_error() {
  local rc="$1" line="$2" cmd="$3"
  printf '
%s  ✗ %s %s failed
' "$C_RED" "$C_RESET" "${SELF##*/}" >&2
  printf '       line %s:  %s
' "$line" "$cmd" >&2
  printf '       exit status %s

' "$rc" >&2
  exit "$rc"
}
trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

# --- Guards ----------------------------------------------------------------------------------------

# Docker Desktop stops more often than expected, and its raw error ("npipe:////./pipe/...") explains
# nothing to anyone who has not seen it before.
require_docker() {
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
    || die "Docker is not responding.
       Start Docker Desktop (Windows) or 'sudo systemctl start docker' (Linux),
       wait until it reports running, then try again."
}

# Keeps the prod script off a laptop and the local script off the server. Both mistakes are one
# mistyped filename away and both are disruptive.
require_platform() {
  local want="$1" have
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) have=windows ;;
    Linux)                have=linux   ;;
    Darwin)               have=macos   ;;
    *)                    have=unknown ;;
  esac
  [[ "$have" == "$want" ]] || die "This script targets ${want}; this machine looks like ${have}.
       See scripts/README.md for which script belongs to which environment."
}

# Absolute path to fl_backend's virtualenv interpreter. The venv layout differs by platform --
# Scripts/python.exe on Windows, bin/python on Linux -- and verify.sh runs on both.
venv_python() {
  local win="${REPO_ROOT}/fl_backend/.venv/Scripts/python.exe"
  local nix="${REPO_ROOT}/fl_backend/.venv/bin/python"
  if   [[ -x "$win" ]]; then printf '%s' "$win"
  elif [[ -x "$nix" ]]; then printf '%s' "$nix"
  else die "No fl_backend virtualenv found. Create it with:  cd fl_backend && uv sync --dev"
  fi
}

require_file() { [[ -f "$1" ]] || die "Missing required file: $1
       ${2:-}"; }
require_dir()  { [[ -d "$1" ]] || die "Missing required directory: $1
       ${2:-}"; }

# --- Git -------------------------------------------------------------------------------------------
git_sha()    { git rev-parse --short=7 HEAD; }
git_branch() { git rev-parse --abbrev-ref HEAD; }
git_clean()  { [[ -z "$(git status --porcelain)" ]]; }

# --- Health ----------------------------------------------------------------------------------------
# Waits for a compose service to report healthy.
#
# This exists because "the container started" and "the app works" became different statements in
# Wave 3: on a bad environment variable the frontend stays up but returns 500 on every route, so the
# healthcheck fails and nginx never serves traffic. That is deliberate fail-closed behaviour, and it
# is invisible unless something actually waits for and reports the health state.
wait_healthy() {
  local compose_file="$1" service="$2" timeout="${3:-150}" waited=0 state cid
  info "waiting for '${service}' to become healthy (up to ${timeout}s)"
  while (( waited < timeout )); do
    cid="$(docker compose -f "$compose_file" ps -q "$service" 2>/dev/null || true)"
    if [[ -z "$cid" ]]; then
      warn "'${service}' has no running container"
      docker compose -f "$compose_file" logs --tail=30 "$service" 2>&1 | sed 's/^/       /'
      return 1
    fi
    # A service with no healthcheck reports "" — treat "running" as good enough for those.
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
    case "$state" in
      healthy|running) ok "'${service}' is ${state}"; return 0 ;;
      unhealthy)
        warn "'${service}' reports UNHEALTHY. Its own explanation, if it gave one:"
        docker compose -f "$compose_file" logs --tail=60 "$service" 2>&1 \
          | grep -iE "invalid environment|failed to prepare|error|refused" | head -12 | sed 's/^/       /' \
          || echo "       (nothing obvious in the log — see the full log below)"
        return 1 ;;
    esac
    sleep 3; waited=$(( waited + 3 ))
  done
  warn "'${service}' did not become healthy within ${timeout}s. Last 30 log lines:"
  docker compose -f "$compose_file" logs --tail=30 "$service" 2>&1 | sed 's/^/       /'
  return 1
}

# Reads the commit an image was built from, out of the image's own OCI label. This is how the server
# can answer "what is actually running?" without trusting a tag name that may have been moved.
# Reads one OCI label off an image, or returns EMPTY if it is absent.
#
# `docker image inspect` SUCCEEDS and prints an empty line for a missing label, so a trailing
# `|| echo unknown` never fires — hence the explicit emptiness test.
#
# These return the RAW value with exactly one sentinel: the empty string. An earlier version returned
# a human-readable "unlabelled (...)" sentence instead, which broke both of its callers in deploy.sh —
# they still compared against the previous sentinel, and one interpolated the sentence into a
# suggested command. Formatting for humans belongs to the caller; see image_revision_display.
_image_label() {
  local image="$1" label="$2" value=""
  value="$(docker image inspect --format "{{index .Config.Labels \"${label}\"}}" "$image" 2>/dev/null)" || true
  [[ "$value" == "<no value>" ]] && value=""
  printf '%s' "$value"
}
image_revision() { _image_label "$1" "org.opencontainers.image.revision"; }
image_created()  { _image_label "$1" "org.opencontainers.image.created";  }

# Human-readable form for status output only. Never use this in a comparison or a command.
image_revision_display() {
  local v; v="$(image_revision "$1")"
  [[ -n "$v" ]] && printf '%s' "$v" || printf 'unlabelled (built before publish.sh added OCI labels)'
}
image_created_display() {
  local v; v="$(image_created "$1")"
  [[ -n "$v" ]] && printf '%s' "$v" || printf 'unknown'
}
