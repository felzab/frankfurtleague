"""
API · the address change's clock, a referee's or a pupil's, against the shipped validators

A pending change whose step lapsed goes within the hour, as an administrator's discard takes it, and a confirmed change
whose waiting time ended takes effect, judged again. The share's sizing is `tests/api/test_schiedsrichter_sweep_refusal.py`'s.
"""

import re
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pymongo
import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.schiedsrichter.schemas import FLAdresswechselSweepParams
from app.api.schiedsrichter.services import ADRESSWECHSEL_FELD, build_ghost_schiedsrichter
from app.api.schiedsrichter.sweep_router import ADRESSWECHSEL_PER_PASS, sweep_adresswechsel
from app.api.spieler.services import SPIELER_ADRESSWECHSEL_FELD, build_ghost_spieler
from app.core.collections import Collection
from app.core.crud import patch_one_in_db
from app.core.exception_handlers import DATABASE_FAILED, UNHANDLED_CRASH, UNKNOWN_OUTCOME
from app.shared.schemas.bounds import ADRESSWECHSEL_WARTEZEIT_TAGE
from tests import documents
from tests.bans import ban_list
from tests.config import build_test_config
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import saison_document, schiedsrichter_document, spieler_document
from tests.records import record_collections
from tests.whole_database import where_held
from tests.wire import commands_by_name, commands_sent
from tests.worker import worker_database

from .test_schiedsrichter_sweep_refusal import COMMANDS_A_DUE_PERSON, COMMANDS_A_PUPIL, COMMANDS_A_REFEREE, OTHER_COMMANDS

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_schiedsrichter_sweep_test")

# Minted at noon on these days, the link lapsed at noon today, half an hour before `NOW`, and lapses tomorrow.
MINTED_TO_LAPSE_YESTERDAY = "2026-04-15"
MINTED_TO_LAPSE_TODAY = "2026-04-16"
NOW = datetime(2026, 4, 16, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Confirmed this long ago, a change waiting is due by `NOW` or still waits.
CONFIRMED_TO_BE_DUE = NOW - timedelta(days=ADRESSWECHSEL_WARTEZEIT_TAGE, minutes=1)
CONFIRMED_TO_WAIT = NOW - timedelta(days=ADRESSWECHSEL_WARTEZEIT_TAGE) + timedelta(minutes=1)
# Written out rather than computed from `log_stamp`, which would agree with any conversion of `NOW`.
REDACTED_AT = "2026-04-16T10:30:00+00:00"


def numbered(position: int) -> ObjectId:
    """One id sequence for both collections, so a case interleaves referees and pupils in the one `_id` order the pass keeps."""

    return ObjectId(f"6890a1b2c3d4e5f607e2{position:04d}")


def on_file(position: int) -> str:
    return f"person.{position}@beispielschule.de"


def pending(position: int) -> str:
    return f"neue.adresse.{position}@anderswo.example.org"


def a_referee(position: int, *, minted: str | None, **fields: Any) -> dict[str, Any]:
    """A referee who confirmed their own record, holding a pending address minted on `minted` where one is given."""

    wechsel = (
        {}
        if minted is None
        else {ADRESSWECHSEL_FELD: documents.adresswechsel_document(email=pending(position), token_hash=hash_token(f"t{position}"), day=minted)}
    )

    return schiedsrichter_document(
        numbered(position),
        email=on_file(position),
        name=f"Schiedsrichter {position}",
        default_payment=20,
        einwilligung=documents.eigene_einwilligung_document(text_version="v1", bestaetigt_am="2026-03-01"),
        **wechsel,
        **fields,
    )


def a_pupil(position: int, *, minted: str, **fields: Any) -> dict[str, Any]:
    """A pupil holding a pending address minted on `minted`."""

    return spieler_document(
        numbered(position),
        "Quintessa",
        f"Muster {position}",
        email=on_file(position),
        **{
            SPIELER_ADRESSWECHSEL_FELD: documents.adresswechsel_document(
                email=pending(position), token_hash=hash_token(f"t{position}"), day=minted
            )
        },
        **fields,
    )


def confirmed_on(row: dict[str, Any], bestaetigt_am: datetime) -> dict[str, Any]:
    """`row`'s change started with a reason and confirmed at `bestaetigt_am`, as the new mailbox's press leaves it."""

    feld = ADRESSWECHSEL_FELD if "kontakt" in row else SPIELER_ADRESSWECHSEL_FELD
    waiting = {
        **row[feld],
        "weg": "wartezeit",
        "token_hash": None,
        "gueltig_bis": None,
        "grund": "Postfach gelöscht, telefonisch bestätigt",
        "bestaetigt_am": bestaetigt_am,
        "wirksam_ab": bestaetigt_am + timedelta(days=ADRESSWECHSEL_WARTEZEIT_TAGE),
    }

    return {**row, feld: waiting}


async def with_history(database: AsyncDatabase, *rows: dict[str, Any]) -> None:
    """Each row stored, then edited once, so the log holds an image of the block as it stood."""

    for row in rows:
        # A referee's address sits under `kontakt`, a pupil's at the top.
        collection = database[Collection.SCHIEDSRICHTER if "kontakt" in row else Collection.SPIELER]
        await collection.insert_one(row)
        await patch_one_in_db(
            collection=collection,
            db_filter={"_id": row["_id"]},
            update={"$set": {"schule": "Lindenschule"} if "kontakt" in row else {"geburtsdatum": "2010-04-04"}},
            return_document=ReturnDocument.BEFORE,
        )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(saison_document("2026", "active"))
            await database[Collection.SCHIEDSRICHTER].insert_one(build_ghost_schiedsrichter())
            await database[Collection.SPIELER].insert_one(build_ghost_spieler())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, *, nach: Any = None, **replaced: Any) -> Any:
    return await sweep_adresswechsel(
        params=FLAdresswechselSweepParams(nach=nach),
        records=record_collections(database, **replaced),
        spieler_collection=replaced.get("spieler_collection", database[Collection.SPIELER]),
        schiedsrichter_collection=replaced.get("schiedsrichter_collection", database[Collection.SCHIEDSRICHTER]),
        saison_teams_collection=replaced.get("saison_teams_collection", database[Collection.SAISON_TEAMS]),
        bewerbungen_collection=replaced.get("bewerbungen_collection", database[Collection.BEWERBUNGEN]),
        registrierungen_collection=replaced.get("registrierungen_collection", database[Collection.REGISTRIERUNGEN]),
        sperrliste=ban_list(database),
        aktionen_collection=database[Collection.AKTIONEN],
        adressanker_collection=database[Collection.ADRESSANKER],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        db=client,
        config=build_test_config(),
        germany_now=NOW,
    )


