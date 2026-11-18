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
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any, Final

import pymongo
import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identity.crud import erasure_due_page, saison_statuses
from app.api.identity.system_router import ERASURES_PER_PASS
from app.api.saisons.admin_router import activate_saison
from app.core.codes import Code
from app.core.collections import Collection
from app.core.logging import JSONFormatter
from tests.acts import deletions_of
from tests.app_client import app_client, app_under_test
from tests.config import SYSTEM_AUTH
from tests.database import a_clean_database
from tests.documents import (
    aufstellung_document,
    kontakte_document,
    kontaktperson_document,
    saison_team_document,
    schiedsrichter_document,
    spiel_document,
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
from tests.whole_database import where_held
from tests.wire import commands_by_name
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_erasure_sweep_test")
PATH = "/api/identity/erasure/sweep"

TODAY = "2026-04-01"

JUST_ENDED = "2025"


def a_line_up_naming(position: int) -> dict[Collection, list[dict[str, Any]]]:
    """A line-up naming that due pupil on a match of an ended season, which kicked off: its entry stands naming nobody."""

    spiel = spiel_document(
        spiel_id=numbered(8000 + position), saison_id="2024", spiel_nr=position + 1, spieltag_id=ObjectId(), date="2024-05-04", time="10:00:00"
    )

    return {Collection.SPIELE: [spiel], Collection.AUFSTELLUNGEN: [aufstellung_document(spiel, TEAM_OID, starters=[numbered(position)])]}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(url: str, body: Body, *, saisons: Mapping[str, str] = LEAGUE, mutates_schema: bool = False) -> Any:
    """The shipped indexes, the seasons and one team."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
        await the_league(database, saisons=saisons)

        return await body(database, client)


# More calls than any pass a case seeds can take: a pass that never ends stops here, and the case says so.
CALLS_A_PASS = 5


async def a_pass(database: AsyncDatabase, client: AsyncMongoClient, **replaced: Any) -> list[Any]:
    """Calls handing each the `after` the last answered, until one answers null, as the press and the hourly pass loop."""

    answers = [await run(database, client, **replaced)]
    while answers[-1].after is not None:
        assert len(answers) < CALLS_A_PASS, f"the pass did not end in {CALLS_A_PASS} calls: {[answer.after for answer in answers]}"
        answers.append(await run(database, client, after=answers[-1].after, **replaced))

    return answers


# A schema no seeded report meets, so any write to one is refused and a pupil no report names passes.
NO_REPORT_WRITTEN: Final = {"required": ["a_field_no_report_holds"]}


async def refuse_writes_breaking(database: AsyncDatabase, collection: Collection, schema: Mapping[str, Any]) -> None:
    """How this suite forces one row's write to fail mid-pass: a `$jsonSchema` the planted row breaks and every other row keeps."""

    await database.command("collMod", str(collection), validator={"$jsonSchema": dict(schema)}, validationLevel="strict")


def counts(answer: Any) -> dict[str, Any]:
    return answer.model_dump(exclude={"after"})


# Past any population a case seeds, so the read names every due pupil at once.
WHOLE = 1000


async def population(database: AsyncDatabase) -> list[Any]:
    page, _ = await erasure_due_page(
        await saison_statuses(saisons_collection=database[Collection.SAISONS]),
        after=None,
        size=WHOLE,
        spieler_collection=database[Collection.SPIELER],
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
    )

    return [row["_id"] for row in page]


class WrittenAfterThePopulationRead:
    """The pupils' collection, writing `rival` once the run's population read has answered and before any pupil's own transaction."""

    def __init__(self, collection: Any, rival: Callable[[], Awaitable[Any]]) -> None:
        self._collection = collection
        self._rival: Callable[[], Awaitable[Any]] | None = rival

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        # The population read is the one read outside a session; every pupil's own reads carry theirs.
        if self._rival is not None and kwargs.get("session") is None:
            rival, self._rival = self._rival, None
            await rival()

        return cursor


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
            "remaining": 0,
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
            pupils = WrittenAfterThePopulationRead(database[Collection.SPIELER], lambda: rival(database))
            answer = await run(database, client, spieler_collection=pupils)

            return counts(answer), await database[Collection.SPIELER].count_documents({"_id": numbered(1)})

        answer, standing = await on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["skipped"], answer["remaining"], standing) == (0, 1, 0, 1)

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

            answer = await run(database, client, spieler_collection=WrittenAfterThePopulationRead(database[Collection.SPIELER], correct_it))

            return (
                counts(answer),
                await database[Collection.SPIELER].count_documents({"_id": numbered(1)}),
                [row["_id"] for row in await database[Collection.REGISTRIERUNGEN].find().to_list(None)],
            )

        answer, standing, registrations = await on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["registrierungen"], standing) == (1, 1, 0)
        assert registrations == [stranger]


