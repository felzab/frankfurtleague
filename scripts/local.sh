#!/usr/bin/env bash
#
# SCRIPTS · run the real production image on your own machine, behind the real nginx.
#
# `next dev` runs the app from source, so it exercises neither the standalone build, the startup
# environment gate, nginx nor the security headers — and so cannot see `instrumentation.ts` being
# dropped from the image, nor a module-scope `AUTH_URL` read failing in the builder stage.
#
#   ./scripts/local.sh              build changed layers, start, wait for health
#   ./scripts/local.sh --fresh      ALSO delete the volumes, and Next's build cache and the local
#                                   database with them — for when the stack behaves in a way the
#                                   code does not explain
#   ./scripts/local.sh --seed       ALSO fill the local database from production, reusing the copy
#                                   in .local-db where there is one
#   ./scripts/local.sh --refresh-db as --seed, but take a new copy from production first
#   ./scripts/local.sh --logs       start, then follow the frontend log
#   ./scripts/local.sh --down       stop the stack; with --fresh, also delete the volumes
#   ./scripts/local.sh --verbose    stream each command's own output instead of capturing it
#   ./scripts/local.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

COMPOSE="docker-compose.local.yml"

# Parsed before any environmental check, so a typo fails instantly instead of demanding Docker.
FRESH=0; FOLLOW=0; DOWN=0; SEED=0; REFRESH_DB=0
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
    --verbose) VERBOSE=1 ;;
    --help|-h) usage ;;
    *)       die "Unknown option: ${arg}. Try --help." ;;
  esac
done

# Stopped rather than ignored: a flag that does nothing reads as a flag that did something.
if (( DOWN )) && (( FOLLOW )); then
  die "--down stops the stack, so there is no log left to follow.
Run one or the other."
fi

# Stopped for --down --logs' reason: the restore would run against a database this same invocation
# is taking down.
if (( DOWN )) && (( SEED )); then
  die "--down stops the stack, so there is no database left to fill.
Run --seed on a start instead."
fi

# Gitignored: a copy of the production database, and this repository is public.
DUMP_DIR="${REPO_ROOT}/.local-db/dump"
# Beside the copy rather than inside it, because mongorestore reads every entry of the directory it
# is pointed at and neither of these is a collection.
DUMP_LOG="${REPO_ROOT}/.local-db/copy.log"
# What says a copy is WHOLE. mongodump fills its output directory as it goes, so an interrupted copy
# leaves one behind that a directory test would read as finished.
DUMP_MARK="${REPO_ROOT}/.local-db/complete"

# Two containers, never one: only the credential-bearing invocation is handed a mongodump command,
# and `restore_dump` is handed no credential at all. A discipline, not a boundary -- the image
# carries both tools.
take_dump() {
  rm -f "$DUMP_MARK"
  rm -rf "${DUMP_DIR:?}"
  mkdir -p "$DUMP_DIR"
  # Into a gitignored file, never a terminal and never partly filtered: a failed mongodump quotes
  # the connection string back in shapes no pattern could be trusted to cover. --env-file keeps it
  # out of the process list too.
  MSYS_NO_PATHCONV=1 docker run --rm -i \
    --env-file fl_backend/.env \
    -v "/${REPO_ROOT}/.local-db/dump:/dump" \
    mongo:8 sh -s >"$DUMP_LOG" 2>&1 <<'CONTAINER'
set -e
# docker --env-file strips neither the quotes a dotenv value may carry nor the CR a Windows editor
# leaves on it, and mongodump answers a URI holding either with a parse error.
q=$(printf '"\047')
clean() { printf '%s' "$1" | tr -d '\r\n' | sed -e "s/^[$q]//" -e "s/[$q]\$//"; }
uri=$(clean "$MONGODB_URI")
base=$(clean "$DB_BASE_NAME")
# The application database alone: the Flex tier denies `admin`, and this credential cannot read the
# Auth.js store beside it -- least privilege working. One collection at a time stays under the
# tier's rate cap.
mongodump --uri="$uri" --db="$base" --numParallelCollections=1 --out=/dump
CONTAINER
  local status=$?
  (( status )) && return "$status"

  # Only now: the marker is the whole of what the reuse test trusts.
  : >"$DUMP_MARK"
}

restore_dump() {
  # Inside the mongo container, which holds the tools and the copy mount: no plumbing, no
  # credential. MSYS_NO_PATHCONV because MSYS rewrites `/dump`. Never --quiet, which hides the
  # document count and makes a real restore and a no-op identical.
  MSYS_NO_PATHCONV=1 docker compose -f "$COMPOSE" exec -T mongo \
    mongorestore --uri="mongodb://localhost:27017/?directConnection=true" --drop /dump
}

