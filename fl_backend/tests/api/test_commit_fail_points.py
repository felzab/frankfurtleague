"""
API · a write refused or its answer lost, and a read held: the journal, the log, the sweeps, a stamp, a repoint, the notices, a lookup

The erasures' and a press's line, a recorded act's row, the confirmation pass's mint, an adoption's stamp, an erased
pupil's repointed report entries and the notices a club's exit owes meet a refused or unanswered write; the subject
lookup's reads are held on the server, so that the ones a transaction runs are seen going one at a time.

Every case configuring `failCommand` lives in this module, through `fail_point`: MongoDB holds one configuration of a
fail point for the whole server, which every worker shares, so a second module configuring it on another worker would
replace this one's configuration, and either case's `off` would clear both. The `--dist loadfile` that
`fl_backend/pyproject.toml` passes every run runs one module on one worker, its cases one after another.
"""

import logging
from collections.abc import AsyncGenerator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from httpx2 import AsyncClient
from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import PyMongoError

from app.api.action_log.schemas import FLActionLogRecord
from app.api.identity.crud import find_subject_in_session
from app.api.teams.admin_router import put_austritt
from app.api.teams.schemas import FLAustrittPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.db import new_client
from app.core.recording import ACT_BY_KONTAKT, record_act
from app.core.transactions import UNKNOWN_COMMIT_RESULT
from app.shared.einwilligung_evidence import evidence_state_of
from tests import austritt_corpus as austritt
from tests import spiel_saves
from tests import spielbestaetigung_corpus as confirmations
from tests.acts import journal_records
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_KEY, ADMINISTRATORS, grants_for_the_suite
from tests.database import a_clean_database
from tests.documents import SPIELER_TEXT_VERSIONS, own_einwilligung_document, saison_document, spieler_document
from tests.erasure import erased_on_request
from tests.erasure_corpus import (
    IDENTIFIER,
    THEIR_GRANT_OID,
    THEIR_REPORT_OID,
    TYPED,
    a_grant,
    a_person_holding_everything,
    action_log_row,
)
from tests.erasure_corpus import NOW as ERASURE_NOW
from tests.erasure_corpus import PUPIL_OID as THEIR_PUPIL_OID
from tests.erasure_corpus import erased_by_the_handler as erased_by_the_person
from tests.erasure_sweep_corpus import a_due_pupil, a_report_naming, seeded
from tests.erasure_sweep_corpus import numbered as pupil_numbered
from tests.erasure_sweep_corpus import run as a_deletion_call
from tests.erasure_sweep_corpus import the_league as the_pupils_league
from tests.outbox import MAIL_NOW
from tests.records import record_collections
from tests.session_headers import StampedHeaders
from tests.stored import the_row
from tests.subject_corpus import IDENTIFIER as SUBJECTS_SEAT_HOLDER
from tests.subject_corpus import the_subjects_corpus
from tests.whole_database import where_held
from tests.worker import worker_database

# The one database every case here seeds, whichever suite's records it borrows.
PRESS_DATABASE = worker_database("fl_commit_fail_points_test")

# The administrator who enters an erasure on a mailed request, one the suite's grants hold.
OPERATOR = ADMINISTRATORS[1]
REQUEST_REASON = "Mail vom 30.03.2126, Betreff: Bitte löscht alle meine Daten"

Seed = Callable[[AsyncDatabase], Awaitable[None]]


async def on_a_league(url: str, seed: Seed, body: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]) -> Any:
    """`body` on this suite's database, on the shipped indexes, once `seed` has run."""

    async with a_clean_database(url, PRESS_DATABASE, constraints=True) as (client, database):
        await seed(database)

        return await body(database, client)


async def the_administrators_league(database: AsyncDatabase) -> None:
    """The person holding everything, beside the suite's grants an administrator presses through."""

    await database[Collection.GRANTS].insert_many(grants_for_the_suite())
    await a_person_holding_everything(database)


