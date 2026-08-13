"""
SPIELTAGE · the write path against a real MongoDB (ADR-0023)

Three things only a database proves. The SEQUENCE `REQ-DATE-002` is wired into on the way back in:
retire a matchday, shrink the season past it -- which `PATCH /saisons/{saison_id}` permits, because
`REQ-DATE-004` reads live matchdays only -- and then ask for it back. The ECHO every write
answers with, which carries a derived `anzahl_spiele` that sits on no document (ADR-0052), so a
matchday created since that decision reaches validation without it. And WHICH PATCHES
`REQ-SPIELTAG-002` reaches, which needs a real fixture count against a real season's rules.

Each step runs through the handler that performs it, so the premise is proved rather than assumed.

Invariants:
- The season shrink is asserted to SUCCEED; a refusal there would leave the reactivate case vacuous.
- The default seed carries no `anzahl_spiele`; the one case that seeds `99` asserts the echo ignores it.
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
from app.api.spieltage.admin_router import delete_spieltag, patch_spieltag, post_spieltag, reactivate_spieltag
from app.api.spieltage.schemas import FLPatchSpieltagPayload, FLPostSpieltagPayload
from app.api.spieltage.services import SPIELTAG_OUTSIDE_SAISON, SPIELTAG_OVER_ITS_PHASE
from app.core.exceptions import DocumentConflictException

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_spieltage_write_test"

SAISON_ID = "2026"
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607300001")

# The day a retirement is stamped with. Injected rather than read from the clock, which is what
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

# What these rules imply, spelled out rather than computed: four groups of four give three group
# matchdays of eight matches, and eight qualifiers play the last three rounds. A `schedule_for`
# change that stops matching is visible here.
GRUPPENPHASE_MATCHES = 8
FINALE_MATCHES = 1


def saison_document() -> dict[str, Any]:
    """The season the matchday belongs to. `schedule` is derived on read and on no document (ADR-0052)."""

    return {
        "_id": SAISON_ID,
        "start_date": SAISON_START,
        "end_date": SAISON_END,
        "status": "active",
        "rules": dict(RULES),
    }


def spieltag_document(**overrides: Any) -> dict[str, Any]:
    """
    One live matchday, late in its season and holding no fixtures.

    It carries no `anzahl_spiele`, which is the shape `POST /spieltage` inserts: the count is derived
    from the season's rules on every read (ADR-0052) and the payload has no field for it. Seeding it
    this way is what makes the echo assertions below controls rather than readings of a stale key --
    the one test that wants a stale key overrides it.
    """

    return {
        "_id": SPIELTAG_OID,
        "beginn": SPIELTAG_BEGINN,
        "ende": SPIELTAG_ENDE,
        "saison_phase": "gruppenphase",
        "saison_id": SAISON_ID,
        "inactive_since": None,
        **overrides,
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


async def retire_the_matchday(database: AsyncIOMotorDatabase, spieltag_id: ObjectId = SPIELTAG_OID) -> Any:
    """Through the endpoint that performs it: `DELETE` stamps `inactive_since` (ADR-0025)."""

    return await delete_spieltag(
        spieltag_id=spieltag_id,
        spieltage_collection=database.spieltage,
        saisons_collection=database.saisons,
        spiele_collection=database.spiele,
        today=RETIRED_ON,
    )


async def move_the_seasons_end(database: AsyncIOMotorDatabase, end_date: str) -> None:
    """
    Through the endpoint that performs it, and the step that creates the state.

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


async def create_a_matchday(database: AsyncIOMotorDatabase) -> ObjectId:
    """
    A matchday made the way the admin makes one, so what follows acts on a real created document.

    Always `gruppenphase`, and the phase is not a parameter: a `str` default would widen
    `FLSaisonPhase` past its `Literal` and the payload would refuse it, which the gate's own `pyright`
    catches because `[tool.pyright]` includes `tests`. The one case that needs another phase patches
    into it, which is the move it is about anyway.
    """

    response = await post_spieltag(
        spieltag_data=FLPostSpieltagPayload(beginn="2026-03-07", ende="2026-03-08", saison_phase="gruppenphase", saison_id=SAISON_ID),
        spieltage_collection=database.spieltage,
        saisons_collection=database.saisons,
        today=RETIRED_ON,
    )

    return ObjectId(response.spieltag_id)


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


