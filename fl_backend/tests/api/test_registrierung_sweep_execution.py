import asyncio
import functools
import logging
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient, MongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.registrierungen.services import SWEEP_PAGE
from app.api.registrierungen.sweep_router import REMINDERS_PER_PASS, sweep_registrierungen
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db
from app.core.logging import FL_LOGGER_NAME
from app.core.recording import SYSTEM_ACTOR_EMAIL
from app.main import create_app
from tests.api import test_registrierung_sweep_refusal as budget
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, BASE_AUTH, SYSTEM_AUTH, build_test_config
from tests.database import a_clean_database, a_clean_database_sync, on_the_seed_loop
from tests.documents import eigene_einwilligung_document, rules_document, saison_document, team_document
from tests.postausgang import MAIL_NOW
from tests.wire import commands_by_name, commands_sent
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_sweep_test")

SAISON_ID = "2026"
OTHER_SAISON_ID = "2025"
TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
MAILED_ON_THE_MARK = "2026-03-29"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Fixed rather than generated, so a failure names the same row every run.
REMIND_OID = ObjectId("6890a1b2c3d4e5f607970001")
EXPIRED_OID = ObjectId("6890a1b2c3d4e5f607970002")
INSIDE_OID = ObjectId("6890a1b2c3d4e5f607970003")
CONFIRMED_OID = ObjectId("6890a1b2c3d4e5f607970004")
DECLINED_OID = ObjectId("6890a1b2c3d4e5f607970005")
OTHER_SEASON_OID = ObjectId("6890a1b2c3d4e5f607970006")
TEAM_OID = ObjectId("6890a1b2c3d4e5f607970011")
EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f607970021")

TEAM_NAME = "Adler"


def einwilligung(*, bestaetigt_am: str = MAILED_ON_THE_MARK) -> dict[str, Any]:
    stored = eigene_einwilligung_document(text_version="2026-10-spielerseite-5", bestaetigt_am=MAILED_ON_THE_MARK)

    return {**stored, "bestaetigt_am": bestaetigt_am}


def bestaetigung(registrierung_id: ObjectId, *, frist: str = "2026-04-05", **overrides: Any) -> dict[str, Any]:
    return {
        "token_hashes": [hash_token(f"first-{registrierung_id}")],
        "verschickt_am": MAILED_ON_THE_MARK,
        "erinnert_am": None,
        "frist": frist,
        **overrides,
    }


def registrierung(registrierung_id: ObjectId, *, saison_id: str = SAISON_ID, **overrides: Any) -> dict[str, Any]:
    """One submitted registration whose link is due its reminder today, that each row below moves one thing of."""

    return {
        "_id": registrierung_id,
        "saison_id": saison_id,
        "team_id": TEAM_OID,
        "einladung_id": EINLADUNG_OID,
        "eingereicht_am": MAILED_ON_THE_MARK,
        "status": "eingereicht",
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "email": f"{registrierung_id}@example.com",
        "position": None,
        "nummer": None,
        "stufe": "Q1",
        "geburtsdatum": None,
        "einwilligung": None,
        "bestaetigung": bestaetigung(registrierung_id),
        "entscheidung": None,
        **overrides,
    }


def the_corpus() -> list[dict[str, Any]]:
    """One registration per clock, plus one of another season that no call for `SAISON_ID` may touch."""

    return [
        registrierung(REMIND_OID),
        registrierung(EXPIRED_OID, bestaetigung=bestaetigung(EXPIRED_OID, frist=YESTERDAY)),
        # Its deadline is today, which the link still answers: the pair pins the clock's own boundary.
        registrierung(INSIDE_OID, bestaetigung=bestaetigung(INSIDE_OID, frist=TODAY)),
        registrierung(CONFIRMED_OID, geburtsdatum="2008-05-09", einwilligung=einwilligung()),
        registrierung(
            DECLINED_OID,
            status="abgelehnt",
            entscheidung={"getroffen_am": "2026-02-15", "von": "admin", "grund": "kein Platz"},
        ),
        registrierung(OTHER_SEASON_OID, saison_id=OTHER_SAISON_ID, bestaetigung=bestaetigung(OTHER_SEASON_OID, frist=YESTERDAY)),
    ]


