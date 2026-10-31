from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spieler.admin_router import (
    get_spieler_nachnominierung,
    patch_saison_spieler,
    patch_spieler,
    post_saison_spieler,
    reactivate_saison_spieler,
)
from app.api.spieler.schemas import FLPatchSaisonSpielerPayload, FLPatchSpielerPayload, FLPostSaisonSpielerPayload
from app.core.codes import Code
from app.core.exceptions import APIError, DocumentNotFoundError
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import EINWILLIGUNG, rules_document, saison_document, saison_spieler_document, saison_team_document, spieler_document
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spieler_write_test")

SAISON_ID = "2026"
# Two, so a squad reaches its cap in two inserts and the third write is the refusal under test.
MAX_KADERGROESSE = 2

HOME_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400001")
AWAY_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400002")
# The club a replacement hands the home club's junction row to.
INCOMING_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400003")

# Injected rather than read from the clock, which `get_german_date_str` makes substitutable.
TODAY = "2026-04-01"

# Any well-formed date: no rule judges a pupil's age (`docs/domain.md`'s what the model permits on purpose),
# so a value chosen for how old it makes somebody would pin a refusal nothing runs.
GEBURTSDATUM = "2008-05-17"


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def spieler_id_for(index: int) -> ObjectId:
    return ObjectId(f"6890a1b2c3d4e5f6074100{index:02d}")


def person_row(*, spieler_number: int, geburtsdatum: str = GEBURTSDATUM) -> dict[str, Any]:
    """A pupil as their admission wrote them, seeded rather than admitted: the admission needs a registration."""

    return spieler_document(spieler_id_for(spieler_number), "Max", "Mustermann", geburtsdatum=geburtsdatum)


def squad_row(*, spieler_id: ObjectId, team_id: ObjectId, inactive_since: str | None = None, rolle: str | None = None) -> dict[str, Any]:
    return saison_spieler_document(spieler_id, SAISON_ID, team_id, rolle=rolle, inactive_since=inactive_since)


def on_a_database(url: str, body: Body) -> Any:
    """The SHIPPED indexes."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await database.saisons.insert_one(saison_document(SAISON_ID, "active", rules=rules_document(max_kadergroesse=MAX_KADERGROESSE)))
            # Both clubs entered, so `kader_team_not_in_saison` passes and every refusal below is the cap. The
            # season's own name and shorthand are required on the row and read by nothing here.
            await database.saison_teams.insert_many(
                [
                    saison_team_document(SAISON_ID, HOME_TEAM_OID, "Adler", "ADX"),
                    saison_team_document(SAISON_ID, AWAY_TEAM_OID, "Bieber", "BIX", gruppe="B"),
                ]
            )
            # The one person `enter` names: the create reads them, and an id nobody holds is a 404 there.
            await database.spieler.insert_one(person_row(spieler_number=90))
            return await body(database)

    return on_the_seed_loop(_run())


async def fill(database: AsyncDatabase, team_id: ObjectId, count: int) -> None:
    """`count` live rows in one squad, none of them a player any test then writes."""

    await database.saison_spieler.insert_many([squad_row(spieler_id=spieler_id_for(index), team_id=team_id) for index in range(count)])


async def enter(database: AsyncDatabase, spieler_id: ObjectId, team_id: ObjectId, *, rolle: Any = None) -> Any:
    return await post_saison_spieler(
        spieler_id=spieler_id,
        saison_spieler_data=FLPostSaisonSpielerPayload(
            saison_id=SAISON_ID, team_id=team_id, nummer=None, position=None, stufe=None, rolle=rolle
        ),
        spieler_collection=database.spieler,
        saison_spieler_collection=database.saison_spieler,
        saison_teams_collection=database.saison_teams,
        saisons_collection=database.saisons,
        spieltage_collection=database.spieltage,
        db=database.client,
        today=TODAY,
    )


async def move(database: AsyncDatabase, spieler_id: ObjectId, team_id: ObjectId, *, nummer: str | None = None, rolle: Any = None) -> Any:
    return await patch_saison_spieler(
        spieler_id=spieler_id,
        saison_id=SAISON_ID,
        saison_spieler_data=FLPatchSaisonSpielerPayload(team_id=team_id, nummer=nummer, position=None, stufe=None, rolle=rolle),
        saison_spieler_collection=database.saison_spieler,
        saison_teams_collection=database.saison_teams,
        saisons_collection=database.saisons,
        db=database.client,
    )


async def revive(database: AsyncDatabase, spieler_id: ObjectId) -> Any:
    return await reactivate_saison_spieler(
        spieler_id=spieler_id,
        saison_id=SAISON_ID,
        saison_spieler_collection=database.saison_spieler,
        saison_teams_collection=database.saison_teams,
        saisons_collection=database.saisons,
        db=database.client,
    )


async def hand_the_junction_row_over(database: AsyncDatabase, team_id: ObjectId) -> None:
    """The state `POST /teams/{team_id}/saisons/{saison_id}/replace` leaves: the row is repointed, so this club holds none in the season."""

    await database.saison_teams.update_one({"saison_id": SAISON_ID, "team_id": team_id}, {"$set": {"team_id": INCOMING_TEAM_OID}})


class TestTheConsentRecordSurvivesTheOneWriteThatCouldReachIt:
    """Through the endpoint, because only a database shows what a `$set` leaves standing."""

    def test_correcting_a_name_leaves_the_consent_record_standing(self, mongo_replica_set_url: str):
        """`$set` names only the payload's keys, so the sub-document is left alone rather than replaced -- against a real update."""

        async def body(database: AsyncDatabase) -> Any:
            await database.spieler.insert_one(person_row(spieler_number=92))
            await patch_spieler(
                spieler_id=spieler_id_for(92),
                spieler_data=FLPatchSpielerPayload(vorname="Maximilian", nachname="Mustermann", geburtsdatum=GEBURTSDATUM),
                spieler_collection=database.spieler,
                db=database.client,
            )
            return await database.spieler.find_one({"_id": spieler_id_for(92)})

        stored = on_a_database(mongo_replica_set_url, body)

        assert stored["vorname"] == "Maximilian"
        assert stored["einwilligung"] == EINWILLIGUNG