# More calls than any pass a case seeds can take: a pass that never ends stops here, and the case says so.
CALLS_A_PASS = 5


async def a_pass(database: AsyncDatabase, client: AsyncMongoClient) -> list[Any]:
    """Calls handing each the `nach` the last answered, until one answers null, as the hourly pass loops."""

    answers = [await sweep(database, client)]
    while answers[-1].nach is not None:
        assert len(answers) < CALLS_A_PASS, f"the pass did not end in {CALLS_A_PASS} calls: {[answer.nach for answer in answers]}"
        answers.append(await sweep(database, client, nach=answers[-1].nach))

    return answers


async def images_of(database: AsyncDatabase, collection: Collection, document_id: ObjectId) -> list[Mapping[str, Any]]:
    return (
        await database[Collection.AKTIONEN]
        .find({"collection": str(collection), "document_id": document_id, "before": {"$ne": None}})
        .to_list(None)
    )


def stored_before_its_validator(collection: Collection, row: Mapping[str, Any]) -> dict[str, Any]:
    """A log image stored before its validator required `trace_id`, which refuses the redaction's update."""

    return {
        "at": "2026-04-01T00:00:00+00:00",
        "actor": {"kind": "system", "email": "SYSTEM"},
        "request": None,
        "collection": str(collection),
        "operation": "patch_one",
        "document_id": row["_id"],
        "db_filter": None,
        "before": dict(row),
        "modified_count": None,
        "redacted_at": None,
    }


