#!/usr/bin/env bash
#
# SCRIPTS · load the made-up league into a running stack's database, then read every document of it back.
#
#   ./scripts/ops/made_up_seed.sh                    seed fl_backend/tests/made_up_seed.py as written, inside the
#                                                    running backend container, into the database its settings name
#   ./scripts/ops/made_up_seed.sh --landing=<state>  the same, the landing in <state> (the seed's LANDING_STATES)
#   ./scripts/ops/made_up_seed.sh --help
#
# Compose reaches the stack through the caller's COMPOSE_FILE and TAG, and the seed refuses any server but the local
# stack's. Exit 0 seeded, and every document reads back through its record model; 1 a seed or a document to correct,
# each named by the seed's or the read-back's own account; 2 refused, Docker not responding, no backend running,
# another server, a state the seed does not hold, or a seed or a read-back that could not load its settings or read
# the database; 130 interrupted; 3 or more a step that crashed, its own status kept where it is 3 or more.

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh" || exit 3

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
require_compose

# Refused rather than failed at the first hand-in: with no backend running, nothing has been judged.
step "The stack's backend"
backend="$(docker compose ps --status running --quiet backend)"
[[ -n "$backend" ]] || refuse "the stack's backend is not running, so there is nothing to seed. Start the stack first."
ok "running"

step "The made-up league${LANDING:+, the landing ${LANDING}}"
# Through stdin and into the container's own /tmp, written as the container's user: a bind mount would differ between
# the stacks.
for file in "${SEED_FILES[@]}"; do
  docker compose exec -T backend sh -c "mkdir -p ${SEED_ROOT}/tests && cat > ${SEED_ROOT}/tests/${file##*/}" < "$file"
done
# Without a state the seed reads none and writes itself as written.
state=()
if (( GIVEN )); then state=(--env "SEED_LANDING=${LANDING}"); fi
# The seed's own refusal, a state it does not hold, a server not the local stack's or settings it could not load, its
# account above saying which.
run_contract \
  "the made-up seed did not load; its own account is above. A refused insert names the index's key: correct
fl_backend/tests/made_up_seed.py." \
  "the made-up seed refused, and its own account above says why." \
  docker compose exec -T "${state[@]}" backend env "PYTHONPATH=${SEED_ROOT}" python -m tests.made_up_seed
ok "seeded the made-up league"

step "The backend's check of what the seed wrote"
run_contract \
  "the made-up seed holds a document its model refuses, and the lines above name it: correct
fl_backend/tests/made_up_seed.py." \
  "the backend could not read what the seed wrote, so nothing of it was judged; its own account is above." \
  docker compose exec -T backend python -m app.readback
ok "every document the seed wrote reads back through its model"
