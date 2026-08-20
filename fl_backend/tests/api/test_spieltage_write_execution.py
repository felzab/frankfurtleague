import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.api.saisons.admin_router import patch_saison
from app.api.saisons.schemas import FLPatchSaisonPayload, FLSaisonRules
from app.api.saisons.services import SAISON_SPAN_BELOW_SPIELTAGE
from app.api.spiele.schemas import FLSaisonPhase
from app.api.spieltage.admin_router import patch_spieltag, post_spieltag
from app.api.spieltage.schemas import FLPatchSpieltagPayload, FLPostSpieltagPayload
from app.api.spieltage.services import (
    SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY,
    SPIELTAG_MOVED_TO_UNPLAYED_PHASE,
    SPIELTAG_OVER_ITS_PHASE,
)
from app.core.exceptions import DocumentConflictException

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_spieltage_write_test"

SAISON_ID = "2026"
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607300001")

# Injected rather than read from the clock, which `get_german_date_str` makes substitutable.
TODAY = "2026-04-01"

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
    """No `anzahl_spiele`, the shape `POST /spieltage` inserts, so the echo assertions are controls rather than readings of a stale key."""

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


# The seeded matchday holds the Gruppenphase's position 1, so `create_a_matchday` appends after it.
CREATED_POSITION = 2


async def create_a_matchday(database: AsyncIOMotorDatabase) -> ObjectId:
    """Always `gruppenphase`; the phase is not a parameter because a `str` default would widen `FLSaisonPhase` past its `Literal`."""

    response = await post_spieltag(
        spieltag_data=FLPostSpieltagPayload(beginn="2026-03-07", ende="2026-03-08", saison_phase="gruppenphase", saison_id=SAISON_ID),
        spieltage_collection=database.spieltage,
        saisons_collection=database.saisons,
        today=TODAY,
    )

    return ObjectId(response.spieltag_id)


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


class TestACreateAppendsToItsPhase:
    """The one path that writes a `position` without being handed one, so only a database says which number it picked."""

    async def _create_in(self, database: AsyncIOMotorDatabase, saison_phase: FLSaisonPhase) -> int:
        response = await post_spieltag(
            spieltag_data=FLPostSpieltagPayload(beginn="2026-03-07", ende="2026-03-08", saison_phase=saison_phase, saison_id=SAISON_ID),
            spieltage_collection=database.spieltage,
            saisons_collection=database.saisons,
            today=TODAY,
        )
        stored = await database.spieltage.find_one({"_id": ObjectId(response.spieltag_id)})

        assert stored is not None
        return int(stored["position"])

    def test_the_first_matchday_of_a_phase_takes_position_one(self, mongo_container: Any):
        """The Finale holds none, and the seeded Gruppenphase row must not push its number up."""

        async def body(database: AsyncIOMotorDatabase) -> int:
            return await self._create_in(database, "finale")

        assert on_a_database(mongo_container, body) == 1

    def test_each_further_matchday_takes_the_next_free_position(self, mongo_container: Any):
        """Read off the phase's highest, not off its count: a create appends behind whatever is already there."""

        async def body(database: AsyncIOMotorDatabase) -> list[int]:
            return [await self._create_in(database, "gruppenphase"), await self._create_in(database, "gruppenphase")]

        assert on_a_database(mongo_container, body) == [CREATED_POSITION, CREATED_POSITION + 1]

    def test_the_phases_are_numbered_independently(self, mongo_container: Any):
        """`saison_phase` is a key of the unique index for exactly this: the Finale's 1 sits beside the Gruppenphase's."""

        async def body(database: AsyncIOMotorDatabase) -> tuple[int, int]:
            return await self._create_in(database, "gruppenphase"), await self._create_in(database, "finale")

        assert on_a_database(mongo_container, body) == (CREATED_POSITION, 1)