def season(saison_id: str, status: str) -> dict[str, Any]:
    return saison_document(saison_id, status, rules=rules_document(number_of_groups=2, teams_per_group=2))


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, status: str = "active", mutates_schema: bool = False) -> Any:
    """The SHIPPED indexes, with a history on every row so the redaction has images to empty.

    `mutates_schema` for a body that installs a validator through `refuse_writes_breaking`.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SAISONS].insert_many([season(SAISON_ID, status), season(OTHER_SAISON_ID, "past")])
            await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, TEAM_NAME, "ADX", website_url=None, schulform="gymnasium_g9"))
            await database[Collection.REGISTRIERUNGEN].insert_many(the_corpus())
            # One recorded write per row, so every one has a log image holding its person.
            for document in the_corpus():
                await patch_one_in_db(
                    collection=database[Collection.REGISTRIERUNGEN],
                    db_filter={"_id": document["_id"]},
                    update={"$set": {"nummer": "7"}},
                    return_document=ReturnDocument.BEFORE,
                )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str = SAISON_ID, today: str = TODAY) -> Any:
    return await sweep_registrierungen(
        saison_id=saison_id,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        aktionen_collection=database[Collection.AKTIONEN],
        postausgang_collection=database[Collection.POSTAUSGANG],
        db=client,
        today=today,
        germany_now=MAIL_NOW,
    )


async def reminded(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    """Every reminder owed, oldest first."""

    return await database[Collection.POSTAUSGANG].find({"art": "registrierung_erinnerung"}).sort("_id", 1).to_list(length=None)


async def reminded_ids(database: AsyncDatabase) -> list[ObjectId]:
    return [row["bezug"]["id"] for row in await reminded(database)]


async def stored(database: AsyncDatabase, registrierung_id: ObjectId) -> Mapping[str, Any] | None:
    return await database[Collection.REGISTRIERUNGEN].find_one({"_id": registrierung_id})


async def standing(database: AsyncDatabase) -> list[ObjectId]:
    rows = await database[Collection.REGISTRIERUNGEN].find({}, {"_id": 1}).sort("_id", 1).to_list(length=None)

    return [row["_id"] for row in rows]


async def log_rows_naming(database: AsyncDatabase, row_id: ObjectId) -> list[Mapping[str, Any]]:
    return await database[Collection.AKTIONEN].find({"collection": str(Collection.REGISTRIERUNGEN), "document_id": row_id}).to_list(length=None)


class TestTheReminderClock:
    def test_it_stamps_and_owes_one_reminder_per_registration(self, mongo_replica_set_url: str):
        """The reminder's link joins the first one rather than replacing it, and the deadline does not move."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await reminded(database), await stored(database, REMIND_OID)

        owed, document = on_a_league(mongo_replica_set_url, body)

        assert document is not None
        mine = [row for row in owed if row["bezug"]["id"] == REMIND_OID]
        assert [(row["an"], row["daten"]["team"], row["link"]["ersetzt"]) for row in mine] == [(f"{REMIND_OID}@example.com", TEAM_NAME, False)]

        bookkeeping = document["bestaetigung"]
        assert bookkeeping["token_hashes"] == [hash_token(f"first-{REMIND_OID}")]
        assert (bookkeeping["erinnert_am"], bookkeeping["verschickt_am"]) == (TODAY, MAILED_ON_THE_MARK)
        assert bookkeeping["frist"] == "2026-04-05"

    def test_the_days_second_pass_reminds_nobody_again(self, mongo_replica_set_url: str):
        """One chase per registration, whatever the mail did after the stamp: the stamp is what spends it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            after_first = sorted(await reminded_ids(database))
            second = await sweep(database, client)

            return first.erinnert, after_first, second.erinnert, len(await reminded(database))

        first, after_first, second, owed = on_a_league(mongo_replica_set_url, body)

        # Both open links at their mark, the one whose deadline is today included: that link still
        # answers, so the chase is owed on it exactly as on a link with days left.
        assert (first, after_first) == (2, sorted([REMIND_OID, INSIDE_OID]))
        assert (second, owed) == (0, 2)

    def test_an_address_the_rule_refuses_is_barred_by_nothing_and_the_pass_goes_on(self, mongo_replica_set_url: str):
        """A stored row may hold an address today's rule refuses, and no ban can be keyed on it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].update_one({"_id": REMIND_OID}, {"$set": {"email": "müller@example.com"}})
            await sweep(database, client)

            return await reminded_ids(database)

        assert REMIND_OID in on_a_league(mongo_replica_set_url, body)