# --- A rival committing INSIDE a pupil's transaction, after its snapshot and before its first write.

# Waited for the rival at most this long: it contends with nothing before the pupil's first write, so
# only a rival that failed or hung waits it out, and the case then says so rather than passing.
RIVAL_BOUND_S = 5.0


class CommittedInsideThePupilsTransaction:
    """The seasons, running `rival` to its commit after a pupil's transaction reads the statuses, its first read.

    Bounded: a rival waiting on a write of the pupil's would never finish, so past `RIVAL_BOUND_S` it is cancelled, and
    `committed` stays false for the case to fail on.
    """

    def __init__(self, collection: Any, rival: Callable[[], Awaitable[Any]]) -> None:
        self._collection = collection
        self._rival: Callable[[], Awaitable[Any]] | None = rival
        self.committed = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        if self._rival is not None and kwargs.get("session") is not None:
            rival, self._rival = self._rival, None
            try:
                async with asyncio.timeout(RIVAL_BOUND_S):
                    await rival()
            except TimeoutError:
                return cursor
            self.committed = True

        return cursor


# Planned below the season just ended, which activation does not refuse, beside a running season whose fixtures are all played.
PLANNED_BELOW = "2023"
BELOW_THE_ENDED = {PLANNED_BELOW: "future", "2024": "active", "2025": "past"}


