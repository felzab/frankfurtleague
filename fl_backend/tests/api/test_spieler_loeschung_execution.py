from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.identity.schemas import FLErasureResponse
from app.api.spieler.admin_router import (
    delete_saison_spieler,
    delete_spieler,
    patch_saison_spieler,
    patch_spieler,
    post_saison_spieler,
)
from app.api.spieler.schemas import FLPatchSaisonSpielerPayload, FLPatchSpielerPayload, FLPostSaisonSpielerPayload
from app.core.collections import Collection
from app.core.sentinels import GHOST_SPIELER_ID
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, on_the_seed_loop
from tests.documents import saison_document, saison_team_document, spielbericht_document, spieler_document
from tests.erasure import erased
from tests.plans import plans_of_sent_reads
from tests.whole_database import where_held
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spieler_loeschung_test")


SAISON_ID = "2026"
# A second season, so one person holds a LIVE squad row and a RETIRED one at once: a redaction
# narrowed to either shape leaves the other's images standing.
FORMER_SAISON_ID = "2025"

# Distinctive rather than "Mustermann": sweeping a whole database for a name is evidence of absence
# only where a hit could not be coincidence, and the seed data is full of German words and dates.
ERASED_VORNAME = "Zorbanax"
OTHER_VORNAME = "Quillhilde"
LONE_VORNAME = "Wraxlington"

# Fixed rather than generated, so a failure names the same club every run.
HOME_TEAM_OID = ObjectId("6890a1b2c3d4e5f607420001")
AWAY_TEAM_OID = ObjectId("6890a1b2c3d4e5f607420002")

TODAY = "2026-04-01"
# Injected through `get_germany_now`.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """The SHIPPED indexes, so a document production would refuse fails here too.

    `mutates_schema=True` where the body installs a validator (`tests/database.py :: a_clean_database`).
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
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


def person_row(vorname: str) -> dict[str, Any]:
    """A pupil as their admission writes them, with an address the erasure is keyed on.

    Seeded rather than written through a route: the one route writing a person is the admission, which needs a registration.
    """

    return spieler_document(
        ObjectId(),
        vorname,
        # Surname derived from the given name, so one sweep of a whole database still tells two apart.
        f"{vorname}-Mustermann",
        email=f"{vorname.lower()}@example.com",
        geburtsdatum="2009-05-09",
    )


async def a_pupil_with_a_history(database: AsyncDatabase, *, vorname: str, team_id: ObjectId, retired: bool) -> ObjectId:
    """A person seeded, put in two squads and edited on every row through the real endpoints.

    The edits are the point: a seed writes no log row, so a person never edited leaves every
    redaction assertion below passing vacuously.
    """

    document = person_row(vorname)
    await database[Collection.SPIELER].insert_one(document)
    spieler_id = document["_id"]

    for saison_id, worn, then_worn in ((FORMER_SAISON_ID, "41", "42"), (SAISON_ID, "10", "7")):
        await post_saison_spieler(
            spieler_id=spieler_id,
            saison_spieler_data=FLPostSaisonSpielerPayload(
                saison_id=saison_id, team_id=team_id, nummer=worn, position="Angriff", stufe="Q2", rolle=None
            ),
            spieler_collection=database[Collection.SPIELER],
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            saisons_collection=database[Collection.SAISONS],
            db=database.client,
            today=TODAY,
        )
        await patch_saison_spieler(
            spieler_id=spieler_id,
            saison_id=saison_id,
            saison_spieler_data=FLPatchSaisonSpielerPayload(team_id=team_id, nummer=then_worn, position="Abwehr", stufe="Q2", rolle="kapitaen"),
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            saisons_collection=database[Collection.SAISONS],
            db=database.client,
        )

    # The earlier squad is LEFT, which is a shape the erasure has to reach as well: a row recording
    # what somebody wore stays about them after they stop wearing it.
    await delete_saison_spieler(
        spieler_id=spieler_id,
        saison_id=FORMER_SAISON_ID,
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        today=TODAY,
        db=database.client,
    )
    await patch_spieler(
        spieler_id=spieler_id,
        spieler_data=FLPatchSpielerPayload(vorname=vorname, nachname=f"{vorname}-Musterfrau", geburtsdatum="2009-05-09"),
        spieler_collection=database[Collection.SPIELER],
        db=database.client,
    )

    if retired:
        await delete_spieler(spieler_id=spieler_id, spieler_collection=database[Collection.SPIELER], today=TODAY, db=database.client)

    return spieler_id