# The client a configuration hits, chosen by its name: the commits of every other client, each seed's own among them,
# run as they would.
REFUSED_COMMIT_APP = "erasure-refused-commit"
# The server's code for a write conflict, which a commit refused under the transient label carries.
WRITE_CONFLICT = 112
# The client whose one commit lands and answers that its time ran out, so its answer is lost.
LOST_COMMIT_APP = "erasure-lost-commit"
# The server's code for an operation out of time, on which `with_transaction` never retries a commit: it raises the
# unknown result at once, so the case holds no deadline that could run out before the commit is sent.
MAX_TIME_EXPIRED = 50
UNANSWERED: dict[str, Any] = {
    "failCommands": ["commitTransaction"],
    "appName": LOST_COMMIT_APP,
    "writeConcernError": {"code": MAX_TIME_EXPIRED, "errmsg": "operation exceeded time limit"},
}

# The server's code for a transaction it does not hold, sent without the transient label the server adds, so nothing reruns it.
NO_SUCH_TRANSACTION = 251
# A commit refused as a write conflict under the transient label, so the driver reruns the transaction.
REFUSED_TRANSIENTLY: dict[str, Any] = {
    "failCommands": ["commitTransaction"],
    "appName": REFUSED_COMMIT_APP,
    "errorCode": WRITE_CONFLICT,
    "errorLabels": ["TransientTransactionError"],
}
# A commit refused without it, so nothing reruns the transaction and what a case reads after it is the rollback's.
REFUSED_FOR_GOOD: dict[str, Any] = {
    "failCommands": ["commitTransaction"],
    "appName": REFUSED_COMMIT_APP,
    "errorCode": NO_SUCH_TRANSACTION,
    "errorLabels": [],
}

FAIL_POINT = "failCommand"
# The client whose reads the server holds, every other client's running as it would.
HELD_READS_APP = "subject-held-reads"
# Far longer than opening a connection for each gathered read takes, so every read gathered beside the first is sent
# before the first is answered, and a read awaited before the next is sent shows as an answer ahead of that send.
HELD_FOR_MS = 200


@asynccontextmanager
async def fail_point(server: AsyncMongoClient, data: Mapping[str, Any], *, mode: Any) -> AsyncGenerator[None]:
    """`failCommand` configured with `data` under `mode`, and switched off as the block ends, however it ends.

    Left on, the point outlives its case and fails the next one this server runs.
    """

    await server.admin.command("configureFailPoint", FAIL_POINT, mode=mode, data=data)
    try:
        yield
    finally:
        await server.admin.command("configureFailPoint", FAIL_POINT, mode="off")


@asynccontextmanager
async def failing_client(
    server: AsyncMongoClient, url: str, data: Mapping[str, Any], *, mode: Any, listener: monitoring.CommandListener | None = None
) -> AsyncGenerator[AsyncMongoClient]:
    """A client of its own the point reaches by `data`'s `appName`, `listener` hearing its commands, closed after the point is off."""

    client = new_client(url, serverMonitoringMode="poll", appname=data["appName"], event_listeners=[] if listener is None else [listener])
    try:
        async with fail_point(server, data, mode=mode):
            yield client
    finally:
        await client.close()


class _Commits(monitoring.CommandListener):
    """The code each `commitTransaction` the case's own client sends is answered with, `None` for one that committed.

    Read off the client rather than the fail point's `count`, which the server keeps for every configuration of it.
    """

    def __init__(self) -> None:
        self.answered: list[int | None] = []

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        """Required by the listener interface; a commit is judged by its answer."""

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        if event.command_name == "commitTransaction":
            self.answered.append(event.reply.get("writeConcernError", {}).get("code"))

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        if event.command_name == "commitTransaction":
            self.answered.append(event.failure.get("code"))


