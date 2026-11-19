"""
API · the season-after rule's run, against the shipped indexes and the whole database

The league has two seasons ended, one running and one planned, so the rule keeps a squad row in the
latest ended one and every later one. Every pupil a case seeds is held against what the rule says of
them, and every reach claim is asked of the whole database, so a step taken from the run fails here.
The decisions underneath are `tests/api/test_identity_erasure_sweep_refusal.py`'s.
"""

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any, Final

import pymongo
import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identity.crud import erasure_due_page, saison_statuses
from app.core.codes import Code
from app.core.collections import Collection
from app.core.logging import JSONFormatter
from tests.acts import deletions_of
from tests.app_client import app_client, app_under_test
from tests.config import SYSTEM_AUTH
from tests.database import a_clean_database
from tests.documents import (
    kontakte_document,
    kontaktperson_document,
    saison_team_document,
    schiedsrichter_document,
)
from tests.erasure_sweep_corpus import (
    LEAGUE,
    NOW,
    TEAM_OID,
    a_due_pupil,
    a_report_naming,
    address_of,
    kader_row,
    numbered,
    pupil,
    registration,
    run,
    seeded,
    the_league,
)
from tests.isolation import InterleavedCollection, Rival
from tests.whole_database import where_held
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_erasure_sweep_test")
PATH = "/api/identity/erasure/sweep"

TODAY = "2026-04-01"

JUST_ENDED = "2025"


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(url: str, body: Body, *, saisons: Mapping[str, str] = LEAGUE, mutates_schema: bool = False) -> Any:
    """The shipped indexes, the seasons and one team."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
        await the_league(database, saisons=saisons)

        return await body(database, client)


# A schema no seeded report meets, so any write to one is refused and a pupil no report names passes.
NO_REPORT_WRITTEN: Final = {"required": ["a_field_no_report_holds"]}


async def refuse_writes_breaking(database: AsyncDatabase, collection: Collection, schema: Mapping[str, Any]) -> None:
    """How this suite forces one row's write to fail mid-pass: a `$jsonSchema` the planted row breaks and every other row keeps."""

    await database.command("collMod", str(collection), validator={"$jsonSchema": dict(schema)}, validationLevel="strict")


def counts(answer: Any) -> dict[str, Any]:
    return answer.model_dump()


# Past any population a case seeds, so the read names every due pupil at once.
WHOLE = 1000


async def population(database: AsyncDatabase) -> list[Any]:
    page = await erasure_due_page(
        await saison_statuses(saisons_collection=database[Collection.SAISONS]),
        size=WHOLE,
        spieler_collection=database[Collection.SPIELER],
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
    )

    return [row["_id"] for row in page]


def written_after_the_population_read(database: AsyncDatabase, rival: Rival) -> InterleavedCollection:
    """The pupils' collection, writing `rival` once the run's population read has answered and before any pupil's own transaction."""

    # The population read is the run's first `aggregate` of the pupils, and the rival runs once.
    return InterleavedCollection(database[Collection.SPIELER], rival, after="aggregate")


# --- The population: whom the read names, before any transaction re-judges them.

TWO_SEASONS_BACK = numbered(1)
DECLINED_ALONE = numbered(2)
LIVE_IN_THE_SEASON_JUST_ENDED = numbered(3)
RETIRED_IN_THE_SEASON_JUST_ENDED = numbered(4)
IN_THE_RUNNING_SEASON = numbered(5)
IN_THE_PLANNED_SEASON = numbered(6)
WITH_A_PENDING_REGISTRATION = numbered(7)

PENDING = "thessaly.okonkwo@beispielschule.example.org"

LABELS = {
    TWO_SEASONS_BACK: "a squad row two seasons back alone",
    DECLINED_ALONE: "a declined registration alone",
    LIVE_IN_THE_SEASON_JUST_ENDED: "a live row in the season just ended",
    RETIRED_IN_THE_SEASON_JUST_ENDED: "a retired row in the season just ended",
    IN_THE_RUNNING_SEASON: "a row in the running season",
    IN_THE_PLANNED_SEASON: "a row in the planned season",
    WITH_A_PENDING_REGISTRATION: "a pending registration",
}


