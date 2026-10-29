"""
API · the address change's clock against the shipped validators: lapses end, due changes take effect, each judged again

A live change whose step lapsed ends within the hour, and a confirmed change whose waiting time ended takes effect or is
refused, the refused one's new address answered alone. The share's sizing is `tests/api/test_adresswechsel_sweep_refusal.py`'s.
"""

import re
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pymongo
import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.adresswechsel.schemas import FLAdresswechselPostausgangResponse, FLAdresswechselSweepParams, FLAdresswechselZugestelltPayload
from app.api.adresswechsel.services import compose_genehmigung, compose_postausgang, wirksam_ab_von
from app.api.adresswechsel.sweep_router import (
    ADRESSWECHSEL_PER_PASS,
    post_adresswechsel_postausgang,
    post_adresswechsel_zugestellt,
    sweep_adresswechsel,
)
from app.api.berechtigungen.services import BEANSPRUCHUNG_DAUER, VERSUCHE_HOECHSTENS
from app.api.bewerbungen.services import hash_token
from app.api.schiedsrichter.services import build_ghost_schiedsrichter
from app.api.spieler.services import build_ghost_spieler
from app.core.collections import Collection
from app.core.crud import patch_one_in_db
from app.core.exception_handlers import DATABASE_FAILED, UNHANDLED_CRASH, UNKNOWN_OUTCOME
from app.shared.schemas.bounds import ADRESSWECHSEL_WARTEZEIT_TAGE
from tests import documents
from tests.bans import ban_list, ban_through_the_route
from tests.config import build_test_config, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import saison_document, schiedsrichter_document, spieler_document
from tests.records import record_collections
from tests.whole_database import where_held
from tests.wire import commands_by_name, commands_sent
from tests.worker import worker_database

from .adresswechsel_harness import owed
from .test_adresswechsel_sweep_refusal import COMMANDS_A_DUE_PERSON, COMMANDS_A_LAPSE, OTHER_COMMANDS, SEASON_READ

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_adresswechsel_sweep_test")

