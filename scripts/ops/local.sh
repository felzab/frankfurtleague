#!/usr/bin/env bash
#
# SCRIPTS · run the real production image on your own machine, behind the real nginx.
#
# `next dev` runs the app from source, so it exercises neither the standalone build, the startup
# environment gate, nginx nor the security headers — and so cannot see `instrumentation.ts` being
# dropped from the image, nor a module-scope `AUTH_URL` read failing in the builder stage.
#
#   ./scripts/ops/local.sh               build changed layers, start, wait for health
#   ./scripts/ops/local.sh --fresh       ALSO delete the volumes, and with them Next's build cache, the
#                                    local database and the copy of production under .local-db —
#                                    for when the stack behaves in a way the code does not explain,
#                                    and for leaving a machine holding no contact records
#   ./scripts/ops/local.sh --seed        ALSO fill the local database from production, reusing the copy
#                                    in .local-db where there is one
#   ./scripts/ops/local.sh --refresh-db  as --seed, but take a new copy from production first
#   ./scripts/ops/local.sh --seed-made-up
#                                    ALSO replace the local database's records with the made-up
#                                    league in scripts/ops/seed/seed.js; the sign-in store stays
#   ./scripts/ops/local.sh --e2e         start the end-to-end stack instead (docker-compose.e2e.yml):
#                                    its own volume, keys and made-up league, new on every start;
#                                    refused while another stack holds port 3000 or 27017
#   ./scripts/ops/local.sh --logs        start, then follow the frontend log
#   ./scripts/ops/local.sh --down        stop the stack; with --fresh, also delete the volumes; with
#                                    --e2e, stop the end-to-end stack and delete all it holds
#   ./scripts/ops/local.sh --verbose     stream each command's own output instead of capturing it
#   ./scripts/ops/local.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

# Windows' docker defaults to this separator, spelled so a reader need not know that default.
export COMPOSE_PATH_SEPARATOR=";"
# docker-compose.local.yml merged over docker-compose.yml, named for every call below by Compose's
# own variable:
# https://docs.docker.com/compose/how-tos/environment-variables/envvars/#compose_file
export COMPOSE_FILE="docker-compose.yml;docker-compose.local.yml"

# Parsed before any environmental check, so a typo fails instantly instead of demanding Docker.
FRESH=0; FOLLOW=0; DOWN=0; SEED=0; REFRESH_DB=0; MADE_UP=0; E2E=0
# shellcheck disable=SC2034  # the --verbose arm assigns VERBOSE for _lib.sh's `quietly`
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --logs)  FOLLOW=1 ;;
    --down)  DOWN=1 ;;
    --seed)  SEED=1 ;;
    # A new copy is only ever taken in order to restore it, so this is --seed plus a refusal to
    # reuse what is already on disk.
    --refresh-db) SEED=1; REFRESH_DB=1 ;;
    --seed-made-up) MADE_UP=1 ;;
    --e2e)   E2E=1 ;;
    --verbose) VERBOSE=1 ;;
    --help|-h) usage ;;
    # `refuse`, not `die`: an invocation nobody can carry out leaves this run with no verdict on the
    # stack, which the exit contract spells 2 (`docs/ops/spec.md` §1.7). 1 would say the stack is
    # what needs fixing.
    *)       refuse "Unknown option: ${arg}. Try --help." ;;
  esac
done

# Stopped rather than ignored: a flag that does nothing reads as a flag that did something.
if (( DOWN )) && (( FOLLOW )); then
  refuse "--down stops the stack, so there is no log left to follow.
Run one or the other."
fi

# Stopped for --down --logs' reason: the restore would run against a database this same invocation
# is taking down.
if (( DOWN )) && (( SEED || MADE_UP )); then
  refuse "--down stops the stack, so there is no database left to fill.
Run --seed or --seed-made-up on a start instead."
fi

# Two fills of one database: whichever ran second would leave the other's records half replaced.
if (( SEED )) && (( MADE_UP )); then
  refuse "--seed fills the database with production's copy and --seed-made-up with the made-up league.
Run one or the other."
fi

# The end-to-end stack starts empty and takes the made-up league on every start, and production's
# copy never enters it: each of these flags would do nothing there or do what it must not.
if (( E2E )) && (( FRESH || SEED || MADE_UP )); then
  refuse "--e2e starts from an empty database and loads the made-up league on every start, and never
