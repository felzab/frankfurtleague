#!/usr/bin/env bash
#
# SCRIPTS · run the real production image on your own machine, behind the real nginx.
#
# `next dev` runs the app from source, so it exercises neither the standalone build, the startup
# environment gate, nginx nor the security headers — and so cannot see `instrumentation.ts` being
# dropped from the image, nor a module-scope `AUTH_URL` read failing in the builder stage.
#
#   ./scripts/ops/local.sh               build changed layers, start, wait for health
#   ./scripts/ops/local.sh --fresh       ALSO delete the volumes, and with them Next's build cache and the
#                                    local database — for when the stack behaves in a way the code
#                                    does not explain
#   ./scripts/ops/local.sh --seed-made-up
#                                    ALSO replace the local database's records with the made-up
#                                    league in fl_backend/tests/made_up_seed.py; the sign-in store stays
#   ./scripts/ops/local.sh --e2e         start the end-to-end stack instead (docker-compose.e2e.yml), through
#                                    scripts/ops/e2e_stack.sh as CI's journeys start it: its own volume,
#                                    keys and made-up league, new on every start
#   ./scripts/ops/local.sh --e2e --landing=<state>
#                                    load the made-up league again into the RUNNING end-to-end stack,
#                                    the landing in <state> (the seed's LANDING_STATES), and restart its
#                                    frontend; nothing is built, and sessions and passkeys stay.
#                                    It refuses any checkout but the one whose --e2e started the stack
#   ./scripts/ops/local.sh --down       stop the stack; with --fresh, also delete the volumes; with
#                                    --e2e, stop the end-to-end stack and delete all it holds
#   ./scripts/ops/local.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

# docker-compose.local.yml merged over docker-compose.yml, named for every call below by Compose's
# own variable:
# https://docs.docker.com/compose/how-tos/environment-variables/envvars/#compose_file
export COMPOSE_FILE="docker-compose.yml;docker-compose.local.yml"
# The base file names both images by the tag a deploy pins and refuses to parse without one; the
# local file builds both images in their place, so the word is never an image's.
export TAG=local

# Parsed before any environmental check, so a typo fails instantly instead of demanding Docker.
FRESH=0; DOWN=0; MADE_UP=0; E2E=0; RESEED=0; LANDING=""
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --down)  DOWN=1 ;;
    --seed-made-up) MADE_UP=1 ;;
    --e2e)   E2E=1 ;;
    --landing=*) RESEED=1; LANDING="${arg#--landing=}" ;;
    --help|-h) usage ;;
    # `refuse`, not `die`: an invocation nobody can carry out leaves this run with no verdict on the
    # stack, which the exit contract spells 2. 1 would say the stack is what needs fixing.
    *)       refuse "Unknown option: ${arg}. Try --help." ;;
  esac
done

# Stopped rather than ignored: the seed would run against a database this same invocation is taking
# down.
if (( DOWN && MADE_UP )); then
  refuse "--down stops the stack, so there is no database left to fill.
Run --seed-made-up on a start instead."
fi

# The end-to-end stack starts empty and takes the made-up league on every start: each of these flags
# would do nothing there.
if (( E2E )) && (( FRESH || MADE_UP )); then
  refuse "--e2e starts from an empty database and loads the made-up league on every start, so it
combines with neither --fresh nor --seed-made-up. Run --e2e alone, or with --down."
fi

# Which states there are is the seed's alone: it refuses any other name, once Docker has been asked.
if (( RESEED )) && (( ! E2E || DOWN )); then
  refuse "--landing re-seeds the running end-to-end stack: run it as --e2e --landing=<state>, without --down."
fi

STOP_COMMAND="./scripts/ops/local.sh --down"
# Where the local stack's frontend files the mail it does not send, as its compose file mounts it.
MAIL_SINK="${REPO_ROOT}/.tmp-mail"
if (( E2E )); then
  # Merged over the local stack's two, as that one merges over production's (docker-compose.e2e.yml).
  COMPOSE_FILE="${COMPOSE_FILE};docker-compose.e2e.yml"
  STOP_COMMAND="./scripts/ops/local.sh --e2e --down"
fi
# Compose as a developer types it beside this stack.
BY_HAND="COMPOSE_FILE='${COMPOSE_FILE}' TAG=${TAG} docker compose"

# Everything the end-to-end stack holds on the host, its keys and its mail sink among it, which
# scripts/ops/e2e_stack.sh writes. `.tmp-*/` is gitignored.
E2E_DIR="${REPO_ROOT}/.tmp-e2e"