async def a_league_of_every_kind(database: AsyncDatabase) -> None:
    await database[Collection.SPIELER].insert_many(
        [pupil(spieler_id, address_of(position)) for position, spieler_id in enumerate(LABELS, start=1)]
    )
    await database[Collection.SPIELER].update_one({"_id": WITH_A_PENDING_REGISTRATION}, {"$set": {"email": PENDING}})
    await database[Collection.SAISON_SPIELER].insert_many(
        [
            kader_row(TWO_SEASONS_BACK, "2024"),
            kader_row(LIVE_IN_THE_SEASON_JUST_ENDED, JUST_ENDED),
            # Retired as removing a player leaves the row; only the erasure deletes one.
            kader_row(RETIRED_IN_THE_SEASON_JUST_ENDED, JUST_ENDED, inactive_since="2025-03-01"),
            kader_row(IN_THE_RUNNING_SEASON, "2026"),
            kader_row(IN_THE_PLANNED_SEASON, "2027"),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [
            registration(numbered(101), address_of(2), declined=True),
            registration(numbered(102), PENDING),
        ]
    )


class TestThePopulation:
    async def test_it_names_the_pupils_the_rule_makes_due_and_no_other(self, mongo_replica_set_url: str):
        """Each pupil stands for one arm of the rule; a kept one appearing names the arm that broke."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> list[str]:
            await a_league_of_every_kind(database)

            return [LABELS.get(spieler_id, str(spieler_id)) for spieler_id in await population(database)]

        assert await on_a_league(mongo_replica_set_url, body) == [LABELS[TWO_SEASONS_BACK], LABELS[DECLINED_ALONE]]


# --- The run.

ADDRESS = "quirinus.vandersloot@beispielschule.example.org"
REACHED = numbered(11)
REACHED_ROWS = (numbered(12), numbered(13))
REACHED_REGISTRATION = numbered(14)
SEAT_ROW = numbered(15)
REFEREE = numbered(16)
GRANT = numbered(17)


async def one_address_in_four_roles(database: AsyncDatabase) -> None:
    """A due pupil, and a contact seat, a referee row and a grant held at the same address."""

    await database[Collection.SPIELER].insert_one(pupil(REACHED, ADDRESS, last_name="Pupillensloot"))
    await database[Collection.SAISON_SPIELER].insert_many(
        [kader_row(REACHED, saison_id, _id=row_id) for saison_id, row_id in zip(("2023", "2024"), REACHED_ROWS, strict=True)]
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(registration(REACHED_REGISTRATION, ADDRESS, declined=True, last_name="Pupillensloot"))
    await database[Collection.SAISON_TEAMS].insert_one(
        {
            "_id": SEAT_ROW,
            **saison_team_document(
                "2026",
                TEAM_OID,
                "Lindenschule",
                "LSX",
                kontakte=kontakte_document(
                    ansprechperson=kontaktperson_document("Quirinus", confirmed_at="2026-03-01", last_name="Sitzsloot", email=ADDRESS)
                ),
            ),
        }
    )
    await database[Collection.SCHIEDSRICHTER].insert_one(
        schiedsrichter_document(REFEREE, email=ADDRESS, name="Quirinus Schiedssloot", default_payment=20, einwilligung=None)
    )
    await database[Collection.GRANTS].insert_one(
        {
            "_id": GRANT,
            "address": ADDRESS,
            "admin_tier": "administration",
            "effective_from": datetime(2026, 1, 1, tzinfo=UTC),
        }
    )


class TestThePupilsOwnDataAlone:
    async def test_the_pupil_goes_whole_and_every_other_role_at_the_address_stands(self, mongo_replica_set_url: str):
        """Run in the full scope and this fails: the seat empties, the referee row and the grant go."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await one_address_in_four_roles(database)
            answer = await run(database, client)

            held = await where_held(database, "Pupillensloot", "Sitzsloot", "Schiedssloot", ADDRESS)

            return counts(answer), held, await deletions_of(database, "retention.spieler")

        answer, held, deletions = await on_a_league(mongo_replica_set_url, body)

        assert deletions == [("system", JUST_ENDED, 1, None)]
        assert answer == {
            "completed_saison_id": JUST_ENDED,
            "spieler": 1,
            "saison_spieler": 2,
            "registrierungen": 1,
            "skipped": 0,
            "failed": 0,
        }
        assert held == {
            "Pupillensloot": [],
            "Sitzsloot": ["saison_teams"],
            "Schiedssloot": ["schiedsrichter"],
            ADDRESS: ["grants", "saison_teams", "schiedsrichter"],
        }


class TestEachPupilIsJudgedAgainInTheirOwnTransaction:
    @pytest.mark.parametrize(
        "rival",
        [
            pytest.param(lambda database: database[Collection.SAISON_SPIELER].insert_one(kader_row(numbered(1), "2026")), id="a squad row"),
            pytest.param(
                lambda database: database[Collection.REGISTRIERUNGEN].insert_one(registration(numbered(901), address_of(1))),
                id="a pending registration",
            ),
        ],
    )
    async def test_what_arrives_after_the_read_keeps_its_pupil(
        self, mongo_replica_set_url: str, rival: Callable[[AsyncDatabase], Awaitable[Any]]
    ):
        """Drop the re-judgement and this fails: the read named them due, and the erasure would take the new record too."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1))
            pupils = written_after_the_population_read(database, lambda: rival(database))
            answer = await run(database, client, spieler_collection=pupils)

            return counts(answer), await database[Collection.SPIELER].count_documents({"_id": numbered(1)})

        answer, standing = await on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["skipped"], standing) == (0, 1, 1)

    async def test_an_address_corrected_by_hand_is_erased_as_it_stands_now(self, mongo_replica_set_url: str):
        """Carry the read's address into the erasure and this fails: the pupil stands, and a stranger's registration goes."""

        corrected = "quintessa.neu@beispielschule.example.org"
        stranger = numbered(902)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1))
            # Another person's, at the address the pupil held when the run read them.
            await database[Collection.REGISTRIERUNGEN].insert_one(registration(stranger, address_of(1), declined=True, last_name="Fremd"))
            await database[Collection.REGISTRIERUNGEN].update_one({"_id": numbered(5001)}, {"$set": {"email": corrected}})

            async def correct_it() -> None:
                await database[Collection.SPIELER].update_one({"_id": numbered(1)}, {"$set": {"email": corrected}})

            answer = await run(database, client, spieler_collection=written_after_the_population_read(database, correct_it))

            return (
                counts(answer),
                await database[Collection.SPIELER].count_documents({"_id": numbered(1)}),
                [row["_id"] for row in await database[Collection.REGISTRIERUNGEN].find().to_list(None)],
            )

        answer, standing, registrations = await on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["registrierungen"], standing) == (1, 1, 0)
        assert registrations == [stranger]


class TestOneRecordHoldsBackNobody:
    async def test_a_refused_erasure_is_counted_and_the_next_pupil_goes(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A report refusing the pupil's repoint, a real failure under strict validation.

        Remove the catch and the call fails, the second pupil standing.
        """

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1), a_due_pupil(2), a_report_naming(1))
            await refuse_writes_breaking(database, Collection.SPIELBERICHTE, NO_REPORT_WRITTEN)

            async with app_client(mongo_replica_set_url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
                response = await http.post(PATH, headers=SYSTEM_AUTH)

            return response.status_code, response.json(), await database[Collection.SPIELER].distinct("_id", {"email": {"$type": "string"}})

        with caplog.at_level(logging.ERROR):
            status, answer, standing = await on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert status == 200, answer
        assert (answer["spieler"], answer["failed"]) == (1, 1)
        assert standing == [numbered(1)]
        failures = [record for record in caplog.records if getattr(record, "error_code", None) == Code.DATABASE_FAILED]
        assert [(getattr(record, "row_id", None), "WriteError" in getattr(record, "diagnosis", "")) for record in failures] == [
            (str(numbered(1)), True)
        ]
        # Neither the address nor the name, which the line would keep past the erasure it reports.
        lines = [JSONFormatter().format(record) for record in failures]
        assert not [line for line in lines if address_of(1) in line or "Quintessa" in line]

    async def test_a_failure_not_the_databases_is_counted_and_the_next_pupil_goes(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """Catch the database's failures alone and the call fails, the second pupil standing and the next pass stopping at the first again."""

        class NotTheDatabases(Exception):
            """A failure no driver raises, standing for every class an erasure can meet outside the database."""

        class RaisesForOnePupil:
            """The squad rows, whose in-session read for the first pupil raises `NotTheDatabases`."""

            def __init__(self, collection: Any) -> None:
                self._collection = collection

            def __getattr__(self, name: str) -> Any:
                return getattr(self._collection, name)

            async def aggregate(self, pipeline: list[Any], *args: Any, **kwargs: Any) -> Any:
                if pipeline and pipeline[0] == {"$match": {"spieler_id": numbered(1)}}:
                    raise NotTheDatabases("synthetic")

                return await self._collection.aggregate(pipeline, *args, **kwargs)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1), a_due_pupil(2))
            answer = await run(database, client, saison_spieler_collection=RaisesForOnePupil(database[Collection.SAISON_SPIELER]))

            return counts(answer), await database[Collection.SPIELER].distinct("_id", {"email": {"$type": "string"}})

        with caplog.at_level(logging.ERROR):
            answer, standing = await on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["failed"]) == (1, 1)
        assert standing == [numbered(1)]
        [failure] = [record for record in caplog.records if getattr(record, "error_code", None) == Code.UNHANDLED_CRASH]
        assert (failure.levelname, failure.getMessage(), getattr(failure, "row_id", None)) == (
            "ERROR",
            "transactions.row_passed_over",
            str(numbered(1)),
        )
        # Located by the frame that raised it, and never by its message, which can quote a value.
        diagnosis = getattr(failure, "diagnosis", "")
        assert re.fullmatch(r"NotTheDatabases in aggregate at .+\.py:\d+", diagnosis) is not None, diagnosis