class TestThePersonsBirthdate:
    """What a stored date has to survive: a later name write."""

    def test_correcting_a_name_leaves_the_date_standing(self, mongo_replica_set_url: str):
        """Restated rather than untouched: the patch payload requires the field, so a name correction carries the date it read."""

        async def body(database: AsyncDatabase) -> Any:
            await database.spieler.insert_one(person_row(spieler_number=93, geburtsdatum=GEBURTSDATUM))
            await patch_spieler(
                spieler_id=spieler_id_for(93),
                spieler_data=FLPatchSpielerPayload(vorname="Maximilian", nachname="Mustermann", geburtsdatum=GEBURTSDATUM),
                spieler_collection=database.spieler,
                db=database.client,
            )
            return await database.spieler.find_one({"_id": spieler_id_for(93)})

        stored = on_a_database(mongo_replica_set_url, body)

        assert stored["vorname"] == "Maximilian"
        assert stored["geburtsdatum"] == GEBURTSDATUM


class TestTheSquadCapOnEveryWritePath:
    """`kader_full` on all three: the cap belongs to the DESTINATION squad, never to the verb that fills it."""

    def test_entering_a_full_squad_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> APIError:
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE)

            with pytest.raises(APIError) as excinfo:
                await enter(database, spieler_id_for(90), HOME_TEAM_OID)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.KADER_FULL

    def test_entering_a_squad_with_room_goes_through(self, mongo_replica_set_url: str):
        """The floor under the case above, or that refusal could be a blanket one."""

        async def body(database: AsyncDatabase) -> Any:
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE - 1)
            return await enter(database, spieler_id_for(90), HOME_TEAM_OID)

        assert on_a_database(mongo_replica_set_url, body).team_id == HOME_TEAM_OID

    def test_a_retired_row_holds_no_place(self, mongo_replica_set_url: str):
        """A player who left the squad gave their place back, which is what makes the count a LIVE one."""

        async def body(database: AsyncDatabase) -> Any:
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE - 1)
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            return await enter(database, spieler_id_for(90), HOME_TEAM_OID)

        assert on_a_database(mongo_replica_set_url, body).team_id == HOME_TEAM_OID

    def test_transferring_into_a_full_squad_is_refused(self, mongo_replica_set_url: str):
        """The DESTINATION is judged: the player's own place is in the team they are leaving."""

        async def body(database: AsyncDatabase) -> APIError:
            await fill(database, AWAY_TEAM_OID, MAX_KADERGROESSE)
            await enter(database, spieler_id_for(90), HOME_TEAM_OID)

            with pytest.raises(APIError) as excinfo:
                await move(database, spieler_id_for(90), AWAY_TEAM_OID)

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.KADER_FULL

    def test_transferring_into_a_squad_with_room_goes_through(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            await fill(database, AWAY_TEAM_OID, MAX_KADERGROESSE - 1)
            await enter(database, spieler_id_for(90), HOME_TEAM_OID)
            return await move(database, spieler_id_for(90), AWAY_TEAM_OID)

        assert on_a_database(mongo_replica_set_url, body).team_id == AWAY_TEAM_OID

    def test_an_edit_that_moves_nobody_passes_at_capacity(self, mongo_replica_set_url: str):
        """The over-breadth trap: the player already holds one of the places, so counting their own row would refuse a shirt change."""

        async def body(database: AsyncDatabase) -> Any:
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE - 1)
            await enter(database, spieler_id_for(90), HOME_TEAM_OID)
            # The squad is now exactly full, and this write changes only the shirt.
            return await move(database, spieler_id_for(90), HOME_TEAM_OID, nummer="7")

        response = on_a_database(mongo_replica_set_url, body)

        assert response.team_id == HOME_TEAM_OID
        assert response.nummer == "7"

    def test_reactivating_into_a_squad_that_has_since_filled_up_is_refused(self, mongo_replica_set_url: str):
        """The gap a create cannot cover: the retired row keeps the unique key, so reviving it is the only way back in."""

        async def body(database: AsyncDatabase) -> APIError:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE)

            with pytest.raises(APIError) as excinfo:
                await revive(database, spieler_id_for(90))

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.KADER_FULL

    def test_reactivating_into_a_squad_with_room_goes_through(self, mongo_replica_set_url: str):
        """And it keeps the number the retired row carried, which is why reviving is not a re-create."""

        async def body(database: AsyncDatabase) -> Any:
            await database.saison_spieler.insert_one(
                {**squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01"), "nummer": "9"}
            )
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE - 1)

            return await revive(database, spieler_id_for(90))

        response = on_a_database(mongo_replica_set_url, body)

        assert response.inactive_since is None
        assert response.nummer == "9"


