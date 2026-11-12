from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spieler.admin_router import (
    delete_saison_spieler,
    patch_spieler_saison,
)
from app.api.spieler.schemas import FLPatchSpielerSaisonPayload
from app.core.collections import Collection
from app.core.crud import composite_version
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    aufstellung_document,
    saison_document,
    saison_spieler_document,
    saison_team_document,
    spiel_document,
    spielbericht_document,
    spieler_document,
)
from tests.erasure import erased
from tests.whole_database import where_held
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spieler_erasure_test")


SAISON_ID = "2026"
# A second season, so one person holds a LIVE squad row and a RETIRED one at once.
FORMER_SAISON_ID = "2025"

# Distinctive rather than "Mustermann": sweeping a whole database for a name is evidence of absence
# only where a hit could not be coincidence, and the seed data is full of German words and dates.
ERASED_FIRST_NAME = "Zorbanax"
OTHER_FIRST_NAME = "Quillhilde"
LONE_FIRST_NAME = "Wraxlington"

# Fixed rather than generated, so a failure names the same club every run.
HOME_TEAM_OID = ObjectId("6890a1b2c3d4e5f607420001")
AWAY_TEAM_OID = ObjectId("6890a1b2c3d4e5f607420002")

TODAY = "2026-04-01"
# Injected through `get_germany_now`.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    """The SHIPPED indexes, so a document production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # Each season spans its own calendar year, so the two seeded spans do not overlap.
            await database[Collection.SAISONS].insert_many([saison_document(SAISON_ID, "active"), saison_document(FORMER_SAISON_ID, "past")])
            # Both clubs in both seasons, so either pupil can be put in a squad in either one. The
            # season's own copy of each identity is required and never read: this suite is about people.
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    saison_team_document(saison_id, team_id, name, short, gruppe=gruppe)
                    for saison_id in (SAISON_ID, FORMER_SAISON_ID)
                    for team_id, gruppe, name, short in ((HOME_TEAM_OID, "A", "Heim-Schule", "HSX"), (AWAY_TEAM_OID, "B", "Gast-Schule", "GSX"))
                ]
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


def person_row(first_name: str) -> dict[str, Any]:
    """A pupil as their admission writes them, with an address the erasure is keyed on.

    Seeded rather than written through a route: the one route writing a person is the admission, which needs a registration.
    """

    return spieler_document(
        ObjectId(),
        first_name,
        # Surname derived from the given name, so one sweep of a whole database still tells two apart.
        f"{first_name}-Mustermann",
        email=f"{first_name.lower()}@example.com",
        birth_date="2009-05-09",
    )


async def save(database: AsyncDatabase, spieler_id: ObjectId, saison_id: str, *, last_name: str, nummer: str | None) -> None:
    """The editor's one save, on the count the two documents stand at."""

    person = await database[Collection.SPIELER].find_one({"_id": spieler_id})
    row = await database[Collection.SAISON_SPIELER].find_one({"spieler_id": spieler_id, "saison_id": saison_id})
    assert person is not None
    assert row is not None
    await patch_spieler_saison(
        spieler_id=spieler_id,
        saison_id=saison_id,
        spieler_data=FLPatchSpielerSaisonPayload(
            first_name=person["first_name"],
            last_name=last_name,
            birth_date="2009-05-09",
            nummer=nummer,
            position="Abwehr",
            stufe="Q2",
            rolle="kapitaen",
            version=composite_version(person, row),
        ),
        spieler_collection=database[Collection.SPIELER],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saisons_collection=database[Collection.SAISONS],
        db=database.client,
    )


async def a_pupil_with_a_history(database: AsyncDatabase, *, first_name: str, team_id: ObjectId) -> ObjectId:
    """A person and two squad rows seeded, then edited on every row through the real endpoints."""

    document = person_row(first_name)
    await database[Collection.SPIELER].insert_one(document)
    spieler_id = document["_id"]

    for saison_id, worn, then_worn in ((FORMER_SAISON_ID, "41", "42"), (SAISON_ID, "10", "7")):
        await database[Collection.SAISON_SPIELER].insert_one(saison_spieler_document(spieler_id, saison_id, team_id, nummer=worn))
        await save(database, spieler_id, saison_id, last_name=document["last_name"], nummer=then_worn)

    # The earlier squad is LEFT, which is a shape the erasure has to reach as well: a row recording
    # what somebody wore stays about them after they stop wearing it.
    await delete_saison_spieler(
        spieler_id=spieler_id,
        saison_id=FORMER_SAISON_ID,
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        today=TODAY,
        db=database.client,
    )
    await save(database, spieler_id, SAISON_ID, last_name=f"{first_name}-Musterfrau", nummer="7")

    return spieler_id


