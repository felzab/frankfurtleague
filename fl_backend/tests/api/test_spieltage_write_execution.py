import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.saisons.admin_router import patch_saison
from app.api.saisons.schemas import FLPatchSaisonPayload, FLSaisonRules
from app.api.saisons.services import SAISON_SPAN_BELOW_SPIELTAGE
from app.api.spieltage.admin_router import patch_spieltag
from app.api.spieltage.schemas import FLPatchSpieltagPayload
from app.api.spieltage.services import SPIELTAG_BEGINN_OUT_OF_ORDER, SPIELTAG_SPAN_BELOW_FIXTURES
from app.core.exceptions import DocumentConflictException
from tests.database import a_clean_database
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
# order rule is what refuses the move, rather than `REQ-DATE-002` reaching it first.
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

# Below both, for a phase already dated backwards: the step is what the rule judges, so a stored day
# under the position below it is a floor and only a move past that floor is refused.
BELOW_THE_BACKWARDS_PAIR = "2026-06-10"
# A later end for a row held at that floor, so an accepted write moves a field the echo can show.
WIDENED_ENDE = "2026-06-19"

# The other season's own days, so no row carries a span reaching across two seasons.
OTHER_SAISON_BEGINN = "2025-06-25"
OTHER_SAISON_ENDE = "2025-06-26"

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


def on_a_database(url: str, body: Body) -> Any:
    """One client and event loop per call: Motor binds to the loop it first runs on."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (_, database):
            await database.saisons.insert_one(saison_document())
            await database.spieltage.insert_one(spieltag_document())
            return await body(database)

    return asyncio.run(_run())


async def move_the_seasons_end(database: AsyncIOMotorDatabase, end_date: str) -> Any:
    """Through `PATCH /saisons`, whose span refusal judges spans it reads out of `spieltage` itself."""

    return await patch_saison(
        saison_id=SAISON_ID,
        saison_data=FLPatchSaisonPayload(start_date=SAISON_START, end_date=end_date, rules=FLSaisonRules.model_validate(RULES), bewerbung=None),
        saisons_collection=database.saisons,
        saison_teams_collection=database.saison_teams,
        spiele_collection=database.spiele,
        spieltage_collection=database.spieltage,
        saison_spieler_collection=database.saison_spieler,
        db=database.client,
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

    def test_a_shrink_past_a_stored_matchday_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            # Ends before the seeded matchday begins, so the matchday would be left outside.
            with pytest.raises(DocumentConflictException) as excinfo:
                await move_the_seasons_end(database, "2026-05-31")

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == SAISON_SPAN_BELOW_SPIELTAGE
        assert SPIELTAG_BEGINN in refusal.error_detail["message"]

    def test_a_shrink_the_matchday_still_fits_goes_through(self, mongo_replica_set_url: str):
        """A shrink stopping short refuses nothing, or the case above is a blanket refusal."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await move_the_seasons_end(database, "2026-06-25")

        response = on_a_database(mongo_replica_set_url, body)

        assert response.updated_document.end_date == "2026-06-25"


