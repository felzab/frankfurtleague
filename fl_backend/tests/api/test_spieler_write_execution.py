from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spieler.admin_router import get_spieler_saison, patch_spieler_saison, reactivate_saison_spieler
from app.api.spieler.schemas import FLPatchSpielerSaisonPayload, FLSaisonSpielerRow
from app.core.codes import Code
from app.core.crud import composite_version
from app.core.exceptions import APIError, DocumentNotFoundError
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import EINWILLIGUNG, rules_document, saison_document, saison_spieler_document, saison_team_document, spieler_document
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spieler_write_test")

SAISON_ID = "2026"
# Two, so a squad reaches its cap in two inserts and the third write is the refusal under test.
MAX_KADER_SIZE = 2

HOME_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400001")
AWAY_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400002")
# The club a replacement hands the home club's junction row to.
INCOMING_TEAM_OID = ObjectId("6890a1b2c3d4e5f607400003")

# Any well-formed date: no rule judges a pupil's age (`docs/domain.md`'s what the model permits on purpose),
# so a value chosen for how old it makes somebody would pin a refusal nothing runs.
BIRTH_DATE = "2008-05-17"

ROW_FIELDS = ("nummer", "position", "stufe", "rolle")


Body = Callable[[AsyncDatabase], Awaitable[Any]]


def spieler_id_for(index: int) -> ObjectId:
    return ObjectId(f"6890a1b2c3d4e5f6074100{index:02d}")


def person_row(*, spieler_number: int, birth_date: str = BIRTH_DATE) -> dict[str, Any]:
    """A pupil as their admission wrote them, seeded rather than admitted: the admission needs a registration."""

    return spieler_document(spieler_id_for(spieler_number), "Max", "Mustermann", birth_date=birth_date)


def squad_row(
    *, spieler_id: ObjectId, team_id: ObjectId, inactive_since: str | None = None, rolle: str | None = None, nominee: bool = False
) -> dict[str, Any]:
    return saison_spieler_document(spieler_id, SAISON_ID, team_id, rolle=rolle, inactive_since=inactive_since, is_nachnominiert=nominee)