# The made-up league loaded into the running backend's database and read back; `--landing` hands its
# state on. The script's own account is shown only on a failure.
load_made_up_seed() {
  local rc=0 landing=()
  if (( RESEED )); then landing=("--landing=${LANDING}"); fi
  quietly "${REPO_ROOT}/scripts/ops/made_up_seed.sh" "${landing[@]}" || rc=$?
  case "$rc" in
    0) ok "seeded the made-up league, and every document it wrote reads back through its model" ;;
    2) refuse "the made-up seed was refused, and the lines above say why.
The frontend and nginx have not been started or recreated." ;;
    *) die "the made-up seed failed, and the lines above name what to correct.
The frontend and nginx have not been started or recreated." ;;
  esac
}

# The script CI's journeys raise the stack with, its steps shown as they run and its verdict kept: a
# refusal stays 2.
e2e_stack() {
  local rc=0
  "${REPO_ROOT}/scripts/ops/e2e_stack.sh" "$@" || rc=$?
  case "$rc" in
    0) ;;
    2) refuse "the end-to-end stack was refused, and the lines above say why.
Stop what is left:  ${STOP_COMMAND}" ;;
    *) die "the end-to-end stack did not come up, and the lines above name what to correct.
Each service's own lines:  ${BY_HAND} logs <service>
Stop what is left:  ${STOP_COMMAND}" ;;
  esac
}

require_platform windows
require_docker

if (( DOWN )); then
  section "down"
  if (( E2E )); then
    step "Stopping the end-to-end stack and removing its volume"
    # Always the volume too: every start begins from an empty one, so nothing in it is kept.
    quietly docker compose down -v --remove-orphans || die "the stack could not be stopped — the output above is compose's own."
    # Its keys and its withheld mail, whose codes are live credentials, go with it.
    rm -rf "${E2E_DIR:?}"
    ok "stopped — its database, its keys and its withheld mail are gone"
  # --fresh combines: stop AND delete the volumes, instead of being silently ignored.
  elif (( FRESH )); then
    step "Stopping the local stack and removing volumes"
    quietly docker compose down -v --remove-orphans || die "the stack could not be stopped — the output above is compose's own."
    rm -rf "${MAIL_SINK:?}"
    ok "stopped — Next's cache rebuilds, and the database and the withheld mail are gone"
  else
    step "Stopping the local stack"
    # `--remove-orphans` here as well as on the way up: a service deleted from the compose file
    # leaves a container behind that nothing else on this machine will ever mention again.
    quietly docker compose down --remove-orphans || die "the stack could not be stopped — the output above is compose's own."
    # A withheld sign-in mail holds a live code, a credential nothing needs once the stack is down.
    rm -rf "${MAIL_SINK:?}"
    ok "stopped — the withheld mail is gone"
  fi
  finish
fi

# The running stack's database emptied and seeded again, its keys, its sign-in store and every image as they are; the
# frontend then recreated, since a reseed alone would leave the landing's read in Next's in-memory cache for minutes.
if (( RESEED )); then
  section "landing"

  step "The running end-to-end stack"
  services="$(docker compose ps --status running --services)" || die "compose could not list the stack's services; its own account is above."
  for service in mongo backend frontend; do
    grep -qx "$service" <<< "$services" || refuse "the end-to-end stack's ${service} is not running, so there is nothing to re-seed.