class TestTheDeadlineClock:
    def test_it_erases_the_day_after_the_deadline_and_not_on_it(self, mongo_replica_set_url: str):
        """The two rows part on one day: the link answers on its deadline, so the erasure waits.

        Both carry a null consent record, which is what says the page's consent term reads one.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await standing(database)

        response, left = on_a_league(mongo_replica_set_url, body)

        assert response.geloescht_unbestaetigt == 1
        assert EXPIRED_OID not in left
        assert INSIDE_OID in left

    def test_it_redacts_the_log_rows_that_still_hold_the_person(self, mongo_replica_set_url: str):
        """The erasure's second half: the row survives its subject, emptied."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response.redigierte_aktionen, await log_rows_naming(database, EXPIRED_OID)

        redacted, rows = on_a_league(mongo_replica_set_url, body)

        assert redacted >= 1
        assert rows
        assert all(row.get("redacted_at") is not None for row in rows)

    def test_a_registration_of_another_season_is_untouched(self, mongo_replica_set_url: str):
        """Every removal names this season alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await standing(database)

        assert OTHER_SEASON_OID in on_a_league(mongo_replica_set_url, body)


class TestTheSeasonsOwnEnd:
    def test_it_takes_every_undecided_row_whatever_the_pupil_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await standing(database)

        response, left = on_a_league(mongo_replica_set_url, body, status="past")

        assert response.geloescht_ohne_entscheidung == 4
        # The other season's row alone: the declined one goes to the month clock in the same pass,
        # and every removal here names this season.
        assert left == [OTHER_SEASON_OID]

    def test_nothing_it_took_is_reminded_on_the_way_out(self, mongo_replica_set_url: str):
        """The clock runs AHEAD of the reminder: a link owed for a row this pass erased is one nobody can spend."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (await sweep(database, client)).erinnert, await reminded(database)

        assert on_a_league(mongo_replica_set_url, body, status="past") == (0, [])