class _InFlight(monitoring.CommandListener):
    """Each read the case's own client sends and each answer to one, by collection, in the order the driver saw them."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []
        self._collections: dict[int, str] = {}

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        if event.command_name in ("find", "aggregate"):
            collection = str(event.command[event.command_name])
            self._collections[event.request_id] = collection
            self.events.append(("sent", collection))

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        self._answered(event.request_id)

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        self._answered(event.request_id)

    def _answered(self, request_id: int) -> None:
        if (collection := self._collections.pop(request_id, None)) is not None:
            self.events.append(("answered", collection))

    def sent_before_the_first_answer(self) -> list[str]:
        first = next((index for index, (kind, _) in enumerate(self.events) if kind == "answered"), len(self.events))

        return sorted(collection for kind, collection in self.events[:first] if kind == "sent")


async def _first_reads(url: str, database: AsyncDatabase, call: Callable[[AsyncMongoClient], Awaitable[Any]]) -> tuple[Any, list[str]]:
    """`call`'s answer over a client whose reads the server holds, and every read it sent before the first was answered."""

    reads = _InFlight()
    holding = {"failCommands": ["find", "aggregate"], "appName": HELD_READS_APP, "blockConnection": True, "blockTimeMS": HELD_FOR_MS}
    async with failing_client(database.client, url, holding, mode="alwaysOn", listener=reads) as held:
        answer = await call(held)

    return answer, reads.sent_before_the_first_answer()


@pytest.mark.db
class TestALookupInsideATransaction:
    async def test_inside_a_transaction_the_subjects_reads_run_one_at_a_time(self, mongo_replica_set_url: str):
        """PyMongo documents that one session runs one operation at a time and refuses nothing, so gathered here they would race unseen."""

        async def body(database: AsyncDatabase) -> Any:
            async def lookup(held: AsyncMongoClient) -> Any:
                records = record_collections(held[database.name])
                async with held.start_session() as session:
                    return await session.with_transaction(
                        lambda transaction: find_subject_in_session(SUBJECTS_SEAT_HOLDER, records, session=transaction)
                    )

            return await _first_reads(mongo_replica_set_url, database, lookup)

        answer, sent = await on_a_league(mongo_replica_set_url, the_subjects_corpus, lambda database, _client: body(database))

        assert answer.seats, "the lookup found no seat, so a single read sent proves nothing of the others"
        assert len(sent) == 1, f"the lookup sent {sent} before the first answered"