class TestAWriteEchoesTheMatchdayItChanged:
    """`anzahl_spiele` is on no document, so the write has to derive it rather than read the stored row back."""

    def test_a_re_dated_matchday_is_echoed_with_its_derived_count(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            return await re_date(database, SPIELTAG_OID, beginn=SPIELTAG_BEGINN, ende="2026-06-22")

        response = on_a_database(mongo_replica_set_url, body)

        assert response.updated_document.ende == "2026-06-22"
        assert response.updated_document.anzahl_spiele == GRUPPENPHASE_MATCHES

    def test_the_count_follows_the_matchdays_own_phase(self, mongo_replica_set_url: str):
        """Two phases, two figures: an echo answering a constant would be right for the Gruppenphase alone."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.spieltage.insert_one(spieltag_document(_id=FINALE_OID, saison_phase="finale"))

            return await re_date(database, FINALE_OID, beginn=SPIELTAG_BEGINN, ende="2026-06-22")

        response = on_a_database(mongo_replica_set_url, body)

        assert response.updated_document.saison_phase == "finale"
        assert response.updated_document.anzahl_spiele == FINALE_MATCHES

    def test_a_stored_count_left_over_from_before_is_ignored(self, mongo_replica_set_url: str):
        """`extra="ignore"` validates such a document either way, so a pass-through would look correct wherever the season never changed."""

        stale_oid = ObjectId("6890a1b2c3d4e5f607300002")

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.spieltage.insert_one(spieltag_document(_id=stale_oid, anzahl_spiele=99, position=2))

            return await re_date(database, stale_oid, beginn=SPIELTAG_BEGINN, ende=SPIELTAG_ENDE)

        response = on_a_database(mongo_replica_set_url, body)

        assert response.updated_document.anzahl_spiele == GRUPPENPHASE_MATCHES


class TestAMatchdayKeepsCoveringItsFixtures:
    """`REQ-DATE-003` through the endpoint: only a database proves the dates it judges are read out of `spiele` at all."""

    async def _with_a_fixture_on(self, database: AsyncIOMotorDatabase, datum: str | None) -> None:
        await database.spiele.insert_one({"saison_id": SAISON_ID, "spieltag_id": SPIELTAG_OID, "spiel_nr": 1, "datum": datum})

    def test_a_shrink_past_a_dated_fixture_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            # On the matchday's last day, so pulling `ende` back to its first leaves the fixture outside.
            await self._with_a_fixture_on(database, SPIELTAG_ENDE)

            with pytest.raises(DocumentConflictException) as excinfo:
                await re_date(database, SPIELTAG_OID, beginn=SPIELTAG_BEGINN, ende=SPIELTAG_BEGINN)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == SPIELTAG_SPAN_BELOW_FIXTURES
        assert SPIELTAG_ENDE in refusal.error_detail["message"]

    def test_an_undated_fixture_constrains_nothing(self, mongo_replica_set_url: str):
        """The endpoint filters those out rather than passing nulls, and only a real query says whether it does."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await self._with_a_fixture_on(database, None)

            return await re_date(database, SPIELTAG_OID, beginn=SPIELTAG_BEGINN, ende=SPIELTAG_BEGINN)

        response = on_a_database(mongo_replica_set_url, body)

        assert response.updated_document.ende == SPIELTAG_BEGINN


class TestAMatchdayNeverBeginsBeforeItsPredecessor:
    """`REQ-DATE-008` through the endpoint: only a database proves the neighbours it judges are read out of `spieltage` at all."""

    async def _with_a_matchday(
        self,
        database: AsyncIOMotorDatabase,
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
        async def body(database: AsyncIOMotorDatabase) -> tuple[DocumentConflictException, Any]:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(DocumentConflictException) as excinfo:
                await re_date(database, SPIELTAG_OID, beginn=AFTER_THE_NEIGHBOUR, ende=PAST_THE_NEIGHBOUR)

            stored = await database.spieltage.find_one({"_id": SPIELTAG_OID}, {"beginn": 1})

            return excinfo.value, stored and stored["beginn"]

        refusal, stored_beginn = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == SPIELTAG_BEGINN_OUT_OF_ORDER
        assert NEIGHBOUR_BEGINN in refusal.error_detail["message"]
        # The refusal runs ahead of the write, so the matchday still holds the span it was seeded with.
        assert stored_beginn == SPIELTAG_BEGINN

    def test_a_move_before_the_previous_position_is_refused(self, mongo_replica_set_url: str):
        """The other neighbour, and the other direction: a rule reading one side would let this one through."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(DocumentConflictException) as excinfo:
                await re_date(database, SECOND_OID, beginn=BEFORE_THE_FIRST_BEGINN, ende=BEFORE_THE_FIRST_ENDE)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == SPIELTAG_BEGINN_OUT_OF_ORDER
        assert SPIELTAG_BEGINN in refusal.error_detail["message"]

    def test_another_phases_matchday_is_no_neighbour(self, mongo_replica_set_url: str):
        """Positions restart in every phase, so only a query keyed on the phase keeps a Finale out of the Gruppenphase's order."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await self._with_a_matchday(database, oid=FINALE_OID, position=2, beginn=NEIGHBOUR_BEGINN, phase="finale")

            return await re_date(database, SPIELTAG_OID, beginn=AFTER_THE_NEIGHBOUR, ende=PAST_THE_NEIGHBOUR)

        response = on_a_database(mongo_replica_set_url, body)

        assert response.updated_document.beginn == AFTER_THE_NEIGHBOUR

    def test_an_undated_neighbour_is_stepped_over_for_the_next_dated_one(self, mongo_replica_set_url: str):
        """A drawn matchday is undated, so stopping at the adjacent position would go blind for most of a phase being dated."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=None)
            await self._with_a_matchday(database, oid=THIRD_OID, position=3, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(DocumentConflictException) as excinfo:
                await re_date(database, SPIELTAG_OID, beginn=AFTER_THE_NEIGHBOUR, ende=PAST_THE_NEIGHBOUR)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == SPIELTAG_BEGINN_OUT_OF_ORDER
        assert "position 3" in refusal.error_detail["message"]

    def test_an_undated_position_below_is_stepped_over_too(self, mongo_replica_set_url: str):
        """The other side of the same gap: a phase is dated in whatever order somebody works it, so undated rows sit on both sides."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=None)
            await self._with_a_matchday(database, oid=THIRD_OID, position=3, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(DocumentConflictException) as excinfo:
                await re_date(database, THIRD_OID, beginn=BEFORE_THE_FIRST_BEGINN, ende=BEFORE_THE_FIRST_ENDE)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == SPIELTAG_BEGINN_OUT_OF_ORDER
        assert "position 1" in refusal.error_detail["message"]

    def test_the_nearest_dated_position_below_is_what_judges_the_move(self, mongo_replica_set_url: str):
        """Two dated rows below the subject at different days: the phase's earliest one would let this step through."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=MIDDLE_BEGINN)
            await self._with_a_matchday(database, oid=THIRD_OID, position=3, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(DocumentConflictException) as excinfo:
                await re_date(database, THIRD_OID, beginn=BEFORE_THE_MIDDLE, ende=MIDDLE_BEGINN)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == SPIELTAG_BEGINN_OUT_OF_ORDER
        # Position 1 begins earlier still and would permit this day, so naming the middle row is the
        # whole of what "nearest" means here.
        assert "position 2" in refusal.error_detail["message"]
        assert MIDDLE_BEGINN in refusal.error_detail["message"]

    def test_another_seasons_matchday_is_no_neighbour(self, mongo_replica_set_url: str):
        """Every season numbers its own phases from 1, so a query missing the season key reads a stranger's dates as this phase's order."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
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

        assert response.updated_document.beginn == AFTER_THE_NEIGHBOUR

    def test_the_predecessor_refusal_names_a_widening_the_write_path_takes(self, mongo_replica_set_url: str):
        """Its remedy moves the row BELOW, so only driving that row says the message sends an admin somewhere the rule lets them go."""

        async def body(database: AsyncIOMotorDatabase) -> tuple[str, Any]:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(DocumentConflictException) as excinfo:
                await re_date(database, SECOND_OID, beginn=BEFORE_THE_FIRST_BEGINN, ende=BEFORE_THE_FIRST_ENDE)

            # The predecessor widened as the message reads it, its own `beginn` untouched.
            accepted = await re_date(database, SPIELTAG_OID, beginn=SPIELTAG_BEGINN, ende=AFTER_THE_NEIGHBOUR)

            return excinfo.value.error_detail["message"], accepted

        message, response = on_a_database(mongo_replica_set_url, body)

        assert "widen position 1's `ende`" in message
        assert response.updated_document.ende == AFTER_THE_NEIGHBOUR

    def test_the_predecessor_refusal_names_the_day_the_matchday_already_stands_on(self, mongo_replica_set_url: str):
        """Its remedy is this row's own stored day, so only driving that day says the message sends an admin somewhere the rule lets them go."""

        async def body(database: AsyncIOMotorDatabase) -> tuple[str, Any]:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=BEFORE_THE_FIRST_BEGINN, ende=BEFORE_THE_FIRST_ENDE)

            with pytest.raises(DocumentConflictException) as excinfo:
                await re_date(database, SECOND_OID, beginn=BELOW_THE_BACKWARDS_PAIR, ende=BEFORE_THE_FIRST_ENDE)

            # Held at the floor the message names, its `ende` moved so the echo shows a write.
            accepted = await re_date(database, SECOND_OID, beginn=BEFORE_THE_FIRST_BEGINN, ende=WIDENED_ENDE)

            return excinfo.value.error_detail["message"], accepted

        message, response = on_a_database(mongo_replica_set_url, body)

        assert f"cannot go earlier than the {BEFORE_THE_FIRST_BEGINN} it already stands on" in message
        assert response.updated_document.beginn == BEFORE_THE_FIRST_BEGINN
        assert response.updated_document.ende == WIDENED_ENDE

    def test_a_first_datings_refusal_names_a_day_the_write_path_takes(self, mongo_replica_set_url: str):
        """An undated matchday has no `beginn` to restore, so its remedy is a different one and needs driving of its own."""

        async def body(database: AsyncIOMotorDatabase) -> tuple[str, Any]:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=None)
            await self._with_a_matchday(database, oid=THIRD_OID, position=3, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(DocumentConflictException) as excinfo:
                await re_date(database, SECOND_OID, beginn=AFTER_THE_NEIGHBOUR, ende=PAST_THE_NEIGHBOUR)

            # Dated on the follower's own day, which is the latest the message offers.
            accepted = await re_date(database, SECOND_OID, beginn=NEIGHBOUR_BEGINN, ende=PAST_THE_NEIGHBOUR)

            return excinfo.value.error_detail["message"], accepted

        message, response = on_a_database(mongo_replica_set_url, body)

        assert f"it holds no `beginn` to keep, so date it at or before {NEIGHBOUR_BEGINN}" in message
        assert response.updated_document.beginn == NEIGHBOUR_BEGINN

    def test_the_refusal_names_a_patch_the_write_path_takes(self, mongo_replica_set_url: str):
        """Both fields are bare strings, so only driving the offered escape says the rule reads the pair its message names."""

        async def body(database: AsyncIOMotorDatabase) -> tuple[str, Any]:
            await self._with_a_matchday(database, oid=SECOND_OID, position=2, beginn=NEIGHBOUR_BEGINN)

            with pytest.raises(DocumentConflictException) as excinfo:
                await re_date(database, SPIELTAG_OID, beginn=AFTER_THE_NEIGHBOUR, ende=PAST_THE_NEIGHBOUR)

            # The message's own remedy, submitted as it reads it: the stored `beginn` back, and the
            # `ende` this request already carried.
            accepted = await re_date(database, SPIELTAG_OID, beginn=SPIELTAG_BEGINN, ende=PAST_THE_NEIGHBOUR)

            return excinfo.value.error_detail["message"], accepted

        message, response = on_a_database(mongo_replica_set_url, body)

        assert f"restore its `beginn` of {SPIELTAG_BEGINN}" in message
        assert f"this `ende` of {PAST_THE_NEIGHBOUR}, which already runs past that day" in message
        assert response.updated_document.beginn == SPIELTAG_BEGINN
        assert response.updated_document.ende == PAST_THE_NEIGHBOUR
