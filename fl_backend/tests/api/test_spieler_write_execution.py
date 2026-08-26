import asyncio
from typing import Any, Awaitable, Callable

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.spieler.admin_router import (
    delete_saison_spieler,
    patch_saison_spieler,
    patch_spieler,
    post_saison_spieler,
    post_spieler,
    reactivate_saison_spieler,
)
from app.api.spieler.schemas import (
    FLPatchSaisonSpielerPayload,
    FLPatchSpielerPayload,
    FLPostSaisonSpielerPayload,
    FLPostSpielerPayload,
)
from app.api.spieler.services import SQUAD_FULL, SQUAD_ROLLE_TAKEN, SQUAD_TEAM_NOT_IN_SAISON
from app.core.exceptions import DocumentConflictException
from tests.database import a_clean_database

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_spieler_write_test"

SAISON_ID = "2026"
# Two, so a squad reaches its cap in two inserts and the third write is the refusal under test.
MAX_KADERGROESSE = 2

HOME_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400001")
AWAY_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400002")
# The club a replacement hands the home club's junction row to.
INCOMING_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400003")

# Injected rather than read from the clock, which `get_german_date_str` makes substitutable.
TODAY = "2026-04-01"

RULES = {
    "win_points": 3,
    "draw_points": 1,
    "qualifiers_per_group": 2,
    "number_of_groups": 4,
    "teams_per_group": 4,
    "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
    "tiebreak_order": "tordifferenz",
    "max_kadergroesse": MAX_KADERGROESSE,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
}

Body = Callable[[AsyncIOMotorDatabase], Awaitable[Any]]


def spieler_id_for(index: int) -> ObjectId:
    return ObjectId(f"6890a1b2c3d4e5f6074100{index:02d}")


def squad_row(*, spieler_id: ObjectId, team_id: ObjectId, inactive_since: str | None = None, rolle: str | None = None) -> dict[str, Any]:
    return {
        "spieler_id": spieler_id,
        "saison_id": SAISON_ID,
        "team_id": team_id,
        "is_nachgetragen": False,
        "rolle": rolle,
        "stufe": "Q2",
        "position": "Angriff",
        "nummer": None,
        "inactive_since": inactive_since,
    }


def legacy_squad_row(*, spieler_id: ObjectId, team_id: ObjectId, inactive_since: str | None = None) -> dict[str, Any]:
    """A row as written before either field existed: the keys are ABSENT rather than empty, which no projection can supply."""

    row = squad_row(spieler_id=spieler_id, team_id=team_id, inactive_since=inactive_since)
    del row["is_nachgetragen"]
    del row["rolle"]

    return row


def on_a_database(container: Any, body: Body) -> Any:
    """One client and event loop per call: Motor binds to the loop it first runs on."""

    async def _run() -> Any:
        async with a_clean_database(container.get_connection_url(), DATABASE_NAME) as (_, database):
            await database.saisons.insert_one(
                {
                    "_id": SAISON_ID,
                    "start_date": "2026-01-01",
                    "end_date": "2026-06-30",
                    "status": "active",
                    "rules": dict(RULES),
                }
            )
            # Both clubs entered, so `REQ-SQUAD-001` passes and every refusal below is the cap.
            await database.saison_teams.insert_many(
                [
                    {"saison_id": SAISON_ID, "team_id": HOME_TEAM_OID, "gruppe": "A"},
                    {"saison_id": SAISON_ID, "team_id": AWAY_TEAM_OID, "gruppe": "B"},
                ]
            )
            return await body(database)

    return asyncio.run(_run())


async def fill(database: AsyncIOMotorDatabase, team_id: ObjectId, count: int) -> None:
    """`count` live rows in one squad, none of them a player any test then writes."""

    await database.saison_spieler.insert_many([squad_row(spieler_id=spieler_id_for(index), team_id=team_id) for index in range(count)])


async def enter(database: AsyncIOMotorDatabase, spieler_id: ObjectId, team_id: ObjectId, *, rolle: Any = None) -> Any:
    return await post_saison_spieler(
        spieler_id=spieler_id,
        saison_spieler_data=FLPostSaisonSpielerPayload(
            saison_id=SAISON_ID, team_id=team_id, nummer=None, position=None, stufe=None, is_nachgetragen=False, rolle=rolle
        ),
        saison_spieler_collection=database.saison_spieler,
        saison_teams_collection=database.saison_teams,
        saisons_collection=database.saisons,
    )