def on_a_database(url: str, body: Body) -> Any:
    """The SHIPPED indexes."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await database.saisons.insert_one(saison_document(SAISON_ID, "active", rules=rules_document(max_kader_size=MAX_KADER_SIZE)))
            # Both clubs entered, so `kader_team_not_in_saison` passes and every refusal below is the cap. The
            # season's own name and shorthand are required on the row and read by nothing here.
            await database.saison_teams.insert_many(
                [
                    saison_team_document(SAISON_ID, HOME_TEAM_OID, "Adler", "ADX"),
                    saison_team_document(SAISON_ID, AWAY_TEAM_OID, "Bieber", "BIX", gruppe="B"),
                ]
            )
            return await body(database)

    return on_the_seed_loop(_run())


async def fill(database: AsyncDatabase, team_id: ObjectId, count: int, *, nominee: bool = False) -> None:
    """`count` live rows in one squad, none of them a player any test then writes."""

    await database.saison_spieler.insert_many(
        [squad_row(spieler_id=spieler_id_for(index), team_id=team_id, nominee=nominee) for index in range(count)]
    )


async def save(
    database: AsyncDatabase,
    spieler_id: ObjectId,
    *,
    first_name: str = "Max",
    birth_date: str = BIRTH_DATE,
    version: int | None = None,
    **row_fields: Any,
) -> Any:
    """The editor's one save on the version the documents stand at unless named, and the row's fields as stored unless named."""

    person = await database.spieler.find_one({"_id": spieler_id})
    row = await database.saison_spieler.find_one({"spieler_id": spieler_id, "saison_id": SAISON_ID})
    return await patch_spieler_saison(
        spieler_id=spieler_id,
        saison_id=SAISON_ID,
        spieler_data=FLPatchSpielerSaisonPayload(
            first_name=first_name,
            last_name="Mustermann",
            birth_date=birth_date,
            **{
                "nummer": None,
                "position": None,
                "stufe": None,
                "rolle": None,
                **{key: value for key, value in (row or {}).items() if key in ROW_FIELDS},
                **row_fields,
            },
            version=composite_version(person or {}, row or {}) if version is None else version,
        ),
        spieler_collection=database.spieler,
        saison_spieler_collection=database.saison_spieler,
        saisons_collection=database.saisons,
        db=database.client,
    )


async def edit(database: AsyncDatabase, spieler_id: ObjectId, *, nummer: str | None = None, rolle: Any = None) -> FLSaisonSpielerRow:
    """The save over a row whose person a case has not seeded, answering the row as stored."""

    if await database.spieler.find_one({"_id": spieler_id}) is None:
        await database.spieler.insert_one(spieler_document(spieler_id, "Max", "Mustermann", birth_date=BIRTH_DATE))
    await save(database, spieler_id, nummer=nummer, rolle=rolle)
    return FLSaisonSpielerRow.model_validate(await database.saison_spieler.find_one({"spieler_id": spieler_id, "saison_id": SAISON_ID}))


async def revive(database: AsyncDatabase, spieler_id: ObjectId) -> FLSaisonSpielerRow:
    """The return, answering the row as stored."""

    await reactivate_saison_spieler(
        spieler_id=spieler_id,
        saison_id=SAISON_ID,
        saison_spieler_collection=database.saison_spieler,
        saison_teams_collection=database.saison_teams,
        saisons_collection=database.saisons,
        db=database.client,
    )

    return FLSaisonSpielerRow.model_validate(await database.saison_spieler.find_one({"spieler_id": spieler_id, "saison_id": SAISON_ID}))


async def hand_the_junction_row_over(database: AsyncDatabase, team_id: ObjectId) -> None:
    """The state `POST /teams/{team_id}/saisons/{saison_id}/replace` leaves: the row is repointed, so this club holds none in the season."""

    await database.saison_teams.update_one({"saison_id": SAISON_ID, "team_id": team_id}, {"$set": {"team_id": INCOMING_TEAM_OID}})


class TestTheConsentRecordSurvivesTheOneWriteThatCouldReachIt:
    """Through the endpoint, because only a database shows what a `$set` leaves standing."""

    def test_correcting_a_name_leaves_the_consent_record_standing(self, mongo_replica_set_url: str):
        """`$set` names only the payload's keys, so the sub-document is left alone rather than replaced -- against a real update."""

        async def body(database: AsyncDatabase) -> Any:
            await database.spieler.insert_one(person_row(spieler_number=92))
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(92), team_id=HOME_TEAM_OID))
            await save(database, spieler_id_for(92), first_name="Maximilian")
            return await database.spieler.find_one({"_id": spieler_id_for(92)})

        stored = on_a_database(mongo_replica_set_url, body)

        assert stored["first_name"] == "Maximilian"
        assert stored["einwilligung"] == EINWILLIGUNG