takes production's copy, so it combines with none of --fresh, --seed, --refresh-db and --seed-made-up.
Run --e2e alone, or with --down, --logs or --verbose."
fi

STOP_COMMAND="./scripts/ops/local.sh --down"
if (( E2E )); then
  # Merged over the local stack's two, as that one merges over production's (docker-compose.e2e.yml).
  COMPOSE_FILE="${COMPOSE_FILE};docker-compose.e2e.yml"
  STOP_COMMAND="./scripts/ops/local.sh --e2e --down"
fi

# Gitignored: a copy of the production database, and this repository is public.
DUMP_DIR="${REPO_ROOT}/.local-db/dump"
# Beside the copy rather than inside it, because mongorestore reads every entry of the directory it
# is pointed at and neither of these is a collection.
DUMP_LOG="${REPO_ROOT}/.local-db/copy.log"
# What says a copy is WHOLE. mongodump fills its output directory as it goes, so an interrupted copy
# leaves one behind that a directory test would read as finished.
DUMP_MARK="${REPO_ROOT}/.local-db/complete"

# The copy's login: a read-only one, on the application database alone. No development machine
# holds production's write login, so the stack's own is an inline config of
# `docker-compose.local.yml` (`docs/ops/runbooks.md` §16).
DUMP_URI_FILE="secrets/dump_mongodb_uri"

# Two containers, never one: only the credential-bearing invocation is handed a mongodump command,
# and `restore_dump` is handed no credential at all. A discipline, not a boundary -- the image
# carries both tools.
take_dump() {
  # Into a gitignored file, never a terminal and never partly filtered: a failed mongodump quotes
  # the connection string back in shapes no pattern could be trusted to cover. A mounted file keeps
  # it out of the host's process list.
  local base=""
  # The database's name alone out of the backend's file, which is no credential: the file is not
  # handed over whole.
  base="$(sed -n 's/^DB_BASE_NAME=//p' fl_backend/.env | tail -n 1)"

  # The local stack's mongo to the digest (`docker-compose.local.yml`, `docs/ops/spec.md` §1.1), so the
  # copy and the server it restores into are one build.
  DB_BASE_NAME="$base" MSYS_NO_PATHCONV=1 docker run --rm -i \
    -e DB_BASE_NAME \
    -v "/${REPO_ROOT}/${DUMP_URI_FILE}:/run/secrets/dump_mongodb_uri:ro" \
    -v "/${REPO_ROOT}/.local-db/dump:/dump" \
    mongo:8.3.13@sha256:0e900a3364da37b76d642b73b0bba56bd4c6c509ab470cf700436fd866bee3ff sh -s >"$DUMP_LOG" 2>&1 <<'CONTAINER'
set -e
# The file keeps its quotes and a Windows editor's CR on the way in, and mongodump answers a URI
# holding either with a parse error. The dotenv line keeps a CR alone, the preflight refusing every
# other spelling.
q=$(printf '"\047')
clean() { printf '%s' "$1" | tr -d '\r\n' | sed -e "s/^[$q]//" -e "s/[$q]\$//"; }
uri=$(clean "$(cat /run/secrets/dump_mongodb_uri)")
base=$(printf '%s' "$DB_BASE_NAME" | tr -d '\r')
# The application database alone: the Flex tier denies `admin`, and this login reads no other
# database -- least privilege working. One collection at a time stays under the
# tier's rate cap.
mongodump --uri="$uri" --db="$base" --numParallelCollections=1 --out=/dump
CONTAINER
}

# Chained, because `||` runs this with errexit off: a clear failing unchecked lets mongodump write
# over the old copy's remains, and the marker then calls the two vintages one copy. The marker
# first, so a half-cleared directory is never trusted.
clear_dump() {
  rm -f "$DUMP_MARK" && rm -rf "${DUMP_DIR:?}" && mkdir -p "$DUMP_DIR"
}

# Where `docker-compose.local.yml` mounts the directory `fl_frontend/src/core/mail.ts :: MAIL_SINK_DIR`
# names inside the frontend's container.
MAIL_SINK_TARGET="/app/.tmp-mail"

