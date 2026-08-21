import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.api.saisons.admin_router import patch_saison
from app.api.saisons.schemas import FLPatchSaisonPayload, FLSaisonRules
from app.api.saisons.services import SAISON_SPAN_BELOW_SPIELTAGE
from app.api.spieltage.admin_router import patch_spieltag
from app.api.spieltage.schemas import FLPatchSpieltagPayload
from app.api.spieltage.services import SPIELTAG_SPAN_BELOW_FIXTURES
from app.core.exceptions import DocumentConflictException

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_spieltage_write_test"

SAISON_ID = "2026"
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607300001")
# The Finale's row, seeded only where a second phase's match count is what a test turns on.
FINALE_OID = ObjectId("6890a1b2c3d4e5f607300003")

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
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": 18,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
}

# Spelled out rather than computed, so a `schedule_for` change that stops matching is visible here.
GRUPPENPHASE_MATCHES = 8
FINALE_MATCHES = 1


def saison_document() -> dict[str, Any]:
    """`schedule` is derived on read and on no document."""

    return {
        "_id": SAISON_ID,
        "start_date": SAISON_START,
        "end_date": SAISON_END,
        "status": "active",
        "rules": dict(RULES),
    }


def spieltag_document(**overrides: Any) -> dict[str, Any]:
    """No `anzahl_spiele`, the shape a drawn schedule leaves, so the echo assertions are controls rather than readings of a stale key."""

    return {
        "_id": SPIELTAG_OID,
        "beginn": SPIELTAG_BEGINN,
        "ende": SPIELTAG_ENDE,
        "position": 1,
        "saison_phase": "gruppenphase",
        "saison_id": SAISON_ID,
        **overrides,
    }


Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def on_a_database(container: Any, body: Body) -> Any:
    """One client and event loop per call: Motor binds to the loop it first runs on."""

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


async def move_the_seasons_end(database: AsyncIOMotorDatabase, end_date: str) -> Any:
    """Through `PATCH /saisons`, whose span refusal judges spans it reads out of `spieltage` itself."""

    return await patch_saison(
        saison_id=SAISON_ID,
        saison_data=FLPatchSaisonPayload(start_date=SAISON_START, end_date=end_date, rules=FLSaisonRules.model_validate(RULES)),
        saisons_collection=database.saisons,
        saison_teams_collection=database.saison_teams,
        spiele_collection=database.spiele,
        spieltage_collection=database.spieltage,
        saison_spieler_collection=database.saison_spieler,
    )


async def re_date(database: AsyncIOMotorDatabase, spieltag_id: ObjectId, *, beginn: str, ende: str) -> Any:
    """The whole of `PATCH /spieltage/{spieltag_id}`: the payload carries the span and nothing else."""

    return await patch_spieltag(
        spieltag_id=spieltag_id,
        spieltag_data=FLPatchSpieltagPayload(beginn=beginn, ende=ende),
        spieltage_collection=database.spieltage,
        saisons_collection=database.saisons,
        spiele_collection=database.spiele,
    )


class TestASeasonKeepsCoveringTheMatchdaysItStores:
    """`REQ-DATE-004` through the endpoint: only a database proves the spans it judges are read from `spieltage` at all."""

    def test_a_shrink_past_a_stored_matchday_is_refused(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            # Ends before the seeded matchday begins, so the matchday would be left outside.
            with pytest.raises(DocumentConflictException) as excinfo:
                await move_the_seasons_end(database, "2026-05-31")

            return excinfo.value

        refusal = on_a_database(mongo_container, body)

        assert refusal.error_code == SAISON_SPAN_BELOW_SPIELTAGE
        assert SPIELTAG_BEGINN in refusal.error_detail["message"]

    def test_a_shrink_the_matchday_still_fits_goes_through(self, mongo_container: Any):
        """A shrink stopping short refuses nothing, or the case above is a blanket refusal."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await move_the_seasons_end(database, "2026-06-25")

        response = on_a_database(mongo_container, body)

        assert response.updated_document.end_date == "2026-06-25"


class TestAWriteEchoesTheMatchdayItChanged:
    """`anzahl_spiele` is on no document, so the write has to derive it rather than read the stored row back."""

    def test_a_re_dated_matchday_is_echoed_with_its_derived_count(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await re_date(database, SPIELTAG_OID, beginn=SPIELTAG_BEGINN, ende="2026-06-22")

        response = on_a_database(mongo_container, body)

        assert response.updated_document.ende == "2026-06-22"
        assert response.updated_document.anzahl_spiele == GRUPPENPHASE_MATCHES

    def test_the_count_follows_the_matchdays_own_phase(self, mongo_container: Any):
        """Two phases, two figures: an echo answering a constant would be right for the Gruppenphase alone."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.spieltage.insert_one(spieltag_document(_id=FINALE_OID, saison_phase="finale"))

            return await re_date(database, FINALE_OID, beginn=SPIELTAG_BEGINN, ende="2026-06-22")

        response = on_a_database(mongo_container, body)

        assert response.updated_document.saison_phase == "finale"
        assert response.updated_document.anzahl_spiele == FINALE_MATCHES

    def test_a_stored_count_left_over_from_before_is_ignored(self, mongo_container: Any):
        """`extra="ignore"` validates such a document either way, so a pass-through would look correct wherever the season never changed."""

        stale_oid = ObjectId("6890a1b2c3d4e5f607300002")

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.spieltage.insert_one(spieltag_document(_id=stale_oid, anzahl_spiele=99, position=2))

            return await re_date(database, stale_oid, beginn=SPIELTAG_BEGINN, ende=SPIELTAG_ENDE)

        response = on_a_database(mongo_container, body)

        assert response.updated_document.anzahl_spiele == GRUPPENPHASE_MATCHES


class TestAMatchdayKeepsCoveringItsFixtures:
    """`REQ-DATE-003` through the endpoint: only a database proves the dates it judges are read out of `spiele` at all."""

    async def _with_a_fixture_on(self, database: AsyncIOMotorDatabase, datum: str | None) -> None:
        await database.spiele.insert_one({"saison_id": SAISON_ID, "spieltag_id": SPIELTAG_OID, "spiel_nr": 1, "datum": datum})

    def test_a_shrink_past_a_dated_fixture_is_refused(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            # On the matchday's last day, so pulling `ende` back to its first leaves the fixture outside.
            await self._with_a_fixture_on(database, SPIELTAG_ENDE)

            with pytest.raises(DocumentConflictException) as excinfo:
                await re_date(database, SPIELTAG_OID, beginn=SPIELTAG_BEGINN, ende=SPIELTAG_BEGINN)

            return excinfo.value

        refusal = on_a_database(mongo_container, body)

        assert refusal.error_code == SPIELTAG_SPAN_BELOW_FIXTURES
        assert SPIELTAG_ENDE in refusal.error_detail["message"]

    def test_an_undated_fixture_constrains_nothing(self, mongo_container: Any):
        """The endpoint filters those out rather than passing nulls, and only a real query says whether it does."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await self._with_a_fixture_on(database, None)

            return await re_date(database, SPIELTAG_OID, beginn=SPIELTAG_BEGINN, ende=SPIELTAG_BEGINN)

        response = on_a_database(mongo_container, body)

        assert response.updated_document.ende == SPIELTAG_BEGINN