class TestTheOneMonthClock:
    def test_it_erases_a_declined_registration_a_month_after_the_decision(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await standing(database)

        response, left = on_a_league(mongo_replica_set_url, body)

        assert response.geloescht_abgelehnt == 1
        assert DECLINED_OID not in left


SECOND_OID = ObjectId("6890a1b2c3d4e5f607970007")


async def refuse_writes_breaking(database: AsyncDatabase, collection: Collection, schema: Mapping[str, Any]) -> None:
    """How this suite forces one row's write to fail mid-pass: a `$jsonSchema` the planted row breaks and every other row keeps."""

    await database.command("collMod", str(collection), validator={"$jsonSchema": dict(schema)}, validationLevel="strict")


def refusing_its_redaction(row: Mapping[str, Any]) -> dict[str, Any]:
    """A log image missing its `trace_id`, so the redaction's update is refused: any row a write is refused on."""

    return {
        "at": "2026-01-01T00:00:00+00:00",
        "at_date": datetime.now(UTC),
        "actor": {"kind": "system", "email": "SYSTEM"},
        "request": None,
        "collection": str(Collection.REGISTRIERUNGEN),
        "operation": "patch_one",
        "document_id": row["_id"],
        "db_filter": None,
        "before": dict(row),
        "modified_count": None,
        "redacted_at": None,
        "anlass": None,
    }


async def refuse_the_redaction_of(database: AsyncDatabase, registrierung_id: ObjectId) -> None:
    row = await stored(database, registrierung_id)
    assert row is not None
    await database[Collection.AKTIONEN].insert_one(refusing_its_redaction(row))
    await refuse_writes_breaking(database, Collection.AKTIONEN, {"required": ["trace_id"]})


# What the planted log image's refusal reads as on a passed-over line: the property the installed validator requires.
REFUSED_TRACE_ID = "WriteError, code 121: [{'loc': 'trace_id', 'type': 'required', 'msg': 'property is missing'}]"


def passed_over(caplog: pytest.LogCaptureFixture) -> list[tuple[Any, ...]]:
    return [
        (
            record.levelname,
            getattr(record, "error_code", None),
            getattr(record, "what", None),
            getattr(record, "row_id", None),
            getattr(record, "clock", None),
            getattr(record, "diagnosis", None),
        )
        for record in caplog.records
        if record.getMessage() == "transactions.row_passed_over"
    ]


class TestOneRowHoldsBackNoOther:
    """One case per write the call makes: with the site's isolation gone the whole call raises, every hour."""

    def test_a_refused_erasure_by_the_decline_clock(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].insert_one(
                registrierung(SECOND_OID, status="abgelehnt", entscheidung={"getroffen_am": "2026-02-15", "von": "admin", "grund": None})
            )
            await refuse_the_redaction_of(database, DECLINED_OID)
            answer = await sweep(database, client)

            return answer, await standing(database), await reminded_ids(database)

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answer, left, chased = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        # The clocks after it ran: the drive at the fork found the deadline's row standing and the call raising every pass.
        assert (answer.geloescht_abgelehnt, answer.geloescht_unbestaetigt, answer.fehlgeschlagen, REMIND_OID in chased) == (1, 1, 1, True)
        assert (DECLINED_OID in left, SECOND_OID in left) == (True, False)
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Registration", str(DECLINED_OID), "decline", f"{REFUSED_TRACE_ID}")]

    def test_a_refused_erasure_at_the_seasons_end(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_redaction_of(database, REMIND_OID)
            answer = await sweep(database, client)

            return answer, await standing(database)

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answer, left = on_a_league(mongo_replica_set_url, body, status="past", mutates_schema=True)

        assert (answer.geloescht_ohne_entscheidung, answer.fehlgeschlagen) == (3, 1)
        assert left == [REMIND_OID, OTHER_SEASON_OID]
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Registration", str(REMIND_OID), "season's end", f"{REFUSED_TRACE_ID}")]

    def test_a_seasons_end_whose_every_erasure_fails_counts_them(self, mongo_replica_set_url: str):
        """No half commits: the count is all that tells this pass from a clean one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].delete_many({"_id": {"$in": [EXPIRED_OID, INSIDE_OID, CONFIRMED_OID]}})
            await refuse_the_redaction_of(database, REMIND_OID)
            answer = await sweep(database, client)

            return answer.geloescht_ohne_entscheidung, answer.fehlgeschlagen

        assert on_a_league(mongo_replica_set_url, body, status="past", mutates_schema=True) == (0, 1)

    def test_a_refused_erasure_by_the_deadline_clock(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].insert_one(
                registrierung(SECOND_OID, bestaetigung=bestaetigung(SECOND_OID, frist=YESTERDAY))
            )
            await refuse_the_redaction_of(database, EXPIRED_OID)
            answer = await sweep(database, client)

            return answer, await standing(database), await reminded_ids(database)

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answer, left, chased = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert (answer.geloescht_unbestaetigt, answer.fehlgeschlagen, REMIND_OID in chased) == (1, 1, True)
        assert (EXPIRED_OID in left, SECOND_OID in left) == (True, False)
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Registration", str(EXPIRED_OID), "deadline", f"{REFUSED_TRACE_ID}")]

    def test_a_refused_reminder_stamp(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A registration short of a field strict validation requires: the stamp's update is refused, and its mail with it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            invalid = {key: value for key, value in registrierung(SECOND_OID).items() if key != "einladung_id"}
            await database[Collection.REGISTRIERUNGEN].insert_one(invalid)
            await refuse_writes_breaking(database, Collection.REGISTRIERUNGEN, {"required": ["einladung_id"]})
            # Inside: the level outside is whatever an earlier test on this worker left.
            with caplog.at_level(logging.INFO, logger=FL_LOGGER_NAME):
                answer = await sweep(database, client)
            refused = await stored(database, SECOND_OID)
            assert refused is not None

            return set(await reminded_ids(database)), answer.fehlgeschlagen, refused["bestaetigung"]["erinnert_am"]

        answered, count, stamp = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert (answered, count, stamp) == ({REMIND_OID, INSIDE_OID}, 1, None)
        refusal = "OperationFailure, code 121: [{'loc': 'einladung_id', 'type': 'required', 'msg': 'property is missing'}]"
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Registration", str(SECOND_OID), "reminder", f"{refusal}")]

    def test_a_pass_whose_every_reminder_fails_counts_them(self, mongo_replica_set_url: str):
        """Every stamp refused, so no half commits: the count is all that tells this pass from a clean one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].update_many({}, {"$unset": {"einladung_id": ""}})
            await refuse_writes_breaking(database, Collection.REGISTRIERUNGEN, {"required": ["einladung_id"]})
            answer = await sweep(database, client)

            return answer.erinnert, await reminded(database), answer.fehlgeschlagen

        # The two registrations at their reminder mark.
        assert on_a_league(mongo_replica_set_url, body, mutates_schema=True) == (0, [], 2)


# A page and a short one after it. At a page plus ONE the first read takes every row, so a clock
# that stopped after one erasure would leave nothing behind and pass.
OVERFLOW = SWEEP_PAGE + 5


def overflowing(**overrides: Any) -> list[dict[str, Any]]:
    """More due rows of one season than one page holds, each an id of its own."""

    return [registrierung(ObjectId(f"6890a1b2c3d4e5f6079{position:05d}"), **overrides) for position in range(OVERFLOW)]


class TestAPageAndOneMoreIsDrainedRatherThanRefused:
    """More due rows than one page, which is the population only the erasure shrinks.

    Seeded as real rows: a page size the endpoint took as an argument would be an API this
    application has only because a test wants one.
    """

    @pytest.mark.parametrize(
        ("clock", "overrides", "status", "counted"),
        [
            pytest.param(
                "deadline", {"bestaetigung": bestaetigung(EXPIRED_OID, frist=YESTERDAY)}, "active", "geloescht_unbestaetigt", id="deadline"
            ),
            pytest.param("season's end", {}, "past", "geloescht_ohne_entscheidung", id="season's end"),
            pytest.param(
                "one month",
                {"status": "abgelehnt", "entscheidung": {"getroffen_am": "2026-02-15", "von": "admin", "grund": None}},
                "active",
                "geloescht_abgelehnt",
                id="one month",
            ),
        ],
    )
    def test_every_due_row_goes_in_one_pass(self, mongo_replica_set_url: str, clock: str, overrides: Any, status: str, counted: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].delete_many({})
            await database[Collection.REGISTRIERUNGEN].insert_many(overflowing(**overrides))
            response = await sweep(database, client)

            return getattr(response, counted), await database[Collection.REGISTRIERUNGEN].count_documents({"saison_id": SAISON_ID})

        erased, left = on_a_league(mongo_replica_set_url, body, status=status)

        assert (erased, left) == (OVERFLOW, 0), f"the {clock} clock left rows the next pass would read into the same full page"


# Under the driver's first batch, so a page read is one command however many rows it holds.
FEW = 10


async def passes_until_empty(one_pass: Callable[[], Awaitable[int]], *, share: int, total: int) -> list[int]:
    """What each pass took, up to the first that took nothing: a clock that stops making progress fails here rather than spinning."""

    passes = -(-total // share)
    taken: list[int] = []
    for _ in range(passes + 1):
        if not (took := await one_pass()):
            return taken
        taken.append(took)

    raise AssertionError(f"{total} rows at {share} a pass take {passes} passes, and pass {passes + 1} still took rows: {taken}")


class TestTheReminderClockTakesAShareEachCall:
    def test_each_pass_stamps_its_share_and_the_passes_reach_every_row(self, mongo_replica_set_url: str):
        """A whole page in one transaction could outrun the request's deadline, and a transaction that times out stamps nothing, every pass."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[int], int, int]:
            await database[Collection.REGISTRIERUNGEN].delete_many({})
            await database[Collection.REGISTRIERUNGEN].insert_many(overflowing())

            async def one_pass() -> int:
                return (await sweep(database, client)).erinnert

            per_pass = await passes_until_empty(one_pass, share=REMINDERS_PER_PASS, total=OVERFLOW)

            return (
                per_pass,
                await database[Collection.REGISTRIERUNGEN].count_documents({"bestaetigung.erinnert_am": TODAY}),
                len(await reminded(database)),
            )

        per_pass, stamped, owed = on_a_league(mongo_replica_set_url, body)
        whole, rest = divmod(OVERFLOW, REMINDERS_PER_PASS)

        assert per_pass == [REMINDERS_PER_PASS] * whole + ([rest] if rest else [])
        assert stamped == owed == OVERFLOW

    def test_the_share_goes_to_the_earliest_deadlines(self, mongo_replica_set_url: str):
        """The later deadlines are seeded FIRST, so natural order would remind the pupils the deadline clock takes last."""

        later = [registrierung(row["_id"], bestaetigung=bestaetigung(row["_id"], frist="2026-04-06")) for row in overflowing()[:5]]
        earlier = overflowing()[5:]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> set[str]:
            await database[Collection.REGISTRIERUNGEN].delete_many({})
            await database[Collection.REGISTRIERUNGEN].insert_many([*later, *earlier])
            await sweep(database, client)
            chased = await reminded_ids(database)

            rows = await database[Collection.REGISTRIERUNGEN].find({"_id": {"$in": chased}}, {"bestaetigung.frist": 1}).to_list(None)
            return {row["bestaetigung"]["frist"] for row in rows}

        assert on_a_league(mongo_replica_set_url, body) == {"2026-04-05"}

    def test_a_reminded_row_costs_the_round_trips_its_share_is_sized_at(self, mongo_replica_set_url: str):
        """Counted on the wire, two passes apart by `FEW` rows: `AFTER` at the call site, or a second write a row, turns this red."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                await database[Collection.REGISTRIERUNGEN].delete_many({})
                await database[Collection.POSTAUSGANG].delete_many({})
                await database[Collection.REGISTRIERUNGEN].insert_many(overflowing()[:due])

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, sweep)

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert (twice - few) / FEW == budget.ROUND_TRIPS_A_ROW

    def test_a_row_the_code_refuses_costs_the_share_no_second_attempt(self, mongo_replica_set_url: str):
        """A share fills the request's deadline, so a refusal taking its transaction apart overruns it before any half commits.

        A share and nine more due, the one at sorted position 31 carrying a send date no judge can read, against the same
        rows all readable.
        """

        due = overflowing()[: REMINDERS_PER_PASS + 9]
        unreadable = {**due[30], "bestaetigung": {**due[30]["bestaetigung"], "verschickt_am": "2026-03-1x"}}
        one_refused = [*due[:30], unreadable, *due[31:]]

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(rows: list[dict[str, Any]]) -> int:
                await database[Collection.REGISTRIERUNGEN].delete_many({})
                await database[Collection.POSTAUSGANG].delete_many({})
                await database[Collection.REGISTRIERUNGEN].insert_many(rows)

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, sweep)

            return await counted(due), await counted(one_refused)

        carryable, with_one_refused = on_a_league(mongo_replica_set_url, body)

        assert with_one_refused == carryable