class TestTheOneRolePerSquadOnEveryWritePath:
    """`kader_rolle_taken` on all three, for the reason the cap is on all three: the role belongs to the DESTINATION squad."""

    def test_entering_a_squad_whose_role_is_taken_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> APIError:
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen"))

            with pytest.raises(APIError) as excinfo:
                await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="kapitaen")

            return excinfo.value

        assert on_a_database(mongo_replica_set_url, body).error_code == Code.KADER_ROLLE_TAKEN

    def test_entering_a_squad_whose_other_role_is_taken_goes_through(self, mongo_replica_set_url: str):
        """The floor under the case above: the rule is per role, so a squad with a Kapitaen still has its Co-Kapitaen to give."""

        async def body(database: AsyncDatabase) -> Any:
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen"))
            return await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="co_kapitaen")

        assert on_a_database(mongo_replica_set_url, body).rolle == "co_kapitaen"

    def test_a_retired_holder_gives_the_role_back(self, mongo_replica_set_url: str):
        """The same live-rows-only count the cap takes: a player who left the squad is not leading it."""

        async def body(database: AsyncDatabase) -> Any:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen", inactive_since="2026-03-01")
            )
            return await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="kapitaen")

        assert on_a_database(mongo_replica_set_url, body).rolle == "kapitaen"

    def test_another_squads_holder_is_not_consulted(self, mongo_replica_set_url: str):
        """The scope is one team in one season: two clubs each field a Kapitaen."""

        async def body(database: AsyncDatabase) -> Any:
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=AWAY_TEAM_OID, rolle="kapitaen"))
            return await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="kapitaen")

        assert on_a_database(mongo_replica_set_url, body).rolle == "kapitaen"

    def test_transferring_a_role_into_a_squad_that_holds_it_is_refused(self, mongo_replica_set_url: str):
        """The DESTINATION is judged, as the cap judges it: the armband travels with the player."""

        async def body(database: AsyncDatabase) -> APIError:
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=AWAY_TEAM_OID, rolle="kapitaen"))
            await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="kapitaen")

            with pytest.raises(APIError) as excinfo:
                await move(database, spieler_id_for(90), AWAY_TEAM_OID, rolle="kapitaen")

            return excinfo.value

        assert on_a_database(mongo_replica_set_url, body).error_code == Code.KADER_ROLLE_TAKEN

    def test_an_edit_that_keeps_the_role_where_it_is_passes(self, mongo_replica_set_url: str):
        """The over-breadth trap: counting the writing player's own row would refuse a captain changing their shirt."""

        async def body(database: AsyncDatabase) -> Any:
            await enter(database, spieler_id_for(90), HOME_TEAM_OID, rolle="kapitaen")
            return await move(database, spieler_id_for(90), HOME_TEAM_OID, nummer="7", rolle="kapitaen")

        response = on_a_database(mongo_replica_set_url, body)

        assert (response.rolle, response.nummer) == ("kapitaen", "7")

    def test_giving_up_a_role_is_never_refused(self, mongo_replica_set_url: str):
        """The repair every refusal above names has to be reachable, and on a squad already holding the role twice it is the only one."""

        async def body(database: AsyncDatabase) -> Any:
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen"))
            await enter(database, spieler_id_for(90), HOME_TEAM_OID)
            return await move(database, spieler_id_for(90), HOME_TEAM_OID, rolle=None)

        assert on_a_database(mongo_replica_set_url, body).rolle is None

    def test_reactivating_into_a_squad_that_has_since_given_the_role_away_is_refused(self, mongo_replica_set_url: str):
        """The path a rule can forget: no payload carries the role here, so the STORED row is what has to be judged."""

        async def body(database: AsyncDatabase) -> APIError:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, rolle="kapitaen", inactive_since="2026-03-01")
            )
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen"))

            with pytest.raises(APIError) as excinfo:
                await revive(database, spieler_id_for(90))

            return excinfo.value

        assert on_a_database(mongo_replica_set_url, body).error_code == Code.KADER_ROLLE_TAKEN

    def test_reactivating_a_roleless_row_asks_nothing(self, mongo_replica_set_url: str):
        """A row holding no role competes with nobody, so the rule must not stand between it and its return."""

        async def body(database: AsyncDatabase) -> Any:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen"))
            return await revive(database, spieler_id_for(90))

        assert on_a_database(mongo_replica_set_url, body).inactive_since is None