# Minted at noon on these days, the link lapsed at noon today, half an hour before `NOW`, and lapses tomorrow.
MINTED_TO_LAPSE_YESTERDAY = "2126-04-15"
MINTED_TO_LAPSE_TODAY = "2126-04-16"
# A century ahead of the real clock: the TTL monitor deletes an expired tombstone or day's count at its next pass,
# under a case reading it back. Every seeded day moves with it.
NOW = datetime(2126, 4, 16, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Confirmed this long ago, a change waiting is due by `NOW` or still waits.
CONFIRMED_TO_BE_DUE = NOW - timedelta(days=ADRESSWECHSEL_WARTEZEIT_TAGE, minutes=1)
CONFIRMED_TO_WAIT = NOW - timedelta(days=ADRESSWECHSEL_WARTEZEIT_TAGE) + timedelta(minutes=1)


def numbered(position: int) -> ObjectId:
    """One id sequence for the changes, so a case reads them in the one `_id` order the pass keeps."""

    return ObjectId(f"6890a1b2c3d4e5f607e2{position:04d}")


def on_file(position: int) -> str:
    return f"person.{position}@beispielschule.de"


def pending(position: int) -> str:
    return f"neue.adresse.{position}@anderswo.example.org"


def a_change(position: int, *, minted: str, **fields: Any) -> dict[str, Any]:
    """The change of `on_file(position)` to `pending(position)`, minted on `minted`."""

    return {
        **documents.adresswechsel_document(
            adresse=on_file(position), email=pending(position), token_hash=hash_token(f"t{position}"), day=minted
        ),
        "_id": numbered(position),
        **fields,
    }


def confirmed_on(change: dict[str, Any], bestaetigt_am: datetime) -> dict[str, Any]:
    """`change` started with a reason and confirmed at `bestaetigt_am`, as the new mailbox's press leaves it."""

    return {
        **change,
        "weg": "wartezeit",
        "gueltig_bis": None,
        "grund": "Postfach gelöscht, telefonisch bestätigt",
        "bestaetigt_am": bestaetigt_am,
        "wirksam_ab": wirksam_ab_von(bestaetigt_am),
    }


def a_pupil(position: int) -> dict[str, Any]:
    return spieler_document(ObjectId(), "Quintessa", f"Muster {position}", email=on_file(position))


def a_referee(position: int) -> dict[str, Any]:
    """A referee who confirmed their own record at `on_file(position)`."""

    return schiedsrichter_document(
        ObjectId(),
        email=on_file(position),
        name=f"Schiedsrichter {position}",
        default_payment=20,
        einwilligung=documents.eigene_einwilligung_document(text_version="v1", bestaetigt_am="2126-03-01"),
    )


async def with_history(database: AsyncDatabase, *changes: dict[str, Any]) -> None:
    """Each change stored, then edited once, so the log holds an image of it as it stood."""

    for change in changes:
        await database[Collection.ADRESSWECHSEL].insert_one(change)
        await patch_one_in_db(
            collection=database[Collection.ADRESSWECHSEL],
            db_filter={"_id": change["_id"]},
            update={"$set": {"verschickt_am": change["verschickt_am"]}},
            return_document=ReturnDocument.BEFORE,
        )


async def a_due_person(database: AsyncDatabase, position: int) -> None:
    """A pupil and the referee beside them at one address, and their change due."""

    await database[Collection.SPIELER].insert_one(a_pupil(position))
    await database[Collection.SCHIEDSRICHTER].insert_one(a_referee(position))
    await with_history(database, confirmed_on(a_change(position, minted=MINTED_TO_LAPSE_YESTERDAY), CONFIRMED_TO_BE_DUE))


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            await database[Collection.SAISONS].insert_one(saison_document("2026", "active"))
            await database[Collection.SCHIEDSRICHTER].insert_one(build_ghost_schiedsrichter())
            await database[Collection.SPIELER].insert_one(build_ghost_spieler())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, *, nach: Any = None, **replaced: Any) -> Any:
    return await sweep_adresswechsel(
        params=FLAdresswechselSweepParams(nach=nach),
        records=record_collections(database, **{name: value for name, value in replaced.items() if name != "adresswechsel_collection"}),
        adresswechsel_collection=replaced.get("adresswechsel_collection", database[Collection.ADRESSWECHSEL]),
        spieler_collection=replaced.get("spieler_collection", database[Collection.SPIELER]),
        schiedsrichter_collection=replaced.get("schiedsrichter_collection", database[Collection.SCHIEDSRICHTER]),
        saison_teams_collection=replaced.get("saison_teams_collection", database[Collection.SAISON_TEAMS]),
        bewerbungen_collection=replaced.get("bewerbungen_collection", database[Collection.BEWERBUNGEN]),
        registrierungen_collection=replaced.get("registrierungen_collection", database[Collection.REGISTRIERUNGEN]),
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
        berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
        berechtigungen_antraege_collection=database[Collection.BERECHTIGUNGEN_ANTRAEGE],
        einladungen_collection=database[Collection.EINLADUNGEN],
        sperrliste_collection=database[Collection.SPERRLISTE],
        adresswechsel_postausgang_collection=database[Collection.ADRESSWECHSEL_POSTAUSGANG],
        drosselung_collection=database[Collection.DROSSELUNG],
        sperrliste=ban_list(database),
        aktionen_collection=database[Collection.AKTIONEN],
        adressanker_collection=database[Collection.ADRESSANKER],
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


async def live(database: AsyncDatabase) -> list[ObjectId]:
    return await database[Collection.ADRESSWECHSEL].distinct("_id", {"beendet": None})


def refusing_its_redaction(collection: Collection, row: Mapping[str, Any]) -> dict[str, Any]:
    """A log image missing the `trace_id` its validator requires, so the redaction's update is refused: any row a write is refused on."""

    return {
        "at": "2126-04-01T00:00:00+00:00",
        "at_date": datetime.now(UTC),
        "actor": {"kind": "system", "email": "SYSTEM"},
        "request": None,
        "collection": str(collection),
        "operation": "patch_one",
        "document_id": row["_id"],
        "db_filter": None,
        "before": dict(row),
        "modified_count": None,
        "redacted_at": None,
        "anlass": None,
    }


class TestALapsedChangeEndsOnceItsDeadlinePassed:
    def test_its_address_goes_from_the_record_and_its_images_and_a_change_before_its_deadline_stands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await with_history(database, a_change(1, minted=MINTED_TO_LAPSE_YESTERDAY), a_change(2, minted=MINTED_TO_LAPSE_TODAY))
            answer = await sweep(database, client)
            ended = await database[Collection.ADRESSWECHSEL].find_one({"_id": numbered(1)})

            return answer, ended, await live(database), await where_held(database, pending(1), folded=True)

        answer, ended, standing, held = on_a_league(mongo_replica_set_url, body)

        assert (answer.entfernt, answer.verworfen, answer.wirksam, answer.verbleibend, answer.nach) == (1, 0, 0, 0, None)
        assert (ended["beendet"]["art"], ended["adresse"], ended["email"]) == ("abgelaufen", None, None)
        assert standing == [numbered(2)]
        assert held == {pending(1): []}

    def test_a_waiting_change_is_no_lapse_and_stands_until_it_is_due(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await with_history(database, confirmed_on(a_change(1, minted=MINTED_TO_LAPSE_YESTERDAY), CONFIRMED_TO_WAIT))
            return await sweep(database, client), await live(database)

        answer, standing = on_a_league(mongo_replica_set_url, body)

        assert (answer.entfernt, answer.verworfen, answer.wirksam) == (0, 0, 0)
        assert standing == [numbered(1)]


class TestADueChangeTakesEffect:
    def test_it_moves_the_person_and_names_whom_to_notify(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_due_person(database, 1)
            answer = await sweep(database, client)
            return answer, await database[Collection.SPIELER].distinct("email", {"vorname": "Quintessa"}), await owed(database)

        answer, addresses, notices = on_a_league(mongo_replica_set_url, body)

        assert answer.wirksam == 1
        assert notices == [
            # The lost-mailbox way greets nobody.
            {"art": "wirksam", "bisherige_email": on_file(1), "email": pending(1), "vorname": None, "weg": "wartezeit"}
        ]
        assert addresses == [pending(1)]

    @pytest.mark.parametrize("barred", ["on_file", "pending"])
    def test_a_ban_on_either_address_refuses_it_and_answers_its_new_address_alone(self, mongo_replica_set_url: str, barred: str):
        """The new mailbox is told it did not take effect, never why, and the address on file nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_due_person(database, 1)
            address = on_file(1) if barred == "on_file" else pending(1)
            await ban_through_the_route(
                database, client, email=address, grund="Falschangaben", von="admin@frankfurtleague.de", today="2126-04-16"
            )

            answer = await sweep(database, client)
            return answer, await database[Collection.ADRESSWECHSEL].find_one({"_id": numbered(1)}), await owed(database)

        answer, ended, notices = on_a_league(mongo_replica_set_url, body)

        assert (answer.verworfen, answer.wirksam) == (1, 0)
        assert notices == [{"art": "verworfen", "bisherige_email": None, "email": pending(1), "vorname": None, "weg": None}]
        assert (ended["beendet"]["art"], ended["email"]) == ("verworfen", None)

    def test_a_change_finding_nothing_to_move_is_refused_alike(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await with_history(database, confirmed_on(a_change(1, minted=MINTED_TO_LAPSE_YESTERDAY), CONFIRMED_TO_BE_DUE))
            return await sweep(database, client), await owed(database)

        answer, notices = on_a_league(mongo_replica_set_url, body)

        assert (answer.verworfen, answer.wirksam, [notice["email"] for notice in notices]) == (1, 0, [pending(1)])


class WrittenAfterTheRead:
    """A collection writing `rival` once the call's page read has answered and before any change's own transaction."""

    def __init__(self, collection: Any, rival: Callable[[], Awaitable[Any]]) -> None:
        self._collection = collection
        self._rival: Callable[[], Awaitable[Any]] | None = rival

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        # The page read is the one read outside a session; every change's own reads carry theirs.
        if self._rival is not None and kwargs.get("session") is None:
            rival, self._rival = self._rival, None
            await rival()

        return cursor


class TestEachChangeIsJudgedAgainInItsOwnTransaction:
    def test_a_link_sent_again_after_the_read_keeps_its_change(self, mongo_replica_set_url: str):
        """End the change by its id alone rather than its lapsed terms and this fails: the fresh link and its address go."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.ADRESSWECHSEL].insert_one(a_change(1, minted=MINTED_TO_LAPSE_YESTERDAY))

            async def send_it_again() -> None:
                await database[Collection.ADRESSWECHSEL].update_one({"_id": numbered(1)}, {"$set": {"gueltig_bis": NOW + timedelta(hours=23)}})

            answer = await sweep(
                database, client, adresswechsel_collection=WrittenAfterTheRead(database[Collection.ADRESSWECHSEL], send_it_again)
            )

            return (answer.entfernt, answer.verbleibend), await live(database)

        counts, standing = on_a_league(mongo_replica_set_url, body)

        assert counts == (0, 0)
        assert standing == [numbered(1)]


class TestEachCallTakesAShare:
    def test_a_share_and_one_more_take_a_pass_of_two_calls(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.ADRESSWECHSEL].insert_many(
                [a_change(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in range(ADRESSWECHSEL_PER_PASS + 1)]
            )
            answers = await a_pass(database, client)
            later = await sweep(database, client)

            return [(answer.entfernt, answer.verbleibend, answer.nach) for answer in answers], (later.entfernt, later.verbleibend, later.nach)

        answers, later = on_a_league(mongo_replica_set_url, body)

        assert answers == [(ADRESSWECHSEL_PER_PASS, 1, numbered(ADRESSWECHSEL_PER_PASS - 1)), (1, 0, None)]
        assert later == (0, 0, None)

    def test_changes_parked_on_an_approval_take_no_share(self, mongo_replica_set_url: str):
        """A share and one more confirmed, each owing its approval while its address holds a grant: one call, ending the pass.

        On the page they would fill the share, every due change behind them waiting a call.
        """

        def parked(position: int) -> dict[str, Any]:
            return {
                **a_change(position, minted=MINTED_TO_LAPSE_TODAY),
                "weg": "konto",
                "gueltig_bis": None,
                "bestaetigt_am": CONFIRMED_TO_WAIT,
                "genehmigung": compose_genehmigung(verwaltung="administration", gestartet_von=on_file(position), now=CONFIRMED_TO_WAIT),
            }

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            positions = range(ADRESSWECHSEL_PER_PASS + 1)
            await database[Collection.ADRESSWECHSEL].insert_many([parked(position) for position in positions])
            await database[Collection.BERECHTIGUNGEN].insert_many(
                [{**grants_for_the_suite()[1], "_id": ObjectId(), "adresse": on_file(position)} for position in positions]
            )
            return await sweep(database, client), await live(database)

        answer, standing = on_a_league(mongo_replica_set_url, body)

        assert (answer.wirksam, answer.verbleibend, answer.nach) == (0, 0, None)
        assert len(standing) == ADRESSWECHSEL_PER_PASS + 1


class NotTheDatabases(Exception):
    """A failure no driver raises, standing for every class a change's handling can meet outside the database."""


class RaisesOnOneChange:
    """The changes' collection, whose in-session write of one change raises `NotTheDatabases`."""

    def __init__(self, collection: Any, failing: ObjectId) -> None:
        self._collection = collection
        self._failing = failing

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def find_one_and_update(self, filter: Mapping[str, Any], *args: Any, **kwargs: Any) -> Any:
        if filter.get("_id") == self._failing:
            raise NotTheDatabases("synthetic")

        return await self._collection.find_one_and_update(filter, *args, **kwargs)


class TestOneChangeHoldsBackNoOther:
    def test_a_failure_not_the_databases_is_passed_over_and_the_next_goes(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catch the database's failures alone and the call fails, the second change standing and the next pass stopping at the first again."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.ADRESSWECHSEL].insert_many([a_change(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in (1, 2)])
            answer = await sweep(database, client, adresswechsel_collection=RaisesOnOneChange(database[Collection.ADRESSWECHSEL], numbered(1)))

            return (answer.entfernt, answer.verbleibend, answer.nach), await live(database)

        with caplog.at_level("ERROR"):
            counts, standing = on_a_league(mongo_replica_set_url, body)

        assert counts == (1, 1, None)
        assert standing == [numbered(1)]
        failures = [
            (record.levelname, record.getMessage()) for record in caplog.records if getattr(record, "error_code", None) == UNHANDLED_CRASH
        ]
        # Located by the frame that raised it, and never by its message, which can quote a value.
        [(level, line)] = failures
        ended = rf"The lapsed address change {numbered(1)} saw no end: NotTheDatabases in find_one_and_update at .+\.py:\d+"
        assert (level, re.fullmatch(ended, line) is not None) == ("ERROR", True), line

    def test_a_refused_end_is_passed_over_and_the_next_goes(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A log image refusing the redaction's update. Remove the catch and the call fails."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first, second = a_change(1, minted=MINTED_TO_LAPSE_YESTERDAY), a_change(2, minted=MINTED_TO_LAPSE_YESTERDAY)
            await database[Collection.ADRESSWECHSEL].insert_many([first, second])
            await database[Collection.AKTIONEN].insert_one(
                refusing_its_redaction(Collection.ADRESSWECHSEL, first), bypass_document_validation=True
            )
            answer = await sweep(database, client)

            return (answer.entfernt, answer.verbleibend), await live(database)

        with caplog.at_level("ERROR"):
            counts, standing = on_a_league(mongo_replica_set_url, body)

        assert counts == (1, 1)
        assert standing == [numbered(1)]
        failures = [record.getMessage() for record in caplog.records if getattr(record, "error_code", None) == DATABASE_FAILED]
        assert [str(numbered(1)) in message and pending(1) not in message for message in failures] == [True]

    def test_a_share_of_failing_changes_holds_back_none_behind_it_in_the_pass(self, mongo_replica_set_url: str):
        """Restart each call at the lowest id and the same share fails every call, the last change never reached."""

        failing = range(ADRESSWECHSEL_PER_PASS)
        last = ADRESSWECHSEL_PER_PASS

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            changes = [a_change(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in failing]
            await database[Collection.ADRESSWECHSEL].insert_many(changes)
            await database[Collection.AKTIONEN].insert_many(
                [refusing_its_redaction(Collection.ADRESSWECHSEL, change) for change in changes], bypass_document_validation=True
            )
            await database[Collection.ADRESSWECHSEL].insert_one(a_change(last, minted=MINTED_TO_LAPSE_YESTERDAY))
            answers = await a_pass(database, client)

            return [answer.entfernt for answer in answers], numbered(last) in await live(database)

        ended, standing = on_a_league(mongo_replica_set_url, body)

        assert (ended, standing) == ([0, 1], False)


# Server-side, so the database itself stops answering and only the deadline's `maxTimeMS` stops it.
STALL = "sleep(60000) || true"
# Long enough that the change before the stall ends inside it on a loaded machine.
SHORT_DEADLINE_S = 1.5


class StallsItsWrite:
    """A collection whose in-session write of one document sleeps on the server, past the deadline the call runs under."""

    def __init__(self, collection: Any, stalled: ObjectId) -> None:
        self._collection = collection
        self._stalled = stalled

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def find_one_and_update(self, filter: Mapping[str, Any], *args: Any, **kwargs: Any) -> Any:
        if filter.get("_id") == self._stalled:
            filter = {**filter, "$where": STALL}

        return await self._collection.find_one_and_update(filter, *args, **kwargs)


class TestTheDeadlineStopsTheCall:
    def test_it_warns_once_and_the_rest_stay_due(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Fail each change past the deadline instead and every later one is logged an ERROR naming a refusal that never happened."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.ADRESSWECHSEL].insert_many(
                [a_change(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in (1, 2, 3)]
            )
            with pymongo.timeout(SHORT_DEADLINE_S):
                answer = await sweep(database, client, adresswechsel_collection=StallsItsWrite(database[Collection.ADRESSWECHSEL], numbered(2)))

            return (answer.entfernt, answer.verbleibend, answer.nach), await live(database)

        with caplog.at_level("WARNING"):
            counts, standing = on_a_league(mongo_replica_set_url, body)

        assert counts == (1, 2, numbered(2))
        assert standing == [numbered(2), numbered(3)]
        lines = [
            (record.levelname, record.getMessage())
            for record in caplog.records
            if getattr(record, "error_code", None) in {DATABASE_FAILED, UNKNOWN_OUTCOME}
        ]
        assert lines == [
            ("WARNING", f"Database deadline passed at the lapsed address change {numbered(2)}: the call stops, and the rest stay due")
        ]

    def test_a_change_dearer_than_the_budgets_row_moves_nothing_and_stays_due(self, mongo_replica_set_url: str):
        """Nothing bounds what one address holds, so a share can meet a change dearer than the one it is sized at.

        Stalled at its last registration, its pupil row already written: the transaction takes everything back.
        """

        registrations = [
            documents.registrierung_document(
                ObjectId(),
                on_file(2),
                saison_id="2026",
                team_id=ObjectId(),
                vorname="Quintessa",
                nachname="Muster 2",
                token=f"registration-{number}",
                eingereicht_am="2126-04-14",
                frist="2126-04-21",
            )
            for number in range(3)
        ]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_due_person(database, 1)
            await a_due_person(database, 2)
            await database[Collection.REGISTRIERUNGEN].insert_many(registrations)
            stalled = StallsItsWrite(database[Collection.REGISTRIERUNGEN], registrations[-1]["_id"])
            with pymongo.timeout(SHORT_DEADLINE_S):
                answer = await sweep(database, client, registrierungen_collection=stalled)

            return (
                answer,
                await database[Collection.SPIELER].distinct("email", {"nachname": "Muster 2"}),
                await database[Collection.REGISTRIERUNGEN].distinct("email", {"_id": {"$in": [row["_id"] for row in registrations]}}),
            )

        answer, dear, moved = on_a_league(mongo_replica_set_url, body)

        assert (answer.wirksam, answer.verbleibend, answer.nach) == (1, 1, numbered(2))
        assert (dear, moved) == ([on_file(2)], [on_file(2)])


FEW = ADRESSWECHSEL_PER_PASS // 2


async def _cleared(database: AsyncDatabase) -> None:
    # The anchors too: a counted call re-anchors the addresses the last one anchored, stamped on the server's own
    # clock and expiring at once, so the TTL monitor's next pass could delete one under a counted transaction
    # writing it, and the retry that write conflict forces would be counted as the change's own commands.
    for collection in (Collection.ADRESSWECHSEL, Collection.AKTIONEN, Collection.REGISTRIERUNGEN, Collection.ADRESSANKER):
        await database[collection].delete_many({})
    await database[Collection.SCHIEDSRICHTER].delete_many({"_id": {"$ne": build_ghost_schiedsrichter()["_id"]}})
    await database[Collection.SPIELER].delete_many({"_id": {"$ne": build_ghost_spieler()["_id"]}})


class TestALapseCostsTheCommandsItsShareIsSizedAt:
    def test_counted_on_the_wire(self, mongo_replica_set_url: str):
        """A write more an end turns this red."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                await _cleared(database)
                await with_history(database, *(a_change(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in range(due)))

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, sweep)

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert (twice - few) / FEW == COMMANDS_A_LAPSE


class TestADueChangeCostsTheCommandsItsShareIsSizedAt:
    def test_a_person_holding_a_pupil_row_and_a_confirmed_referee_row_counted_on_the_wire(self, mongo_replica_set_url: str):
        """The dearer change a share mixes: a due change moving a pupil row and the confirmed referee row beside it.

        A command added to the effect turns this red, so the share is judged against the deadline again.
        """

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Any, float]:
            async def counted(due: int) -> tuple[Any, Counter[str]]:
                await _cleared(database)
                for position in range(due):
                    await a_due_person(database, position)

                return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, sweep)

            # One call first, so the running season the ban list asks is cached for both counted ones alike.
            await counted(1)
            (_, few), (answer, twice) = await counted(FEW), await counted(2 * FEW)

            return answer, (twice.total() - few.total()) / FEW

        answer, per_person = on_a_league(mongo_replica_set_url, body)

        assert answer.wirksam == 2 * FEW
        assert per_person == COMMANDS_A_DUE_PERSON


class TestTheWorstCallSendsTheCommandsItsBudgetCounts:
    def test_a_full_share(self, mongo_replica_set_url: str):
        """`tests/api/test_adresswechsel_sweep_refusal.py`'s budget: a share and one more lapsed.

        A command added to the call turns this red, so the share is judged against the deadline again.
        """

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await with_history(
                database, *(a_change(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in range(ADRESSWECHSEL_PER_PASS + 1))
            )

            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, sweep)

        answer, names = on_a_league(mongo_replica_set_url, body)

        assert answer.entfernt == ADRESSWECHSEL_PER_PASS
        assert names.total() - ADRESSWECHSEL_PER_PASS * COMMANDS_A_LAPSE == OTHER_COMMANDS, names

    def test_a_full_share_of_due_changes_asking_the_running_season(self, mongo_replica_set_url: str):
        """The page's own read beside the season it asks once, which the per-change count's difference cancels out."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            for position in range(ADRESSWECHSEL_PER_PASS + 1):
                await a_due_person(database, position)

            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, sweep)

        answer, names = on_a_league(mongo_replica_set_url, body)

        assert answer.wirksam == ADRESSWECHSEL_PER_PASS
        assert names.total() - ADRESSWECHSEL_PER_PASS * COMMANDS_A_DUE_PERSON == OTHER_COMMANDS + SEASON_READ, names


async def queue(database: AsyncDatabase, *positions: int) -> list[ObjectId]:
    """One completion notice per position, queued a minute apart in that order, as the ends would have written them."""

    ids = []
    for position in positions:
        row = compose_postausgang(
            art="wirksam",
            email=pending(position),
            now=NOW - timedelta(minutes=len(positions) - len(ids)),
            bisherige_email=on_file(position),
            vorname=None,
            weg="wartezeit",
        )
        ids.append((await database[Collection.ADRESSWECHSEL_POSTAUSGANG].insert_one(row)).inserted_id)

    return ids


async def claimed(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime = NOW) -> FLAdresswechselPostausgangResponse:
    return await post_adresswechsel_postausgang(
        adresswechsel_postausgang_collection=database[Collection.ADRESSWECHSEL_POSTAUSGANG], db=client, now=now
    )


async def stamped(database: AsyncDatabase, client: AsyncMongoClient, beanspruchung: str, ids: list[ObjectId]) -> tuple[int, int]:
    answer = await post_adresswechsel_zugestellt(
        zugestellt_data=FLAdresswechselZugestelltPayload(beanspruchung=beanspruchung, ids=ids),
        adresswechsel_postausgang_collection=database[Collection.ADRESSWECHSEL_POSTAUSGANG],
        db=client,
    )

    return answer.zugestellt, answer.ignoriert


class TestTheOutbox:
    """The grants' outbox's contract: a lease per claim, a count per row, a stamp per claim."""

    def test_a_claim_hands_out_oldest_first_and_a_second_inside_the_lease_gets_nothing(self, mongo_replica_set_url: str):
        """Two overlapping passes never hold one notice; a pass that died leaves its notices to the pass after its lease."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            queued = await queue(database, 1, 2)
            first = await claimed(database, client)
            overlapping = await claimed(database, client, now=NOW + BEANSPRUCHUNG_DAUER - timedelta(seconds=1))
            after = await claimed(database, client, now=NOW + BEANSPRUCHUNG_DAUER)

            return queued, first, overlapping, after

        queued, first, overlapping, after = on_a_league(mongo_replica_set_url, body)

        assert [notice.id for notice in first.mitteilungen] == queued
        assert [(notice.bisherige_email, notice.email, notice.aufgegeben) for notice in first.mitteilungen] == [
            (on_file(1), pending(1), False),
            (on_file(2), pending(2), False),
        ]
        assert (overlapping.mitteilungen, overlapping.beanspruchung) == ([], None)
        assert [notice.id for notice in after.mitteilungen] == queued
        assert after.beanspruchung not in (None, first.beanspruchung)

    def test_the_stamp_removes_only_what_its_own_claim_holds_and_counts_a_repeat_once(self, mongo_replica_set_url: str):
        """A lapsed claim's stamp, an unknown id and a repeated id are each left alone and counted, never refused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            ids = await queue(database, 1, 2)
            first = await claimed(database, client)
            second = await claimed(database, client, now=NOW + BEANSPRUCHUNG_DAUER)
            assert first.beanspruchung is not None and second.beanspruchung is not None

            counts = [
                await stamped(database, client, first.beanspruchung, ids),
                await stamped(database, client, second.beanspruchung, [ids[0], ids[0], ObjectId()]),
                await stamped(database, client, second.beanspruchung, ids),
            ]

            return counts, await owed(database)

        counts, left = on_a_league(mongo_replica_set_url, body)

        assert counts == [(0, 2), (1, 1), (1, 1)]
        assert left == []

    def test_a_notice_handed_out_its_last_time_is_answered_as_given_up_the_time_after(self, mongo_replica_set_url: str):
        """The bound's last hand-out is delivered as any other; the claim after it tells the pass to stamp and send nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[bool]:
            await queue(database, 1)
            await database[Collection.ADRESSWECHSEL_POSTAUSGANG].update_many({}, {"$set": {"versuche": VERSUCHE_HOECHSTENS - 1}})
            last = await claimed(database, client)
            after = await claimed(database, client, now=NOW + BEANSPRUCHUNG_DAUER)

            return [notice.aufgegeben for notice in (*last.mitteilungen, *after.mitteilungen)]

        assert on_a_league(mongo_replica_set_url, body) == [False, True]

    def test_the_bookkeeping_leaves_the_log_no_address(self, mongo_replica_set_url: str):
        """A notice names both addresses; neither its claim nor its stamp may keep them in the year-long log."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            ids = await queue(database, 1)
            answer = await claimed(database, client)
            assert answer.beanspruchung is not None
            await stamped(database, client, answer.beanspruchung, ids)
            rows = database[Collection.AKTIONEN].find({"collection": str(Collection.ADRESSWECHSEL_POSTAUSGANG)})

            return [str(row) async for row in rows]

        logged = on_a_league(mongo_replica_set_url, body)

        assert all(on_file(1) not in row and pending(1) not in row for row in logged)