# Emptied on every start, so a code an earlier run filed never reads as current
# (`docs/ops/spec.md` §1.5).
empty_mail_sink() {
  # Off, so a trace never prints the rendered model, which carries every value of both `.env` files.
  local -
  set +x
  local model="" rc=0 source="" probe="" rest="" root="" sink="" file removed=0
  model="$(docker compose config --format json 2>/dev/null)" || rc=$?
  if (( rc )); then
    refuse "compose could not render the local stack's model (exit ${rc}), so the mail sink was not found
and nothing in it was removed. NOTHING has been started. Ask it directly:  docker compose config"
  fi
  # A bind's source precedes its target inside its own object in compose's model.
  local mount='"source": "([^"]*)",[^{}]*"target": "'"${MAIL_SINK_TARGET//./\\.}"'"'
  if [[ ! "$model" =~ $mount ]]; then
    refuse "compose's model mounts nothing at ${MAIL_SINK_TARGET}, so the mail sink was not found and nothing
was removed. NOTHING has been started."
  fi
  # JSON doubles a Windows path's backslashes; forward slashes are a path both shells read.
  source="${BASH_REMATCH[1]//\\\\/\\}"
  source="${source//\\//}"
  # Through the deepest directory that exists, followed to where its links lead: judged before
  # anything is made, so a source outside the checkout is never created either.
  probe="$source"
  while [[ -n "$probe" && ! -d "$probe" ]]; do rest="/${probe##*/}${rest}"; probe="${probe%/*}"; done
  root="$(cd "$REPO_ROOT" && pwd -P)"
  if [[ -n "$probe" ]]; then sink="$(cd "$probe" && pwd -P)${rest}"; fi
  if [[ "$sink" != "$root"/* ]]; then
    refuse "the mail sink compose mounts is ${source}, which leads outside the checkout ${root}, so nothing
there was removed. Point the frontend's ${MAIL_SINK_TARGET} mount in docker-compose.local.yml back
inside it. NOTHING has been started."
  fi
  # Never left to the engine: a bind-mount source it creates is root-owned, and the frontend writes
  # as `nextjs` (`docs/ops/spec.md` §1.2 records the same decision for the access log).
  mkdir -p "$sink" || die "the mail sink's directory could not be created, and the frontend cannot make
it either: it runs as a non-root user under a root-owned /app. mkdir's own account is above."
  # `fl_frontend/src/core/mail.ts :: sinkFileStem`'s names: a timestamp, then `.html`.
  for file in "$sink"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*.html; do
    [[ -f "$file" && ! -L "$file" ]] || continue
    rm -f -- "$file" || die "a message an earlier run filed could not be removed from ${sink}; rm's own account is above."
    removed=$(( removed + 1 ))
  done
  ok "emptied — ${removed} message(s) an earlier run filed removed; this run's withheld mail lands in ${sink#"$root"/}"
}

restore_dump() {
  # Inside the mongo container, which holds the tools and the copy mount: no plumbing, no
  # credential. MSYS_NO_PATHCONV because MSYS rewrites `/dump`. Never --quiet, which hides the
  # document count and makes a real restore and a no-op identical.
  MSYS_NO_PATHCONV=1 docker compose exec -T mongo \
    mongorestore --uri="mongodb://localhost:27017/?directConnection=true" --drop /dump
}

# Asked of the CONTAINER, the one question a host-side test cannot answer: mongorestore pointed at
# an empty directory writes nothing and exits 0, and counting what the database holds afterwards
# cannot tell this restore from the one before it.
dump_collections_seen() {
  MSYS_NO_PATHCONV=1 docker compose exec -T mongo \
    sh -c 'find /dump -name "*.bson" | wc -l'
}

# Before the database container exists, not merely before the application ones: `clear_dump`
# deletes and recreates the directory `docker-compose.local.yml :: mongo` bind-mounts, which is
# only safe while no container holds the mount.
fetch_copy() {
  step "A copy to restore from"
  mkdir -p "$(dirname "$DUMP_LOG")"
  # The marker and not the directory: an interrupted copy leaves a directory behind.
  if (( REFRESH_DB )) || [[ ! -f "$DUMP_MARK" ]]; then
    info "copying from production, one collection at a time — the Flex tier throttles past 500 ops/s"
    require_file "$DUMP_URI_FILE" "The copy is taken with a read-only login's URI, and only that one: docs/ops/runbooks.md §16."
    clear_dump || refuse ".local-db could not be cleared for a new copy — the line above names the entry
that refused — so nothing was copied: a copy written over the remains of the old one would be two
vintages under one marker."
    quietly take_dump || die "the copy from production failed, and nothing was written to the
local database. mongodump's own account is in .local-db/copy.log, which is not printed here and
not committable: it names the cluster this machine connects to."
    # Only now: the marker is the whole of what the reuse test trusts.
    : >"$DUMP_MARK"
    ok "copied"
  else
    info "reusing the copy in .local-db — --refresh-db takes a new one"
    ok "found"
  fi
}

# Called before the application services exist, so nothing can read the database between its
# coming up and its holding something.
restore_copy() {
  step "Restoring it into the local database"
  # Asked and answered are two questions: an exec that could not run and a container that saw an
  # empty directory both leave `seen` empty, and only the second says anything about the copy.
  local seen="" ask_rc=0
  seen="$(dump_collections_seen | tr -d '[:space:]')" || ask_rc=$?
  if (( ask_rc )); then
    refuse "the database container could not be asked what is under /dump (exit ${ask_rc}), so
whether a restore would write anything is not what this run established. compose's own
explanation is above."
  fi
  if [[ ! "$seen" =~ ^[0-9]+$ ]]; then
    refuse "the database container answered '${seen}' when asked how many collections are under
/dump, which is not a count, so whether a restore would write anything is not what this run
established."
  fi
  if (( seen == 0 )); then
    die "the database container sees no collection under /dump, so a restore would write nothing.
Take a fresh copy with:  ./scripts/ops/local.sh --refresh-db"
  fi
  quietly restore_dump || die "the restore failed — mongorestore's own output is above."
  ok "restored — ${seen} collection(s), and the local stack is reading its own data"
}

# Everything the end-to-end stack holds on the host: its keys, its mail sink and its access log, each
# at the path docker-compose.e2e.yml names. `.tmp-*/` is gitignored.
E2E_DIR="${REPO_ROOT}/.tmp-e2e"

# The local stack's secret files, which docker-compose.e2e.yml points at this stack's own copies.
E2E_KEYS=(auth_secret sperrliste_schluessel internal_api_key_base internal_api_key_system internal_api_key_admin)

# Generated on every start rather than copied from `secrets/`: the stack shares nothing with the
# local one, and a key it held for longer than one run would be a key to keep. Each command is
# `docs/ops/runbooks.md` §16's own, and nothing prints a value.
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

# Both stacks publish nginx on 3000 and the database on 27017, so a container of another stack
# holding either port makes `up` fail half-started. Asked of the engine, by port rather than by
# project name: the local stack's name is its checkout's directory, so every worktree's differs.
refuse_another_stack_on_the_ports() {
  local own="" listed="" id="" name="" project="" ports="" rc=0
  local -a held=()
  own="$(docker compose ps -q 2>/dev/null)" || rc=$?
  if (( rc )); then
    refuse "compose could not be asked which containers are this stack's own (exit ${rc}), so whether
another stack holds port 3000 or 27017 is not what this run established. NOTHING has been started."
  fi
  # `|`, which no id, container name, project name or port list holds.
  listed="$(docker ps --no-trunc --format '{{.ID}}|{{.Names}}|{{.Label "com.docker.compose.project"}}|{{.Ports}}')" || rc=$?
  if (( rc )); then
    refuse "the engine could not be asked which containers publish a port (exit ${rc}). NOTHING has been started."
  fi
  while IFS='|' read -r id name project ports; do
    [[ "$ports" == *":3000->"* || "$ports" == *":27017->"* ]] || continue
    # A whole line, so one id never matches as part of another.
    if [[ $'\n'"${own}"$'\n' == *$'\n'"${id}"$'\n'* ]]; then continue; fi
    held+=("${name}, compose project '${project:-none}'")
  done <<<"$listed"
  (( ${#held[@]} )) || return 0
  refuse "another stack holds port 3000 or 27017, which this one publishes too:
$(printf '  %s\n' "${held[@]}")
Stop it first: the local stack with ./scripts/ops/local.sh --down, the end-to-end stack with
./scripts/ops/local.sh --e2e --down. NOTHING has been started."
}

# Read by mongosh inside the database container, where `127.0.0.1:27017` is that container's own
# server and nothing else's (`scripts/ops/seed/seed.js`).
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
  # The backend's own pattern for the name (`fl_backend/app/core/config.py :: db_base_name`).
  if [[ ! "$base" =~ ^[A-Za-z0-9_-]+$ ]]; then
    die "the backend reads a database name that is not one, so nothing was seeded."
  fi
  # Through stdin and into the container's own /tmp, written as the container's user: a bind mount
  # would differ between the two stacks.
  MSYS_NO_PATHCONV=1 docker compose exec -T mongo sh -c "cat > ${SEED_TARGET}" < "$SEED_FILE" \
    || die "the seed could not be handed to the database container; compose's own account is above."
  quietly run_made_up_seed "$base" \
    || die "the made-up seed did not load; mongosh's own account is above. A refused insert names
the validator's field: correct scripts/ops/seed/seed.js."
  ok "seeded '${base}' with the made-up league"
}

# Its own function for `restore_dump`'s reason: MSYS rewrites the `/tmp` path.
run_made_up_seed() {
  MSYS_NO_PATHCONV=1 docker compose exec -T mongo \
    mongosh --quiet "mongodb://127.0.0.1:27017/${1}?directConnection=true" --file "$SEED_TARGET"
}

# The backend's read-back over what the seed wrote: every document through its record model. It
# writes nothing.
judge_made_up_seed() {
  local rc=0
  quietly docker compose exec -T backend python -m app.core.readback || rc=$?
  case "$rc" in
    0) ok "every document the seed wrote reads back through its model" ;;
    1) die "the made-up seed holds a document its model refuses, and the lines above name it:
correct scripts/ops/seed/seed.js. The frontend and nginx have not been started." ;;
    *) refuse "the backend could not judge the seed (exit ${rc}); its own account is above.
The frontend and nginx have not been started." ;;
  esac
}

require_platform windows
require_docker
require_file "docker-compose.yml"
require_file "docker-compose.local.yml"
if (( E2E )); then require_file "docker-compose.e2e.yml"; fi
refuse_compose_dotenv

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
    # The copy, the edge's access log and the mail sink go with the volume: all four are records of
    # real people, and a machine done with a local stack should be left holding none of them.
    rm -rf "${REPO_ROOT:?}/.local-db" "${REPO_ROOT:?}/.tmp-nginx-log" "${REPO_ROOT:?}/.tmp-mail"
    ok "stopped — Next's cache rebuilds, and the database, the copy of production, the access log and the withheld mail are gone"
  else
    step "Stopping the local stack"
    # `--remove-orphans` here as well as on the way up: a service deleted from the compose file
    # leaves a container behind that nothing else on this machine will ever mention again.
    quietly docker compose down --remove-orphans || die "the stack could not be stopped — the output above is compose's own."
    # A withheld sign-in mail holds a live code, a credential nothing needs once the stack is
    # down; the copy and the access log stay until --fresh, being records rather than credentials.
    rm -rf "${REPO_ROOT:?}/.tmp-mail"
    ok "stopped — the withheld mail is gone"
  fi
  finish
fi

section "preflight"

# The end-to-end stack reads neither package's file nor this machine's keys: docker-compose.e2e.yml
# writes its settings and a start generates its keys, below.
if (( ! E2E )); then
  step "Files the containers read"
  require_file "fl_frontend/.env" "The frontend container reads it via env_file. Write this machine's own; it holds no credential, each being a file under secrets/."
  require_file "fl_backend/.env"  "The backend container reads it via env_file."
  # The only reader of these files here before the containers hold their lines: neither image's name
  # check runs on this stack.
  judge_env_files "fl_frontend/.env" "fl_backend/.env"
  for secret_file in $(printf '%s\n' "${LOCAL_FRONTEND_SECRETS[@]}" "${LOCAL_BACKEND_SECRETS[@]}" | sort -u); do
    require_file "secrets/${secret_file}" "The stack mounts it at /run/secrets/${secret_file}. Make this machine's own: docs/ops/runbooks.md §16."
  done
  ok "both packages' .env files and this machine's secret files are in place"
fi

if (( E2E )); then
  # First, so every file docker-compose.e2e.yml names exists before compose is asked anything, and
  # every start runs on keys of its own. Written over a stack still running, whose next step is its
  # teardown below.
  step "This run's own keys"
  write_e2e_keys
  ok "generated under .tmp-e2e — none printed, none copied from secrets/"
fi

step "Ports 3000 and 27017"
refuse_another_stack_on_the_ports
ok "no other stack holds either"

step "Anything holding the build's files open"
# A running `next dev` holds .next open and makes the build fail with EBUSY on Windows. Never
# `grep -q` here: it closes the pipe on its first match, and under `pipefail` the writer's SIGPIPE
# then fails the test exactly when there WAS a match.
if ! task_list="$(tasklist 2>/dev/null)"; then
  info "tasklist did not answer, so nothing here says whether a build-blocking process is running"
elif printf '%s\n' "$task_list" | grep -i "node.exe" >/dev/null; then
  info "node.exe is running — if the build fails with EBUSY, stop any 'pnpm dev' and retry"
else
  info "no node.exe running"
fi
ok "checked"

if (( FRESH )); then
  step "Tearing down, including volumes"
  quietly docker compose down -v --remove-orphans || die "the stack could not be torn down — the output above is compose's own."
  # As on the way down, and for the same reason.
  rm -rf "${REPO_ROOT:?}/.local-db" "${REPO_ROOT:?}/.tmp-nginx-log" "${REPO_ROOT:?}/.tmp-mail"
  ok "volumes removed — Next's cache rebuilds and the database starts empty; --seed fills it again"
fi

if (( E2E )); then
  step "An empty end-to-end stack"
  # Every start from nothing, so no journey reads what an earlier run left: its database and its
  # sign-in store, its mail going below and its keys being new already.
  quietly docker compose down -v --remove-orphans || die "the end-to-end stack could not be torn down — the output above is compose's own."
  # Made here for the mail sink's reason below: a bind source the engine creates is root-owned.
  mkdir -p "${E2E_DIR}/nginx-log" || die "${E2E_DIR}/nginx-log could not be made; mkdir's own account is above."
  ok "torn down"
fi

# Either stack's: compose's model names the sink each one mounts.
step "Where the frontend writes the mail it does not send"
empty_mail_sink

section "build"

step "Building images from source"
docker compose build || die "The image build failed — its own output is above."
ok "images built"

step "Each service's settings and secret files, as its own boot builds them"
# Through compose, as the deploy asks it: each container reads its variables and files as the stack
# hands them over, owner and mode included.
check_frontend_boot_config "NOTHING has been started." local docker compose run --rm --no-deps -T
check_backend_boot_config "NOTHING has been started." docker compose run --rm --no-deps -T


# Before `start`, not inside it: a page rendered against an empty database caches that read for
# days. The copy comes before the database container as well, for the reason at `fetch_copy`.
if (( SEED )); then
  section "database"
  fetch_copy

  step "The database, before anything reads it"
  quietly docker compose up -d --force-recreate --remove-orphans mongo \
    || die "the database could not be started — compose's own output is above."
  wait_healthy "" mongo 150 \
    || die "the database did not elect itself primary, so there is nothing to restore into."
  ok "database up"

  restore_copy
fi

# After the backend's boot, which gives every collection its validator and its indexes, so each
# insert is judged as it lands; before the frontend's, so no page renders, and no cache keeps, a
# read of a database still filling (`docs/ops/spec.md` §1.5).
if (( E2E || MADE_UP )); then
  section "database"

  step "The database and the backend, before anything renders a page"
  quietly docker compose up -d --force-recreate --remove-orphans mongo backend \
    || die "the database and the backend could not be started — compose's own output is above."
  wait_healthy "" mongo 150 \
    || die "the database did not elect itself primary, so there is nothing to seed."
  wait_healthy "" backend 150 \
    || die "the backend did not boot, so no validator stands to judge the seed."
  ok "database and backend up"

  step "The made-up league"
  load_made_up_seed

  step "The backend's own check of what the seed wrote"
  judge_made_up_seed
fi

section "start"

step "Starting the stack"
# Guarded, not bare: nginx depends on both services being HEALTHY, so `up` exits non-zero on an
# unhealthy start and an unguarded call would take the error trap instead of the explanation below.
UP_RC=0
quietly docker compose up -d --force-recreate --remove-orphans || UP_RC=$?
if (( UP_RC )); then
  fail "compose could not bring the stack up (exit ${UP_RC}); each service is asked what happened below"
else
  ok "containers started"
fi

step "Waiting for health"
HEALTHY=1
# Each is waited on even when an earlier fails, so one run reports every unhealthy service. `mongo`
# is named rather than left to the other two's `depends_on`, which would report a database that
# never elected itself as two services that never started.
wait_healthy "" mongo 150    || HEALTHY=0
wait_healthy "" backend 150  || HEALTHY=0
wait_healthy "" frontend 150 || HEALTHY=0
if (( UP_RC )); then HEALTHY=0; fi

# `wait_healthy` answers 1 for "reports UNHEALTHY" and for "could not ask compose" alike, and only
# the first says anything about this stack. Asking compose again separates them.
if (( ! HEALTHY && ! UP_RC )); then
  # Not where `up` itself exited non-zero: the start was attempted and did not complete, so this
  # run has a verdict whether or not the daemon answered afterwards.
  ASK_RC=0
  docker compose ps -q backend  >/dev/null 2>&1 || ASK_RC=$?
  docker compose ps -q frontend >/dev/null 2>&1 || ASK_RC=$?
  if (( ASK_RC )); then
    refuse "compose could not be asked about this stack (exit ${ASK_RC}), so 'unhealthy' is not what
this run established. Ask it directly:  COMPOSE_FILE='${COMPOSE_FILE}' docker compose ps"
  fi
fi

if (( HEALTHY )); then
  ok "every service is healthy"

  end_section
  CLOSING=("Open:               http://localhost:3000")
  if (( E2E )); then
    # Once: a run keeps the records it creates, which the next run would meet as already there.
    CLOSING+=("Run the journeys:   (cd fl_frontend && pnpm run e2e), once per start of this stack" \
              "Sign in as:         admin.desktop@example.com, its code in .tmp-e2e/mail" \
              "Logs:               COMPOSE_FILE='${COMPOSE_FILE}' docker compose logs -f frontend" \
              "Stop:               ${STOP_COMMAND}")
  else
    # Offered only where it was not just done, so the table never names the step this run performed.
    (( SEED || MADE_UP )) || CLOSING+=("Fill the database:  ./scripts/ops/local.sh --seed, or --seed-made-up")
    CLOSING+=("Security headers:   curl -sI http://localhost:3000 | grep -i content-security-policy" \
              "Logs:               COMPOSE_FILE='${COMPOSE_FILE}' docker compose logs -f frontend" \
              "Stop:               ./scripts/ops/local.sh --down")
  fi
  detail "${CLOSING[@]}"
else
  fail "The stack came up unhealthy."
  detail "If you see 'Invalid environment variables', fix those names in the .env files — that is" \
         "the startup gate doing its job." \
         "'Invalid secret files: <FILES>' or 'Unreadable secret files: <PATH> (<ERRNO>)' names a" \
         "file under secrets/ to write, or to give its owner and mode." \
         "A line opening 'backend_mongodb_uri:' is the backend's other refusal, and its continuation says" \
         "which: the value yielded no server, the server refused to authenticate it, or nothing" \
         "answered. Neither refusal prints a value, so the file it names is what to read." \
         "Stop what is left:  ${STOP_COMMAND}"
  finish
fi

# Before `finish`, which exits: the closing table is printed once the follow ends, and Ctrl-C out of
# the log reaches the library's interrupt handler rather than this script.
if (( FOLLOW )); then
  info "following the frontend log — Ctrl-C stops the log, not the stack"
  # Guarded, not bare: the stack is up, and a follow ending by itself — the container removed from
  # under it — would take the ERR trap and grade a running stack as a crash. 130 is Ctrl-C, whose
  # ending the library's INT trap owns.
  LOG_RC=0
  docker compose logs -f frontend || LOG_RC=$?
  if (( LOG_RC && LOG_RC != 130 )); then
    warn "the log follow ended on its own (exit ${LOG_RC}); the stack is still up.
Follow it again with:  COMPOSE_FILE='${COMPOSE_FILE}' docker compose logs -f frontend"
  fi
fi

if (( E2E )); then finish "The end-to-end stack is up at http://localhost:3000."; fi
finish "The local stack is up at http://localhost:3000."