class TestReactivatingIntoASeasonTheClubHasLeft:
    """`kader_team_not_in_saison` on the third write path, a replacement's: it retires a club's squad and hands that club's row away."""

    def test_reviving_a_row_whose_club_left_the_season_is_refused(self, mongo_replica_set_url: str):
        """Kills the reactivate asking the cap alone: the row goes live naming a club the season holds no junction row for."""

        async def body(database: AsyncDatabase) -> Any:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            await hand_the_junction_row_over(database, HOME_TEAM_OID)

            with pytest.raises(APIError) as excinfo:
                await revive(database, spieler_id_for(90))

            return excinfo.value, await database.saison_spieler.find_one({"spieler_id": spieler_id_for(90)})

        refusal, stored = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.KADER_TEAM_NOT_IN_SAISON
        # The second half kills a refusal asked after the write, which reports a state it has already created.
        assert stored["inactive_since"] == "2026-03-01"

    def test_reviving_a_row_whose_club_is_still_entered_goes_through(self, mongo_replica_set_url: str):
        """The floor under the refusal above, or it could be a blanket one: the ordinary revival is what the surface exists for."""

        async def body(database: AsyncDatabase) -> Any:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            return await revive(database, spieler_id_for(90))

        response = on_a_database(mongo_replica_set_url, body)

        assert (response.inactive_since, response.team_id) == (None, HOME_TEAM_OID)

    def test_the_club_is_asked_before_the_cap(self, mongo_replica_set_url: str):
        """Both refusals hold, the live rows seeded by hand: kills the two swapped, sending an admin to free a place in a squad with no club."""

        async def body(database: AsyncDatabase) -> APIError:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            await fill(database, HOME_TEAM_OID, MAX_KADERGROESSE)
            await hand_the_junction_row_over(database, HOME_TEAM_OID)

            with pytest.raises(APIError) as excinfo:
                await revive(database, spieler_id_for(90))

            return excinfo.value

        assert on_a_database(mongo_replica_set_url, body).error_code == Code.KADER_TEAM_NOT_IN_SAISON


