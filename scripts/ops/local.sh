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
#                                    league in scripts/ops/seed/seed.js; the sign-in store stays
#   ./scripts/ops/local.sh --e2e         start the end-to-end stack instead (docker-compose.e2e.yml):
#                                    its own volume, keys and made-up league, new on every start
#   ./scripts/ops/local.sh --e2e --landing=<state>
#                                    load the made-up league again into the RUNNING end-to-end stack,
#                                    the landing in <state> (seed.js's LANDING_STATES), and restart its
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

# The states `scripts/ops/seed/seed.js :: LANDING_STATES` seeds, which refuses any other name too, but only once
# Docker has been asked.
LANDING_STATES=(running running-two-one-side countdown countdown-with-opening decided window none)
if (( RESEED )); then
  if (( ! E2E || DOWN )); then
    refuse "--landing re-seeds the running end-to-end stack: run it as --e2e --landing=<state>, without --down."
  fi
  known=0
  for state in "${LANDING_STATES[@]}"; do
    if [[ "$state" == "$LANDING" ]]; then known=1; fi
  done
  if (( ! known )); then
    # A space between the names: `[*]` joins with the first character of IFS, a newline here.
    refuse "--landing=${LANDING} names no state of the landing. One of: $(IFS=' '; printf '%s' "${LANDING_STATES[*]}")."
  fi
fi

STOP_COMMAND="./scripts/ops/local.sh --down"
# Where the frontend files the mail it does not send, as each stack's compose file mounts it.
MAIL_SINK="${REPO_ROOT}/.tmp-mail"
if (( E2E )); then
  # Merged over the local stack's two, as that one merges over production's (docker-compose.e2e.yml).
  COMPOSE_FILE="${COMPOSE_FILE};docker-compose.e2e.yml"
  STOP_COMMAND="./scripts/ops/local.sh --e2e --down"
fi
# Compose as a developer types it beside this stack.
BY_HAND="COMPOSE_FILE='${COMPOSE_FILE}' TAG=${TAG} docker compose"

# Everything the end-to-end stack holds on the host: its keys and its mail sink, each at the path
# docker-compose.e2e.yml names. `.tmp-*/` is gitignored.
E2E_DIR="${REPO_ROOT}/.tmp-e2e"
if (( E2E )); then MAIL_SINK="${E2E_DIR}/mail"; fi

# The local stack's secret files, which docker-compose.e2e.yml points at this stack's own copies.
E2E_KEYS=(auth_secret internal_api_key_base internal_api_key_system internal_api_key_admin)

# Generated on every start rather than copied from `secrets/`: the stack shares nothing with the
# local one, and a key it held for longer than one run would be a key to keep. Nothing prints a
# value.
write_e2e_keys() {
  local -
  set +x
  local name=""
  (umask 077 && mkdir -p "${E2E_DIR}/secrets") || die "${E2E_DIR}/secrets could not be made; mkdir's own account is above."
  for name in "${E2E_KEYS[@]}"; do
    (umask 077 && openssl rand -hex 32 | tr -d '\r\n' > "${E2E_DIR}/secrets/${name}") \
      || die "the end-to-end stack's ${name} could not be generated; openssl's own account is above."
  done
}

# Read by mongosh inside the database container, where `127.0.0.1:27017` is that container's own
# server and nothing else's.
SEED_FILE="scripts/ops/seed/seed.js"
SEED_TARGET="/tmp/made-up-seed.js"

load_made_up_seed() {
  local base="" rc=0
  # The backend's own answer, the database it reads: `fl_backend/.env` names it for the local stack
  # and docker-compose.e2e.yml for the end-to-end one. Single quotes, so the container expands it.
  base="$(docker compose exec -T backend sh -c 'printf %s "$DB_BASE_NAME"')" || rc=$?
  if (( rc )); then
    die "the backend could not be asked which database it reads (exit ${rc}), so nothing was seeded.
compose's own account is above."
  fi
  # The backend's own pattern for the name.
  if [[ ! "$base" =~ ^[A-Za-z0-9_-]+$ ]]; then
    die "the backend reads a database name that is not one, so nothing was seeded."
  fi
  # Through stdin and into the container's own /tmp, written as the container's user: a bind mount
  # would differ between the two stacks.
  MSYS_NO_PATHCONV=1 docker compose exec -T mongo sh -c "cat > ${SEED_TARGET}" < "$SEED_FILE" \
    || die "the seed could not be handed to the database container; compose's own account is above."
  quietly run_made_up_seed "$base" \
    || die "the made-up seed did not load; mongosh's own account is above. A refused insert names
the index's key: correct scripts/ops/seed/seed.js."
  ok "seeded '${base}' with the made-up league"
}

# Its own function because MSYS rewrites the `/tmp` path. `--landing` hands its state to the seed through mongosh's
# environment; without it the seed reads none and writes itself as written.
run_made_up_seed() {
  local state=()
  if (( RESEED )); then state=(--env "SEED_LANDING=${LANDING}"); fi
  MSYS_NO_PATHCONV=1 docker compose exec -T "${state[@]}" mongo \
    mongosh --quiet "mongodb://127.0.0.1:27017/${1}?directConnection=true" --file "$SEED_TARGET"
}

