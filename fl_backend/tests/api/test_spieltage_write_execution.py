from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import patch_saison
from app.api.saisons.schemas import FLPatchSaisonPayload, FLSaisonRules
from app.api.spieltage.admin_router import patch_spieltag
from app.api.spieltage.schemas import FLPatchSpieltagPayload
from app.core.codes import Code
from app.core.exceptions import APIError
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spieltage_write_test")

SAISON_ID = "2026"
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607300001")
# The Finale's row, seeded only where a second phase's match count is what a test turns on.
FINALE_OID = ObjectId("6890a1b2c3d4e5f607300003")
# The later positions of the seeded matchday's own phase, for the tests judging a pair of them.
SECOND_OID = ObjectId("6890a1b2c3d4e5f607300004")
THIRD_OID = ObjectId("6890a1b2c3d4e5f607300005")
# A row of ANOTHER season, whose phases are numbered from 1 exactly as this one's are.
OTHER_SAISON_OID = ObjectId("6890a1b2c3d4e5f607300006")
OTHER_SAISON_ID = "2025"

SAISON_START = "2026-01-01"
SAISON_END = "2026-06-30"

# Late in the season, so an end date can be moved to either side of it.
SPIELTAG_BEGINN = "2026-06-20"
SPIELTAG_ENDE = "2026-06-21"

# A neighbour after the seeded matchday, and a date past it that is still inside the season: the
# order rule is what refuses the move, rather than `spieltag_outside_saison` reaching it first.
NEIGHBOUR_BEGINN = "2026-06-25"
NEIGHBOUR_ENDE = "2026-06-26"
AFTER_THE_NEIGHBOUR = "2026-06-28"
PAST_THE_NEIGHBOUR = "2026-06-29"

# A third dated position, and a day between it and the seeded matchday below: only a phase holding
# two dated rows under the subject tells the nearest one apart from the earliest.
MIDDLE_BEGINN = "2026-06-23"
BEFORE_THE_MIDDLE = "2026-06-22"

# Before the seeded matchday, which is where a step below the whole phase lands.
BEFORE_THE_FIRST_BEGINN = "2026-06-15"
BEFORE_THE_FIRST_ENDE = "2026-06-16"


# The other season's own days, so no row carries a span reaching across two seasons.
OTHER_SAISON_BEGINN = "2025-06-25"
OTHER_SAISON_ENDE = "2025-06-26"

# The shape the two match counts below follow from.
RULES = documents.rules_document(number_of_groups=4, teams_per_group=4, qualifiers_per_group=2)

# Spelled out rather than computed, so a `schedule_for` change that stops matching is visible here.
GRUPPENPHASE_MATCHES = 8
FINALE_MATCHES = 1


def saison_document() -> dict[str, Any]:
    return documents.saison_document(SAISON_ID, "active", start_date=SAISON_START, end_date=SAISON_END, rules=dict(RULES))


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


def spiel_document(*, spiel_nr: int, **overrides: Any) -> dict[str, Any]:
    """Only the date is ever read here."""

    return {**documents.spiel_document(spiel_id=ObjectId(), saison_id=SAISON_ID, spiel_nr=spiel_nr, spieltag_id=SPIELTAG_OID), **overrides}


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def on_a_database(url: str, body: Body) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (_, database):
            await database.saisons.insert_one(saison_document())
            await database.spieltage.insert_one(spieltag_document())
            return await body(database)

    return on_the_seed_loop(_run())


async def move_the_seasons_end(database: AsyncDatabase, end_date: str) -> Any:
    """Through `PATCH /saisons`, whose span refusal judges spans it reads out of `spieltage` itself; the season as stored after."""

    await patch_saison(
        saison_id=SAISON_ID,
        saison_data=FLPatchSaisonPayload(
            start_date=SAISON_START, end_date=end_date, rules=FLSaisonRules.model_validate(RULES), bewerbung=None, registrierung=None
        ),
        saisons_collection=database.saisons,
        saison_teams_collection=database.saison_teams,
        spiele_collection=database.spiele,
        spieltage_collection=database.spieltage,
        saison_spieler_collection=database.saison_spieler,
        db=database.client,
        today=SAISON_START,
    )

    return await database.saisons.find_one({"_id": SAISON_ID})


