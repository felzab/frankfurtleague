#!/usr/bin/env bash
#
# scripts/backfill_inactive_since.sh — put `inactive_since: null` on every document that lacks it.
# TARGET PLATFORM: Linux (the production server).
#
# WHEN TO RUN IT:
#   ONCE, and BEFORE deploying the image that introduces the field. `inactive_since` is REQUIRED by
#   the Pydantic models and by the `$jsonSchema` validators the backend applies on every boot
#   (ADR-0027, ADR-0032). Deploying first would give you a backend that refuses to serve documents it
#   has not been told about — every read of a team, player, matchday, venue or referee failing
#   response validation at once.
#
#   This is the "edit the data first, then deploy" case in docs/workflows/README.md. Nothing about
#   the running site changes when you run this: the deployed image does not read the field, so adding
#   it is invisible until the new image arrives.
#
# WHAT IT TOUCHES:
#   Six collections — teams, spieler, saison_spieler, spieltage, spielorte, schiedsrichter.
#   `saisons` and `saison_teams` are deliberately absent: a season is never deleted (its `status` is
#   what "gone" means) and a team never leaves a season except by disqualification (ADR-0033).
#   `spiele` is absent because a match that did not happen is `is_canceled`, a fact about the match.
#
#   `spielorte` and `schiedsrichter` also carry a boolean `is_inactive` from before the field was a
#   date. It is left in place: this script only ADDS, so a rollback to the previous image keeps
#   working, and removing it is BE-12's business alongside the purge.
#
# HOW IT WORKS:
#   Inside the running backend container, so MONGODB_URI is read from the container's own environment
#   and never reaches this script, your shell history or a log line. Same reason as
#   revalidate_reference_data.sh.
#
#   The update is `{"inactive_since": {"$exists": false}} -> $set null`, so it is IDEMPOTENT: running
#   it twice changes nothing the second time, and it cannot overwrite a real retirement date.
#
# USAGE:
#   ./scripts/backfill_inactive_since.sh            report what WOULD change, write nothing
#   ./scripts/backfill_inactive_since.sh --apply    perform the update
#   ./scripts/backfill_inactive_since.sh --help
#
# AFTER THE DEPLOY:
#   Run `app.core.constraints` in check mode inside the backend container — this script prints the
#   exact command when it finishes, and scripts/README.md carries it too. Exit 0 means every document
#   satisfies its validator. Run it from the NEW image: the deployed one does not know the field
#   exists, so checking before the deploy proves nothing.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply)   APPLY=1 ;;
    --help|-h) usage ;;
    *) die "Unknown argument: '${arg}'. See --help." ;;
  esac
done

require_platform linux
require_docker
require_file "docker-compose.yml"

step "What is running right now"
# Read against the DEPLOYED image, never against main: this script edits the data that image serves,
# and the whole point of running it first is that the two are out of step.
./scripts/deploy.sh --status

if [[ "$APPLY" -eq 0 ]]; then
  step "Counting documents without inactive_since (dry run — nothing is written)"
else
  step "Setting inactive_since: null where it is missing"
fi

docker compose exec -T -e FL_BACKFILL_APPLY="$APPLY" backend python -c '
import asyncio
import os

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import backend_config

# The six collections that gained the field (ADR-0032). Written out rather than derived from the
# validators, because this script has to run against the DEPLOYED image, whose app/core/constraints.py
# does not yet list them.
COLLECTIONS = ("teams", "spieler", "saison_spieler", "spieltage", "spielorte", "schiedsrichter")

APPLY = os.environ["FL_BACKFILL_APPLY"] == "1"
MISSING = {"inactive_since": {"$exists": False}}


async def main() -> int:
    # Through backend_config rather than os.environ, so the database name comes from the one place
    # that decides it -- the URI does not carry it -- and the credentials stay inside a SecretStr.
    client = AsyncIOMotorClient(backend_config.mongodb_uri.get_secret_value())
    database = client[backend_config.db_base_name]

    total = 0
    for name in COLLECTIONS:
        collection = database[name]
        missing = await collection.count_documents(MISSING)
        held = await collection.count_documents({})

        if APPLY and missing:
            # $exists: false, so a document already carrying a real retirement date is never touched.
            result = await collection.update_many(MISSING, {"$set": {"inactive_since": None}})
            print(f"  {name:<16} {result.modified_count:>4} updated   ({held} in the collection)")
        else:
            print(f"  {name:<16} {missing:>4} missing   ({held} in the collection)")

        total += missing

    client.close()
    return total


print(f"\n  TOTAL {asyncio.run(main())} documents\n")
' || die "The backfill failed.
       Is the backend container running?  docker compose ps backend"

if [[ "$APPLY" -eq 0 ]]; then
  warn "Dry run. Nothing was written."
  printf '\n       Apply it:  ./scripts/backfill_inactive_since.sh --apply\n\n'
else
  ok "Backfill applied — every document now carries inactive_since"
  printf '\n       Next:  ./scripts/deploy.sh\n'
  printf '       Then:  docker compose exec -T backend python -m app.core.constraints --check\n\n'
fi
