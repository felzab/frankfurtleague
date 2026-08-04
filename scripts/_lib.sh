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
# identically no matter which directory it was called from — without this, a relative path fails
# with a confusing "path not found" that depends on where the caller happened to stand.
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
# One package per service on GitHub Container Registry, so the service name lives in the REPOSITORY
# and the tag says only which build it is (ADR-0017):
#
#   ghcr.io/felzab/frankfurtleague-frontend:latest          <- moving pointer, what prod runs
#   ghcr.io/felzab/frankfurtleague-frontend:sha-1a2b3c4     <- immutable, one per published commit
#
# The packages are PUBLIC, which is what makes anonymous pulls work: the server needs no docker
# login and no token that can expire mid-deploy. A pull failing with an authentication error almost
# always means a package was left private, not that credentials are missing.
REGISTRY="ghcr.io"
# shellcheck disable=SC2034  # consumed by the scripts that source this file
REPO_FRONTEND="${REGISTRY}/felzab/frankfurtleague-frontend"
# shellcheck disable=SC2034  # consumed by the scripts that source this file
REPO_BACKEND="${REGISTRY}/felzab/frankfurtleague-backend"
# shellcheck disable=SC2034  # consumed by the scripts that source this file
IMAGE_FRONTEND="${REPO_FRONTEND}:latest"
# shellcheck disable=SC2034  # consumed by the scripts that source this file
IMAGE_BACKEND="${REPO_BACKEND}:latest"

# --- Output ----------------------------------------------------------------------------------------
# THE OUTPUT STANDARD. Every script speaks through these helpers and nothing writes its own
# formatting, so every script reads identically at a glance. The vocabulary, one verb per meaning:
#
#   ==> Title       step  — one phase of work. Bold, blank line before, starts the step timer.
#    ok  message    ok    — a phase or check succeeded. A step that ran 3s or longer gets its
#                           elapsed time appended automatically.
#     ·  message    info  — neutral progress detail.
#    --  message    skip  — something deliberately not run, and why. Dim, so it cannot be
#                           mistaken for a pass.
#    !!  message    warn  — wrong but not fatal. Goes to stderr.
#     ✗  message    die   — fatal. Goes to stderr and exits non-zero.
#
# Two rules make the column discipline free at the call site:
#   - every message column starts at column 7, and a MULTI-LINE message needs no hand alignment —
#     the helpers indent continuation lines themselves. Write the message naturally.
#   - supporting output that belongs to the line above it — a log excerpt, a findings list, a
#     block of follow-up commands — goes through `detail`, which indents its arguments (or stdin)
#     to the same column.
#
# Colour: on for a terminal, and in GitHub Actions, whose log renders ANSI. NO_COLOR set to
# anything forces it off (https://no-color.org), FORCE_COLOR forces it on. Redirected local logs
# therefore stay clean of escape codes.
if [[ -n "${NO_COLOR:-}" ]]; then
  _colour=0
elif [[ -t 1 || -n "${FORCE_COLOR:-}" || -n "${GITHUB_ACTIONS:-}" ]]; then
  _colour=1
else
  _colour=0
fi
if (( _colour )); then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
else
  C_RESET=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_BOLD=''; C_DIM=''
fi
unset _colour

# The single funnel: tag in a four-column gutter, message at column 7, continuation lines indented
# to match. The tags arrive pre-padded — printf's %4s pads by BYTES, so it mis-pads the multibyte
# `·` and `✗` — and everything below goes through here.
_emit() {
  local colour="$1" tag="$2" first=1 line
  shift 2
  while IFS= read -r line; do
    if (( first )); then
      printf '%s%s%s  %s\n' "$colour" "$tag" "$C_RESET" "$line"
      first=0
    else
      printf '      %s\n' "$line"
    fi
  done <<< "$*"
}

