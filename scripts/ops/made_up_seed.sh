#!/usr/bin/env bash
#
# SCRIPTS · load the made-up league into a running stack's database, then read every document of it back.
#
#   ./scripts/ops/made_up_seed.sh                    seed fl_backend/tests/made_up_seed.py as written, inside the
#                                                    running backend container, into the database its settings name
#   ./scripts/ops/made_up_seed.sh --landing=<state>  the same, the landing in <state> (the seed's LANDING_STATES)
#   ./scripts/ops/made_up_seed.sh --help
#
# Compose reaches the stack through the caller's COMPOSE_FILE and TAG. Exit 0 seeded, and every document reads back
# through its record model; 1 a seed or a document to correct; 2 refused, a state the seed does not hold or a read-back
# that could not judge.

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

step "The made-up league${LANDING:+, the landing ${LANDING}}"
# Through stdin and into the container's own /tmp, written as the container's user: a bind mount would differ between
# the stacks.
for file in "${SEED_FILES[@]}"; do
  docker compose exec -T backend sh -c "mkdir -p ${SEED_ROOT}/tests && cat > ${SEED_ROOT}/tests/${file##*/}" < "$file" \
    || die "the seed could not be handed to the backend container; compose's own account is above."
done
# Without a state the seed reads none and writes itself as written.
state=()
if (( GIVEN )); then state=(--env "SEED_LANDING=${LANDING}"); fi
rc=0
quietly docker compose exec -T "${state[@]}" backend env "PYTHONPATH=${SEED_ROOT}" python -m tests.made_up_seed || rc=$?
case "$rc" in
  0) ok "seeded the made-up league" ;;
  # The seed's own refusal of a state it does not hold, whose account above lists the ones it does.
  2) if (( GIVEN )); then refuse "--landing=${LANDING} names no state of the landing."; fi
     die "the made-up seed exited 2 with no --landing given; its own account is above." ;;
  *) die "the made-up seed did not load; its own account is above. A refused insert names the index's key: correct
fl_backend/tests/made_up_seed.py." ;;
esac

step "The backend's own check of what the seed wrote"
rc=0
quietly docker compose exec -T backend python -m app.readback || rc=$?
case "$rc" in
  0) ok "every document the seed wrote reads back through its model" ;;
  1) die "the made-up seed holds a document its model refuses, and the lines above name it: correct
fl_backend/tests/made_up_seed.py." ;;
  *) refuse "the backend could not judge the seed (exit ${rc}); its own account is above." ;;
esac