class TestTheWorstCallSendsTheCommandsItsBudgetCounts:
    def test_the_sweep(self, mongo_replica_set_url: str):
        """`tests/api/test_registrierung_sweep_refusal.py`'s budget: both erasing clocks take a page.

        A command added to the call turns this red, so the share is judged against the deadline again.
        """

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, sweep)

        answer, names = on_a_league(mongo_replica_set_url, body)
        rows = answer.erinnert

        assert (answer.geloescht_abgelehnt, answer.geloescht_unbestaetigt, rows) == (1, 1, 2)
        assert sum(names.values()) - budget.ROUND_TRIPS_A_ROW * rows == budget.OTHER_COMMANDS, names


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(build_test_config())


def through_the_app(url: str, path: str, *, auth: Mapping[str, str]) -> tuple[int, list[Mapping[str, Any]]]:
    """One call over the wire, so the guard, the system binder and the route template all run."""

    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, database_name)
        database[Collection.SAISONS].insert_many([season(SAISON_ID, "active"), season(OTHER_SAISON_ID, "past")])
        database[Collection.REGISTRIERUNGEN].insert_one(registrierung(EXPIRED_OID, bestaetigung=bestaetigung(EXPIRED_OID, frist=YESTERDAY)))

        async def _called() -> int:
            async with app_client(url, app=_served(), now=NOW) as http:
                response = await http.post(f"/api/v{API_VERSION}{path}", json=None, headers=dict(auth))
                return response.status_code

        status = asyncio.run(_called())

        return status, list(database[Collection.AKTIONEN].find({"operation": "erase_many"}))
    finally:
        client.close()


