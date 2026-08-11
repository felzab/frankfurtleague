"""
SPIELTAGE · reactivation against a real MongoDB (ADR-0023)

`find_spieltag_span_refusal` is pure and covered by `test_containment_refusals.py`. What needs a
database is the SEQUENCE it is wired into: retire a matchday, shrink the season past it -- which
`PATCH /saisons/{saison_id}` permits, because `REQ-DATE-004` reads live matchdays only -- and then
ask for it back. Each step runs through the handler that performs it, so the premise is proved
rather than assumed.

Invariants:
- The season shrink is asserted to SUCCEED; a refusal there would leave the reactivate case vacuous.
- Every test is marked `db` and deselected by default (`fl_backend/tests/README.md`).

See:
- docs/backend/spec.md — section 1.6, the two tiers and the marker
"""

import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.api.saisons.admin_router import patch_saison
from app.api.saisons.schemas import FLPatchSaisonPayload, FLSaisonRules
from app.api.spieltage.admin_router import delete_spieltag, reactivate_spieltag
from app.api.spieltage.services import SPIELTAG_OUTSIDE_SAISON
from app.core.exceptions import DocumentConflictException

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_spieltag_reactivate_test"

SAISON_ID = "2026"
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607300001")

# The day the retirement is stamped with. Injected rather than read from the clock, which is what
# `get_german_date_str` exists to make substitutable.
RETIRED_ON = "2026-04-01"

SAISON_START = "2026-01-01"
SAISON_END = "2026-06-30"

# Late in the season, so an end date can be moved to either side of it.
SPIELTAG_BEGINN = "2026-06-20"
SPIELTAG_ENDE = "2026-06-21"

RULES = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_group": 2,
    "number_of_groups": 4,
    "teams_per_group": 4,
    "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
}


def saison_document() -> dict[str, Any]:
    """The season the matchday belongs to. `schedule` is derived on read and on no document (ADR-0052)."""

    return {
        "_id": SAISON_ID,
        "start_date": SAISON_START,
        "end_date": SAISON_END,
        "status": "active",
        "rules": dict(RULES),
    }


def spieltag_document() -> dict[str, Any]:
    """
    One live matchday, late in its season and holding no fixtures.

    It carries `anzahl_spiele` because the write endpoints echo the raw document through `FLSpieltag`,
    which requires the field — the READ endpoints inject the derived value and these do not (ADR-0052).
    Every matchday predating that decision still holds the key, which is what makes the permitted case
    reachable here.
    """

    return {
        "_id": SPIELTAG_OID,
        "beginn": SPIELTAG_BEGINN,
        "ende": SPIELTAG_ENDE,
        "anzahl_spiele": 8,
        "saison_phase": "gruppenphase",
        "saison_id": SAISON_ID,
        "inactive_since": None,
    }


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def on_a_database(container: Any, body: Body) -> Any:
    """
    Seed a fresh database with the season and the matchday, run `body` against it, then drop it.

    One client and one event loop per call, for the reason `tests/core/test_constraints_execution.py`
    gives: Motor binds to the loop it first runs on, so a client shared across `asyncio.run` calls
    works right up until it does not, and the symptom reads as a flake rather than as fixture design.
    """

    async def _run() -> Any:
        client = AsyncIOMotorClient(container.get_connection_url())
        try:
            await client.drop_database(DATABASE_NAME)
            database = client[DATABASE_NAME]
            await database.saisons.insert_one(saison_document())
            await database.spieltage.insert_one(spieltag_document())
            return await body(database)
        finally:
            await client.drop_database(DATABASE_NAME)
            client.close()

    return asyncio.run(_run())


async def retire_the_matchday(database: AsyncIOMotorDatabase) -> None:
    """Step one, through the endpoint that performs it: `DELETE` stamps `inactive_since` (ADR-0025)."""

    await delete_spieltag(
        spieltag_id=SPIELTAG_OID,
        spieltage_collection=database.spieltage,
        spiele_collection=database.spiele,
        today=RETIRED_ON,
    )


