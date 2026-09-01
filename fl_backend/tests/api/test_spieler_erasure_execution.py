from datetime import datetime
from typing import Any, Awaitable, Callable
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.spieler.admin_router import (
    delete_saison_spieler,
    delete_spieler,
    erase_spieler,
    patch_saison_spieler,
    patch_spieler,
    post_saison_spieler,
    post_spieler,
)
from app.api.spieler.schemas import (
    FLPatchSaisonSpielerPayload,
    FLPatchSpielerPayload,
    FLPostSaisonSpielerPayload,
    FLPostSpielerPayload,
)
from app.api.spieler.services import ERASURE_NOT_RETIRED
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException
from tests.database import a_clean_database, on_the_seed_loop

pytestmark = pytest.mark.db

DATABASE_NAME = "fl_spieler_erasure_test"

# Named rather than caught broadly: another failure must not read as the rollback this suite proves.
DOCUMENT_VALIDATION_FAILED = 121

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
# Injected through `get_germany_now`, so the stamp under test is not the wall clock. Summer time,
# which is what puts an offset on the conversion below.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# The instant above as a log row spells it: 12:30 in Frankfurt is 10:30 in the log. Written out
# rather than computed from `log_stamp`, a stored stamp compared against the function that produced
# it agreeing with any conversion of it, including none.
REDACTED_AT = "2026-04-01T10:30:00+00:00"

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

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """The SHIPPED validators, so a document production would refuse fails here too, and every collection created.

    `mutates_schema=True` where the body narrows one of those validators: `tests/database.py` then
    keeps the change off every later test.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            # Each season spans its own calendar year, so the two seeded spans do not overlap.
            await database[Collection.SAISONS].insert_many(
                [
                    {"_id": year, "start_date": f"{year}-01-01", "end_date": f"{year}-06-30", "status": status, "rules": dict(RULES)}
                    for year, status in ((SAISON_ID, "active"), (FORMER_SAISON_ID, "past"))
                ]
            )
            # Both clubs in both seasons, so either pupil can be put in a squad in either one. The
            # season's own copy of each identity is required and never read: this suite is about people.
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    {"saison_id": saison_id, "team_id": team_id, "gruppe": gruppe, "austritt": None, "name": name, "shorthand": short}
                    for saison_id in (SAISON_ID, FORMER_SAISON_ID)
                    for team_id, gruppe, name, short in ((HOME_TEAM_OID, "A", "Heim-Schule", "HS"), (AWAY_TEAM_OID, "B", "Gast-Schule", "GS"))
                ]
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def a_pupil_with_a_history(database: AsyncDatabase, *, vorname: str, team_id: ObjectId, retired: bool) -> ObjectId:
    """A person created, put in two squads and then edited on every row, through the real endpoints.

    The edits are the point: an `insert` row carries no image, so a person seeded from creates alone
    leaves every redaction assertion below passing vacuously.
    """

    created = await post_spieler(
        # Surname derived from the given name, so one sweep of a whole database still tells two apart.
        spieler_data=FLPostSpielerPayload(vorname=vorname, nachname=f"{vorname}-Mustermann"),
        spieler_collection=database[Collection.SPIELER],
        today=TODAY,
    )
    spieler_id = ObjectId(created.spieler_id)

    for saison_id, worn, then_worn in ((FORMER_SAISON_ID, "41", "42"), (SAISON_ID, "10", "7")):
        await post_saison_spieler(
            spieler_id=spieler_id,
            saison_spieler_data=FLPostSaisonSpielerPayload(
                saison_id=saison_id, team_id=team_id, nummer=worn, position="Angriff", stufe="Q2", is_nachgetragen=False, rolle=None
            ),
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            saisons_collection=database[Collection.SAISONS],
        )
        await patch_saison_spieler(
            spieler_id=spieler_id,
            saison_id=saison_id,
            saison_spieler_data=FLPatchSaisonSpielerPayload(
                team_id=team_id, nummer=then_worn, position="Abwehr", stufe="Q2", is_nachgetragen=False, rolle="kapitaen"
            ),
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            saisons_collection=database[Collection.SAISONS],
        )

    # The earlier squad is LEFT, which is a shape the erasure has to reach as well: a row recording
    # what somebody wore stays about them after they stop wearing it.
    await delete_saison_spieler(
        spieler_id=spieler_id, saison_id=FORMER_SAISON_ID, saison_spieler_collection=database[Collection.SAISON_SPIELER], today=TODAY
    )
    await patch_spieler(
        spieler_id=spieler_id,
        spieler_data=FLPatchSpielerPayload(vorname=vorname, nachname=f"{vorname}-Musterfrau"),
        spieler_collection=database[Collection.SPIELER],
    )

    if retired:
        await delete_spieler(spieler_id=spieler_id, spieler_collection=database[Collection.SPIELER], today=TODAY)

    return spieler_id


async def a_pupil_who_never_joined_a_squad(database: AsyncDatabase) -> ObjectId:
    """A person created, renamed and retired who holds no squad row, so the redaction's squad branch names no id."""

    created = await post_spieler(
        spieler_data=FLPostSpielerPayload(vorname=LONE_VORNAME, nachname=f"{LONE_VORNAME}-Mustermann"),
        spieler_collection=database[Collection.SPIELER],
        today=TODAY,
    )
    spieler_id = ObjectId(created.spieler_id)

    await patch_spieler(
        spieler_id=spieler_id,
        spieler_data=FLPatchSpielerPayload(vorname=LONE_VORNAME, nachname=f"{LONE_VORNAME}-Musterfrau"),
        spieler_collection=database[Collection.SPIELER],
    )
    await delete_spieler(spieler_id=spieler_id, spieler_collection=database[Collection.SPIELER], today=TODAY)

    return spieler_id