class TestTheSystemTierOverTheWire:
    """On the replica set: the erasure runs in a transaction, which a standalone mongod refuses outright."""

    def test_the_erasure_records_the_system_actor_and_the_route_template(self, mongo_replica_set_url: str):
        """What `bind_system_actor` buys: the row names the machine and the endpoint, not an invented person or a raw path."""

        status, rows = through_the_app(mongo_replica_set_url, f"/registrierungen/sweep/{SAISON_ID}", auth=SYSTEM_AUTH)

        assert status == 200
        assert len(rows) == 1
        assert rows[0]["actor"] == {"kind": "system", "email": SYSTEM_ACTOR_EMAIL}
        assert rows[0]["request"] == {"method": "POST", "path": f"/api/v{API_VERSION}/registrierungen/sweep/{{saison_id}}"}

    @pytest.mark.parametrize("auth", [BASE_AUTH, ADMIN_AUTH], ids=("base", "admin"))
    def test_neither_other_key_reaches_it(self, mongo_replica_set_url: str, auth: Mapping[str, str]):
        """The other two keys are refused as the wrong credential before any body is read, so nothing is erased."""

        status, rows = through_the_app(mongo_replica_set_url, f"/registrierungen/sweep/{SAISON_ID}", auth=auth)

        assert status == 401
        assert rows == []