class TestAWriteEchoesTheMatchdayItChanged:
    """
    The round trip a matchday makes once ADR-0052 took `anzahl_spiele` off the document.

    `POST` answers with an id alone and so never validates a stored matchday; the other three echo the
    document they just changed, and the field is required on the read model. So the endpoints are
    exercised against a matchday this suite CREATED, not one it seeded -- a seeded document can be
    given whatever shape makes a test pass, and a created one has the shape the API actually produces.
    """

    def test_a_created_matchday_can_be_retired(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            created = await create_a_matchday(database)
            return await retire_the_matchday(database, created)

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.inactive_since == RETIRED_ON
        assert response.updated_document.anzahl_spiele == GRUPPENPHASE_MATCHES

    def test_a_created_matchday_can_be_edited(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            created = await create_a_matchday(database)
            return await patch_spieltag(
                spieltag_id=created,
                spieltag_data=FLPatchSpieltagPayload(beginn="2026-03-07", ende="2026-03-09", saison_phase="gruppenphase"),
                spieltage_collection=database.spieltage,
                saisons_collection=database.saisons,
                spiele_collection=database.spiele,
            )

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.ende == "2026-03-09"
        assert response.updated_document.anzahl_spiele == GRUPPENPHASE_MATCHES

    def test_a_created_matchday_can_be_retired_and_brought_back(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            created = await create_a_matchday(database)
            await retire_the_matchday(database, created)
            return await reactivate_spieltag(
                spieltag_id=created,
                spieltage_collection=database.spieltage,
                saisons_collection=database.saisons,
            )

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.inactive_since is None
        assert response.updated_document.anzahl_spiele == GRUPPENPHASE_MATCHES

    def test_moving_the_phase_moves_the_count_the_echo_reports(self, mongo_container: Any):
        """
        The case that separates a derived echo from a remembered one.

        `PATCH` can move the `saison_phase` the count follows from, so an echo carrying the count the
        matchday had before the write would be wrong rather than merely absent. Nothing attached, so
        `REQ-SPIELTAG-002` permits the move.
        """

        async def body(database: AsyncIOMotorDatabase) -> Any:
            created = await create_a_matchday(database)
            return await patch_spieltag(
                spieltag_id=created,
                spieltag_data=FLPatchSpieltagPayload(beginn="2026-03-07", ende="2026-03-08", saison_phase="finale"),
                spieltage_collection=database.spieltage,
                saisons_collection=database.saisons,
                spiele_collection=database.spiele,
            )

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.saison_phase == "finale"
        assert response.updated_document.anzahl_spiele == FINALE_MATCHES

    def test_a_stored_count_left_over_from_before_is_ignored(self, mongo_container: Any):
        """
        The documents ADR-0052 left behind still carry the key, and the echo must not read it.

        `extra="ignore"` means such a document validates either way, so a pass-through would look
        correct on every matchday whose season never changed -- and be silently wrong on the ones that
        are the whole reason the field stopped being stored.
        """

        stale_oid = ObjectId("6890a1b2c3d4e5f607300002")

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.spieltage.insert_one(spieltag_document(_id=stale_oid, anzahl_spiele=99))
            return await retire_the_matchday(database, stale_oid)

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.anzahl_spiele == GRUPPENPHASE_MATCHES


class TestAMatchdayOverItsPhaseKeepsItsDatesEditable:
    """
    `REQ-SPIELTAG-002` against the state only the database can hold.

    The fixture count comes from a real `spiele` collection, and the phase count from the season's own
    rules, so the two figures the refusal compares are produced the way the endpoint produces them. That
    is the whole case: the rule reads a phase, and the endpoint runs it on every patch — including one
    whose payload repeats the phase the matchday already has.

    A season's fixtures are created outside the API (ADR-0037), which is why nine of them can sit on a
    matchday whose Gruppenphase accounts for eight, and why no edit here can move one out.
    """

    ATTACHED = GRUPPENPHASE_MATCHES + 1

    async def _with_fixtures_attached(self, database: AsyncIOMotorDatabase) -> None:
        """Nine fixtures on the seeded matchday, dateless so `REQ-DATE-003` has nothing to hold."""

        for spiel_nr in range(1, self.ATTACHED + 1):
            await database.spiele.insert_one({"saison_id": SAISON_ID, "spieltag_id": SPIELTAG_OID, "spiel_nr": spiel_nr})

    def test_a_dates_only_patch_goes_through(self, mongo_container: Any):
        """The payload repeats the stored phase, so there is no move for the phase rule to judge."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await self._with_fixtures_attached(database)
            return await patch_spieltag(
                spieltag_id=SPIELTAG_OID,
                spieltag_data=FLPatchSpieltagPayload(beginn=SPIELTAG_BEGINN, ende="2026-06-22", saison_phase="gruppenphase"),
                spieltage_collection=database.spieltage,
                saisons_collection=database.saisons,
                spiele_collection=database.spiele,
            )

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.ende == "2026-06-22"

    def test_a_move_into_a_smaller_phase_is_still_refused(self, mongo_container: Any):
        """The other half: from a bad state the step that makes it worse is refused as it always was."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await self._with_fixtures_attached(database)

            with pytest.raises(DocumentConflictException) as excinfo:
                await patch_spieltag(
                    spieltag_id=SPIELTAG_OID,
                    spieltag_data=FLPatchSpieltagPayload(beginn=SPIELTAG_BEGINN, ende=SPIELTAG_ENDE, saison_phase="finale"),
                    spieltage_collection=database.spieltage,
                    saisons_collection=database.saisons,
                    spiele_collection=database.spiele,
                )

            return excinfo.value

        refusal = on_a_database(mongo_container, body)

        assert refusal.error_code == SPIELTAG_OVER_ITS_PHASE