async def a_pupil_who_never_joined_a_squad(database: AsyncDatabase) -> ObjectId:
    """A person seeded who holds no squad row."""

    document = person_row(LONE_FIRST_NAME)
    await database[Collection.SPIELER].insert_one(document)

    return document["_id"]


async def erase_the_pupil(database: AsyncDatabase, client: AsyncMongoClient, spieler_id: ObjectId) -> None:
    """The registry's erasure of the address this pupil's row holds: the erasure is keyed on a mailbox, never on an id."""

    person = await database[Collection.SPIELER].find_one({"_id": spieler_id}, {"email": 1})
    assert person is not None, f"no pupil {spieler_id} to erase"

    await erased(database, client, person["email"], germany_now=NOW)


class TestARetiredPupilIsErasedWhole:
    """Through the endpoint: the person and their squad rows."""

    def test_every_squad_row_they_held_is_gone(self, mongo_replica_set_url: str):
        """Catches removing the person alone: the squad read `$lookup`s outward from `spieler`, so an orphan is invisible."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, first_name="Max", team_id=HOME_TEAM_OID)
            held = await database[Collection.SAISON_SPIELER].count_documents({"spieler_id": spieler_id})
            await erase_the_pupil(database, client, spieler_id)

            return held, await database[Collection.SAISON_SPIELER].count_documents({"spieler_id": spieler_id})

        held, remaining = on_a_league(mongo_replica_set_url, body)

        assert (held, remaining) == (2, 0)

    def test_another_pupil_keeps_their_squad_row(self, mongo_replica_set_url: str):
        """The over-breadth floor: catches a removal filtered on the collection rather than on `spieler_id`."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, first_name="Max", team_id=HOME_TEAM_OID)
            other_id = await a_pupil_with_a_history(database, first_name="Erika", team_id=AWAY_TEAM_OID)
            await erase_the_pupil(database, client, spieler_id)

            return (
                await database[Collection.SPIELER].count_documents({"_id": other_id}),
                await database[Collection.SAISON_SPIELER].count_documents({"spieler_id": other_id}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (1, 2)


class TestNothingOfTheirsIsLeftAnywhere:
    """The floor under the class above, which asks where the endpoint looked: these ask what is left."""

    def test_no_name_of_theirs_survives_anywhere_in_the_database(self, mongo_replica_set_url: str):
        """Catches a value left in a collection the erasure never names -- every one of them is read.

        The other pupil's surname is asserted present, without which a database emptied wholesale
        would pass.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, first_name=ERASED_FIRST_NAME, team_id=HOME_TEAM_OID)
            await a_pupil_with_a_history(database, first_name=OTHER_FIRST_NAME, team_id=AWAY_TEAM_OID)
            await erase_the_pupil(database, client, spieler_id)

            return await where_held(database, ERASED_FIRST_NAME, f"{OTHER_FIRST_NAME}-Musterfrau")

        held = on_a_league(mongo_replica_set_url, body)

        # Both surnames carry the given name, so one substring answers for all three of their values.
        assert held[ERASED_FIRST_NAME] == []
        assert held[f"{OTHER_FIRST_NAME}-Musterfrau"]


class TestAPupilWhoNeverJoinedASquad:
    def test_their_own_record_is_erased_all_the_same(self, mongo_replica_set_url: str):
        """Catches an erasure that only reaches a person who held a squad row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_who_never_joined_a_squad(database)
            await erase_the_pupil(database, client, spieler_id)

            return await database[Collection.SPIELER].count_documents({"_id": spieler_id}), await where_held(database, LONE_FIRST_NAME)

        remaining, held = on_a_league(mongo_replica_set_url, body)

        assert remaining == 0
        assert held == {LONE_FIRST_NAME: []}


def a_report_naming(*, scorers: list[ObjectId | None], carded: list[ObjectId]) -> dict[str, Any]:
    """A report on a fixture of its own, adopted, so a repoint that touched the adoption shows as one."""

    report = spielbericht_document({"_id": ObjectId(), "saison_id": SAISON_ID})
    bericht = report["bericht"]
    bericht["scorers"] = [
        {"side": "team1", "spieler_id": scorer, "minute": str(10 + index), "eigentor": False} for index, scorer in enumerate(scorers)
    ]
    bericht["cards"] = [
        {"side": "team2", "spieler_id": pupil, "minute": str(60 + index), "colour": "gelb"} for index, pupil in enumerate(carded)
    ]
    bericht["ergebnis_vorschlag"] = {"team1_tore": len(scorers), "team2_tore": 0, "elfmeterschiessen": None, "sonderereignis": None}
    bericht["adopted"] = True

    return report


class TestTheirEntriesNameNobody:
    """A report is the league's record of the match, so it stays; the entries naming them name nobody instead."""

    def test_no_entry_names_them_and_every_other_entry_and_report_stands(self, mongo_replica_set_url: str):
        """Catches an erasure reaching one array alone, every element of one, or a report naming somebody else."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            document = person_row(ERASED_FIRST_NAME)
            other = person_row(OTHER_FIRST_NAME)
            await database[Collection.SPIELER].insert_many([document, other])
            spieler_id, other_id = document["_id"], other["_id"]

            theirs = a_report_naming(scorers=[spieler_id, other_id, None, spieler_id], carded=[other_id, spieler_id])
            elsewhere = a_report_naming(scorers=[other_id], carded=[other_id])
            nobody = a_report_naming(scorers=[], carded=[])
            await database[Collection.SPIELBERICHTE].insert_many([theirs, elsewhere, nobody])

            async def reports() -> dict[ObjectId, dict[str, Any]]:
                return {row["_id"]: row for row in await database[Collection.SPIELBERICHTE].find().to_list(length=None)}

            # Read back rather than taken from the seed, which the driver stores and answers in its own datetime form.
            seeded = await reports()
            await erase_the_pupil(database, client, spieler_id)

            return spieler_id, other_id, [theirs["_id"], elsewhere["_id"], nobody["_id"]], seeded, await reports()

        spieler_id, other_id, (theirs, elsewhere, nobody), seeded, stored = on_a_league(mongo_replica_set_url, body)
        emptied, before = stored[theirs]["bericht"], seeded[theirs]["bericht"]

        assert [entry["spieler_id"] for entry in emptied["scorers"]] == [None, other_id, None, None]
        assert [entry["spieler_id"] for entry in emptied["cards"]] == [other_id, None]
        # Each entry's other fields, and the adoption, are the report's own.
        assert [{**entry, "spieler_id": None} for entry in [*emptied["scorers"], *emptied["cards"]]] == [
            {**entry, "spieler_id": None} for entry in [*before["scorers"], *before["cards"]]
        ]
        assert {**emptied, "scorers": None, "cards": None} == {**before, "scorers": None, "cards": None}
        assert (stored[elsewhere], stored[nobody]) == (seeded[elsewhere], seeded[nobody])
        assert spieler_id not in {
            entry["spieler_id"] for row in stored.values() for entry in [*row["bericht"]["scorers"], *row["bericht"]["cards"]]
        }

    def test_no_line_up_names_them_and_every_other_entry_and_line_up_stands(self, mongo_replica_set_url: str):
        """A kicked-off match's line-up records whom the club fielded, so its entry stays and names nobody: emptying every entry fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            document = person_row(ERASED_FIRST_NAME)
            other = person_row(OTHER_FIRST_NAME)
            await database[Collection.SPIELER].insert_many([document, other])
            spieler_id, other_id = document["_id"], other["_id"]

            # Kicked off before `NOW`.
            spiel = spiel_document(
                spiel_id=ObjectId(), saison_id=SAISON_ID, spiel_nr=1, spieltag_id=ObjectId(), date="2026-03-28", time="10:00:00"
            )
            await database[Collection.SPIELE].insert_one(spiel)
            theirs = aufstellung_document(spiel, ObjectId(), starters=[other_id, spieler_id], bench=[])
            elsewhere = aufstellung_document(spiel, ObjectId(), starters=[other_id], bench=[])
            await database[Collection.AUFSTELLUNGEN].insert_many([theirs, elsewhere])
            await erase_the_pupil(database, client, spieler_id)

            stored = {row["_id"]: row for row in await database[Collection.AUFSTELLUNGEN].find().to_list(length=None)}

            return other_id, stored[theirs["_id"]]["spieler"], (stored[elsewhere["_id"]], elsewhere)

        other_id, entries, (untouched, seeded) = on_a_league(mongo_replica_set_url, body)

        assert entries == [{"spieler_id": other_id, "starts": True}, {"spieler_id": None, "starts": True}]
        assert untouched == seeded
