#!/usr/bin/env bash
#
# SCRIPTS · shared helpers — sourced by every other script, never run directly.
#
# Anything more than one script needs lives here, so there is one copy to fix. Sourcing it also
# applies strict mode and installs the error trap.
#
# See:
# - docs/ops/spec.md — the script conventions, and the output standard these helpers implement

set -euo pipefail
IFS=$'\n\t'

# Every script behaves identically whatever directory it was called from. Without this, a relative
# path fails with a "path not found" that depends on where the caller happened to stand.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Resolved BEFORE the cd below: `--help` reads a script's own header back, and a relative path stops
# resolving once we cd. The ${x-default} form (no colon) survives `set -u` even when the array
# element does not exist.
_caller="${BASH_SOURCE[1]-${BASH_SOURCE[0]-$0}}"
SELF="$(cd "$(dirname "$_caller")" && pwd)/$(basename "$_caller")"
unset _caller

cd "$REPO_ROOT"

# --- Image naming -----------------------------------------------------------------------------------

# One package per service (ADR-0012). The packages are public, which is what makes anonymous pulls
# work — no docker login on the server, and no token that expires mid-deploy. A pull failing to
# authenticate means a package was left private.
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

# Every script speaks through the helpers below and nothing writes formatting of its own. The verbs,
# what each means and the line shape they print are the output standard in `docs/ops/spec.md` §1.7.

# Colour is on for a terminal and in GitHub Actions, whose log renders ANSI. NO_COLOR forces it off
# (https://no-color.org) and FORCE_COLOR forces it on — except FORCE_COLOR=0, which the npm
# ecosystem defines as "off" and which is honoured the same way.
if [[ -n "${NO_COLOR:-}" || "${FORCE_COLOR:-}" == "0" ]]; then
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

# The funnel every verb below uses but `step` and `detail`, which own their line shapes. Tags arrive
# pre-padded because printf's %4s pads by BYTES and mis-pads the multibyte tags.
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

# One verb per meaning, each defined in `docs/ops/spec.md` §1.7.
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

# Supporting output belonging to the line above it — a log excerpt, a findings list, a block of
# follow-up commands — indented to the same message column, from arguments or from stdin.
detail() {
  if (( $# )); then printf '      %s\n' "$@"
  else sed 's/^/      /'
  fi
}

# Captures a command's output and prints it through `detail` only on failure, so a green run stays
# readable and a red one loses nothing. VERBOSE=1 streams instead of capturing.
quietly() {
  local out rc=0
  if (( ${VERBOSE:-0} )); then
    "$@" || rc=$?
  else
    out="$("$@" 2>&1)" || rc=$?
    if (( rc )); then printf '%s\n' "$out" | detail; fi
  fi
  return "$rc"
}

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

# Report exactly what failed when a script dies unexpectedly: `set -e` otherwise exits in complete
# silence. The three values are passed in at the moment the trap fires, which is what makes them
# accurate.

# `$LINENO` must be passed as an argument — referenced inside the trap body it reports where the
# trap was defined, which is this file rather than the script that failed.
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

# Any interpreter able to run the stdlib-only checkers in scripts/: the backend venv's where it
# exists, otherwise whatever is on PATH. Prints nothing and returns 1 when there is none.

# Deliberately not `venv_python`, which dies: the scope check runs on every verify.sh invocation,
# `--frontend` included, and failing that for a missing backend virtualenv buys a prerequisite for
# nothing. The caller decides what an absent one means.
any_python() {
  local win="${REPO_ROOT}/fl_backend/.venv/Scripts/python.exe"
  local nix="${REPO_ROOT}/fl_backend/.venv/bin/python"
  if   [[ -x "$win" ]]; then printf '%s' "$win"
  elif [[ -x "$nix" ]]; then printf '%s' "$nix"
  elif command -v python3 >/dev/null 2>&1; then printf 'python3'
  elif command -v python  >/dev/null 2>&1; then printf 'python'
  else return 1
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

# A started container and a working app are different statements: on a bad environment variable the
# frontend stays up and 500s on every route, so the healthcheck fails and nginx serves nothing —
# fail-closed, and invisible unless something waits on it.
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

# Reads one OCI label off an image, or returns empty where it is absent. `docker image inspect`
# succeeds and prints an empty line for a missing label, so a trailing `|| echo unknown` never
# fires — hence the explicit emptiness test.

# These return the raw value with exactly one sentinel, the empty string: deploy.sh compares the
# value and interpolates it into a suggested command, and a prose sentinel breaks both. Formatting
# for humans belongs to the caller.
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
  [[ -n "$v" ]] && printf '%s' "$v" || printf 'unlabelled (not built by publish.sh)'
}
image_created_display() {
  local v; v="$(image_created "$1")"
  [[ -n "$v" ]] && printf '%s' "$v" || printf 'unknown'
}
