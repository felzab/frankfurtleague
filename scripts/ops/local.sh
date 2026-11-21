#!/usr/bin/env bash
#
# SCRIPTS · run the real production image on your own machine, behind the real nginx.
#
# Built as production's images are, so it exercises the standalone build, the startup environment gate,
# nginx and the security headers — and so sees `instrumentation.ts` dropped from the image, or a
# module-scope `AUTH_URL` read failing in the builder stage, which no test run of the source can.
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
#                                    frontend; nothing is built, and sessions and passkeys stay
#   ./scripts/ops/local.sh --down       stop the stack; with --fresh, also delete the volumes; with
#                                    --e2e, stop the end-to-end stack and delete all it holds
#   ./scripts/ops/local.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh" || exit 3

# docker-compose.local.yml merged over docker-compose.yml, named for every call below by Compose's
# own variable.
export COMPOSE_FILE="docker-compose.yml;docker-compose.local.yml"
# The stack's name, the one Compose gives the primary checkout's directory, over any a caller's variable
# or a `.env` sets: `--down --fresh` deletes the named stack's volumes, the local database among them.
export COMPOSE_PROJECT_NAME="frankfurtleague"
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
  # Merged over the local stack's two, as that one merges over production's.
  COMPOSE_FILE="${COMPOSE_FILE};docker-compose.e2e.yml"
  # The stack's name as docker-compose.e2e.yml gives it, which a caller's variable or a `.env` would
  # outrank: `--down` deletes the named stack's volume, and `--landing` empties its database.
  export COMPOSE_PROJECT_NAME="frankfurtleague-e2e"
  STOP_COMMAND="./scripts/ops/local.sh --e2e --down"
fi
# Compose as a developer types it beside this stack.
BY_HAND="COMPOSE_FILE='${COMPOSE_FILE}' TAG=${TAG} docker compose"

# Everything the end-to-end stack holds on the host, its keys and its mail sink among it.
# `.tmp-*/` is gitignored.
E2E_DIR="${REPO_ROOT}/.tmp-e2e"

# The made-up league loaded into the running backend's database; `--landing` hands its
# state on. The script's own account is shown only on a failure, and it annotates its own ending.
load_made_up_seed() {
  local landing=()
  if (( RESEED )); then landing=("--landing=${LANDING}"); fi
  run_contract --summary \
    "the made-up seed failed, and the lines above name what to correct.
The frontend has not been started or recreated." \
    "the made-up seed was refused, and the lines above say why.
The frontend has not been started or recreated." \
    quietly "${REPO_ROOT}/scripts/ops/made_up_seed.sh" "${landing[@]}"
  ok "seeded the made-up league"
}

# The script CI's journeys raise the stack with, its steps shown as they run and its verdict kept: a
# refusal stays 2, an interrupt 130 and a crash its own status, each annotated by the script itself.
e2e_stack() {
  run_contract --summary \
    "the end-to-end stack did not come up, and the lines above name what to correct.
Each service's own lines:  ${BY_HAND} logs <service>
Stop what is left:  ${STOP_COMMAND}" \
    "the end-to-end stack was refused, and the lines above say why.
Stop what is left:  ${STOP_COMMAND}" \
    "${REPO_ROOT}/scripts/ops/e2e_stack.sh" "$@"
}

# Whether a line of `$2` is `$1` whole, a carriage return a Windows tool ends it with aside.
holds_line() { # $1 the line · $2 the text
  [[ $'\n'"${2//$'\r'/}"$'\n' == *$'\n'"$1"$'\n'* ]]
}

require_platform windows
require_docker
require_compose

if (( DOWN )); then
  section "down"
  if (( E2E )); then
    step "Stopping the end-to-end stack and removing its volume"
    # Always the volume too: every start begins from an empty one, so nothing in it is kept.
    quietly docker compose down -v --remove-orphans
    # Its keys and its withheld mail, whose codes are live credentials, go with it.
    rm -rf "${E2E_DIR:?}"
    ok "stopped — its database, its keys and its withheld mail are gone"
  # --fresh combines: stop AND delete the volumes, instead of being silently ignored.
  elif (( FRESH )); then
    step "Stopping the local stack and removing volumes"
    quietly docker compose down -v --remove-orphans
    rm -rf "${MAIL_SINK:?}"
    ok "stopped — Next's cache rebuilds, and the database and the withheld mail are gone"
  else
    step "Stopping the local stack"
    # `--remove-orphans` here as well as on the way up: a service deleted from the compose file
    # leaves a container behind that nothing else on this machine will ever mention again.
    quietly docker compose down --remove-orphans
    # A withheld sign-in mail holds a live code, a credential nothing needs once the stack is down.
    rm -rf "${MAIL_SINK:?}"
    ok "stopped — the withheld mail is gone"
  fi
  finish
fi

# The running stack's database emptied and seeded again, its keys, its sign-in store and every image
# as they are; the frontend then recreated, since a reseed alone would leave the landing's read in
# Next's in-memory cache for minutes.
if (( RESEED )); then
  section "landing"

  step "The running end-to-end stack"
  services="$(docker compose ps --status running --services)"
  for service in mongo backend nginx; do
    holds_line "$service" "$services" || refuse "the end-to-end stack's ${service} is not running, so there is nothing to re-seed.
Start the stack with ./scripts/ops/local.sh --e2e first."
  done
  # In any state: the seed needs it stopped, and a re-seed that failed leaves it so.
  existing="$(docker compose ps --all --services)"
  holds_line frontend "$existing" || refuse "the end-to-end stack has no frontend, so there is nothing to re-seed.
Start the stack with ./scripts/ops/local.sh --e2e first."
  ok "running"

  # The seed writes only a database nothing else writes, and the recreate below starts it again.
  step "The frontend, stopped"
  quietly docker compose stop frontend
  ok "stopped"

  step "The made-up league, the landing ${LANDING}"
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
  quietly docker compose down -v --remove-orphans
  ok "volumes removed — Next's cache rebuilds and the database starts empty; --seed-made-up fills it"
fi

# Emptied on every start, so a code an earlier run filed never reads as current.
step "Where the frontend writes the mail it does not send"
# Removed whole, as --down removes it, whatever names the frontend gives its messages.
rm -rf "${MAIL_SINK:?}"
# Made here rather than left to the engine: a bind-mount source it creates is root-owned, and the
# frontend writes as `nextjs`.
mkdir -p "$MAIL_SINK"
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

  # A frontend left running from an earlier start: the seed writes only a database nothing else writes.
  step "The database and the backend, before anything renders a page"
  quietly docker compose stop frontend
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
# a database `--seed-made-up` has just replaced. Its finding is worded below, with what to read next.
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
  # An account of a failure already counted, so a listing compose cannot give is said and passed.
  if listing="$(docker compose ps --all)"; then
    detail <<<"$listing"
  else
    detail "compose could not list the services; its own account is above."
  fi
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