# Long enough that the pupil before the stall is erased inside it on a loaded machine.
SHORT_DEADLINE_S = 1.5


class StallsOnePupil:
    """The squad rows, whose in-session read for one pupil is sent once the call's deadline has passed.

    Spent before the read, as earlier pupils spend it: a script sleeping on the server outlives the deadline and holds the abort.
    """

    def __init__(self, collection: Any, stalled: ObjectId) -> None:
        self._collection = collection
        self._stalled = stalled

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def aggregate(self, pipeline: list[Any], *args: Any, **kwargs: Any) -> Any:
        if pipeline and pipeline[0] == {"$match": {"spieler_id": self._stalled}}:
            await asyncio.sleep(SHORT_DEADLINE_S)

        return await self._collection.aggregate(pipeline, *args, **kwargs)


class TestTheDeadlineStopsTheCall:
    async def test_it_warns_once_and_the_rest_stay_due(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Fail each pupil past the deadline instead and every later one is logged an ERROR naming a refusal that never happened."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1), a_due_pupil(2), a_due_pupil(3))
            with pymongo.timeout(SHORT_DEADLINE_S):
                answer = await run(database, client, saison_spieler_collection=StallsOnePupil(database[Collection.SAISON_SPIELER], numbered(2)))
            standing = await database[Collection.SPIELER].distinct("_id", {"email": {"$type": "string"}})
            # The next pass, unstalled: the cut left nothing behind that keeps either of them.
            await run(database, client)

            return counts(answer), standing, await database[Collection.SPIELER].distinct("_id", {"email": {"$type": "string"}})

        with caplog.at_level(logging.WARNING):
            answer, standing, after_the_next_pass = await on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["failed"]) == (1, 0)
        assert standing == [numbered(2), numbered(3)]
        assert after_the_next_pass == []
        lines = [
            (record.levelname, record.getMessage(), getattr(record, "row_id", None), getattr(record, "unanswered", None))
            for record in caplog.records
            if getattr(record, "error_code", None) in {Code.DATABASE_FAILED, Code.UNKNOWN_OUTCOME}
        ]
        assert lines == [("WARNING", "transactions.pass_cut", str(numbered(2)), False)]


class TestNoJournalLine:
    async def test_the_run_writes_none(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Repeating it by hand after a restore would erase the whole address, where the rule deletes the pupil again on its own."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await seeded(database, a_due_pupil(1))

            return (await run(database, client)).spieler

        with caplog.at_level(logging.INFO):
            erased_count = await on_a_league(mongo_replica_set_url, body)

        assert erased_count == 1
        assert "journal.act" not in [record.getMessage() for record in caplog.records]