async def call_erasure(database: AsyncDatabase, client: AsyncMongoClient, spieler_id: ObjectId) -> Any:
    return await erase_spieler(
        spieler_id=spieler_id,
        spieler_collection=database[Collection.SPIELER],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        germany_now=NOW,
    )


async def log_rows_naming(database: AsyncDatabase, spieler_id: ObjectId) -> list[dict[str, Any]]:
    """Every log row about this person, found INDEPENDENTLY of the endpoint's own filter.

    The squad rows are reached through their stored image rather than the id list the endpoint
    builds, so a wrong id list cannot make these assertions agree with it.
    """

    junction_rows = await database[Collection.AKTIONEN].find({"collection": str(Collection.SAISON_SPIELER)}).to_list(length=None)
    squad_ids = [row["document_id"] for row in junction_rows if (row.get("before") or {}).get("spieler_id") == spieler_id]

    return (
        await database[Collection.AKTIONEN]
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

    rows = await database[Collection.AKTIONEN].find({"before": {"$ne": None}}).to_list(length=None)

    return [image for row in rows for image in (row["before"] if isinstance(row["before"], list) else [row["before"]])]


def images_naming(images: list[dict[str, Any]], spieler_id: ObjectId) -> list[dict[str, Any]]:
    """The images that ARE this person or point at them, from whichever collection they were recorded."""

    return [image for image in images if spieler_id in (image.get("_id"), image.get("spieler_id"))]


async def every_collection_as_text(database: AsyncDatabase) -> str:
    """The whole database rendered, so a value can be looked for where nobody thought to put it."""

    return str([await database[name].find().to_list(length=None) for name in await database.list_collection_names()])


class TestARetiredPupilIsErasedWhole:
    """D83 through the endpoint: the person, their squad rows and their values in the log, or none of the three."""

    def test_the_person_is_gone_from_the_collection(self, mongo_replica_set_url: str):
        """Catches an erasure that only stamps `inactive_since` again -- the soft delete wearing a new route."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=True)
            await call_erasure(database, client, spieler_id)

            return await database[Collection.SPIELER].count_documents({"_id": spieler_id})

        assert on_a_league(mongo_replica_set_url, body) == 0

    def test_every_squad_row_they_held_is_gone(self, mongo_replica_set_url: str):
        """Catches removing the person alone: the squad read `$lookup`s outward from `spieler`, so an orphan is invisible."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=True)
            response = await call_erasure(database, client, spieler_id)

            return response.erased_saison_spieler, await database[Collection.SAISON_SPIELER].count_documents({"spieler_id": spieler_id})

        erased, remaining = on_a_league(mongo_replica_set_url, body)

        assert (erased, remaining) == (2, 0)

    def test_another_pupil_keeps_their_squad_row(self, mongo_replica_set_url: str):
        """The over-breadth floor: catches a removal filtered on the collection rather than on `spieler_id`."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=True)
            other_id = await a_pupil_with_a_history(database, vorname="Erika", team_id=AWAY_TEAM_OID, retired=False)
            await call_erasure(database, client, spieler_id)

            return (
                await database[Collection.SPIELER].count_documents({"_id": other_id}),
                await database[Collection.SAISON_SPIELER].count_documents({"spieler_id": other_id}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (1, 2)

    def test_every_log_row_naming_them_is_emptied_and_stamped(self, mongo_replica_set_url: str):
        """Catches a redaction that stamps without clearing the image, and one that clears without stamping.

        The pre-state is asserted too, without which a filter matching nothing would pass this test.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=True)
            before_erasure = await log_rows_naming(database, spieler_id)
            response = await call_erasure(database, client, spieler_id)

            stamped = await database[Collection.AKTIONEN].find({"redacted_at": {"$ne": None}}).to_list(length=None)

            return before_erasure, stamped, response.redacted_aktionen

        before_erasure, stamped, counted = on_a_league(mongo_replica_set_url, body)

        # The floor: the seeded history really did leave this person's names and consent record in the log.
        assert [row for row in before_erasure if row["before"] is not None], "the seeded log held no image to redact"
        assert len(before_erasure) == counted == len(stamped)
        assert all(row["before"] is None for row in stamped)
        assert {row["redacted_at"] for row in stamped} == {REDACTED_AT}

    def test_another_pupils_log_rows_keep_their_images(self, mongo_replica_set_url: str):
        """Catches an `$or` branch matching on `collection` alone, which would empty the whole log."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=True)
            other_id = await a_pupil_with_a_history(database, vorname="Erika", team_id=AWAY_TEAM_OID, retired=False)
            await call_erasure(database, client, spieler_id)

            return await log_rows_naming(database, other_id)

        rows = on_a_league(mongo_replica_set_url, body)

        assert [row for row in rows if row["before"] is not None], "the other pupil's log rows were emptied too"
        assert all(row["redacted_at"] is None for row in rows)

    def test_the_redaction_writes_no_row_of_its_own(self, mongo_replica_set_url: str):
        """Catches removing `record_write`'s early return on the log: the redaction would record a fresh copy of the values it erased.

        Exactly two rows are added, the two removals' own, and neither names the log.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=True)
            before_count = await database[Collection.AKTIONEN].count_documents({})
            await call_erasure(database, client, spieler_id)

            return (
                before_count,
                await database[Collection.AKTIONEN].count_documents({}),
                await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.AKTIONEN)}),
            )

        before_count, after_count, self_recorded = on_a_league(mongo_replica_set_url, body)

        assert after_count == before_count + 2
        assert self_recorded == 0

    def test_the_erasure_stays_readable_as_an_action(self, mongo_replica_set_url: str):
        """Catches a redaction that stamps its own two rows: what the erasure did would then be as unreadable as what it removed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=True)
            await call_erasure(database, client, spieler_id)

            return await database[Collection.AKTIONEN].find({"operation": "erase_many"}).to_list(length=None)

        rows = on_a_league(mongo_replica_set_url, body)

        assert {row["collection"] for row in rows} == {str(Collection.SPIELER), str(Collection.SAISON_SPIELER)}
        # No image by construction, and unstamped: an erasure has to be able to show its own filter and count.
        assert all(row["before"] is None and row["redacted_at"] is None and row["db_filter"] for row in rows)
        assert sum(row["modified_count"] for row in rows) == 3


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
            await call_erasure(database, client, spieler_id)

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
            await call_erasure(database, client, spieler_id)

            return await every_collection_as_text(database)

        rendered = on_a_league(mongo_replica_set_url, body)

        # Both surnames carry the given name, so one substring answers for all three of their values.
        assert ERASED_VORNAME not in rendered
        # Their REPLACED surname, not their live one: only what an edit replaced is ever in the log.
        assert f"{OTHER_VORNAME}-Mustermann" in rendered


class TestAPupilWhoNeverJoinedASquad:
    """The redaction's empty squad branch: an `$in` of no ids has to match nothing rather than everything."""

    def test_every_other_squad_rows_images_are_left_standing(self, mongo_replica_set_url: str):
        """Catches an empty id list widened to match every squad row, which would empty the log for the whole league."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            other_id = await a_pupil_with_a_history(database, vorname=OTHER_VORNAME, team_id=AWAY_TEAM_OID, retired=False)
            response = await call_erasure(database, client, await a_pupil_who_never_joined_a_squad(database))

            return response.erased_saison_spieler, images_naming(await images_in_the_whole_log(database), other_id)

        erased, theirs = on_a_league(mongo_replica_set_url, body)

        assert erased == 0
        assert [image for image in theirs if image.get("saison_id")], "an empty id list swept the other pupil's squad rows"

    def test_their_own_record_is_erased_all_the_same(self, mongo_replica_set_url: str):
        """Catches an erasure that only reaches a person who held a squad row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_who_never_joined_a_squad(database)
            await call_erasure(database, client, spieler_id)

            return await database[Collection.SPIELER].count_documents({"_id": spieler_id}), await every_collection_as_text(database)

        remaining, rendered = on_a_league(mongo_replica_set_url, body)

        assert remaining == 0
        assert LONE_VORNAME not in rendered