class TestAWriteEchoesTheMatchdayItChanged:
    """`anzahl_spiele` is on no document. Created rather than seeded, because a seeded document can be given any shape that passes."""

    def test_a_created_matchday_can_be_edited(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            created = await create_a_matchday(database)
            return await patch_spieltag(
                spieltag_id=created,
                spieltag_data=FLPatchSpieltagPayload(
                    beginn="2026-03-07", ende="2026-03-09", saison_phase="gruppenphase", position=CREATED_POSITION
                ),
                spieltage_collection=database.spieltage,
                saisons_collection=database.saisons,
                spiele_collection=database.spiele,
            )

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.ende == "2026-03-09"
        assert response.updated_document.anzahl_spiele == GRUPPENPHASE_MATCHES

    def test_moving_the_phase_moves_the_count_the_echo_reports(self, mongo_container: Any):
        """`PATCH` can move the phase the count follows from, so a remembered echo would be wrong rather than merely absent."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            created = await create_a_matchday(database)
            return await patch_spieltag(
                spieltag_id=created,
                # Position 1 in the Finale, which holds none: a phase change picks its slot in the same write.
                spieltag_data=FLPatchSpieltagPayload(beginn="2026-03-07", ende="2026-03-08", saison_phase="finale", position=1),
                spieltage_collection=database.spieltage,
                saisons_collection=database.saisons,
                spiele_collection=database.spiele,
            )

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.saison_phase == "finale"
        assert response.updated_document.anzahl_spiele == FINALE_MATCHES

    def test_a_stored_count_left_over_from_before_is_ignored(self, mongo_container: Any):
        """`extra="ignore"` validates such a document either way, so a pass-through would look correct wherever the season never changed."""

        stale_oid = ObjectId("6890a1b2c3d4e5f607300002")

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.spieltage.insert_one(spieltag_document(_id=stale_oid, anzahl_spiele=99, position=CREATED_POSITION))
            return await patch_spieltag(
                spieltag_id=stale_oid,
                spieltag_data=FLPatchSpieltagPayload(
                    beginn=SPIELTAG_BEGINN, ende=SPIELTAG_ENDE, saison_phase="gruppenphase", position=CREATED_POSITION
                ),
                spieltage_collection=database.spieltage,
                saisons_collection=database.saisons,
                spiele_collection=database.spiele,
            )

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.anzahl_spiele == GRUPPENPHASE_MATCHES


class TestAMatchdayOverItsPhaseKeepsItsDatesEditable:
    """`REQ-SPIELTAG-002` against a real `spiele` collection, so the refusal compares the figures the endpoint produces."""

    ATTACHED = GRUPPENPHASE_MATCHES + 1

    async def _with_fixtures_attached(self, database: AsyncIOMotorDatabase) -> None:
        """Fixtures on the seeded matchday, dateless so `REQ-DATE-003` has nothing to hold."""

        for spiel_nr in range(1, self.ATTACHED + 1):
            await database.spiele.insert_one({"saison_id": SAISON_ID, "spieltag_id": SPIELTAG_OID, "spiel_nr": spiel_nr})

    def test_a_dates_only_patch_goes_through(self, mongo_container: Any):
        """The payload repeats the stored phase, so there is no move for the phase rule to judge."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await self._with_fixtures_attached(database)
            return await patch_spieltag(
                spieltag_id=SPIELTAG_OID,
                spieltag_data=FLPatchSpieltagPayload(beginn=SPIELTAG_BEGINN, ende="2026-06-22", saison_phase="gruppenphase", position=1),
                spieltage_collection=database.spieltage,
                saisons_collection=database.saisons,
                spiele_collection=database.spiele,
            )

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.ende == "2026-06-22"

    def test_a_move_into_a_smaller_phase_is_still_refused(self, mongo_container: Any):
        """From a bad state the step that makes it worse is still refused."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await self._with_fixtures_attached(database)

            with pytest.raises(DocumentConflictException) as excinfo:
                await patch_spieltag(
                    spieltag_id=SPIELTAG_OID,
                    spieltag_data=FLPatchSpieltagPayload(beginn=SPIELTAG_BEGINN, ende=SPIELTAG_ENDE, saison_phase="finale", position=1),
                    spieltage_collection=database.spieltage,
                    saisons_collection=database.saisons,
                    spiele_collection=database.spiele,
                )

            return excinfo.value

        refusal = on_a_database(mongo_container, body)

        assert refusal.error_code == SPIELTAG_OVER_ITS_PHASE


class TestWhichPhaseChangesAreLegitimate:
    """Only a database proves the split: the side counts key on the fixture's own `saison_phase`, which this endpoint never writes."""

    async def _with_fixtures(self, database: AsyncIOMotorDatabase, saison_phase: str, count: int) -> None:
        """Fixtures carrying their own phase, dateless so `REQ-DATE-003` has nothing to hold."""

        for spiel_nr in range(1, count + 1):
            await database.spiele.insert_one(
                {"saison_id": SAISON_ID, "spieltag_id": SPIELTAG_OID, "spiel_nr": spiel_nr, "saison_phase": saison_phase}
            )

    async def _patch_to(self, database: AsyncIOMotorDatabase, saison_phase: FLSaisonPhase) -> Any:
        return await patch_spieltag(
            spieltag_id=SPIELTAG_OID,
            spieltag_data=FLPatchSpieltagPayload(beginn=SPIELTAG_BEGINN, ende=SPIELTAG_ENDE, saison_phase=saison_phase, position=1),
            spieltage_collection=database.spieltage,
            saisons_collection=database.saisons,
            spiele_collection=database.spiele,
        )

    def test_a_drawn_knockout_round_may_not_become_a_group_matchday(self, mongo_container: Any):
        """`REQ-SPIELTAG-002` cannot fire on these counts, which leaves the boundary rule as the only thing that can refuse."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await database.spieltage.update_one({"_id": SPIELTAG_OID}, {"$set": {"saison_phase": "viertelfinale"}})
            await self._with_fixtures(database, "viertelfinale", 4)

            with pytest.raises(DocumentConflictException) as excinfo:
                await self._patch_to(database, "gruppenphase")

            return excinfo.value

        refusal = on_a_database(mongo_container, body)

        assert refusal.error_code == SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY

    def test_an_empty_knockout_matchday_still_becomes_a_group_matchday(self, mongo_container: Any):
        """Identical move, identical row, opposite answer — which makes the case above a rule about the fixtures."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.spieltage.update_one({"_id": SPIELTAG_OID}, {"$set": {"saison_phase": "viertelfinale"}})
            return await self._patch_to(database, "gruppenphase")

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.saison_phase == "gruppenphase"
        assert response.updated_document.anzahl_spiele == GRUPPENPHASE_MATCHES

    def test_a_matchday_may_be_moved_to_agree_with_the_fixtures_it_holds(self, mongo_container: Any):
        """A rule reading the crossing alone would block the only edit that improves the state."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await self._with_fixtures(database, "viertelfinale", 4)
            return await self._patch_to(database, "viertelfinale")

        response = on_a_database(mongo_container, body)

        assert response.updated_document is not None
        assert response.updated_document.saison_phase == "viertelfinale"

    def test_a_move_into_a_round_the_season_never_plays_is_refused(self, mongo_container: Any):
        """These rules send eight into the bracket, so `achtelfinale` is a round the season never reaches."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await database.spieltage.update_one({"_id": SPIELTAG_OID}, {"$set": {"saison_phase": "viertelfinale"}})

            with pytest.raises(DocumentConflictException) as excinfo:
                await self._patch_to(database, "achtelfinale")

            return excinfo.value

        refusal = on_a_database(mongo_container, body)

        assert refusal.error_code == SPIELTAG_MOVED_TO_UNPLAYED_PHASE

    def test_a_row_stranded_in_an_unplayed_round_keeps_its_dates_and_its_way_out(self, mongo_container: Any):
        """A rule reading the row's own phase would refuse the dates correction and leave no way to reach the move out."""

        async def body(database: AsyncIOMotorDatabase) -> tuple[Any, Any]:
            await database.spieltage.update_one({"_id": SPIELTAG_OID}, {"$set": {"saison_phase": "achtelfinale"}})

            dates_only = await patch_spieltag(
                spieltag_id=SPIELTAG_OID,
                spieltag_data=FLPatchSpieltagPayload(beginn=SPIELTAG_BEGINN, ende="2026-06-22", saison_phase="achtelfinale", position=1),
                spieltage_collection=database.spieltage,
                saisons_collection=database.saisons,
                spiele_collection=database.spiele,
            )

            return dates_only, await self._patch_to(database, "viertelfinale")

        dates_only, moved_out = on_a_database(mongo_container, body)

        assert dates_only.updated_document is not None
        assert dates_only.updated_document.ende == "2026-06-22"
        assert moved_out.updated_document is not None
        assert moved_out.updated_document.saison_phase == "viertelfinale"

    def test_the_unplayed_round_is_answered_before_the_boundary(self, mongo_container: Any):
        """Naming the season's rules is the actionable half: moving fixtures would not make the round exist."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await self._with_fixtures(database, "gruppenphase", GRUPPENPHASE_MATCHES)

            with pytest.raises(DocumentConflictException) as excinfo:
                await self._patch_to(database, "achtelfinale")

            return excinfo.value

        refusal = on_a_database(mongo_container, body)

        assert refusal.error_code == SPIELTAG_MOVED_TO_UNPLAYED_PHASE