class TestTheMarkerTheCreateStored:
    def test_an_edit_leaves_the_marker_as_the_create_stored_it(self, mongo_replica_set_url: str):
        """The edit carries no marker, so what the create derived is never replaced by what an editor's page believed."""

        async def body(database: AsyncDatabase) -> Any:
            await database.saison_spieler.insert_one(
                {**squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID), "is_nachnominiert": True}
            )
            echoed = await move(database, spieler_id_for(90), HOME_TEAM_OID, nummer="9")
            stored = await database.saison_spieler.find_one({"spieler_id": spieler_id_for(90)})

            return echoed.is_nachnominiert, stored["is_nachnominiert"] if stored else None

        assert on_a_database(mongo_replica_set_url, body) == (True, True)


def spieltag_row(*, beginn: str | None, saison_phase: str = "gruppenphase", position: int = 1) -> dict[str, Any]:
    return {"_id": ObjectId(), "saison_id": SAISON_ID, "saison_phase": saison_phase, "position": position, "beginn": beginn, "ende": beginn}


class TestTheCreateDerivesTheLateEntryMarker:
    """The create stores the verdict the squad editor's read serves, whatever the season's status says.

    Every season here is `active`, so a create judging by the status would mark every entry late.
    """

    def _entered_and_announced(self, url: str, spieltage: list[dict[str, Any]]) -> tuple[bool, bool, bool]:
        async def body(database: AsyncDatabase) -> tuple[bool, bool, bool]:
            if spieltage:
                await database.spieltage.insert_many(spieltage)
            announced = await get_spieler_nachnominierung(
                saison_id=SAISON_ID, saisons_collection=database.saisons, spieltage_collection=database.spieltage, today=TODAY
            )
            echoed = await enter(database, spieler_id_for(90), HOME_TEAM_OID)
            stored = await database.saison_spieler.find_one({"spieler_id": spieler_id_for(90)})

            return announced.nachnominierung, echoed.is_nachnominiert, bool(stored and stored["is_nachnominiert"])

        return on_a_database(url, body)

    def test_a_matchday_one_dated_after_today_makes_no_entry_late(self, mongo_replica_set_url: str):
        assert self._entered_and_announced(mongo_replica_set_url, [spieltag_row(beginn="2026-04-02")]) == (False, False, False)

    def test_an_entry_on_matchday_ones_first_day_is_late(self, mongo_replica_set_url: str):
        assert self._entered_and_announced(mongo_replica_set_url, [spieltag_row(beginn=TODAY)]) == (True, True, True)

    def test_a_later_phases_first_matchday_opens_nothing(self, mongo_replica_set_url: str):
        """`position` restarts in every phase, so a filter on the position alone would read this knockout round as the season's start."""

        spieltage = [spieltag_row(beginn="2026-04-20"), spieltag_row(beginn="2026-03-15", saison_phase="viertelfinale")]

        assert self._entered_and_announced(mongo_replica_set_url, spieltage) == (False, False, False)

    def test_the_read_refuses_a_season_nobody_created(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> Any:
            return await get_spieler_nachnominierung(
                saison_id="2031", saisons_collection=database.saisons, spieltage_collection=database.spieltage, today=TODAY
            )

        with pytest.raises(DocumentNotFoundError):
            on_a_database(mongo_replica_set_url, body)