class TestALapsedAddressGoesOnceItsDeadlinePassed:
    def test_the_referees_block_and_its_address_in_the_images_go_and_the_rest_stands(self, mongo_replica_set_url: str):
        """A bystander's pending address, still running, keeps its block and its images whole."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await with_history(database, a_referee(1, minted=MINTED_TO_LAPSE_YESTERDAY), a_referee(2, minted=MINTED_TO_LAPSE_TODAY))
            answer = await sweep(database, client)

            return (
                answer,
                await database[Collection.SCHIEDSRICHTER].find_one({"_id": numbered(1)}),
                await images_of(database, Collection.SCHIEDSRICHTER, numbered(1)),
                await images_of(database, Collection.SCHIEDSRICHTER, numbered(2)),
                await where_held(database, pending(1), pending(2), on_file(1)),
            )

        answer, row, lapsed_images, bystander_images, held = on_a_league(mongo_replica_set_url, body)

        assert (answer.entfernt, answer.verbleibend, answer.nach) == (1, 0, None)
        assert ADRESSWECHSEL_FELD not in row
        assert row["kontakt"]["email"] == on_file(1)
        held_the_block = [image for image in lapsed_images if ADRESSWECHSEL_FELD in image["before"]]
        assert held_the_block, "no image held the block, so the redaction proves nothing"
        assert [(image["before"][ADRESSWECHSEL_FELD], image["redacted_at"]) for image in held_the_block] == [(None, REDACTED_AT)] * len(
            held_the_block
        )
        assert {image["before"]["kontakt"]["email"] for image in held_the_block} == {on_file(1)}
        assert [(image["before"][ADRESSWECHSEL_FELD]["email"], image["redacted_at"]) for image in bystander_images] == [(pending(2), None)]
        assert held == {pending(1): [], pending(2): ["aktionen", "schiedsrichter"], on_file(1): ["aktionen", "schiedsrichter"]}

    def test_the_pupils_block_goes_past_its_deadline_and_stands_before_it(self, mongo_replica_set_url: str):
        """Judged on the instant, as its confirmation refuses: a link still opening keeps its change."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await with_history(database, a_pupil(1, minted=MINTED_TO_LAPSE_YESTERDAY), a_pupil(2, minted=MINTED_TO_LAPSE_TODAY))
            answer = await sweep(database, client)

            return (
                answer,
                await database[Collection.SPIELER].find_one({"_id": numbered(1)}),
                await images_of(database, Collection.SPIELER, numbered(1)),
                await images_of(database, Collection.SPIELER, numbered(2)),
                await where_held(database, pending(1), pending(2), on_file(1)),
            )

        answer, row, lapsed_images, bystander_images, held = on_a_league(mongo_replica_set_url, body)

        assert (answer.entfernt, answer.verbleibend, answer.nach) == (1, 0, None)
        assert SPIELER_ADRESSWECHSEL_FELD not in row
        assert row["email"] == on_file(1)
        held_the_block = [image for image in lapsed_images if SPIELER_ADRESSWECHSEL_FELD in image["before"]]
        assert held_the_block, "no image held the block, so the redaction proves nothing"
        assert [(image["before"][SPIELER_ADRESSWECHSEL_FELD], image["redacted_at"]) for image in held_the_block] == [(None, REDACTED_AT)] * len(
            held_the_block
        )
        assert {image["before"]["email"] for image in held_the_block} == {on_file(1)}
        assert [(image["before"][SPIELER_ADRESSWECHSEL_FELD]["email"], image["redacted_at"]) for image in bystander_images] == [
            (pending(2), None)
        ]
        assert held == {pending(1): [], pending(2): ["aktionen", "spieler"], on_file(1): ["aktionen", "spieler"]}

    def test_a_retired_referees_and_a_retired_pupils_lapsed_address_go_too(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await with_history(
                database,
                a_referee(1, minted=MINTED_TO_LAPSE_YESTERDAY, inactive_since="2026-02-01"),
                a_pupil(2, minted=MINTED_TO_LAPSE_YESTERDAY, inactive_since="2026-02-01"),
            )
            answer = await sweep(database, client)

            return (
                answer.entfernt,
                await database[Collection.SCHIEDSRICHTER].find_one({"_id": numbered(1)}),
                await database[Collection.SPIELER].find_one({"_id": numbered(2)}),
            )

        removed, referee, pupil = on_a_league(mongo_replica_set_url, body)

        assert removed == 2
        assert ADRESSWECHSEL_FELD not in referee and SPIELER_ADRESSWECHSEL_FELD not in pupil
        assert (referee["inactive_since"], pupil["inactive_since"]) == ("2026-02-01", "2026-02-01")

    def test_neither_sentinel_is_read(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answer = await sweep(database, client)

            return (
                (answer.entfernt, answer.verbleibend),
                await database[Collection.SCHIEDSRICHTER].find_one({"_id": build_ghost_schiedsrichter()["_id"]}),
                await database[Collection.SPIELER].find_one({"_id": build_ghost_spieler()["_id"]}),
            )

        counts, referee_ghost, pupil_ghost = on_a_league(mongo_replica_set_url, body)

        assert counts == (0, 0)
        assert (referee_ghost, pupil_ghost) == (build_ghost_schiedsrichter(), build_ghost_spieler())


class TestADueChangeTakesEffect:
    """A change an administrator started with a reason moves its person once the waiting time ended, judged again then."""

    def test_the_due_change_moves_the_record_and_names_whom_to_notify(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await with_history(
                database,
                confirmed_on(a_referee(1, minted=MINTED_TO_LAPSE_YESTERDAY), CONFIRMED_TO_BE_DUE),
                confirmed_on(a_pupil(2, minted=MINTED_TO_LAPSE_YESTERDAY), CONFIRMED_TO_WAIT),
            )
            answer = await sweep(database, client)

            return (
                answer,
                await database[Collection.SCHIEDSRICHTER].find_one({"_id": numbered(1)}),
                await database[Collection.SPIELER].find_one({"_id": numbered(2)}),
            )

        answer, referee, waiting = on_a_league(mongo_replica_set_url, body)

        assert (answer.entfernt, answer.verworfen, answer.verbleibend, answer.nach) == (0, 0, 0, None)
        assert [(entry.bisherige_email, entry.vorname) for entry in answer.wirksam] == [(on_file(1), "Schiedsrichter")]
        assert (referee["kontakt"]["email"], ADRESSWECHSEL_FELD in referee) == (pending(1), False)
        # The change still in its waiting time stands, untouched.
        assert (waiting["email"], waiting[SPIELER_ADRESSWECHSEL_FELD]["email"]) == (on_file(2), pending(2))

    def test_a_ban_on_either_address_refuses_it_and_removes_the_change(self, mongo_replica_set_url: str):
        """The confirmation's own judgement at the end of the wait: a barred person moves no record off the address the ban keys on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await with_history(
                database,
                confirmed_on(a_pupil(1, minted=MINTED_TO_LAPSE_YESTERDAY), CONFIRMED_TO_BE_DUE),
                confirmed_on(a_pupil(2, minted=MINTED_TO_LAPSE_YESTERDAY), CONFIRMED_TO_BE_DUE),
            )
            await database[Collection.SPERRLISTE].insert_many(
                [documents.ban_document(on_file(1), bis="2026"), documents.ban_document(pending(2), bis="2026")]
            )
            answer = await sweep(database, client)

            return (
                answer,
                [await database[Collection.SPIELER].find_one({"_id": numbered(position)}) for position in (1, 2)],
                await where_held(database, pending(1), pending(2)),
            )

        answer, pupils, held = on_a_league(mongo_replica_set_url, body)

        assert (answer.verworfen, answer.wirksam, answer.verbleibend) == (2, [], 0)
        assert [(pupil["email"], SPIELER_ADRESSWECHSEL_FELD in pupil) for pupil in pupils] == [(on_file(1), False), (on_file(2), False)]
        assert held == {pending(1): [], pending(2): []}


class WrittenAfterTheRead:
    """A collection writing `rival` once the call's page read has answered and before any row's own transaction."""

    def __init__(self, collection: Any, rival: Callable[[], Awaitable[Any]]) -> None:
        self._collection = collection
        self._rival: Callable[[], Awaitable[Any]] | None = rival

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        # The page read is the one read outside a session; every row's own reads carry theirs.
        if self._rival is not None and kwargs.get("session") is None:
            rival, self._rival = self._rival, None
            await rival()

        return cursor


class TestEachChangeIsJudgedAgainInItsOwnTransaction:
    @pytest.mark.parametrize(
        ("collection", "feld", "row"),
        [
            pytest.param(Collection.SCHIEDSRICHTER, ADRESSWECHSEL_FELD, a_referee, id="a referee's"),
            pytest.param(Collection.SPIELER, SPIELER_ADRESSWECHSEL_FELD, a_pupil, id="a pupil's"),
        ],
    )
    def test_a_link_sent_again_after_the_read_keeps_its_block(
        self, mongo_replica_set_url: str, collection: Collection, feld: str, row: Callable[..., dict[str, Any]]
    ):
        """Remove the change by its pending filter rather than its lapsed one and this fails: the fresh link and its address go."""

        fresh = documents.adresswechsel_document(email=pending(1), token_hash=hash_token("fresh"), day=MINTED_TO_LAPSE_TODAY)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[collection].insert_one(row(1, minted=MINTED_TO_LAPSE_YESTERDAY))

            async def send_it_again() -> None:
                await database[collection].update_one({"_id": numbered(1)}, {"$set": {feld: fresh}})

            # The page is read from the referees' collection, the pupils' joined into it.
            answer = await sweep(
                database, client, schiedsrichter_collection=WrittenAfterTheRead(database[Collection.SCHIEDSRICHTER], send_it_again)
            )

            return (answer.entfernt, answer.verbleibend), await database[collection].find_one({"_id": numbered(1)})

        counts, kept = on_a_league(mongo_replica_set_url, body)

        assert counts == (0, 0)
        assert kept is not None and kept[feld]["token_hash"] == fresh["token_hash"]


class TestEachCallTakesAShare:
    def test_a_share_and_one_more_across_both_take_a_pass_of_two_calls(self, mongo_replica_set_url: str):
        """Referees and pupils in alternation, the shipped share seeded one over: ignore it and the first call takes every one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            for position in range(ADRESSWECHSEL_PER_PASS + 1):
                row = (a_referee if position % 2 else a_pupil)(position, minted=MINTED_TO_LAPSE_YESTERDAY)
                await database[Collection.SCHIEDSRICHTER if position % 2 else Collection.SPIELER].insert_one(row)
            answers = await a_pass(database, client)
            later = await sweep(database, client)

            return [(answer.entfernt, answer.verbleibend, answer.nach) for answer in answers], (later.entfernt, later.verbleibend, later.nach)

        answers, later = on_a_league(mongo_replica_set_url, body)

        assert answers == [(ADRESSWECHSEL_PER_PASS, 1, numbered(ADRESSWECHSEL_PER_PASS - 1)), (1, 0, None)]
        assert later == (0, 0, None)


class NotTheDatabases(Exception):
    """A failure no driver raises, standing for every class a row's removal can meet outside the database."""


class RaisesOnOneRow:
    """A collection whose in-session read of one row raises `NotTheDatabases`."""

    def __init__(self, collection: Any, failing: str) -> None:
        self._collection = collection
        self._failing = failing

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def find_one(self, filter: Mapping[str, Any], *args: Any, **kwargs: Any) -> Any:
        if self._failing in str(filter) and kwargs.get("session") is not None:
            raise NotTheDatabases("synthetic")

        return await self._collection.find_one(filter, *args, **kwargs)


class TestOneRecordHoldsBackNoOther:
    def test_a_failure_not_the_databases_is_passed_over_and_the_next_goes(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catch the database's failures alone and the call fails, the second address standing and the next pass stopping at the first again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].insert_many(
                [a_referee(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in (1, 2)]
            )
            answer = await sweep(
                database, client, schiedsrichter_collection=RaisesOnOneRow(database[Collection.SCHIEDSRICHTER], str(numbered(1)))
            )

            return (answer.entfernt, answer.verbleibend, answer.nach), await database[Collection.SCHIEDSRICHTER].distinct(
                "_id", {ADRESSWECHSEL_FELD: {"$type": "object"}}
            )

        with caplog.at_level("ERROR"):
            counts, still_pending = on_a_league(mongo_replica_set_url, body)

        assert counts == (1, 1, None)
        assert still_pending == [numbered(1)]
        failures = [
            (record.levelname, record.getMessage()) for record in caplog.records if getattr(record, "error_code", None) == UNHANDLED_CRASH
        ]
        # Located by the frame that raised it, and never by its message, which can quote a value.
        [(level, line)] = failures
        removed = rf"The lapsed address change of referee {numbered(1)} saw no removal: NotTheDatabases in find_one at .+\.py:\d+"
        assert (level, re.fullmatch(removed, line) is not None) == ("ERROR", True), line

    def test_a_refused_removal_is_passed_over_and_the_next_goes(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A log image stored before its validator required `trace_id` refuses the redaction's update. Remove the catch and the call fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first, second = a_referee(1, minted=MINTED_TO_LAPSE_YESTERDAY), a_referee(2, minted=MINTED_TO_LAPSE_YESTERDAY)
            await database[Collection.SCHIEDSRICHTER].insert_many([first, second])
            await database[Collection.AKTIONEN].insert_one(
                stored_before_its_validator(Collection.SCHIEDSRICHTER, first), bypass_document_validation=True
            )
            answer = await sweep(database, client)

            return (answer.entfernt, answer.verbleibend), await database[Collection.SCHIEDSRICHTER].distinct(
                "_id", {ADRESSWECHSEL_FELD: {"$type": "object"}}
            )

        with caplog.at_level("ERROR"):
            counts, still_pending = on_a_league(mongo_replica_set_url, body)

        assert counts == (1, 1)
        assert still_pending == [numbered(1)]
        failures = [record.getMessage() for record in caplog.records if getattr(record, "error_code", None) == DATABASE_FAILED]
        assert [str(numbered(1)) in message and pending(1) not in message for message in failures] == [True]

    def test_a_share_of_failing_changes_holds_back_none_behind_it_in_the_pass(self, mongo_replica_set_url: str):
        """A whole share of referees whose removal the database refuses, and one ordinary pupil after them.

        Restart each call at the lowest id and the same share fails every call, the pupil's address never reached.
        """

        failing = range(ADRESSWECHSEL_PER_PASS)
        last = ADRESSWECHSEL_PER_PASS

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            referees = [a_referee(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in failing]
            await database[Collection.SCHIEDSRICHTER].insert_many(referees)
            await database[Collection.AKTIONEN].insert_many(
                [stored_before_its_validator(Collection.SCHIEDSRICHTER, referee) for referee in referees], bypass_document_validation=True
            )
            await database[Collection.SPIELER].insert_one(a_pupil(last, minted=MINTED_TO_LAPSE_YESTERDAY))
            answers = await a_pass(database, client)

            return [answer.entfernt for answer in answers], await database[Collection.SPIELER].find_one({"_id": numbered(last)})

        removed, pupil = on_a_league(mongo_replica_set_url, body)

        assert removed == [0, 1]
        assert pupil is not None and SPIELER_ADRESSWECHSEL_FELD not in pupil


# Server-side, so the database itself stops answering and only the deadline's `maxTimeMS` stops it.
STALL = "sleep(60000) || true"
# Long enough that the row before the stall is removed inside it on a loaded machine.
SHORT_DEADLINE_S = 1.5


class StallsOneRow:
    """A collection whose in-session read of one row sleeps on the server, past the deadline the call runs under."""

    def __init__(self, collection: Any, stalled: str) -> None:
        self._collection = collection
        self._stalled = stalled

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def find_one(self, filter: Mapping[str, Any], *args: Any, **kwargs: Any) -> Any:
        if self._stalled in str(filter) and kwargs.get("session") is not None:
            filter = {**filter, "$where": STALL}

        return await self._collection.find_one(filter, *args, **kwargs)


class TestTheDeadlineStopsTheCall:
    def test_it_warns_once_and_the_rest_stay_due(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Fail each row past the deadline instead and every later one is logged an ERROR naming a refusal that never happened."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].insert_many(
                [a_referee(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in (1, 2, 3)]
            )
            with pymongo.timeout(SHORT_DEADLINE_S):
                answer = await sweep(
                    database, client, schiedsrichter_collection=StallsOneRow(database[Collection.SCHIEDSRICHTER], str(numbered(2)))
                )

            return (answer.entfernt, answer.verbleibend, answer.nach), await database[Collection.SCHIEDSRICHTER].distinct(
                "_id", {ADRESSWECHSEL_FELD: {"$type": "object"}}
            )

        with caplog.at_level("WARNING"):
            counts, still_pending = on_a_league(mongo_replica_set_url, body)

        assert counts == (1, 2, numbered(2))
        assert still_pending == [numbered(2), numbered(3)]
        lines = [
            (record.levelname, record.getMessage())
            for record in caplog.records
            if getattr(record, "error_code", None) in {DATABASE_FAILED, UNKNOWN_OUTCOME}
        ]
        assert lines == [
            (
                "WARNING",
                f"Database deadline passed at the lapsed address change of referee {numbered(2)}: the call stops, and the rest stay due",
            )
        ]


FEW = ADRESSWECHSEL_PER_PASS // 2


class TestOneRowCostsTheCommandsItsShareIsSizedAt:
    @pytest.mark.parametrize(
        ("row", "commands"),
        [pytest.param(a_referee, COMMANDS_A_REFEREE, id="a referee"), pytest.param(a_pupil, COMMANDS_A_PUPIL, id="a pupil")],
    )
    def test_counted_on_the_wire(self, mongo_replica_set_url: str, row: Callable[..., dict[str, Any]], commands: int):
        """`AFTER` at the call site, or a write more a row, turns this red."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                await database[Collection.SCHIEDSRICHTER].delete_many({"_id": {"$ne": build_ghost_schiedsrichter()["_id"]}})
                await database[Collection.SPIELER].delete_many({"_id": {"$ne": build_ghost_spieler()["_id"]}})
                await database[Collection.AKTIONEN].delete_many({})
                await with_history(database, *(row(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in range(due)))

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, sweep)

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert (twice - few) / FEW == commands


class TestADueChangeCostsTheCommandsItsShareIsSizedAt:
    def test_a_person_holding_a_pupil_row_and_a_confirmed_referee_row_counted_on_the_wire(self, mongo_replica_set_url: str):
        """The dearer row a share mixes: a due change moving a pupil row and the confirmed referee row beside it.

        A command added to the effect turns this red, so the share is judged against the deadline again.
        """

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Any, float]:
            async def counted(due: int) -> tuple[Any, Counter[str]]:
                await database[Collection.SCHIEDSRICHTER].delete_many({"_id": {"$ne": build_ghost_schiedsrichter()["_id"]}})
                await database[Collection.SPIELER].delete_many({"_id": {"$ne": build_ghost_spieler()["_id"]}})
                await database[Collection.AKTIONEN].delete_many({})
                for position in range(due):
                    await with_history(
                        database,
                        confirmed_on(a_pupil(2 * position, minted=MINTED_TO_LAPSE_YESTERDAY), CONFIRMED_TO_BE_DUE),
                        # The same person refereeing under the same address, as the runbook's „a referee is a pupil“ holds.
                        a_referee(2 * position + 1, minted=None, kontakt={"telefon": None, "email": on_file(2 * position)}),
                    )

                return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, sweep)

            # One call first, so the running season the ban list asks is cached for both counted ones alike.
            await counted(1)
            (_, few), (answer, twice) = await counted(FEW), await counted(2 * FEW)

            return answer, (twice.total() - few.total()) / FEW

        answer, per_person = on_a_league(mongo_replica_set_url, body)

        assert len(answer.wirksam) == 2 * FEW
        assert per_person == COMMANDS_A_DUE_PERSON


class TestTheWorstCallSendsTheCommandsItsBudgetCounts:
    def test_a_full_share(self, mongo_replica_set_url: str):
        """`tests/api/test_schiedsrichter_sweep_refusal.py`'s budget: a share and one more lapsed, pupils and referees in alternation.

        A command added to the call turns this red, so the share is judged against the deadline again.
        """

        rows = [
            (a_referee if position % 2 else a_pupil)(position, minted=MINTED_TO_LAPSE_YESTERDAY)
            for position in range(ADRESSWECHSEL_PER_PASS + 1)
        ]
        taken = rows[:ADRESSWECHSEL_PER_PASS]
        referees = sum(1 for row in taken if "kontakt" in row)

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await with_history(database, *rows)

            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, sweep)

        answer, names = on_a_league(mongo_replica_set_url, body)
        per_row = referees * COMMANDS_A_REFEREE + (len(taken) - referees) * COMMANDS_A_PUPIL

        assert answer.entfernt == ADRESSWECHSEL_PER_PASS
        assert names.total() - per_row == OTHER_COMMANDS, names