class TestTheErasureIsRefusedUntilTheyAreRetired:
    """`REQ-PURGE-001`, D60's precondition: the reversible step has to have been taken and left standing."""

    def test_a_pupil_still_in_the_league_is_refused(self, mongo_replica_set_url: str):
        """Catches dropping the precondition, which would put an unrecoverable write one click from the squad list."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> DocumentConflictException:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=False)

            with pytest.raises(DocumentConflictException) as excinfo:
                await call_erasure(database, client, spieler_id)

            return excinfo.value

        assert on_a_league(mongo_replica_set_url, body).error_code == ERASURE_NOT_RETIRED

    def test_the_refused_call_removes_and_redacts_nothing(self, mongo_replica_set_url: str):
        """The refusal is raised INSIDE the transaction, so it has to abort rather than leave half a write."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=False)

            with pytest.raises(DocumentConflictException):
                await call_erasure(database, client, spieler_id)

            return (
                await database[Collection.SPIELER].count_documents({"_id": spieler_id}),
                await database[Collection.SAISON_SPIELER].count_documents({"spieler_id": spieler_id}),
                await database[Collection.AKTIONEN].count_documents({"redacted_at": {"$ne": None}}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (1, 2, 0)

    def test_retiring_them_first_lets_the_same_call_through(self, mongo_replica_set_url: str):
        """The floor under the refusal: without it, a blanket failure would read as the precondition working."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            spieler_id = await a_pupil_with_a_history(database, vorname="Max", team_id=HOME_TEAM_OID, retired=False)
            await delete_spieler(spieler_id=spieler_id, spieler_collection=database[Collection.SPIELER], today=TODAY)

            return await call_erasure(database, client, spieler_id)

        response = on_a_league(mongo_replica_set_url, body)

        assert (response.erased_saison_spieler, response.acknowledged) == (2, 1)


class TestAHalfDoneErasureCommitsNothing:
    """D83's failure mode: a person removed while the log still holds their values reports an erasure that did not happen."""

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
                Collection.AKTIONEN.value,
                validator={"$jsonSchema": {"bsonType": "object", "properties": {"redacted_at": {"bsonType": "null"}}}},
                validationLevel="strict",
            )

            with pytest.raises(OperationFailure) as failure:
                await call_erasure(database, client, spieler_id)

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