class TestTheOneSave:
    """The person and their row, written together or not at all, on the one count the editor read."""

    async def seated(self, database: AsyncDatabase) -> ObjectId:
        spieler_id = spieler_id_for(90)
        await database.spieler.insert_one(person_row(spieler_number=90))
        await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id, team_id=HOME_TEAM_OID))
        return spieler_id

    def test_a_refused_row_part_saves_none_of_the_person(self, mongo_replica_set_url: str):
        """Saved apart, the name would stand under an editor reading the save as failed."""

        async def body(database: AsyncDatabase) -> tuple[Any, Any]:
            spieler_id = await self.seated(database)
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, rolle="kapitaen"))

            with pytest.raises(APIError) as excinfo:
                await save(database, spieler_id, first_name="Maximilian", rolle="kapitaen")

            return excinfo.value.error_code, await database.spieler.find_one({"_id": spieler_id})

        code, person = on_a_database(mongo_replica_set_url, body)

        assert code == Code.KADER_ROLLE_TAKEN
        assert person["first_name"] == "Max"

    @pytest.mark.parametrize("collection", ["spieler", "saison_spieler"])
    def test_either_document_moved_since_the_read_refuses_the_save(self, mongo_replica_set_url: str, collection: str):
        """Each one raised alone, so a count judging one of the two passes a save over the other's newer state."""

        async def body(database: AsyncDatabase) -> tuple[Any, Any]:
            spieler_id = await self.seated(database)
            read = await get_spieler_saison(
                spieler_id=spieler_id,
                saison_id=SAISON_ID,
                spieler_collection=database.spieler,
                saison_spieler_collection=database.saison_spieler,
                saison_teams_collection=database.saison_teams,
                saisons_collection=database.saisons,
            )
            key = "_id" if collection == "spieler" else "spieler_id"
            await database[collection].update_one({key: spieler_id}, {"$inc": {"version": 1}})

            with pytest.raises(APIError) as excinfo:
                await save(database, spieler_id, nummer="9", first_name="Maximilian", version=read.version)

            return excinfo.value.error_code, await database.spieler.find_one({"_id": spieler_id})

        code, person = on_a_database(mongo_replica_set_url, body)

        assert code == Code.VERSION_STALE
        assert person["first_name"] == "Max"

    def test_the_answer_is_the_count_the_next_read_serves(self, mongo_replica_set_url: str):
        """The editor sends it with its next save, so a count short of the stored one refuses that save as stale."""

        async def body(database: AsyncDatabase) -> tuple[int, int]:
            spieler_id = await self.seated(database)
            answered = await save(database, spieler_id, first_name="Maximilian", nummer="9")
            read = await get_spieler_saison(
                spieler_id=spieler_id,
                saison_id=SAISON_ID,
                spieler_collection=database.spieler,
                saison_spieler_collection=database.saison_spieler,
                saison_teams_collection=database.saison_teams,
                saisons_collection=database.saisons,
            )
            return answered.version, read.version

        answered, served = on_a_database(mongo_replica_set_url, body)

        assert answered == served

    def test_a_corrected_birthdate_lands(self, mongo_replica_set_url: str):
        """Written through a list of the person's fields, so a date falling out of it answers the save and keeps the wrong day."""

        async def body(database: AsyncDatabase) -> Any:
            spieler_id = await self.seated(database)
            await save(database, spieler_id, birth_date="2008-05-18")

            return await database.spieler.find_one({"_id": spieler_id})

        assert on_a_database(mongo_replica_set_url, body)["birth_date"] == "2008-05-18"

    def test_a_part_left_as_stored_is_not_written(self, mongo_replica_set_url: str):
        """Written anyway, every name's correction would log a squad edit nobody made."""

        async def body(database: AsyncDatabase) -> Any:
            spieler_id = await self.seated(database)
            before = await database.saison_spieler.find_one({"spieler_id": spieler_id})
            await save(database, spieler_id, first_name="Maximilian")
            after = await database.saison_spieler.find_one({"spieler_id": spieler_id})
            return before, after

        before, after = on_a_database(mongo_replica_set_url, body)

        assert before.get("version") == after.get("version")

    def test_a_stufe_the_season_does_not_offer_is_refused(self, mongo_replica_set_url: str):
        """The box offers the season's levels, so only a season narrowed under the open page reaches this."""

        async def body(database: AsyncDatabase) -> Any:
            spieler_id = await self.seated(database)
            await database.saisons.update_one({"_id": SAISON_ID}, {"$set": {"rules.allowed_stufen": ["Q1"]}})

            with pytest.raises(APIError) as excinfo:
                await save(database, spieler_id, stufe="Q3")

            return excinfo.value.error_code

        assert on_a_database(mongo_replica_set_url, body) == Code.KADER_STUFE_NOT_ALLOWED

    def test_a_person_with_no_row_of_the_season_is_not_found(self, mongo_replica_set_url: str):
        """The page stands under a season, so its save reaches no person out of that squad."""

        async def body(database: AsyncDatabase) -> Any:
            await database.spieler.insert_one(person_row(spieler_number=91))
            await save(database, spieler_id_for(91))

        with pytest.raises(DocumentNotFoundError):
            on_a_database(mongo_replica_set_url, body)


