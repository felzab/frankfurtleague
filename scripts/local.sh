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
#   ./scripts/local.sh --verbose    stream each command's own output instead of capturing it
#   ./scripts/local.sh --help
#
# See:
# - docs/ops/spec.md — the environments, and what each of them does not cover

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

COMPOSE="docker-compose.local.yml"

# Arguments are parsed before any expensive or environmental check, so a typo fails instantly
# instead of demanding Docker be running first.
FRESH=0; FOLLOW=0; DOWN=0
# shellcheck disable=SC2034  # the --verbose arm assigns VERBOSE for _lib.sh's `quietly`
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --logs)  FOLLOW=1 ;;
    --down)  DOWN=1 ;;
    --verbose) VERBOSE=1 ;;
    --help|-h) usage ;;
    *)       die "Unknown option: ${arg}. Try --help." ;;
  esac
done

# Refused rather than silently ignored, which is the rule `scripts/deploy.sh` applies to its own
# nonsense combination: a flag that does nothing reads as a flag that did something.
if (( DOWN )) && (( FOLLOW )); then
  die "--down stops the stack, so there is no log left to follow.
Run one or the other."
fi

require_platform windows
require_docker

if (( DOWN )); then
  section "down"
  # --fresh combines: stop AND delete the volumes, instead of being silently ignored.
  if (( FRESH )); then
    step "Stopping the local stack and removing volumes"
    quietly docker compose -f "$COMPOSE" down -v --remove-orphans || die "the stack could not be stopped — the output above is compose's own."
    ok "stopped — the next start rebuilds Next's cache from scratch"
  else
    step "Stopping the local stack"
    # `--remove-orphans` here as well as on the way up: a service deleted from the compose file
    # leaves a container behind that nothing else on this machine will ever mention again.
    quietly docker compose -f "$COMPOSE" down --remove-orphans || die "the stack could not be stopped — the output above is compose's own."
    ok "stopped"
  fi
  finish
fi

section "preflight"

step "Files the containers read"
require_file "fl_frontend/.env" "The frontend container reads it via env_file. Copy it from your password manager."
require_file "fl_backend/.env"  "The backend container reads it via env_file."
ok "both .env files are in place"

step "Anything holding the build's files open"
# A running `next dev` holds .next open and makes the build fail with EBUSY on Windows. Never
# `grep -q` here: it closes the pipe on its first match, and under `pipefail` tasklist's SIGPIPE
# then fails the test exactly when there WAS a match.
if tasklist 2>/dev/null | grep -i "node.exe" >/dev/null; then
  info "node.exe is running — if the build fails with EBUSY, stop any 'pnpm dev' and retry"
else
  info "no node.exe running"
fi
ok "checked"

if (( FRESH )); then
  step "Tearing down, including volumes"
  quietly docker compose -f "$COMPOSE" down -v --remove-orphans || die "the stack could not be torn down — the output above is compose's own."
  ok "volumes removed — the next start rebuilds Next's cache from scratch"
fi

section "build"

step "Building images from source"
docker compose -f "$COMPOSE" build || die "The image build failed — its own output is above."
ok "images built"

section "start"

step "Starting the stack"
# Guarded, not bare: nginx depends on both services being HEALTHY, so `up` itself exits non-zero on
# an unhealthy start, and an unguarded call would take the error trap instead of the explanation
# below.
UP_RC=0
quietly docker compose -f "$COMPOSE" up -d --force-recreate --remove-orphans || UP_RC=$?
if (( UP_RC )); then
  fail "compose could not bring the stack up (exit ${UP_RC}); each service is asked what happened below"
else
  ok "containers started"
fi

step "Waiting for health"
HEALTHY=1
# Backend first, then frontend, which is the order `scripts/deploy.sh` waits in; and both are waited
# on even when the first fails, so one run reports every unhealthy service rather than the first.
wait_healthy "$COMPOSE" backend 150  || HEALTHY=0
wait_healthy "$COMPOSE" frontend 150 || HEALTHY=0
if (( UP_RC )); then HEALTHY=0; fi

if (( HEALTHY )); then
  ok "both services are healthy"
  end_section
  detail "Open:              http://localhost:3000" \
         "Security headers:  curl -sI http://localhost:3000 | grep -i content-security-policy" \
         "Logs:              docker compose -f $COMPOSE logs -f frontend" \
         "Stop:              ./scripts/local.sh --down"
else
  fail "The stack came up unhealthy."
  detail "If you see 'Invalid environment variables', fix those names in the .env files — that is" \
         "the startup gate doing its job." \
         "Stop what is left:  ./scripts/local.sh --down"
  finish
fi

# Before `finish`, which exits: the closing table is printed once the follow ends, and Ctrl-C out of
# the log reaches the library's interrupt handler rather than this script.
if (( FOLLOW )); then
  info "following the frontend log — Ctrl-C stops the log, not the stack"
  docker compose -f "$COMPOSE" logs -f frontend
fi

finish "The local stack is up at http://localhost:3000."
