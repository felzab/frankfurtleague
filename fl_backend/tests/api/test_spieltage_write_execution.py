import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.api.saisons.admin_router import patch_saison
from app.api.saisons.schemas import FLPatchSaisonPayload, FLSaisonRules
from app.api.spiele.schemas import FLSaisonPhase
from app.api.spieltage.admin_router import delete_spieltag, patch_spieltag, post_spieltag, reactivate_spieltag
from app.api.spieltage.schemas import FLPatchSpieltagPayload, FLPostSpieltagPayload
from app.api.spieltage.services import (
    SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY,
    SPIELTAG_MOVED_TO_UNPLAYED_PHASE,
    SPIELTAG_OUTSIDE_SAISON,
    SPIELTAG_OVER_ITS_PHASE,
)
from app.core.exceptions import DocumentConflictException

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_spieltage_write_test"

SAISON_ID = "2026"
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607300001")

# Injected rather than read from the clock, which `get_german_date_str` makes substitutable.
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
        "saison_phase": "gruppenphase",
        "saison_id": SAISON_ID,
        "inactive_since": None,
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


async def retire_the_matchday(database: AsyncIOMotorDatabase, spieltag_id: ObjectId = SPIELTAG_OID) -> Any:
    """Through the endpoint that performs it: `DELETE` stamps `inactive_since`."""

    return await delete_spieltag(
        spieltag_id=spieltag_id,
        spieltage_collection=database.spieltage,
        saisons_collection=database.saisons,
        spiele_collection=database.spiele,
        today=RETIRED_ON,
    )


async def move_the_seasons_end(database: AsyncIOMotorDatabase, end_date: str) -> None:
    """Asserted rather than assumed: `REQ-DATE-004` reads live matchdays only, so a retired one must not block the shrink."""

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
    """Always `gruppenphase`; the phase is not a parameter because a `str` default would widen `FLSaisonPhase` past its `Literal`."""

    response = await post_spieltag(
        spieltag_data=FLPostSpieltagPayload(beginn="2026-03-07", ende="2026-03-08", saison_phase="gruppenphase", saison_id=SAISON_ID),
        spieltage_collection=database.spieltage,
        saisons_collection=database.saisons,
        today=RETIRED_ON,
    )

    return ObjectId(response.spieltag_id)


class TestAReactivatedMatchdayStaysInsideItsSeason:
    def test_the_season_shrinking_past_a_retired_matchday_refuses_the_way_back(self, mongo_container: Any):
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
        """A refused reactivation writes nothing, so the repair is the dates rather than a retry."""

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
        """The repair is a choice between two edits, so the message carries both spans."""

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
        """A shrink stopping short refuses nothing, or this is a blanket refusal."""

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
    """`anzahl_spiele` is on no document. Created rather than seeded, because a seeded document can be given any shape that passes."""

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
        """`PATCH` can move the phase the count follows from, so a remembered echo would be wrong rather than merely absent."""

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
        """`extra="ignore"` validates such a document either way, so a pass-through would look correct wherever the season never changed."""

        stale_oid = ObjectId("6890a1b2c3d4e5f607300002")

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.spieltage.insert_one(spieltag_document(_id=stale_oid, anzahl_spiele=99))
            return await retire_the_matchday(database, stale_oid)

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
                spieltag_data=FLPatchSpieltagPayload(beginn=SPIELTAG_BEGINN, ende="2026-06-22", saison_phase="gruppenphase"),
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
                    spieltag_data=FLPatchSpieltagPayload(beginn=SPIELTAG_BEGINN, ende=SPIELTAG_ENDE, saison_phase="finale"),
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
            spieltag_data=FLPatchSpieltagPayload(beginn=SPIELTAG_BEGINN, ende=SPIELTAG_ENDE, saison_phase=saison_phase),
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
                spieltag_data=FLPatchSpieltagPayload(beginn=SPIELTAG_BEGINN, ende="2026-06-22", saison_phase="achtelfinale"),
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
