#!/usr/bin/env bash
#
# SCRIPTS · load the made-up league into a running stack's database, then read every document of it back.
#
#   ./scripts/ops/made_up_seed.sh                    seed fl_backend/tests/made_up_seed.py as written, inside the
#                                                    running backend container, into the database its settings name
#   ./scripts/ops/made_up_seed.sh --landing=<state>  the same, the landing in <state> (the seed's LANDING_STATES)
#   ./scripts/ops/made_up_seed.sh --help
#
# Compose reaches the stack through the caller's COMPOSE_FILE and TAG, and only the local and the end-to-end stacks are
# seeded: the script refuses any stack not running the mongo service, and the seed any server but that one.
# Exit 0 seeded, and every document reads back through its record model; 1 a seed or a document to correct, each named
# by the seed's or the read-back's own closing line; 2 refused, Docker not responding, another stack, no backend running,
# a frontend not stopped, another server, a state the seed does not hold, or a seed or a read-back that could not load
# its settings or read the database; 130 interrupted; 3 or more a step that crashed, its own status kept where it is 3
# or more, a Compose call that failed and a 1 without its closing line among them.

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

GIVEN=0; LANDING=""
for arg in "$@"; do
  case "$arg" in
    --landing=*) GIVEN=1; LANDING="${arg#--landing=}" ;;
    --help|-h) usage ;;
    *) refuse "Unknown option: ${arg}. Try --help." ;;
  esac
done

# Every path this script hands docker is one inside the container, which Git Bash would rewrite as a Windows one.
export MSYS_NO_PATHCONV=1

# The seed, its people and the builders it composes with: no image holds the tests.
SEED_FILES=(fl_backend/tests/documents.py fl_backend/tests/made_up_seed.py fl_backend/tests/made_up_people.json)
SEED_ROOT="/tmp/seed"

require_docker

step "The stack the seed loads into"
# Before anything reaches a container, judged by what runs rather than by what a file declares: the two stacks the seed
# is for each run their own mongo, and production runs none, whichever files a checkout's Compose reads. One line per
# container of the project, a stopped one among them, with the label `docker compose run` marks a one-off container
# with, which lists under its service's name; a TAG left unset fails it, as every compose call would. Compose's
# formatter answers `.Label` for a container's label (cmd/formatter/container.go), and its run.go sets this one.
states=""
run_tool compose --stdout states --crash "Compose could not list the stack's containers; its own account is above." -- \
  docker compose ps --all --format '{{.Service}} {{.State}} {{.Label "com.docker.compose.oneoff"}}'
declare -A running=()
frontends=()
while IFS=' ' read -r service state oneoff; do
  state="${state%$'\r'}"
  oneoff="${oneoff%$'\r'}"
  # A one-off container is no service's own, so it runs no service the seed needs.
  if [[ "$state" == running && "$oneoff" != True ]]; then running[$service]=1; fi
  # A one-off frontend writes as the service's own does.
  if [[ "$service" == frontend ]]; then frontends+=("$state"); fi
done <<<"$states"
# Refused rather than failed at the first hand-in: with no backend running, nothing has been judged.
[[ -n "${running[backend]-}" ]] \
  || refuse "the stack's backend is not running, so there is nothing to seed. Start the stack first."
[[ -n "${running[mongo]-}" ]] \
  || refuse "the made-up seed loads only into the local or the end-to-end stack, and this one runs no mongo service."
# The seed empties and refills one collection after another, and the frontend is the database's one other writer, its
# scheduler's passes and the requests it serves alike: beside the seed, it would write from a league half loaded. A
# stopped one alone stays stopped: its restart policy brings a restarting one back, and a paused one resumes.
for state in "${frontends[@]}"; do
  case "$state" in
    exited | created) ;;
    *) refuse "the stack's frontend is ${state}, and the seed writes only a database nothing else
writes. Stop it first." ;;
  esac
done
ok "the local or the end-to-end stack, its backend running and its frontend stopped"

step "The made-up league${LANDING:+, the landing ${LANDING}}"
# Through stdin and into the container's own /tmp, written as the container's user: a bind mount would differ between
# the stacks.
for file in "${SEED_FILES[@]}"; do
  run_tool compose --crash "the seed could not be handed to the backend container; compose's own account is above." -- \
    docker compose exec -T backend sh -c "mkdir -p ${SEED_ROOT}/tests && cat > ${SEED_ROOT}/tests/${file##*/}" < "$file"
done
# Without a state the seed reads none and writes itself as written.
state=()
if (( GIVEN )); then state=(--env "SEED_LANDING=${LANDING}"); fi
# The seed's own refusal, a state it does not hold, a server not the local stack's or settings it could not load, its
# account above saying which. A 1 without the seed's closing line is Compose's own or Python's, a crash.
run_tool made-up-seed \
  --finding "the made-up seed did not load; its own account is above. A refused insert names the index's key: correct
fl_backend/tests/made_up_seed.py." \
  --refusal "the made-up seed refused, and its own account above says why." \
  --crash "python -m tests.made_up_seed in the backend container" -- \
  quietly docker compose exec -T "${state[@]}" backend env "PYTHONPATH=${SEED_ROOT}" python -m tests.made_up_seed
ok "seeded the made-up league"

step "The backend's own check of what the seed wrote"
run_tool readback \
  --finding "the made-up seed holds a document its model refuses, and the lines above name it: correct
fl_backend/tests/made_up_seed.py." \
  --refusal "the backend could not read what the seed wrote, so nothing of it was judged; its own account is above." \
  --crash "python -m app.readback in the backend container" -- \
  quietly docker compose exec -T backend python -m app.readback
ok "every document the seed wrote reads back through its model"