@pytest.mark.db
class TestThePersonsOwnErasure:
    async def test_a_commit_whose_answer_is_lost_is_journalled_all_the_same(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches the journal left to a commit that answered: this one landed and answered only that its time ran out."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            commits = _Commits()
            async with failing_client(client, mongo_replica_set_url, UNANSWERED, mode={"times": 1}, listener=commits) as losing:
                with pytest.raises(PyMongoError) as lost:
                    await erased_by_the_person(losing[database.name], losing)

            return commits.answered, lost.value.has_error_label(UNKNOWN_COMMIT_RESULT), await where_held(database, IDENTIFIER)

        with caplog.at_level(logging.INFO):
            commits, labelled, after = await on_a_league(mongo_replica_set_url, a_person_holding_everything, body)

        # The premise first, so a failure names its cause: one commit ran, its answer was lost, and the erasure landed.
        assert (commits, labelled, after) == ([MAX_TIME_EXPIRED], True, {IDENTIFIER: []})
        assert len(journal_records(caplog)) == 1

    async def test_an_attempt_rolled_back_at_its_commit_writes_no_line(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches the journal written inside the callback, ahead of a commit that can still fail.

        The refusal is transient, so the driver reruns the erasure and the rerun commits: one line, none of the
        first attempt's.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            commits = _Commits()
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            async with failing_client(client, mongo_replica_set_url, REFUSED_TRANSIENTLY, mode={"times": 1}, listener=commits) as refusing:
                await erased_by_the_person(refusing[database.name], refusing)

            return commits.answered, await database[Collection.GRANTS].count_documents({"_id": THEIR_GRANT_OID})

        with caplog.at_level(logging.INFO):
            refused, left = await on_a_league(mongo_replica_set_url, a_person_holding_everything, body)

        assert len(journal_records(caplog)) == 1
        # The premise last: one commit refused, so the line counted above is the second attempt's alone.
        assert (refused, left) == ([WRITE_CONFLICT, None], 0)

    async def test_an_attempt_refused_at_its_commit_leaves_every_document_as_it_stood(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """Catches any step writing off the erasure's session: that write would stand while the commit taking the rest failed.

        Their records span every arm, a report names the pupil and the log their act, so each step reaching them writes.
        Refused without the transient label, so nothing reruns the erasure and the database read after it is the rollback's;
        the journal, which a restore replays, holds no line of an erasure that never landed.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            commits = _Commits()
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            await database[Collection.SPIELBERICHTE].update_one(
                {"_id": THEIR_REPORT_OID}, {"$set": {"bericht.scorers.0.spieler_id": THEIR_PUPIL_OID}}
            )
            # An act of theirs as an administrator, which the erasure reattributes.
            await database[Collection.ACTION_LOG].insert_one(action_log_row(ObjectId(), by=IDENTIFIER))
            before = await _every_document(database)
            async with failing_client(client, mongo_replica_set_url, REFUSED_FOR_GOOD, mode={"times": 1}, listener=commits) as refusing:
                with pytest.raises(PyMongoError):
                    await erased_by_the_person(refusing[database.name], refusing)

            return commits.answered, before, await _every_document(database)

        with caplog.at_level(logging.INFO):
            commits, before, after = await on_a_league(mongo_replica_set_url, a_person_holding_everything, body)

        # The premise first: one commit, refused, so what follows is the rollback's state.
        assert commits == [NO_SUCH_TRANSACTION]
        assert [name for name in sorted(before.keys() | after.keys()) if before.get(name) != after.get(name)] == []
        assert journal_records(caplog) == []


async def _every_document(database: AsyncDatabase) -> dict[str, list[Any]]:
    """Each collection's documents in `_id` order."""

    return {name: await database[name].find({}, sort=[("_id", 1)]).to_list() for name in await database.list_collection_names()}


@pytest.mark.db
class TestAnErasureOnRequest:
    async def test_one_line_follows_the_commit_and_none_the_attempt_rolled_back(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """The first commit is refused under the transient label, so the driver reruns the erasure: one line, the rerun's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            commits = _Commits()
            async with failing_client(client, mongo_replica_set_url, REFUSED_TRANSIENTLY, mode={"times": 1}, listener=commits) as refusing:
                await erased_on_request(
                    refusing[database.name], refusing, email=TYPED, reason=REQUEST_REASON, by=OPERATOR, germany_now=ERASURE_NOW
                )

            return commits.answered, await database[Collection.SPIELER].count_documents({"_id": THEIR_PUPIL_OID})

        with caplog.at_level(logging.INFO):
            refused, left = await on_a_league(mongo_replica_set_url, the_administrators_league, body)

        assert len(journal_records(caplog)) == 1
        # The premise last: one commit refused, so the line above is the rerun's alone.
        assert (refused, left) == ([WRITE_CONFLICT, None], 0)

    async def test_a_commit_whose_answer_is_lost_is_journalled_all_the_same(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches a route journalling once its commit answers: this one landed and answered only that its time ran out."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            commits = _Commits()
            async with failing_client(client, mongo_replica_set_url, UNANSWERED, mode={"times": 1}, listener=commits) as losing:
                with pytest.raises(PyMongoError) as lost:
                    await erased_on_request(
                        losing[database.name], losing, email=TYPED, reason=REQUEST_REASON, by=OPERATOR, germany_now=ERASURE_NOW
                    )

            return commits.answered, lost.value.has_error_label(UNKNOWN_COMMIT_RESULT), await where_held(database, IDENTIFIER)

        with caplog.at_level(logging.INFO):
            commits, labelled, after = await on_a_league(mongo_replica_set_url, the_administrators_league, body)

        # The premise first, so a failure names its cause: one commit ran, its answer was lost, and the erasure landed.
        assert (commits, labelled, after) == ([MAX_TIME_EXPIRED], True, {IDENTIFIER: []})
        assert len(journal_records(caplog)) == 1


# The pupil's own consent page, whose withdrawal writes the line.
CONSENT_PRESS = "/api/spieler/self/einwilligung"
PERSON = "ortrud.zwiebelmayer@schule.example.org"
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607870011")
PRESS_NOW = datetime(2126, 10, 3, 12, 0, tzinfo=ZoneInfo("Europe/Berlin"))
RECORDED_TEAM = "Lessing"
THEIR_CONSENT = own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at="2126-09-02", media=True)


def _person(email: str) -> StampedHeaders:
    return StampedHeaders(email, ADMIN_KEY, lane="person")


def _withdrawal(**choices: Any) -> dict[str, Any]:
    return {"text_versions": dict(SPIELER_TEXT_VERSIONS), "evidence_state": evidence_state_of(blocks=[THEIR_CONSENT]), **choices}


async def served(url: str, steps: Callable[[AsyncClient, AsyncDatabase, AsyncMongoClient], Awaitable[Any]]) -> Any:
    async with a_clean_database(url, PRESS_DATABASE, constraints=True) as (client, database):
        await database[Collection.SAISONS].insert_one(saison_document("2026", "active"))
        await database[Collection.SPIELER].insert_one(
            spieler_document(PUPIL_OID, "Ortrud", "Zwiebelmayer", email=PERSON, birth_date="1990-05-09", einwilligung=THEIR_CONSENT)
        )
        async with app_client(url, app=app_under_test(PRESS_DATABASE), now=PRESS_NOW) as http:
            return await steps(http, database, client)


def _as_app(url: str, app_name: str) -> str:
    """`url` for clients carrying `app_name`, the one name a configuration of the fail point reaches."""

    return f"{url}{'&' if '?' in url else '?'}appName={app_name}"


@pytest.mark.db
class TestAPersonsOwnPress:
    """A pupil withdrawing on their own page, through the routes: the journal follows the press's commit."""

    async def test_a_press_whose_commit_answer_is_lost_is_journalled_all_the_same(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """Catches the journal left to a commit that answered: this one landed and answered only that its time ran out."""

        withdrawn = {"scope": "internal", "media": False}

        async def chosen(database: AsyncDatabase) -> dict[str, Any]:
            stored = await the_row(database, Collection.SPIELER, {"_id": PUPIL_OID})

            return {key: stored["einwilligung"][key] for key in withdrawn}

        async def steps(http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await chosen(database)
            async with fail_point(client, UNANSWERED, mode={"times": 1}):
                with caplog.at_level(logging.INFO):
                    response = await http.patch(CONSENT_PRESS, json=_withdrawal(**withdrawn), headers=_person(PERSON))

            return before, await chosen(database), response.status_code, response.json()

        before, after, status, body = await served(_as_app(mongo_replica_set_url, LOST_COMMIT_APP), steps)

        # The premise first: the commit landed, its answer lost.
        assert (before != withdrawn, after) == (True, withdrawn)
        assert (status, body["error_code"], len(journal_records(caplog))) == (500, Code.UNKNOWN_OUTCOME, 1)


@pytest.mark.db
class TestARecordedActWhoseCommitIsRefused:
    async def test_a_retried_transaction_leaves_one_row_of_the_stored_shape(self, mongo_replica_set_url: str):
        """The driver reruns an act whose commit is refused as transient, and an insert outside the transaction would stand once per attempt.

        The record model reads the row, as a drift between it and `record_act` is a page that cannot read its log.
        """

        async with a_clean_database(mongo_replica_set_url, PRESS_DATABASE, constraints=True) as (client, database):
            attempts = 0

            async def act(session: AsyncClientSession) -> None:
                nonlocal attempts
                attempts += 1
                teams = refusing[database.name][Collection.TEAMS]
                await record_act(
                    collection=teams, action="spieler.changed", by=ACT_BY_KONTAKT, team=RECORDED_TEAM, record_id=PUPIL_OID, session=session
                )

            async with failing_client(client, mongo_replica_set_url, REFUSED_TRANSIENTLY, mode={"times": 1}) as refusing:
                async with refusing.start_session() as session:
                    await session.with_transaction(act)

            attempts, rows = attempts, [row async for row in database[Collection.ACTION_LOG].find()]

        assert len(rows) == 1
        FLActionLogRecord.model_validate(rows[0], extra="forbid")
        assert (rows[0]["by"], rows[0]["team"], rows[0]["record_id"]) == (ACT_BY_KONTAKT, RECORDED_TEAM, PUPIL_OID)
        # The premise last: the act ran twice, so one row is the rollback's work.
        assert attempts == 2


@pytest.mark.db
class TestAConfirmationMintWhoseCommitAnswerIsLost:
    """The driver's own lost answer, a `WTimeoutError` whose label the driver adds and the server's reply never carries."""

    async def test_the_pass_warns_and_the_mints_rows_stand_with_the_mails_they_owe(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """The rows and their mails commit in one transaction, so none stands unmailed and the next pass owes them nothing more.

        The lost answer is one `transactions.pass_cut` warning rather than a raise, as every pass's deadline is, naming the
        fixture whose commit went unanswered.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirmations.sweep(database, client)
            await database[Collection.SPIELE].update_one({"_id": confirmations.SPIEL}, {"$set": {"time": "19:00:00"}})
            commits = _Commits()
            # The move is the mint's to close, so the close writes nothing: the mint's commit is the first this client sends,
            # and it lands and loses its answer.
            async with failing_client(client, mongo_replica_set_url, UNANSWERED, mode={"times": 1}, listener=commits) as losing:
                with caplog.at_level(logging.WARNING):
                    await confirmations.a_pass(losing[database.name], losing)
            standing = await confirmations.rows(database, closed=None)
            owed = await database[Collection.OUTBOX].find({"reference.id": {"$in": [row["_id"] for row in standing]}}, {"kind": 1}).to_list()

            return commits.answered, standing, owed, await confirmations.a_pass(database, client)

        spiele = [confirmations.a_spiel(confirmations.SPIEL, 1, confirmations.NEXT_WEEK)]
        commits, standing, owed, nxt = await on_a_league(
            mongo_replica_set_url, lambda database: confirmations.the_league(database, spiele=spiele), body
        )

        # The premise first: the mint's commit landed with its answer lost.
        assert commits[:1] == [MAX_TIME_EXPIRED]
        assert [
            (record.getMessage(), getattr(record, "error_code", None), getattr(record, "row_id", None), getattr(record, "unanswered", None))
            for record in caplog.records
            if record.levelname == "WARNING"
        ] == [("transactions.pass_cut", Code.UNKNOWN_OUTCOME, str(confirmations.SPIEL), True)]
        # Each side's fresh row and the referee's, about the moved Ansetzung, each stamped with the mails it owes beside it.
        assert sorted((row["party"]["kind"], row["ansetzung"]["time"], row["asked_at"]) for row in standing) == [
            ("schiedsrichter", "19:00:00", confirmations.TODAY),
            ("team", "19:00:00", confirmations.TODAY),
            ("team", "19:00:00", confirmations.TODAY),
        ]
        assert sorted(mail["kind"] for mail in owed) == ["spiel_einteilung"] + ["spiel_request"] * 6
        assert (nxt.asked, nxt.mails) == (0, 0)


@pytest.mark.db
class TestASpielSaveRefusedAtItsCommit:
    async def test_takes_the_adoption_stamp_back_with_the_spiel(self, mongo_replica_set_url: str):
        """Catches a stamp written off the save's session: every rule passes, so only the commit can refuse this save."""

        spiele, reports = spiel_saves.a_bracket_with_reports(quarter_final_at=spiel_saves.SEEDED_VERSION)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await spiel_saves.with_reports(database, reports)
            spiel_data = await spiel_saves.payload_for(
                database,
                spiel_saves.VIERTELFINALE,
                team1=spiel_saves.side(spiel_saves.ALPHA, 3),
                team2=spiel_saves.side(spiel_saves.BETA, 1),
            )
            commits = _Commits()
            async with failing_client(client, mongo_replica_set_url, REFUSED_FOR_GOOD, mode={"times": 1}, listener=commits) as refusing:
                with pytest.raises(PyMongoError):
                    await spiel_saves.call_patch(
                        refusing[database.name],
                        refusing,
                        spiel_saves.VIERTELFINALE,
                        spiel_data,
                        adopts_bericht=spiel_saves.SEEDED_VERSION,
                    )

            return commits.answered, await spiel_saves.spiele_now(database), before, await spiel_saves.reports_now(database)

        commits, spiele, before, after = await on_a_league(
            mongo_replica_set_url, lambda database: spiel_saves.the_season(database, spiele), body
        )

        # The premise first: one commit, refused, and the fixture it carried not written.
        assert (commits, spiele[spiel_saves.VIERTELFINALE_NR]["ergebnis"]) == ([NO_SUCH_TRANSACTION], "1:3")
        assert after[spiel_saves.VIERTELFINALE] == before[spiel_saves.VIERTELFINALE], "a save that never committed adopted the report"


@pytest.mark.db
class TestAPupilsErasureRefusedAtItsCommit:
    async def test_takes_the_emptied_report_entries_back_with_the_pupil(self, mongo_replica_set_url: str):
        """Catches an entry emptied off the erasure's session: the report would name nobody for a pupil who stands.

        Refused without the transient label, so nothing reruns the erasure and the state read after it is the rollback's.
        """

        pupil = pupil_numbered(1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1), a_report_naming(1))
            commits = _Commits()
            async with failing_client(client, mongo_replica_set_url, REFUSED_FOR_GOOD, mode={"times": 1}, listener=commits) as refusing:
                answer = await a_deletion_call(refusing[database.name], refusing)

            report = await database[Collection.SPIELBERICHTE].find_one({}, {"bericht.scorers.spieler_id": 1})
            standing = await database[Collection.SPIELER].count_documents({"_id": pupil})

            return commits.answered, (answer.spieler, answer.failed), report, standing

        commits, counted, report, standing = await on_a_league(mongo_replica_set_url, the_pupils_league, body)

        # The premise first: one commit, refused, and the erasure it carried counted as failed.
        assert (commits, counted) == ([NO_SUCH_TRANSACTION], (0, 1))
        assert report is not None
        # `a_report_naming` names the pupil as the report's first scorer.
        assert report["bericht"]["scorers"][0]["spieler_id"] == pupil, "an erasure that rolled back repointed the report"
        assert standing == 1


# The client whose exit the server refuses, by its name; each refusal carries no transient label, on which
# `with_transaction` never retries.
REFUSED_EXIT_APP = "austritt-refused"
# The server's code for a bad value, which the write recording an exit on the club's row is refused with.
BAD_VALUE = 2
# The exit's commit, or the write recording it on the club's row (`findAndModify`, which no notice sends): the one is
# what notices written off its session outlive, the other what notices committed apart from it outlive.
EXIT_REFUSALS = [
    pytest.param(["commitTransaction"], NO_SUCH_TRANSACTION, id="its commit refused"),
    pytest.param(["findAndModify"], BAD_VALUE, id="its row's write refused"),
]


async def _exit_through(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """The exit as its route's own function records it, the day before it takes effect."""

    await put_austritt(
        team_id=austritt.DEPARTED,
        saison_id=austritt.SAISON_ID,
        austritt_data=FLAustrittPayload.model_validate({"type": "rueckzug", "reason": "Schulwechsel", "date": austritt.EXIT_DAY}),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=austritt.DAY_BEFORE,
        germany_now=MAIL_NOW,
    )


@pytest.mark.db
class TestAnExitRefusedAtItsWrite:
    @pytest.mark.parametrize(("commands", "code"), EXIT_REFUSALS)
    async def test_the_exit_s_write_owes_the_notices_in_its_own_transaction(self, mongo_replica_set_url: str, commands: list[str], code: int):
        """The one case holding that the route owes the notices: an exit recorded with that call gone would tell nobody.

        The Austritt suite owes them through the crud alone. Owed outside the exit's transaction, a refused exit would tell
        every opponent of an exit that never stood.
        """

        refusal = {"failCommands": commands, "appName": REFUSED_EXIT_APP, "errorCode": code, "errorLabels": []}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async with failing_client(client, mongo_replica_set_url, refusal, mode={"times": 1}) as refusing:
                with pytest.raises(PyMongoError):
                    await _exit_through(refusing[database.name], refusing)
            refused = await austritt.told(database, client)
            await _exit_through(database, client)

            return refused, await austritt.told(database, client)

        spiele = [austritt.spiel(1, austritt.DEPARTED, austritt.OPPONENT, austritt.LATER)]
        refused, notices = await on_a_league(mongo_replica_set_url, lambda database: austritt.the_league(database, spiele=spiele), body)

        assert refused == {}
        assert sorted(notices) == austritt.addresses(austritt.OPPONENT)