async def move_the_seasons_end(database: AsyncIOMotorDatabase, end_date: str) -> None:
    """
    Step two, through the endpoint that performs it, and the step that creates the state.

    Asserted rather than assumed: `REQ-DATE-004` reads live matchdays only, so a retired one must not
    block the shrink. If that ever changed, the reactivate case below would pass for the wrong reason.
    """

    response = await patch_saison(
        saison_id=SAISON_ID,
        saison_data=FLPatchSaisonPayload(start_date=SAISON_START, end_date=end_date, rules=FLSaisonRules.model_validate(RULES)),
        saisons_collection=database.saisons,
        saison_teams_collection=database.saison_teams,
        spiele_collection=database.spiele,
        spieltage_collection=database.spieltage,
    )

    assert response.updated_document.end_date == end_date


class TestAReactivatedMatchdayStaysInsideItsSeason:
    def test_the_season_shrinking_past_a_retired_matchday_refuses_the_way_back(self, mongo_container: Any):
        """The three steps in order, and the state each one leaves is the next one's input."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await retire_the_matchday(database)
            # Now ends before the matchday begins, which is legal precisely because it is retired.
            await move_the_seasons_end(database, "2026-05-31")

            with pytest.raises(DocumentConflictException) as excinfo:
                await reactivate_spieltag(
                    spieltag_id=SPIELTAG_OID,
                    spieltage_collection=database.spieltage,
                    saisons_collection=database.saisons,
                )

            return excinfo.value

        refusal = on_a_database(mongo_container, body)

        assert refusal.error_code == SPIELTAG_OUTSIDE_SAISON

    def test_the_refusal_leaves_the_matchday_retired(self, mongo_container: Any):
        """A refused reactivation writes nothing, so the admin's repair is the dates rather than a retry."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await retire_the_matchday(database)
            await move_the_seasons_end(database, "2026-05-31")

            with pytest.raises(DocumentConflictException):
                await reactivate_spieltag(
                    spieltag_id=SPIELTAG_OID,
                    spieltage_collection=database.spieltage,
                    saisons_collection=database.saisons,
                )

            return await database.spieltage.find_one({"_id": SPIELTAG_OID})

        stored = on_a_database(mongo_container, body)

        assert stored is not None
        assert stored["inactive_since"] == RETIRED_ON

    def test_the_refusal_names_both_spans(self, mongo_container: Any):
        """The repair is a choice between two edits, so the message carries the matchday and the season."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await retire_the_matchday(database)
            await move_the_seasons_end(database, "2026-05-31")

            with pytest.raises(DocumentConflictException) as excinfo:
                await reactivate_spieltag(
                    spieltag_id=SPIELTAG_OID,
                    spieltage_collection=database.spieltage,
                    saisons_collection=database.saisons,
                )

            return excinfo.value

        refusal = on_a_database(mongo_container, body)
        message = refusal.error_detail["message"]

        assert SPIELTAG_BEGINN in message
        assert SPIELTAG_ENDE in message
        assert "2026-05-31" in message

    def test_a_matchday_the_shrunk_season_still_covers_comes_back(self, mongo_container: Any):
        """
        The other half, and the one that keeps the refusal from being a blanket one.

        The same three steps with a shrink that stops short of the matchday: the containment still
        holds, so nothing is refused and the matchday is live again.
        """

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await retire_the_matchday(database)
            await move_the_seasons_end(database, "2026-06-25")

            response = await reactivate_spieltag(
                spieltag_id=SPIELTAG_OID,
                spieltage_collection=database.spieltage,
                saisons_collection=database.saisons,
            )

            return (response, await database.spieltage.find_one({"_id": SPIELTAG_OID}))

        response, stored = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.inactive_since is None
        assert stored is not None
        assert stored["inactive_since"] is None