async def a_pupil_who_never_joined_a_squad(database: AsyncDatabase) -> ObjectId:
    """A person seeded, renamed and retired who holds no squad row, so the redaction's squad branch names no id."""

    document = person_row(LONE_VORNAME)
    await database[Collection.SPIELER].insert_one(document)
    spieler_id = document["_id"]

    await patch_spieler(
        spieler_id=spieler_id,
        spieler_data=FLPatchSpielerPayload(vorname=LONE_VORNAME, nachname=f"{LONE_VORNAME}-Musterfrau", geburtsdatum="2009-05-09"),
        spieler_collection=database[Collection.SPIELER],
        db=database.client,
    )
    await delete_spieler(spieler_id=spieler_id, spieler_collection=database[Collection.SPIELER], today=TODAY, db=database.client)

    return spieler_id


async def erase_the_pupil(database: AsyncDatabase, client: AsyncMongoClient, spieler_id: ObjectId) -> FLErasureResponse:
    """The registry's erasure of the address this pupil's row holds: the erasure is keyed on a mailbox, never on an id."""

    person = await database[Collection.SPIELER].find_one({"_id": spieler_id}, {"email": 1})
    assert person is not None, f"no pupil {spieler_id} to erase"

    return await erased(database, client, person["email"], germany_now=NOW)


async def log_rows_naming(database: AsyncDatabase, spieler_id: ObjectId) -> list[dict[str, Any]]:
    """Every log row about this person, found INDEPENDENTLY of the endpoint's own filter.

    The squad rows are reached through their stored image rather than the id list the endpoint
    builds, so a wrong id list cannot make these assertions agree with it.
    """

    junction_rows = await database[Collection.ACTION_LOG].find({"collection": str(Collection.SAISON_SPIELER)}).to_list(length=None)
    squad_ids = [row["document_id"] for row in junction_rows if (row.get("before") or {}).get("spieler_id") == spieler_id]

    return (
        await database[Collection.ACTION_LOG]
        .find(
            {
                "$or": [
                    {"collection": str(Collection.SPIELER), "document_id": spieler_id},
                    {"collection": str(Collection.SAISON_SPIELER), "document_id": {"$in": squad_ids}},
                ]
            }
        )
        .to_list(length=None)
    )


async def images_in_the_whole_log(database: AsyncDatabase) -> list[dict[str, Any]]:
    """Every image the log still holds, read WITHOUT the endpoint's `(collection, document_id)` filter.

    `log_rows_naming` reproduces that filter, so a shape the endpoint misses the helper misses too.
    This asks what a row CONTAINS instead.
    """

    rows = await database[Collection.ACTION_LOG].find({"before": {"$ne": None}}).to_list(length=None)

    return [image for row in rows for image in (row["before"] if isinstance(row["before"], list) else [row["before"]])]


def images_naming(images: list[dict[str, Any]], spieler_id: ObjectId) -> list[dict[str, Any]]:
    """The images that ARE this person or point at them, from whichever collection they were recorded."""

    return [image for image in images if spieler_id in (image.get("_id"), image.get("spieler_id"))]