step() { _STEP_T0=$SECONDS; printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_RESET"; }
info() { _emit "$C_BLUE"   "   ·" "$*"; }
skip() { _emit "$C_DIM"    "  --" "$*"; }
warn() { _emit "$C_YELLOW" "  !!" "$*" >&2; }
die()  { printf '\n' >&2; _emit "$C_RED" "   ✗" "$*" >&2; printf '\n' >&2; exit 1; }

# ok appends the running step's elapsed time once it is long enough to be worth reading — that is
# what makes a slow gate's log answer "where did the minutes go" without any caller keeping time.
ok() {
  local suffix=""
  if [[ -n "${_STEP_T0:-}" ]] && (( SECONDS - _STEP_T0 >= 3 )); then
    suffix=" ${C_DIM}($(fmt_duration $(( SECONDS - _STEP_T0 ))))${C_RESET}"
  fi
  _emit "$C_GREEN" "  ok" "$*${suffix}"
}

# Indents supporting output to the message column: each argument on its own line, or stdin when
# called with none. Replaces every hand-rolled `sed 's/^/       /'` and aligned printf.
detail() {
  if (( $# )); then printf '      %s\n' "$@"
  else sed 's/^/      /'
  fi
}

# 47 -> "47s"; 154 -> "2m 34s". For the ok timer and for a script's own total.
fmt_duration() {
  local s="$1"
  if (( s < 120 )); then printf '%ss' "$s"
  else printf '%sm %02ds' $(( s / 60 )) $(( s % 60 ))
  fi
}

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
  printf '\n' >&2
  _emit "$C_RED" "   ✗" "${SELF##*/} failed
line ${line}:  ${cmd}
exit status ${rc}" >&2
  printf '\n' >&2
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

require_file() { [[ -f "$1" ]] || die "Missing required file: $1${2:+
$2}"; }
require_dir()  { [[ -d "$1" ]] || die "Missing required directory: $1${2:+
$2}"; }

# --- Git -------------------------------------------------------------------------------------------
git_sha()    { git rev-parse --short=7 HEAD; }
git_branch() { git rev-parse --abbrev-ref HEAD; }
git_clean()  { [[ -z "$(git status --porcelain)" ]]; }

# --- Health ----------------------------------------------------------------------------------------
# Waits for a compose service to report healthy.
#
# This exists because "the container started" and "the app works" became different statements in
# practice: on a bad environment variable the frontend stays up but returns 500 on every route, so the
# healthcheck fails and nginx never serves traffic. That is deliberate fail-closed behaviour, and it
# is invisible unless something actually waits for and reports the health state.
wait_healthy() {
  local compose_file="$1" service="$2" timeout="${3:-150}" waited=0 state cid
  info "waiting for '${service}' to become healthy (up to ${timeout}s)"
  while (( waited < timeout )); do
    cid="$(docker compose -f "$compose_file" ps -q "$service" 2>/dev/null || true)"
    if [[ -z "$cid" ]]; then
      warn "'${service}' has no running container"
      docker compose -f "$compose_file" logs --tail=30 "$service" 2>&1 | detail
      return 1
    fi
    # A service with no healthcheck reports "" — treat "running" as good enough for those.
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
    case "$state" in
      healthy|running) ok "'${service}' is ${state}"; return 0 ;;
      unhealthy)
        warn "'${service}' reports UNHEALTHY. Its own explanation, if it gave one:"
        docker compose -f "$compose_file" logs --tail=60 "$service" 2>&1 \
          | grep -iE "invalid environment|failed to prepare|error|refused" | head -12 | detail \
          || detail "(nothing obvious in the log — see the full log below)"
        return 1 ;;
    esac
    sleep 3; waited=$(( waited + 3 ))
  done
  warn "'${service}' did not become healthy within ${timeout}s. Last 30 log lines:"
  docker compose -f "$compose_file" logs --tail=30 "$service" 2>&1 | detail
  return 1
}

# Reads the commit an image was built from, out of the image's own OCI label. This is how the server
# can answer "what is actually running?" without trusting a tag name that may have been moved.
# Reads one OCI label off an image, or returns EMPTY if it is absent.
#
# `docker image inspect` SUCCEEDS and prints an empty line for a missing label, so a trailing
# `|| echo unknown` never fires — hence the explicit emptiness test.
#
# These return the RAW value with exactly one sentinel: the empty string. Never a human-readable
# sentence — deploy.sh compares the value and interpolates it into a suggested command, and a prose
# sentinel breaks both. Formatting for humans belongs to the caller; see image_revision_display.
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