# The backend's read-back over what the seed wrote: every document through its record model. It
# writes nothing.
judge_made_up_seed() {
  local rc=0
  quietly docker compose exec -T backend python -m app.readback || rc=$?
  case "$rc" in
    0) ok "every document the seed wrote reads back through its model" ;;
    1) die "the made-up seed holds a document its model refuses, and the lines above name it:
correct scripts/ops/seed/seed.js. The frontend and nginx have not been started or recreated." ;;
    *) refuse "the backend could not judge the seed (exit ${rc}); its own account is above.
The frontend and nginx have not been started or recreated." ;;
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

  step "The made-up league, the landing ${LANDING}"
  load_made_up_seed

  step "The backend's own check of what the seed wrote"
  judge_made_up_seed

  step "The frontend, recreated"
  quietly docker compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 240 frontend \
    || die "the frontend did not come back healthy, and compose's own account is above.
Its own lines:  ${BY_HAND} logs frontend"
  ok "recreated — no read of the earlier seed is cached"
  finish "The end-to-end stack serves the landing ${LANDING} at http://localhost:3000."
fi

section "preflight"

if (( E2E )); then
  # First, so every file docker-compose.e2e.yml names exists before compose is asked anything, and
  # every start runs on keys of its own. Written over a stack still running, whose next step is its
  # teardown below.
  step "This run's own keys"
  write_e2e_keys
  ok "generated under .tmp-e2e — none printed, none copied from secrets/"

  step "An empty end-to-end stack"
  # Every start from nothing, so no journey reads what an earlier run left: its database and its
  # sign-in store, its mail going below and its keys being new already.
  quietly docker compose down -v --remove-orphans || die "the end-to-end stack could not be torn down — the output above is compose's own."
  ok "torn down"
fi

if (( FRESH )); then
  step "Tearing down, including volumes"
  quietly docker compose down -v --remove-orphans || die "the stack could not be torn down — the output above is compose's own."
  ok "volumes removed — Next's cache rebuilds and the database starts empty; --seed-made-up fills it"
fi

# Emptied on every start, so a code an earlier run filed never reads as current.
step "Where the frontend writes the mail it does not send"
# Made here rather than left to the engine: a bind-mount source it creates is root-owned, and the
# frontend writes as `nextjs`.
mkdir -p "$MAIL_SINK" || die "the mail sink's directory could not be created; mkdir's own account is above."
# The names the frontend's mail sink gives each message, a timestamp and then `.html`.
rm -f -- "$MAIL_SINK"/*.html || die "a message an earlier run filed could not be removed from ${MAIL_SINK}; rm's own account is above."
ok "emptied — this run's withheld mail lands in ${MAIL_SINK#"$REPO_ROOT"/}"

section "build"

step "Building images from source"
docker compose build || die "The image build failed — its own output is above."
ok "images built"

# After the backend's boot, which gives every collection its indexes, so each insert meets them as
# it lands; before the frontend's, so no page renders, and no cache keeps, a read of a database
# still filling. The waits are the journeys' CI job's for the same starts.
if (( E2E || MADE_UP )); then
  section "database"

  step "The database and the backend, before anything renders a page"
  quietly docker compose up -d --force-recreate --remove-orphans --wait --wait-timeout 180 mongo backend \
    || die "the database and the backend did not both come up healthy, and compose's own account is above.
Each one's own lines:  ${BY_HAND} logs mongo backend"
  ok "database and backend up"

  step "The made-up league"
  load_made_up_seed

  step "The backend's own check of what the seed wrote"
  judge_made_up_seed
fi

section "start"

step "Starting the stack"
# The local stack recreates every service, so a frontend left running from an earlier start drops
# what it cached of a database `--seed-made-up` has just replaced. The end-to-end stack's database
# and backend are the ones just started and seeded, which a recreate would only restart.
UP=(up -d --remove-orphans --wait --wait-timeout 240)
if (( ! E2E )); then UP+=(--force-recreate); fi
if quietly docker compose "${UP[@]}"; then
  ok "every service is healthy"

  end_section
  CLOSING=("Open:               http://localhost:3000")
  if (( E2E )); then
    # Once: a run keeps the records it creates, which the next run would meet as already there.
    CLOSING+=("Run the journeys:   (cd fl_frontend && pnpm run e2e), once per start of this stack" \
              "Sign in as:         admin.desktop@example.com, its code in .tmp-e2e/mail" \
              "Logs:               ${BY_HAND} logs -f frontend" \
              "Stop:               ${STOP_COMMAND}")
  else
    # Offered only where it was not just done, so the table never names the step this run performed.
    (( MADE_UP )) || CLOSING+=("Fill the database:  ./scripts/ops/local.sh --seed-made-up")
    CLOSING+=("Security headers:   curl -sI http://localhost:3000 | grep -i content-security-policy" \
              "Logs:               ${BY_HAND} logs -f frontend" \
              "Stop:               ${STOP_COMMAND}")
  fi
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

if (( E2E )); then finish "The end-to-end stack is up at http://localhost:3000."; fi
finish "The local stack is up at http://localhost:3000."