class TestARetiredPupilIsGeloeschtWhole:
    """Through the endpoint: the person, their squad rows and their values in the log, or none of the three."""

    def test_every_squad_row_they_held_is_gone(self, mongo_replica_set_url: str):
        """Catches removing the person alone: the squad read `$lookup`s outward from `spieler`, so an orphan is invisible."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=True)
            response = await erase_the_pupil(database, client, spieler_id)

            return response.saison_spieler, await database[Collection.SAISON_SPIELER].count_documents({"spieler_id": spieler_id})

        removed, remaining = on_a_league(mongo_replica_set_url, body)

        assert (removed, remaining) == (2, 0)

    def test_another_pupil_keeps_their_squad_row(self, mongo_replica_set_url: str):
        """The over-breadth floor: catches a removal filtered on the collection rather than on `spieler_id`."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=True)
            other_id = await a_pupil_with_a_history(database, vorname="Erika", team_id=AWAY_TEAM_OID, retired=False)
            await erase_the_pupil(database, client, spieler_id)

            return (
                await database[Collection.SPIELER].count_documents({"_id": other_id}),
                await database[Collection.SAISON_SPIELER].count_documents({"spieler_id": other_id}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (1, 2)

    def test_another_pupils_log_rows_keep_their_images(self, mongo_replica_set_url: str):
        """Catches an `$or` branch matching on `collection` alone, which would empty the whole log."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=True)
            other_id = await a_pupil_with_a_history(database, vorname="Erika", team_id=AWAY_TEAM_OID, retired=False)
            await erase_the_pupil(database, client, spieler_id)

            return await log_rows_naming(database, other_id)

        rows = on_a_league(mongo_replica_set_url, body)

        assert [row for row in rows if row["before"] is not None], "the other pupil's log rows were emptied too"
        assert all(row["redacted_at"] is None for row in rows)


class TestNothingOfTheirsIsLeftAnywhere:
    """The floor under the class above, which asks where the endpoint looked: these ask what is left."""

    def test_no_image_anywhere_in_the_log_still_names_them(self, mongo_replica_set_url: str):
        """Catches an erasure reaching their LIVE squad rows alone: the squad they left keeps its images.

        The retired row and its seeded image are asserted first, so a fixture that stopped producing
        either fails here rather than passing vacuously.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname=ERASED_VORNAME, team_id=HOME_TEAM_OID, retired=True)
            left_behind = await database[Collection.SAISON_SPIELER].count_documents({"spieler_id": spieler_id, "inactive_since": {"$ne": None}})
            seeded = images_naming(await images_in_the_whole_log(database), spieler_id)
            await erase_the_pupil(database, client, spieler_id)

            return left_behind, seeded, images_naming(await images_in_the_whole_log(database), spieler_id)

        left_behind, seeded, surviving = on_a_league(mongo_replica_set_url, body)

        assert left_behind == 1, "the seeded person held no retired squad row"
        assert [image for image in seeded if image.get("saison_id") == FORMER_SAISON_ID], "the squad they left recorded no image"
        assert surviving == []

    def test_no_name_of_theirs_survives_anywhere_in_the_database(self, mongo_replica_set_url: str):
        """Catches a value left in a collection the erasure never names -- every one of them is read.

        The other pupil's replaced surname is asserted present, without which a database emptied
        wholesale would pass.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname=ERASED_VORNAME, team_id=HOME_TEAM_OID, retired=True)
            await a_pupil_with_a_history(database, vorname=OTHER_VORNAME, team_id=AWAY_TEAM_OID, retired=False)
            await erase_the_pupil(database, client, spieler_id)

            return await where_held(database, ERASED_VORNAME, f"{OTHER_VORNAME}-Mustermann")

        held = on_a_league(mongo_replica_set_url, body)

        # Both surnames carry the given name, so one substring answers for all three of their values.
        assert held[ERASED_VORNAME] == []
        # Their REPLACED surname, not their live one: only what an edit replaced is ever in the log.
        assert held[f"{OTHER_VORNAME}-Mustermann"]


class TestAPupilWhoNeverJoinedASquad:
    """The redaction's empty squad branch: an `$in` of no ids has to match nothing rather than everything."""

    def test_every_other_squad_rows_images_are_left_standing(self, mongo_replica_set_url: str):
        """Catches an empty id list widened to match every squad row, which would empty the log for the whole league."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            other_id = await a_pupil_with_a_history(database, vorname=OTHER_VORNAME, team_id=AWAY_TEAM_OID, retired=False)
            response = await erase_the_pupil(database, client, await a_pupil_who_never_joined_a_squad(database))

            return response.saison_spieler, images_naming(await images_in_the_whole_log(database), other_id)

        removed, theirs = on_a_league(mongo_replica_set_url, body)

        assert removed == 0
        assert [image for image in theirs if image.get("saison_id")], "an empty id list swept the other pupil's squad rows"

    def test_their_own_record_is_geloescht_all_the_same(self, mongo_replica_set_url: str):
        """Catches an erasure that only reaches a person who held a squad row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_who_never_joined_a_squad(database)
            await erase_the_pupil(database, client, spieler_id)

            return await database[Collection.SPIELER].count_documents({"_id": spieler_id}), await where_held(database, LONE_VORNAME)

        remaining, held = on_a_league(mongo_replica_set_url, body)

        assert remaining == 0
        assert held == {LONE_VORNAME: []}


def a_report_naming(*, scorers: list[ObjectId | None], carded: list[ObjectId]) -> dict[str, Any]:
    """A report on a fixture of its own, adopted, so a repoint that touched the adoption shows as one."""

    report = spielbericht_document({"_id": ObjectId(), "saison_id": SAISON_ID})
    bericht = report["bericht"]
    bericht["torschuetzen"] = [
        {"seite": "team1", "spieler_id": scorer, "minute": str(10 + index), "eigentor": False} for index, scorer in enumerate(scorers)
    ]
    bericht["karten"] = [
        {"seite": "team2", "spieler_id": pupil, "minute": str(60 + index), "farbe": "gelb", "grund": "foulspiel"}
        for index, pupil in enumerate(carded)
    ]
    bericht["ergebnis_vorschlag"] = {"team1_tore": len(scorers), "team2_tore": 0, "elfmeterschiessen": None, "sonderereignis": None}
    bericht |= {"adopted_at": bericht["submitted_at"], "adopted_by": {"art": "admin"}, "adopted_version": bericht["version"]}

    return report


class TestTheirReportEntriesNameTheSentinel:
    """A report is the league's record of the match, so it stays; the entries naming them name nobody instead."""

    def test_no_entry_names_them_and_every_other_entry_and_report_stands(self, mongo_replica_set_url: str):
        """Catches a repoint reaching one array alone, every element of one, or a report naming somebody else."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            document = person_row(ERASED_VORNAME)
            other = person_row(OTHER_VORNAME)
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
        repointed, before = stored[theirs]["bericht"], seeded[theirs]["bericht"]

        assert [entry["spieler_id"] for entry in repointed["torschuetzen"]] == [GHOST_SPIELER_ID, other_id, None, GHOST_SPIELER_ID]
        assert [entry["spieler_id"] for entry in repointed["karten"]] == [other_id, GHOST_SPIELER_ID]
        # Each entry's other fields, and the adoption, are the report's own.
        assert [{**entry, "spieler_id": None} for entry in [*repointed["torschuetzen"], *repointed["karten"]]] == [
            {**entry, "spieler_id": None} for entry in [*before["torschuetzen"], *before["karten"]]
        ]
        assert {**repointed, "torschuetzen": None, "karten": None} == {**before, "torschuetzen": None, "karten": None}
        assert (stored[elsewhere], stored[nobody]) == (seeded[elsewhere], seeded[nobody])
        assert spieler_id not in {
            entry["spieler_id"] for row in stored.values() for entry in [*row["bericht"]["torschuetzen"], *row["bericht"]["karten"]]
        }

    def test_the_repoint_reads_an_index_per_kind_of_entry(self, mongo_replica_set_url: str):
        """The reports are kept with no retention bound, and every pupil's erasure reads them inside its transaction."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            document = person_row(ERASED_VORNAME)
            await database[Collection.SPIELER].insert_one(document)
            await database[Collection.SPIELBERICHTE].insert_one(a_report_naming(scorers=[document["_id"]], carded=[]))
            _, sent = await plans_of_sent_reads(
                mongo_replica_set_url,
                database,
                lambda watched, watching: erase_the_pupil(watched, watching, document["_id"]),
                lambda collection, _: collection == Collection.SPIELBERICHTE,
                commands=("update",),
            )

            return sent

        [(_, plan)] = on_a_league(mongo_replica_set_url, body)

        assert plan == "IXSCAN { bericht.torschuetzen.spieler_id: 1 }, IXSCAN { bericht.karten.spieler_id: 1 }"


class TestAHalfDoneLoeschungCommitsNothing:
    """The failure mode.

    A person removed while the log still holds their values reports an erasure that did not happen.
    """

    def test_a_refused_redaction_takes_both_removals_back(self, mongo_replica_set_url: str):
        """A `$jsonSchema` refusing a stamped row fails the LAST of the three writes, after the other two have landed.

        Catches running the three outside one transaction, and dropping the session from either removal.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=True)
            # Narrow enough to refuse the redaction's `$set`, wide enough to admit the removals' own
            # rows, which are recorded with `redacted_at` null.
            await database.command(
                "collMod",
                Collection.ACTION_LOG.value,
                validator={"$jsonSchema": {"bsonType": "object", "properties": {"redacted_at": {"bsonType": "null"}}}},
                validationLevel="strict",
            )

            with pytest.raises(OperationFailure) as failure:
                await erase_the_pupil(database, client, spieler_id)

            return (
                failure.value.code,
                await database[Collection.SPIELER].count_documents({"_id": spieler_id}),
                await database[Collection.SAISON_SPIELER].count_documents({"spieler_id": spieler_id}),
                await log_rows_naming(database, spieler_id),
            )

        code, people, squad_rows, rows = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        # Asserted on the code, so this cannot pass because something else failed before any write.
        assert code == DOCUMENT_VALIDATION_FAILED, f"expected the validator to refuse the redaction, got code {code}"
        assert (people, squad_rows) == (1, 2), "the removals survived a redaction that failed"
        assert [row for row in rows if row["before"] is not None], "the log lost its images to a transaction that never committed"
        assert all(row["redacted_at"] is None for row in rows)