class TestAnActivationInsideThePupilsTransactionKeepsThem:
    async def test_the_pupil_stands(self, mongo_replica_set_url: str):
        """Remove the planned season's anchor in `erase_if_still_due` and the pupil goes.

        The pupil's only row is in the planned season, which activating it keeps; the transaction read it planned.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(
                database,
                {Collection.SPIELER: [pupil(numbered(1), address_of(1))], Collection.SAISON_SPIELER: [kader_row(numbered(1), PLANNED_BELOW)]},
            )
            # What makes the planned season activatable (`activate_target_undrawn`).
            await database[Collection.SPIELE].insert_one(
                spiel_document(spiel_id=numbered(900), saison_id=PLANNED_BELOW, spiel_nr=1, spieltag_id=numbered(901))
            )

            async def activate() -> Any:
                return await activate_saison(
                    saison_id=PLANNED_BELOW,
                    saisons_collection=database[Collection.SAISONS],
                    spiele_collection=database[Collection.SPIELE],
                    spieltage_collection=database[Collection.SPIELTAGE],
                    ban_list_collection=database[Collection.BAN_LIST],
                    db=client,
                )

            seasons = CommittedInsideThePupilsTransaction(database[Collection.SAISONS], activate)
            answer = await run(database, client, saisons_collection=seasons)

            return seasons.committed, counts(answer), await database[Collection.SPIELER].count_documents({"_id": numbered(1)})

        committed, answer, standing = await on_a_league(mongo_replica_set_url, body, saisons=BELOW_THE_ENDED)

        assert committed, "the activation never committed inside the pupil's transaction, so this case proves nothing"
        assert (answer["spieler"], answer["skipped"], standing) == (0, 1, 1)


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
        assert (answer["spieler"], answer["failed"], answer["remaining"]) == (1, 1, 1)
        assert standing == [numbered(1)]
        failures = [record for record in caplog.records if getattr(record, "error_code", None) == Code.DATABASE_FAILED]
        assert [(getattr(record, "spieler_id", None), "WriteError" in getattr(record, "diagnosis", "")) for record in failures] == [
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

            return counts(answer), answer.after, await database[Collection.SPIELER].distinct("_id", {"email": {"$type": "string"}})

        with caplog.at_level(logging.ERROR):
            answer, after, standing = await on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["failed"], answer["remaining"], after) == (1, 1, 1, None)
        assert standing == [numbered(1)]
        [failure] = [record for record in caplog.records if getattr(record, "error_code", None) == Code.UNHANDLED_CRASH]
        assert (failure.levelname, failure.getMessage(), getattr(failure, "spieler_id", None)) == (
            "ERROR",
            "identity.erasure_failed",
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
            await a_pass(database, client)

            return counts(answer), answer.after, standing, await database[Collection.SPIELER].distinct("_id", {"email": {"$type": "string"}})

        with caplog.at_level(logging.WARNING):
            answer, after, standing, after_the_next_pass = await on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["failed"], answer["remaining"], after) == (1, 0, 2, numbered(2))
        assert standing == [numbered(2), numbered(3)]
        assert after_the_next_pass == []
        lines = [
            (record.levelname, record.getMessage(), getattr(record, "spieler_id", None), getattr(record, "erasure_unanswered", None))
            for record in caplog.records
            if getattr(record, "error_code", None) in {Code.DATABASE_FAILED, Code.UNKNOWN_OUTCOME}
        ]
        assert lines == [("WARNING", "identity.erasure_cut", str(numbered(2)), False)]


class TestEachCallTakesAShare:
    async def test_a_share_and_one_more_take_a_pass_of_two_calls_and_a_later_call_finds_nobody(self, mongo_replica_set_url: str):
        """The shipped share, seeded one over: ignore it and the first call takes everybody and ends the pass."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, *(a_due_pupil(position) for position in range(ERASURES_PER_PASS + 1)))
            answers = await a_pass(database, client)

            return [(answer.spieler, answer.remaining, answer.after) for answer in answers], await run(database, client)

        answers, later = await on_a_league(mongo_replica_set_url, body)

        assert answers == [(ERASURES_PER_PASS, 1, numbered(ERASURES_PER_PASS - 1)), (1, 0, None)]
        assert (later.spieler, later.remaining, later.after) == (0, 0, None)

    async def test_a_share_of_failing_pupils_holds_back_none_behind_it_in_the_pass(self, mongo_replica_set_url: str):
        """A whole share whose erasures the database refuses, and one ordinary pupil after them.

        Restart each call at the lowest id and the same share fails every call, the last pupil never reached.
        """

        failing = range(1, ERASURES_PER_PASS + 1)
        last = ERASURES_PER_PASS + 1

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, *(a_due_pupil(position) for position in [*failing, last]), *map(a_report_naming, failing))
            await refuse_writes_breaking(database, Collection.SPIELBERICHTE, NO_REPORT_WRITTEN)
            answers = await a_pass(database, client)

            return [(answer.spieler, answer.failed) for answer in answers], await database[Collection.SPIELER].count_documents(
                {"_id": numbered(last)}
            )

        answers, standing = await on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert answers == [(0, ERASURES_PER_PASS), (1, 0)]
        assert standing == 0


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


# --- What a call costs on the wire, which the share is sized at.


# The server's first batch for a cursor naming no size: one pending registration more takes the read a `getMore`.
FIRST_BATCH = 101


# One pupil's commands on the wire at their costliest, a report and a played match's line-up naming them: the line-ups'
# read is one of them whether or not a line-up names the pupil, and the entry's emptying one more where one does.
COMMANDS_A_PERSON = 16

# The call's other commands: three aggregates, and a `getMore` once the pending registrations outrun the driver's first
# batch, the page being one document.
OTHER_COMMANDS = 3 + 1


class TestTheWorstCallSendsTheCommandsItsBudgetCounts:
    async def test_a_full_share(self, mongo_replica_set_url: str):
        """A share and one more due, pending registrations past the first batch.

        A command added to the call turns this red, so `ERASURES_PER_PASS` is judged against the deadline again.
        """

        waiting = [
            registration(numbered(6000 + position), f"angemeldet.{position}@beispielschule.example.org") for position in range(FIRST_BATCH + 1)
        ]

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await seeded(
                database,
                *(
                    shape
                    for position in range(ERASURES_PER_PASS + 1)
                    for shape in (a_due_pupil(position), a_report_naming(position), a_line_up_naming(position))
                ),
                {Collection.REGISTRIERUNGEN: waiting},
            )

            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, run)

        answer, names = await on_a_league(mongo_replica_set_url, body)

        # The premise first: a full share erased, and the pending registrations read past the first batch.
        assert (answer.spieler, names["getMore"]) == (ERASURES_PER_PASS, 1), names
        assert names.total() - ERASURES_PER_PASS * COMMANDS_A_PERSON == OTHER_COMMANDS, names