# DOCUMENTS, not databases: the backend creates the application database and every collection in it
# at boot, so a node that took no restore at all still holds them, empty. Counting rows is the only
# question whose answer differs.
restored_documents() {
  MSYS_NO_PATHCONV=1 docker compose -f "$COMPOSE" exec -T mongo mongosh --quiet --eval \
    'db.adminCommand({ listDatabases: 1, nameOnly: true }).databases
       .filter((entry) => !["admin", "config", "local"].includes(entry.name))
       .reduce((total, entry) => {
         const store = db.getSiblingDB(entry.name);
         return total + store.getCollectionNames().reduce((rows, name) => rows + store[name].countDocuments({}), 0);
       }, 0)'
}

require_platform windows
require_docker
require_file "$COMPOSE"

if (( DOWN )); then
  section "down"
  # --fresh combines: stop AND delete the volumes, instead of being silently ignored.
  if (( FRESH )); then
    step "Stopping the local stack and removing volumes"
    quietly docker compose -f "$COMPOSE" down -v --remove-orphans || die "the stack could not be stopped — the output above is compose's own."
    ok "stopped — the next start rebuilds Next's cache, and the local database starts empty"
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
  quietly docker compose -f "$COMPOSE" down -v --remove-orphans || die "the stack could not be torn down — the output above is compose's own."
  ok "volumes removed — Next's cache rebuilds, and the local database starts empty; --seed fills it"
fi

section "build"

step "Building images from source"
docker compose -f "$COMPOSE" build || die "The image build failed — its own output is above."
ok "images built"

section "start"

step "Starting the stack"
# Guarded, not bare: nginx depends on both services being HEALTHY, so `up` exits non-zero on an
# unhealthy start and an unguarded call would take the error trap instead of the explanation below.
UP_RC=0
quietly docker compose -f "$COMPOSE" up -d --force-recreate --remove-orphans || UP_RC=$?
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
wait_healthy "$COMPOSE" mongo 150    || HEALTHY=0
wait_healthy "$COMPOSE" backend 150  || HEALTHY=0
wait_healthy "$COMPOSE" frontend 150 || HEALTHY=0
if (( UP_RC )); then HEALTHY=0; fi

# `wait_healthy` answers 1 for "reports UNHEALTHY" and for "could not ask compose" alike, and only
# the first says anything about this stack. Asking compose again separates them.
if (( ! HEALTHY && ! UP_RC )); then
  # Not where `up` itself exited non-zero: the start was attempted and did not complete, so this
  # run has a verdict whether or not the daemon answered afterwards.
  ASK_RC=0
  docker compose -f "$COMPOSE" ps -q backend  >/dev/null 2>&1 || ASK_RC=$?
  docker compose -f "$COMPOSE" ps -q frontend >/dev/null 2>&1 || ASK_RC=$?
  if (( ASK_RC )); then
    refuse "compose could not be asked about this stack (exit ${ASK_RC}), so 'unhealthy' is not what
this run established. Ask it directly:  docker compose -f ${COMPOSE} ps"
  fi
fi

if (( HEALTHY )); then
  ok "every service is healthy"

  # Only once the stack is up: the restore runs inside the mongo container, and a database that
  # never elected itself has nothing to restore into.
  if (( SEED )); then
    section "database"

    step "A copy to restore from"
    mkdir -p "$(dirname "$DUMP_LOG")"
    # The marker and not the directory: an interrupted copy leaves a directory behind.
    if (( REFRESH_DB )) || [[ ! -f "$DUMP_MARK" ]]; then
      info "copying from production, one collection at a time — the Flex tier throttles past 500 ops/s"
      quietly take_dump || die "the copy from production failed, and nothing was written to the
local database. mongodump's own account is in .local-db/copy.log, which is not printed here and
not committable: it names the cluster this machine connects to."
      ok "copied"
    else
      info "reusing the copy in .local-db — --refresh-db takes a new one"
      ok "found"
    fi

    step "Restoring it into the local database"
    quietly restore_dump || die "the restore failed — mongorestore's own output is above."
    # Asked of the database rather than read off mongorestore's wording: a restore that wrote
    # nothing exits 0, and the point of the seed is that something is there afterwards.
    RESTORED="$(restored_documents 2>/dev/null | tr -d '[:space:]')"
    if [[ ! "$RESTORED" =~ ^[0-9]+$ ]] || (( RESTORED == 0 )); then
      die "the restore reported success and the local database holds no documents.
Take a fresh copy with:  ./scripts/local.sh --refresh-db"
    fi
    ok "restored — ${RESTORED} document(s), and the local stack is reading its own data"
  fi

  end_section
  CLOSING=("Open:               http://localhost:3000")
  # Offered only where it was not just done, so the table never names the step this run performed.
  (( SEED )) || CLOSING+=("Fill the database:  ./scripts/local.sh --seed")
  CLOSING+=("Security headers:   curl -sI http://localhost:3000 | grep -i content-security-policy" \
            "Logs:               docker compose -f $COMPOSE logs -f frontend" \
            "Stop:               ./scripts/local.sh --down")
  detail "${CLOSING[@]}"
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