class TestThePersonsBirthdate:
    """What a stored date has to survive: a later name write."""

    def test_correcting_a_name_leaves_the_date_standing(self, mongo_replica_set_url: str):
        """Restated rather than untouched: the patch payload requires the field, so a name correction carries the date it read."""

        async def body(database: AsyncDatabase) -> Any:
            await database.spieler.insert_one(person_row(spieler_number=93, birth_date=BIRTH_DATE))
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(93), team_id=HOME_TEAM_OID))
            await save(database, spieler_id_for(93), first_name="Maximilian")
            return await database.spieler.find_one({"_id": spieler_id_for(93)})

        stored = on_a_database(mongo_replica_set_url, body)

        assert stored["first_name"] == "Maximilian"
        assert stored["birth_date"] == BIRTH_DATE


class TestTheSquadCapOnAReturn:
    """`kader_full` on a squad row's return, the one write of this router that grows a squad."""

    def test_a_retired_row_holds_no_place(self, mongo_replica_set_url: str):
        """A player who left the squad gave their place back, which is what makes the count a LIVE one."""

        async def body(database: AsyncDatabase) -> Any:
            await fill(database, HOME_TEAM_OID, MAX_KADER_SIZE - 1)
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(80), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            return await revive(database, spieler_id_for(90))

        assert on_a_database(mongo_replica_set_url, body).team_id == HOME_TEAM_OID

    def test_a_nominee_holds_no_place(self, mongo_replica_set_url: str):
        """A nominee stands outside the cap: counted, a late pupil would silently cost a squad a regular's place."""

        async def body(database: AsyncDatabase) -> Any:
            await fill(database, HOME_TEAM_OID, MAX_KADER_SIZE, nominee=True)
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            return await revive(database, spieler_id_for(90))

        assert on_a_database(mongo_replica_set_url, body).inactive_since is None

    def test_a_nominee_returns_to_a_full_squad(self, mongo_replica_set_url: str):
        """Ordinary rows fill the cap and the nominee needs no place in it: the row's own stored mark decides, as no payload carries one."""

        async def body(database: AsyncDatabase) -> Any:
            await fill(database, HOME_TEAM_OID, MAX_KADER_SIZE)
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01", nominee=True)
            )
            return await revive(database, spieler_id_for(90))

        assert on_a_database(mongo_replica_set_url, body).is_nachnominiert is True

    def test_reactivating_into_a_squad_that_has_since_filled_up_is_refused(self, mongo_replica_set_url: str):
        """The gap the admission cannot cover: the retired row keeps the unique key, so reviving it is an administrator's way back in."""

        async def body(database: AsyncDatabase) -> APIError:
            await database.saison_spieler.insert_one(
                squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, inactive_since="2026-03-01")
            )
            await fill(database, HOME_TEAM_OID, MAX_KADER_SIZE)

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
            await fill(database, HOME_TEAM_OID, MAX_KADER_SIZE - 1)

            return await revive(database, spieler_id_for(90))

        response = on_a_database(mongo_replica_set_url, body)

        assert response.inactive_since is None
        assert response.nummer == "9"