async def re_date(database: AsyncDatabase, spieltag_id: ObjectId, *, beginn: str, ende: str) -> Any:
    """The whole of `PATCH /spieltage/{spieltag_id}`, the payload carrying the span and nothing else; the matchday as stored after."""

    await patch_spieltag(
        spieltag_id=spieltag_id,
        spieltag_data=FLPatchSpieltagPayload(beginn=beginn, ende=ende),
        spieltage_collection=database.spieltage,
        saisons_collection=database.saisons,
        spiele_collection=database.spiele,
        db=database.client,
    )

    return await database.spieltage.find_one({"_id": spieltag_id})


class TestASeasonKeepsCoveringTheMatchdaysItStores:
    """`saison_span_below_spieltage` through the endpoint: only a database proves the spans it judges are read from `spieltage` at all."""

    def test_a_shrink_past_a_stored_matchday_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> APIError:
            # Ends before the seeded matchday begins, so the matchday would be left outside.
            with pytest.raises(APIError) as excinfo:
                await move_the_seasons_end(database, "2026-05-31")

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.SAISON_SPAN_BELOW_SPIELTAGE

    def test_a_shrink_the_matchday_still_fits_goes_through(self, mongo_replica_set_url: str):
        """A shrink stopping short refuses nothing, or the case above is a blanket refusal."""

        async def body(database: AsyncDatabase) -> Any:
            return await move_the_seasons_end(database, "2026-06-25")

        response = on_a_database(mongo_replica_set_url, body)

        assert response["end_date"] == "2026-06-25"


class TestAMatchdayKeepsCoveringItsFixtures:
    """`spieltag_span_below_spiele` through the endpoint: only a database proves the dates it judges are read out of `spiele` at all."""

    async def _with_a_fixture_on(self, database: AsyncDatabase, datum: str | None) -> None:
        await database.spiele.insert_one(spiel_document(spiel_nr=1, datum=datum))

    def test_a_shrink_past_a_dated_fixture_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> APIError:
            # On the matchday's last day, so pulling `ende` back to its first leaves the fixture outside.
            await self._with_a_fixture_on(database, SPIELTAG_ENDE)

            with pytest.raises(APIError) as excinfo:
                await re_date(database, SPIELTAG_OID, beginn=SPIELTAG_BEGINN, ende=SPIELTAG_BEGINN)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.SPIELTAG_SPAN_BELOW_SPIELE

    def test_an_undated_fixture_constrains_nothing(self, mongo_replica_set_url: str):
        """The endpoint filters those out rather than passing nulls, and only a real query says whether it does."""

        async def body(database: AsyncDatabase) -> Any:
            await self._with_a_fixture_on(database, None)

            return await re_date(database, SPIELTAG_OID, beginn=SPIELTAG_BEGINN, ende=SPIELTAG_BEGINN)

        response = on_a_database(mongo_replica_set_url, body)

        assert response["ende"] == SPIELTAG_BEGINN


