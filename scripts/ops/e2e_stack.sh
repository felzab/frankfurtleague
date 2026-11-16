#!/usr/bin/env bash
#
# SCRIPTS · raise the end-to-end stack (docker-compose.e2e.yml) with keys of its own and the made-up league in it.
#
#   ./scripts/ops/e2e_stack.sh start [--build]  new keys, an empty stack and mail sink, with --build its images built
#                                               from source, then the database and the backend started without a wait
#   ./scripts/ops/e2e_stack.sh serve            the database and the backend waited for, the made-up league loaded
#                                               and read back (scripts/ops/made_up_seed.sh), then the rest started
#   ./scripts/ops/e2e_stack.sh --help
#
# Two calls, so a caller can run something of its own while the database and the backend start. Without --build, the
# images are the ones docker-compose.e2e.yml names, and no image is built. Exit 0 up; 1 something to correct; 2 refused,
# the seed's refusal among them.

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

PHASE=""; BUILD=0
for arg in "$@"; do
  case "$arg" in
    start|serve) [[ -z "$PHASE" ]] || refuse "Name one of start and serve, not both. Try --help."; PHASE="$arg" ;;
    --build) BUILD=1 ;;
    --help|-h) usage ;;
    *) refuse "Unknown option: ${arg}. Try --help." ;;
  esac
done
[[ -n "$PHASE" ]] || refuse "Name start or serve. Try --help."
if (( BUILD )) && [[ "$PHASE" != start ]]; then refuse "--build belongs to start, which builds before it starts a container."; fi

# Set here, whatever the caller's environment says: `start` deletes the volume of the stack these files name, and the
# local stack's holds the developer's database. The separator spelled out, since Compose's own differs by platform
# (https://docs.docker.com/compose/how-tos/environment-variables/envvars/#compose_path_separator).
export COMPOSE_PATH_SEPARATOR=":"
export COMPOSE_FILE="docker-compose.yml:docker-compose.local.yml:docker-compose.e2e.yml"
# The tag docker-compose.yml's two images read, which Compose demands before it merges the files that name this stack's
# own images in their place; no image is pulled or built by it.
export TAG=e2e

# Everything the stack holds on the host, at the paths docker-compose.e2e.yml names. `.tmp-*/` is gitignored.
E2E_DIR="${REPO_ROOT}/.tmp-e2e"
E2E_KEYS=(auth_secret internal_api_key_base internal_api_key_system internal_api_key_admin)

# Generated on every start rather than copied from `secrets/`: the stack shares nothing with the local one, and a key
# it held for longer than one run would be a key to keep. Readable by every user, since the containers' own users read
# a bind-mounted file with its host mode on Linux; under Git Bash the drive is mounted without permissions, so no mode
# set here changes who reads a file there. Nothing prints a value.
write_keys() {
  local -
  set +x
  local name=""
  mkdir -p "${E2E_DIR}/secrets" || die "${E2E_DIR}/secrets could not be made; mkdir's own account is above."
  for name in "${E2E_KEYS[@]}"; do
    openssl rand -hex 32 | tr -d '\r\n' > "${E2E_DIR}/secrets/${name}" \
      || die "the end-to-end stack's ${name} could not be generated; openssl's own account is above."
  done
  chmod 644 "${E2E_DIR}/secrets/"* || die "the end-to-end stack's keys could not be made readable; chmod's own account is above."
}

require_docker

if [[ "$PHASE" == start ]]; then
  # First, so every file docker-compose.e2e.yml names exists before compose is asked anything. Written over a stack
  # still running, whose teardown is next.
  step "This run's own keys"
  write_keys
  ok "generated under .tmp-e2e — none printed, none copied from secrets/"

  # Every start from nothing, so no journey reads what an earlier run left: its database and its sign-in store.
  step "An empty end-to-end stack"
  quietly docker compose down -v --remove-orphans || die "the end-to-end stack could not be torn down; compose's own account is above."
  ok "torn down"

  # Emptied, so a code an earlier run filed never reads as current. Made here rather than left to the engine, whose
  # bind-mount source is root's, and writable by every user, since the frontend writes as `nextjs`.
  step "Where the frontend writes the mail it does not send"
  rm -rf "${E2E_DIR:?}/mail" || die "the mail an earlier run filed could not be removed; rm's own account is above."
  mkdir -p "${E2E_DIR}/mail" || die "the mail sink's directory could not be made; mkdir's own account is above."
  chmod 777 "${E2E_DIR}/mail" || die "the mail sink could not be made writable; chmod's own account is above."
  ok "emptied — this run's withheld mail lands in .tmp-e2e/mail"

  if (( BUILD )); then
    step "Building images from source"
    docker compose build || die "the image build failed; its own output is above."
    ok "images built"
  fi

  # No wait, so a caller's own work runs while the database is pulled and both start.
  step "The database and the backend, starting"
  quietly docker compose up -d --no-build --remove-orphans mongo backend \
    || die "the database and the backend could not be started; compose's own account is above."
  ok "started"
  exit 0
fi

# After the backend's boot, which gives every collection its indexes, so each insert meets them as it lands. The `up`
# recreates neither container, since `up` recreates one only for a changed configuration or image
# (https://docs.docker.com/reference/cli/docker/compose/up/).
step "The database and the backend, healthy"
quietly docker compose up -d --no-build --wait --wait-timeout 180 mongo backend \
  || die "the database and the backend did not both come up healthy; compose's own account is above."
ok "database and backend up"

# Before the frontend's start, so no page renders, and no cache keeps, a read of a database still filling.
rc=0
"${REPO_ROOT}/scripts/ops/made_up_seed.sh" || rc=$?
case "$rc" in
  0) ;;
  2) refuse "the made-up seed was refused, and the lines above say why. The frontend and nginx have not been started." ;;
  *) die "the made-up seed failed, and the lines above name what to correct. The frontend and nginx have not been started." ;;
esac

step "The rest of the stack"
quietly docker compose up -d --no-build --remove-orphans --wait --wait-timeout 240 \
  || die "the stack came up unhealthy; compose's own account is above."
ok "every service is healthy"