async def move(database: AsyncIOMotorDatabase, spieler_id: ObjectId, team_id: ObjectId, *, nummer: str | None = None, rolle: Any = None) -> Any:
    return await patch_saison_spieler(
        spieler_id=spieler_id,
        saison_id=SAISON_ID,
        saison_spieler_data=FLPatchSaisonSpielerPayload(
            team_id=team_id, nummer=nummer, position=None, stufe=None, is_nachgetragen=False, rolle=rolle
        ),
        saison_spieler_collection=database.saison_spieler,
        saison_teams_collection=database.saison_teams,
        saisons_collection=database.saisons,
    )


async def revive(database: AsyncIOMotorDatabase, spieler_id: ObjectId) -> Any:
    return await reactivate_saison_spieler(
        spieler_id=spieler_id,
        saison_id=SAISON_ID,
        saison_spieler_collection=database.saison_spieler,
        saison_teams_collection=database.saison_teams,
        saisons_collection=database.saisons,
    )


async def hand_the_junction_row_over(database: AsyncIOMotorDatabase, team_id: ObjectId) -> None:
    """The state `POST /teams/{team_id}/saisons/{saison_id}/replace` leaves: the row is repointed, so this club holds none in the season."""

    await database.saison_teams.update_one({"saison_id": SAISON_ID, "team_id": team_id}, {"$set": {"team_id": INCOMING_TEAM_OID}})