class TestTheOneRolePerSquadOnEveryWritePath:
    """`kader_rolle_taken` on the edit and the return: the role belongs to the squad the row stands in."""

    async def seat(self, database: AsyncDatabase, spieler_id: ObjectId, team_id: ObjectId, *, rolle: str | None = None, **fields: Any) -> None:
        await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id, team_id=team_id, rolle=rolle, **fields))

    def test_an_edit_taking_a_held_role_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> APIError:
            await self.seat(database, spieler_id_for(80), HOME_TEAM_OID, rolle="kapitaen")
            await self.seat(database, spieler_id_for(90), HOME_TEAM_OID)

            with pytest.raises(APIError) as excinfo:
                await edit(database, spieler_id_for(90), rolle="kapitaen")

            return excinfo.value

        refusal = on_a_database(mongo_replica_set_url, body)

        assert refusal.error_code == Code.KADER_ROLLE_TAKEN
        # Named, or the editor's phrase has no box to land on and falls to the shared failure line.
        assert refusal.fields == (("rolle",),)

    def test_an_edit_taking_the_other_role_goes_through(self, mongo_replica_set_url: str):
        """The floor under the case above: the rule is per role, so a squad with a Kapitaen still has its Co-Kapitaen to give."""

        async def body(database: AsyncDatabase) -> Any:
            await self.seat(database, spieler_id_for(80), HOME_TEAM_OID, rolle="kapitaen")
            await self.seat(database, spieler_id_for(90), HOME_TEAM_OID)
            return await edit(database, spieler_id_for(90), rolle="co_kapitaen")

        assert on_a_database(mongo_replica_set_url, body).rolle == "co_kapitaen"

    def test_a_retired_holder_gives_the_role_back(self, mongo_replica_set_url: str):
        """The same live-rows-only count the cap takes: a player who left the squad is not leading it."""

        async def body(database: AsyncDatabase) -> Any:
            await self.seat(database, spieler_id_for(80), HOME_TEAM_OID, rolle="kapitaen", inactive_since="2026-03-01")
            await self.seat(database, spieler_id_for(90), HOME_TEAM_OID)
            return await edit(database, spieler_id_for(90), rolle="kapitaen")

        assert on_a_database(mongo_replica_set_url, body).rolle == "kapitaen"

    def test_another_squads_holder_is_not_consulted(self, mongo_replica_set_url: str):
        """The scope is the row's own team: judged against anything else, two clubs could not each field a Kapitaen."""

        async def body(database: AsyncDatabase) -> Any:
            await self.seat(database, spieler_id_for(80), AWAY_TEAM_OID, rolle="kapitaen")
            await self.seat(database, spieler_id_for(90), HOME_TEAM_OID)
            return await edit(database, spieler_id_for(90), rolle="kapitaen")

        assert on_a_database(mongo_replica_set_url, body).rolle == "kapitaen"

    def test_an_edit_that_keeps_the_role_where_it_is_passes(self, mongo_replica_set_url: str):
        """The over-breadth trap: counting the writing player's own row would refuse a captain changing their shirt."""

        async def body(database: AsyncDatabase) -> Any:
            await self.seat(database, spieler_id_for(90), HOME_TEAM_OID, rolle="kapitaen")
            return await edit(database, spieler_id_for(90), nummer="7", rolle="kapitaen")

        response = on_a_database(mongo_replica_set_url, body)

        assert (response.rolle, response.nummer) == ("kapitaen", "7")

    def test_giving_up_a_role_is_never_refused(self, mongo_replica_set_url: str):
        """The repair every refusal above names has to be reachable, and on a squad already holding the role twice it is the only one."""

        async def body(database: AsyncDatabase) -> Any:
            await self.seat(database, spieler_id_for(80), HOME_TEAM_OID, rolle="kapitaen")
            await self.seat(database, spieler_id_for(90), HOME_TEAM_OID)
            return await edit(database, spieler_id_for(90), rolle=None)

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
            await fill(database, HOME_TEAM_OID, MAX_KADER_SIZE)
            await hand_the_junction_row_over(database, HOME_TEAM_OID)

            with pytest.raises(APIError) as excinfo:
                await revive(database, spieler_id_for(90))

            return excinfo.value

        assert on_a_database(mongo_replica_set_url, body).error_code == Code.KADER_TEAM_NOT_IN_SAISON


class TestTheStoredMarker:
    def test_an_edit_leaves_the_marker_standing(self, mongo_replica_set_url: str):
        """The edit carries no marker, so what the entry stored is never replaced by what an editor's page believed."""

        async def body(database: AsyncDatabase) -> Any:
            await database.saison_spieler.insert_one(squad_row(spieler_id=spieler_id_for(90), team_id=HOME_TEAM_OID, nominee=True))
            echoed = await edit(database, spieler_id_for(90), nummer="9")
            stored = await database.saison_spieler.find_one({"spieler_id": spieler_id_for(90)})

            return echoed.is_nachnominiert, stored["is_nachnominiert"] if stored else None

        assert on_a_database(mongo_replica_set_url, body) == (True, True)