Start the stack with ./scripts/ops/local.sh --e2e first."
  done
  ok "running"

  # The stack's name is fixed, so a checkout that did not start it reaches it too, and the frontend
  # recreated below would take this checkout's keys, mail folder and compose files, which the rest of
  # the stack does not share. Compose labels each container with the absolute directory of the
  # project that created it; both sides are spelled by cygpath and compared without case, as Windows
  # compares paths.
  step "The checkout that started it"
  listed="$(docker compose ps -q)" || die "compose could not list the stack's containers; its own account is above."
  mapfile -t ids <<< "$listed"
  # Each line opened by a word, so a container without the label is a line of its own and never one
  # the command substitution drops at the end.
  created="$(docker inspect --format 'from {{index .Config.Labels "com.docker.compose.project.working_dir"}}' "${ids[@]}")" \
    || die "the stack's containers could not be inspected; docker's own account is above."
  here="$(cygpath -m "$REPO_ROOT")" || die "cygpath could not spell this checkout's directory as Windows does."
  declare -A others=()
  while IFS= read -r dir; do
    dir="${dir%$'\r'}"
    dir="${dir#from }"
    if [[ -z "$dir" ]]; then others["an unnamed directory"]=1; continue; fi
    dir="$(cygpath -m "$dir")" || die "cygpath could not read the directory a container was created from."
    if [[ "${dir,,}" != "${here,,}" ]]; then others["$dir"]=1; fi
  done <<< "$created"
  if (( ${#others[@]} )); then
    refuse "the running end-to-end stack's containers were created from $(IFS=' '; printf '%s' "${!others[*]}"), not from this checkout, ${here}.
Run --e2e --landing=<state> from the checkout whose --e2e started the stack, or start it here with --e2e."
  fi
  ok "started from this checkout"

  step "The made-up league, the landing ${LANDING}, and the backend's check of it"
  load_made_up_seed

  step "The frontend, recreated"
  quietly docker compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 240 frontend \
    || die "the frontend did not come back healthy, and compose's own account is above.
Its own lines:  ${BY_HAND} logs frontend"
  ok "recreated — no read of the earlier seed is cached"
  finish "The end-to-end stack serves the landing ${LANDING} at http://localhost:3000."
fi

if (( E2E )); then
  section "start"
  e2e_stack start --build
  e2e_stack serve
  ok "the end-to-end stack is healthy, the made-up league in its database"
  end_section
  # Once: a run keeps the records it creates, which the next run would meet as already there.
  detail "Open:               http://localhost:3000" \
         "Run the journeys:   (cd fl_frontend && pnpm run e2e), once per start of this stack" \
         "Sign in as:         admin.desktop@example.com, its code in .tmp-e2e/mail" \
         "Logs:               ${BY_HAND} logs -f frontend" \
         "Stop:               ${STOP_COMMAND}"
  finish "The end-to-end stack is up at http://localhost:3000."
fi

section "preflight"

if (( FRESH )); then
  step "Tearing down, including volumes"
  quietly docker compose down -v --remove-orphans || die "the stack could not be torn down — the output above is compose's own."
  ok "volumes removed — Next's cache rebuilds and the database starts empty; --seed-made-up fills it"
fi

# Emptied on every start, so a code an earlier run filed never reads as current.
step "Where the frontend writes the mail it does not send"
# Removed whole, as --down removes it, whatever names the frontend gives its messages.
rm -rf "${MAIL_SINK:?}" || die "the mail an earlier run filed could not be removed from ${MAIL_SINK}; rm's own account is above."
# Made here rather than left to the engine: a bind-mount source it creates is root-owned, and the
# frontend writes as `nextjs`.
mkdir -p "$MAIL_SINK" || die "the mail sink's directory could not be created; mkdir's own account is above."
ok "emptied — this run's withheld mail lands in ${MAIL_SINK#"$REPO_ROOT"/}"

section "build"

step "Building images from source"
docker compose build || die "The image build failed — its own output is above."
ok "images built"

# After the backend's boot, which gives every collection its indexes, so each insert meets them as
# it lands; before the frontend's, so no page renders, and no cache keeps, a read of a database
# still filling.
if (( MADE_UP )); then
  section "database"

  step "The database and the backend, before anything renders a page"
  quietly docker compose up -d --force-recreate --remove-orphans --wait --wait-timeout 180 mongo backend \
    || die "the database and the backend did not both come up healthy, and compose's own account is above.
Each one's own lines:  ${BY_HAND} logs mongo backend"
  ok "database and backend up"

  step "The made-up league, and the backend's check of it"
  load_made_up_seed
fi

section "start"

step "Starting the stack"
# Every service recreated, so a frontend left running from an earlier start drops what it cached of
# a database `--seed-made-up` has just replaced.
if quietly docker compose up -d --force-recreate --remove-orphans --wait --wait-timeout 240; then
  ok "every service is healthy"

  end_section
  CLOSING=("Open:               http://localhost:3000")
  # Offered only where it was not just done, so the table never names the step this run performed.
  (( MADE_UP )) || CLOSING+=("Fill the database:  ./scripts/ops/local.sh --seed-made-up")
  CLOSING+=("Security headers:   curl -sI http://localhost:3000 | grep -i content-security-policy" \
            "Logs:               ${BY_HAND} logs -f frontend" \
            "Stop:               ${STOP_COMMAND}")
  detail "${CLOSING[@]}"
else
  fail "The stack came up unhealthy, and compose's own account is above."
  docker compose ps --all 2>&1 | detail || true
  detail "If you see 'Invalid environment variables', fix those names in the .env files — that is" \
         "the startup gate doing its job." \
         "'Invalid secret files: <FILES>' or 'Unreadable secret files: <PATH> (<ERRNO>)' names a" \
         "file under secrets/ to write, or to give its owner and mode." \
         "A line opening 'backend_mongodb_uri:' is the backend's other refusal, and its continuation says" \
         "which: the value yielded no server, the server refused to authenticate it, or nothing" \
         "answered. Neither refusal prints a value, so the file it names is what to read." \
         "Each service's own lines:  ${BY_HAND} logs <service>" \
         "Stop what is left:  ${STOP_COMMAND}"
  finish
fi

finish "The local stack is up at http://localhost:3000."
