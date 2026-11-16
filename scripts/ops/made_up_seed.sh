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
# seeded: the script refuses any stack Compose resolves without the mongo service, and the seed any server but that
# one. Exit 0 seeded, and every document reads back through its record model; 1 a seed or a document to correct; 2
# refused, Docker not responding, another stack, no backend running, another server, a state the seed does not hold or a
# read-back that could not judge.

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
# Before anything reaches a container: the two stacks the seed is for start their own mongo, and production's declares
# none, so a checkout whose Compose resolves production's file is refused here. Compose's own listing of the model it
# resolves, from every source it reads, a `.env` among them; a TAG left unset fails it, as every compose call would.
services="$(docker compose config --services)" \
  || refuse "the made-up seed loads only into the local or the end-to-end stack, and Compose could not resolve this one;
its own account is above."
grep -qxF mongo <<<"$services" \
  || refuse "the made-up seed loads only into the local or the end-to-end stack, whose Compose files declare the mongo
service."
# Refused rather than failed at the first hand-in: with no backend running, nothing has been judged.
running="$(docker compose ps --status running --services)" \
  || refuse "Compose could not list the stack's running services; its own account is above."
grep -qxF backend <<<"$running" \
  || refuse "the stack's backend is not running, so there is nothing to seed. Start the stack first."
ok "the local or the end-to-end stack, its backend running"

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
  # The seed's own refusal, a state it does not hold or a server not the local stack's, its account above saying which.
  2) refuse "the made-up seed refused, and its own account above says why." ;;
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