class TestTheConsentRecordIsComposedAndNeverAccepted:
    """D59 through the endpoints: only a database shows what is stored, and what survives a later write."""

    def test_creating_a_player_stores_a_collected_consent(self, mongo_container: Any):
        """`erziehungsberechtigt` with both dates set -- a guardian filing a registration today really is consenting."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            response = await post_spieler(
                spieler_data=FLPostSpielerPayload(vorname="Max", nachname="Mustermann"),
                spieler_collection=database.spieler,
                today=TODAY,
            )
            return await database.spieler.find_one({"_id": ObjectId(response.spieler_id)})

        stored = on_a_database(mongo_container, body)

        assert stored["einwilligung"] == {
            "umfang": "kader_oeffentlich",
            "erteilt_von": "erziehungsberechtigt",
            "datum": TODAY,
            "bestaetigt_am": TODAY,
        }

    def test_the_create_payload_carries_no_consent_field(self):
        """An admin able to state one could publish a pupil on a claim nobody made. Pure: an absence needs no database."""

        assert "einwilligung" not in FLPostSpielerPayload.model_fields

    def test_the_patch_payload_carries_no_consent_field(self):
        """The load-bearing half, because `patch_spieler` `$set`s this model's whole dump."""

        assert "einwilligung" not in FLPatchSpielerPayload.model_fields

    def test_correcting_a_name_leaves_the_consent_record_standing(self, mongo_container: Any):
        """`$set` names only the payload's keys, so the sub-document is left alone rather than replaced -- against a real update."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            created = await post_spieler(
                spieler_data=FLPostSpielerPayload(vorname="Max", nachname="Mustermann"),
                spieler_collection=database.spieler,
                today=TODAY,
            )
            await patch_spieler(
                spieler_id=ObjectId(created.spieler_id),
                spieler_data=FLPatchSpielerPayload(vorname="Maximilian", nachname="Mustermann"),
                spieler_collection=database.spieler,
            )
            return await database.spieler.find_one({"_id": ObjectId(created.spieler_id)})

        stored = on_a_database(mongo_container, body)

        assert stored["vorname"] == "Maximilian"
        assert stored["einwilligung"]["erteilt_von"] == "erziehungsberechtigt"
        assert stored["einwilligung"]["bestaetigt_am"] == TODAY


class TestTheSquadCapOnEveryWritePath:
    """`REQ-SQUAD-003` on all three: the cap belongs to the DESTINATION squad, never to the verb that fills it."""

    def test_entering_a_full_squad_is_refused(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE)

            with pytest.raises(DocumentConflictException) as excinfo:
                await enter(database, spieler_id_for(90), HOME_TEAM_OID)

            return excinfo.value

        refusal = on_a_database(mongo_container, body)

        assert refusal.error_code == SQUAD_FULL

    def test_entering_a_squad_with_room_goes_through(self, mongo_container: Any):
        """The floor under the case above, or that refusal could be a blanket one."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE - 1)
            return await enter(database, spieler_id_for(90), HOME_TEAM_OID)

        assert on_a_database(mongo_container, body).team_id == HOME_TEAM_OID

    def test_a_retired_row_holds_no_place(self, mongo_container: Any):
        """A player who left the squad gave their place back, which is what makes the count a LIVE one."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE - 1)
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            return await enter(database, spieler_id_for(90), HOME_TEAM_OID)

        assert on_a_database(mongo_container, body).team_id == HOME_TEAM_OID

    def test_transferring_into_a_full_squad_is_refused(self, mongo_container: Any):
        """The DESTINATION is judged: the player's own place is in the team they are leaving."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await fill(database, AWAY_TEAM_OID, MAX_KADERGROESSE)
            await enter(database, spieler_id_for(90), HOME_TEAM_OID)

            with pytest.raises(DocumentConflictException) as excinfo:
                await move(database, spieler_id_for(90), AWAY_TEAM_OID)

            return excinfo.value

        refusal = on_a_database(mongo_container, body)

        assert refusal.error_code == SQUAD_FULL

    def test_transferring_into_a_squad_with_room_goes_through(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            await fill(database, AWAY_TEAM_OID, MAX_KADERGROESSE - 1)
            await enter(database, spieler_id_for(90), HOME_TEAM_OID)
            return await move(database, spieler_id_for(90), AWAY_TEAM_OID)

        assert on_a_database(mongo_container, body).team_id == AWAY_TEAM_OID

    def test_an_edit_that_moves_nobody_passes_at_capacity(self, mongo_container: Any):
        """The over-breadth trap: the player already holds one of the places, so counting their own row would refuse a shirt change."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE - 1)
            await enter(database, spieler_id_for(90), HOME_TEAM_OID)
            # The squad is now exactly full, and this write changes only the shirt.
            return await move(database, spieler_id_for(90), HOME_TEAM_OID, nummer="7")

        response = on_a_database(mongo_container, body)

        assert response.team_id == HOME_TEAM_OID
        assert response.nummer == "7"

    def test_reactivating_into_a_squad_that_has_since_filled_up_is_refused(self, mongo_container: Any):
        """The gap a create cannot cover: the retired row keeps the unique key, so reviving it is the only way back in."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE)

            with pytest.raises(DocumentConflictException) as excinfo:
                await revive(database, spieler_id_for(90))

            return excinfo.value

        refusal = on_a_database(mongo_container, body)

        assert refusal.error_code == SQUAD_FULL

    def test_reactivating_into_a_squad_with_room_goes_through(self, mongo_container: Any):
        """And it keeps the number the retired row carried, which is why reviving is not a re-create."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.saison_spieler.insert_one(
                {**squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01"), "nummer": "9"}
            )
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE - 1)

            return await revive(database, spieler_id_for(90))

        response = on_a_database(mongo_container, body)

        assert response.inactive_since is None
        assert response.nummer == "9"


class TestTheOneRolePerSquadOnEveryWritePath:
    """`REQ-SQUAD-004` on all three, for the reason the cap is on all three: the role belongs to the DESTINATION squad."""

    def test_entering_a_squad_whose_role_is_taken_is_refused(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen"))

            with pytest.raises(DocumentConflictException) as excinfo:
                await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="kapitaen")

            return excinfo.value

        assert on_a_database(mongo_container, body).error_code == SQUAD_ROLLE_TAKEN

    def test_entering_a_squad_whose_other_role_is_taken_goes_through(self, mongo_container: Any):
        """The floor under the case above: the rule is per role, so a squad with a Kapitaen still has its Co-Kapitaen to give."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen"))
            return await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="co_kapitaen")

        assert on_a_database(mongo_container, body).rolle == "co_kapitaen"

    def test_a_retired_holder_gives_the_role_back(self, mongo_container: Any):
        """The same live-rows-only count the cap takes: a player who left the squad is not leading it."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen", inactive_since="2026-03-01")
            )
            return await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="kapitaen")

        assert on_a_database(mongo_container, body).rolle == "kapitaen"

    def test_another_squads_holder_is_not_consulted(self, mongo_container: Any):
        """The scope is one team in one season: two clubs each field a Kapitaen."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=AWAY_TEAM_OID, rolle="kapitaen"))
            return await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="kapitaen")

        assert on_a_database(mongo_container, body).rolle == "kapitaen"

    def test_transferring_a_role_into_a_squad_that_holds_it_is_refused(self, mongo_container: Any):
        """The DESTINATION is judged, as the cap judges it: the armband travels with the player."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=AWAY_TEAM_OID, rolle="kapitaen"))
            await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="kapitaen")

            with pytest.raises(DocumentConflictException) as excinfo:
                await move(database, spieler_id_for(90), AWAY_TEAM_OID, rolle="kapitaen")

            return excinfo.value

        assert on_a_database(mongo_container, body).error_code == SQUAD_ROLLE_TAKEN

    def test_an_edit_that_keeps_the_role_where_it_is_passes(self, mongo_container: Any):
        """The over-breadth trap: counting the writing player's own row would refuse a captain changing their shirt."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="kapitaen")
            return await move(database, spieler_id_for(90), HOME_TEAM_OID, nummer="7", rolle="kapitaen")

        response = on_a_database(mongo_container, body)

        assert (response.rolle, response.nummer) == ("kapitaen", "7")

    def test_giving_up_a_role_is_never_refused(self, mongo_container: Any):
        """The repair every refusal above names has to be reachable, and on a squad already holding the role twice it is the only one."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen"))
            await enter(database, spieler_id_for(90), HOME_TEAM_OID)
            return await move(database, spieler_id_for(90), HOME_TEAM_OID, rolle=None)

        assert on_a_database(mongo_container, body).rolle is None

    def test_reactivating_into_a_squad_that_has_since_given_the_role_away_is_refused(self, mongo_container: Any):
        """The path a rule can forget: no payload carries the role here, so the STORED row is what has to be judged."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, rolle="kapitaen", inactive_since="2026-03-01")
            )
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen"))

            with pytest.raises(DocumentConflictException) as excinfo:
                await revive(database, spieler_id_for(90))

            return excinfo.value

        assert on_a_database(mongo_container, body).error_code == SQUAD_ROLLE_TAKEN

    def test_reactivating_a_roleless_row_asks_nothing(self, mongo_container: Any):
        """A row holding no role competes with nobody, so the rule must not stand between it and its return."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen"))
            return await revive(database, spieler_id_for(90))

        assert on_a_database(mongo_container, body).inactive_since is None


class TestReactivatingIntoASeasonTheClubHasLeft:
    """`REQ-SQUAD-001` on the third write path, which a replacement reaches: it retires a club's squad and hands that club's row away."""

    def test_reviving_a_row_whose_club_left_the_season_is_refused(self, mongo_container: Any):
        """Kills the reactivate asking the cap alone: the row goes live naming a club the season holds no junction row for."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            await hand_the_junction_row_over(database, HOME_TEAM_OID)

            with pytest.raises(DocumentConflictException) as excinfo:
                await revive(database, spieler_id_for(90))

            return excinfo.value, await database.saison_spieler.find_one({"spieler_id": spieler_id_for(90)})

        refusal, stored = on_a_database(mongo_container, body)

        assert refusal.error_code == SQUAD_TEAM_NOT_IN_SAISON
        # The second half kills a refusal asked after the write, which reports a state it has already created.
        assert stored["inactive_since"] == "2026-03-01"

    def test_reviving_a_row_whose_club_is_still_entered_goes_through(self, mongo_container: Any):
        """The floor under the refusal above, or it could be a blanket one: the ordinary revival is what the surface exists for."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            return await revive(database, spieler_id_for(90))

        response = on_a_database(mongo_container, body)

        assert (response.inactive_since, response.team_id) == (None, HOME_TEAM_OID)

    def test_the_club_is_asked_before_the_cap(self, mongo_container: Any):
        """Both refusals hold, the live rows seeded by hand: kills the two swapped, sending an admin to free a place in a squad with no club."""

        async def body(database: AsyncIOMotorDatabase) -> DocumentConflictException:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE)
            await hand_the_junction_row_over(database, HOME_TEAM_OID)

            with pytest.raises(DocumentConflictException) as excinfo:
                await revive(database, spieler_id_for(90))

            return excinfo.value

        assert on_a_database(mongo_container, body).error_code == SQUAD_TEAM_NOT_IN_SAISON


class TestASquadRowPredatingTheTwoFieldsStillEchoes:
    """`patch_saison_spieler` `$set`s both flags, so the paths naming neither are the only ones a legacy document reaches.

    A subscript there answers 500 on a request that changed nothing, and `python -m app.core.constraints --check` is what finds the row.
    """

    def test_leaving_a_squad_answers_for_one(self, mongo_container: Any):
        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.saison_spieler.insert_one(legacy_squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID))

            return await delete_saison_spieler(
                spieler_id=spieler_id_for(90),
                saison_id=SAISON_ID,
                saison_spieler_collection=database.saison_spieler,
                today=TODAY,
            )

        response = on_a_database(mongo_container, body)

        assert (response.is_nachgetragen, response.rolle) == (False, None)
        assert response.inactive_since == TODAY

    def test_returning_to_a_squad_answers_for_one_too(self, mongo_container: Any):
        """The other write naming neither flag: the soft delete's case cannot speak for a revive that reads its own stored row."""

        async def body(database: AsyncIOMotorDatabase) -> Any:
            await database.saison_spieler.insert_one(
                legacy_squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )

            return await revive(database, spieler_id_for(90))

        response = on_a_database(mongo_container, body)

        assert (response.is_nachgetragen, response.rolle) == (False, None)
        assert response.inactive_since is None