class TestAMatchdayNeverBeginsBeforeItsPredecessor:
    """`spieltag_beginn_out_of_order` through the endpoint: only a database proves the neighbours it judges are read from `spieltage`."""

    async def _with_a_matchday(
        self,
        database: AsyncDatabase,
        *,
        oid: ObjectId,
        position: int,
        beginn: str | None,
        ende: str = NEIGHBOUR_ENDE,
        phase: str = "gruppenphase",
        saison_id: str = SAISON_ID,
    ) -> None:
        await database.spieltage.insert_one(
            spieltag_document(
                _id=oid,
                position=position,
                saison_phase=phase,
                saison_id=saison_id,
                beginn=beginn,
                ende=None if beginn is None else ende,
            )
        )

    def test_a_move_past_the_next_position_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> tuple[APIError, Any]:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(APIError) as excinfo:
                await re_date(database, SPIELTAG_OID, beginn=AFTER_THE_NEIGHBOUR, ende=PAST_THE_NEIGHBOUR)

            stored = await database.spieltage.find_one({"_id": SPIELTAG_OID}, {"beginn": 1})

            return excinfo.value, stored and stored["beginn"]

        refusal, stored_beginn = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.SPIELTAG_BEGINN_OUT_OF_ORDER
        # The refusal runs ahead of the write, so the matchday still holds the span it was seeded with.
        assert stored_beginn == SPIELTAG_BEGINN

    def test_a_move_before_the_previous_position_is_refused(self, mongo_replica_set_url: str):
        """The other neighbour, and the other direction: a rule reading one side would let this one through."""

        async def body(database: AsyncDatabase) -> APIError:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(APIError) as excinfo:
                await re_date(database, SECOND_OID, beginn=BEFORE_THE_FIRST_BEGINN, ende=BEFORE_THE_FIRST_ENDE)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.SPIELTAG_BEGINN_OUT_OF_ORDER

    def test_another_phases_matchday_is_no_neighbour(self, mongo_replica_set_url: str):
        """Positions restart in every phase, so only a query keyed on the phase keeps a Finale out of the Gruppenphase's order."""

        async def body(database: AsyncDatabase) -> Any:
            await self._with_a_matchday(database, oid=FINALE_OID, position=2, beginn=NEIGHBOUR_BEGINN, phase="finale")

            return await re_date(database, SPIELTAG_OID, beginn=AFTER_THE_NEIGHBOUR, ende=PAST_THE_NEIGHBOUR)

        response = on_a_database(mongo_replica_set_url, body)

        assert response["beginn"] == AFTER_THE_NEIGHBOUR

    def test_an_undated_neighbour_is_stepped_over_for_the_next_dated_one(self, mongo_replica_set_url: str):
        """A drawn matchday is undated, so stopping at the adjacent position would go blind for most of a phase being dated."""

        async def body(database: AsyncDatabase) -> APIError:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=None)
            await self._with_a_matchday(database, oid=THIRD_OID, position=3, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(APIError) as excinfo:
                await re_date(database, SPIELTAG_OID, beginn=AFTER_THE_NEIGHBOUR, ende=PAST_THE_NEIGHBOUR)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.SPIELTAG_BEGINN_OUT_OF_ORDER

    def test_an_undated_position_below_is_stepped_over_too(self, mongo_replica_set_url: str):
        """The other side of the same gap: a phase is dated in whatever order somebody works it, so undated rows sit on both sides."""

        async def body(database: AsyncDatabase) -> APIError:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=None)
            await self._with_a_matchday(database, oid=THIRD_OID, position=3, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(APIError) as excinfo:
                await re_date(database, THIRD_OID, beginn=BEFORE_THE_FIRST_BEGINN, ende=BEFORE_THE_FIRST_ENDE)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.SPIELTAG_BEGINN_OUT_OF_ORDER

    def test_the_nearest_dated_position_below_is_what_judges_the_move(self, mongo_replica_set_url: str):
        """Two dated rows below the subject at different days: the phase's earliest one would let this step through."""

        async def body(database: AsyncDatabase) -> APIError:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=MIDDLE_BEGINN)
            await self._with_a_matchday(database, oid=THIRD_OID, position=3, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(APIError) as excinfo:
                await re_date(database, THIRD_OID, beginn=BEFORE_THE_MIDDLE, ende=MIDDLE_BEGINN)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.SPIELTAG_BEGINN_OUT_OF_ORDER

    def test_another_seasons_matchday_is_no_neighbour(self, mongo_replica_set_url: str):
        """Every season numbers its own phases from 1, so a query missing the season key reads a stranger's dates as this phase's order."""

        async def body(database: AsyncDatabase) -> Any:
            await self._with_a_matchday(
                database,
                oid=OTHER_SAISON_OID,
                position=2,
                beginn=OTHER_SAISON_BEGINN,
                ende=OTHER_SAISON_ENDE,
                saison_id=OTHER_SAISON_ID,
            )

            return await re_date(database, SPIELTAG_OID, beginn=AFTER_THE_NEIGHBOUR, ende=PAST_THE_NEIGHBOUR)

        response = on_a_database(mongo_replica_set_url, body)

        assert response["beginn"] == AFTER_THE_NEIGHBOUR
