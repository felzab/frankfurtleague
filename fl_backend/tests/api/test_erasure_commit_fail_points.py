"""
API · a commit refused or its answer lost: the journal of the erasures and of a person's press, and each sweep's unanswered line

Every case configuring `failCommand` lives in this module: the fail point is one setting the server holds for all
workers, so a second module configuring it on another worker would replace this one's configuration, and either case's
`off` would clear both. The gate's `--dist loadfile` runs one module on one worker, its cases one after another.
"""

import ast
import logging
from collections.abc import Awaitable, Callable
from importlib.util import resolve_name
from pathlib import Path
from typing import Any

import pytest
from httpx2 import AsyncClient
from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import PyMongoError

from app.api.konto.services import EINWILLIGUNG_STAND_VERALTET
from app.api.spielbestaetigungen.services import halter_of, seite_of
from app.core.collections import Collection
from app.core.db import NO_OWNER
from app.core.exception_handlers import DATABASE_FAILED, UNKNOWN_OUTCOME
from app.core.journal import JOURNAL_TOKEN
from app.core.security import akteur_pseudonym, loeschung_journal_hash
from app.core.transactions import UNKNOWN_COMMIT_RESULT
from tests.whole_database import where_held

from . import test_spielbestaetigung_sweep_execution as confirmations
from .test_erasure_auf_anfrage import CONFIG as REQUEST_CONFIG
from .test_erasure_auf_anfrage import erased_by_the_handler as erased_on_request
from .test_erasure_auf_anfrage import journal_lines
from .test_erasure_auf_anfrage import on_a_league as on_the_administrators_league
from .test_funktionen_erasure import IDENTIFIER, THEIR_GRANT_OID, a_grant
from .test_funktionen_erasure import erased_by_the_handler as erased_by_the_person
from .test_funktionen_erasure import on_a_league as on_their_league
from .test_journal_replay import PERSON, PUPIL_OID, V, _app, _person, _withdrawal, journalled, served
from .test_loeschung_sweep import a_due_pupil, seeded
from .test_loeschung_sweep import numbered as pupil_numbered
from .test_loeschung_sweep import on_a_league as on_the_pupils_league
from .test_loeschung_sweep import run as a_deletion_call
from .test_schiedsrichter_sweep_execution import MINTED_TO_LAPSE_YESTERDAY, a_referee
from .test_schiedsrichter_sweep_execution import numbered as referee_numbered
from .test_schiedsrichter_sweep_execution import on_a_league as on_the_referees_league
from .test_schiedsrichter_sweep_execution import sweep as an_address_change_call

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

FAIL_POINT = "failCommand"
TESTS_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = TESTS_ROOT.parent
THIS_MODULE = ".".join(Path(__file__).resolve().relative_to(BACKEND_ROOT).with_suffix("").parts)


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


def _modules_imported(path: Path) -> frozenset[str]:
    """Every module the file imports, and every name it imports from one read as a submodule, relative levels resolved."""

    package = ".".join(path.relative_to(BACKEND_ROOT).with_suffix("").parts[:-1])
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = resolve_name("." * node.level + (node.module or ""), package)
            found.add(base)
            found.update(f"{base}.{alias.name}" for alias in node.names)

    return frozenset(found)


def test_no_other_module_configures_the_fail_point():
    """The rule this module's docstring states: a second module's configuration replaces this one's on a shared server.

    Two routes reach it: spelling the fail point, and importing this module, whose helpers configure it unspelled.
    """

    texts = {path.relative_to(TESTS_ROOT).as_posix(): (path, path.read_text(encoding="utf-8")) for path in sorted(TESTS_ROOT.rglob("*.py"))}
    spelling = [name for name, (_, text) in texts.items() if FAIL_POINT in text]
    # Parsed only where the module's own name is spelled, as every import of it spells it.
    importing = [name for name, (path, text) in texts.items() if Path(__file__).stem in text and THIS_MODULE in _modules_imported(path)]

    assert (spelling, importing) == ([Path(__file__).relative_to(TESTS_ROOT).as_posix()], [])


@pytest.mark.db
class TestThePersonsOwnErasure:
    def test_a_commit_whose_answer_is_lost_is_journalled_all_the_same(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches the journal left to a commit that answered: this one landed and answered only that its time ran out."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            commits = _Commits()
            losing = AsyncMongoClient(mongo_replica_set_url, serverMonitoringMode="poll", appname=LOST_COMMIT_APP, event_listeners=[commits])
            await client.admin.command("configureFailPoint", FAIL_POINT, mode={"times": 1}, data=UNANSWERED)
            try:
                with pytest.raises(PyMongoError) as lost:
                    await erased_by_the_person(losing[database.name], losing)
            finally:
                await client.admin.command("configureFailPoint", FAIL_POINT, mode="off")
                await losing.close()

            return commits.answered, lost.value.has_error_label(UNKNOWN_COMMIT_RESULT), await where_held(database, IDENTIFIER)

        with caplog.at_level(logging.INFO):
            commits, labelled, after = on_their_league(mongo_replica_set_url, body)

        lines = [record.getMessage() for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]

        # The premise first, so a failure names its cause: one commit ran, its answer was lost, and the erasure landed.
        assert (commits, labelled, after) == ([MAX_TIME_EXPIRED], True, {IDENTIFIER: []})
        assert len(lines) == 1

    def test_an_attempt_rolled_back_at_its_commit_writes_no_line(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches the journal written inside the callback, ahead of a commit that can still fail.

        The refusal is transient, so the driver reruns the erasure and the rerun commits: one line and one warning, none of the
        first attempt's.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            commits = _Commits()
            refusing = AsyncMongoClient(
                mongo_replica_set_url, serverMonitoringMode="poll", appname=REFUSED_COMMIT_APP, event_listeners=[commits]
            )
            refusal = {
                "failCommands": ["commitTransaction"],
                "appName": REFUSED_COMMIT_APP,
                "errorCode": WRITE_CONFLICT,
                "errorLabels": ["TransientTransactionError"],
            }
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            await client.admin.command("configureFailPoint", FAIL_POINT, mode={"times": 1}, data=refusal)
            try:
                answer = await erased_by_the_person(refusing[database.name], refusing)
            finally:
                await client.admin.command("configureFailPoint", FAIL_POINT, mode="off")
                await refusing.close()

            return commits.answered, answer.berechtigungen

        with caplog.at_level(logging.INFO):
            refused, removed = on_their_league(mongo_replica_set_url, body)

        lines = [record for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]
        warnings = [getattr(record, "error_code", None) for record in caplog.records].count(NO_OWNER.error_code)

        assert (len(lines), warnings) == (1, 1)
        # The premise last: one commit refused, so the line counted above is the second attempt's alone.
        assert (refused, removed) == ([WRITE_CONFLICT, None], 1)


@pytest.mark.db
class TestAnErasureOnRequest:
    def test_one_line_follows_the_commit_and_none_the_attempt_rolled_back(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The first commit is refused under the transient label, so the driver reruns the erasure: one line, the rerun's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            commits = _Commits()
            refusing = AsyncMongoClient(
                mongo_replica_set_url, serverMonitoringMode="poll", appname=REFUSED_COMMIT_APP, event_listeners=[commits]
            )
            refusal = {
                "failCommands": ["commitTransaction"],
                "appName": REFUSED_COMMIT_APP,
                "errorCode": WRITE_CONFLICT,
                "errorLabels": ["TransientTransactionError"],
            }
            await client.admin.command("configureFailPoint", FAIL_POINT, mode={"times": 1}, data=refusal)
            try:
                answer = await erased_on_request(refusing[database.name], refusing)
            finally:
                await client.admin.command("configureFailPoint", FAIL_POINT, mode="off")
                await refusing.close()

            return commits.answered, answer.spieler

        with caplog.at_level(logging.INFO):
            refused, erased = on_the_administrators_league(mongo_replica_set_url, body)

        assert journal_lines(caplog) == [
            f"{JOURNAL_TOKEN} {loeschung_journal_hash(IDENTIFIER, schluessel=REQUEST_CONFIG.sperrliste_schluessel)} loeschung "
            f"pseudonym={akteur_pseudonym(IDENTIFIER, schluessel=REQUEST_CONFIG.sperrliste_schluessel)} "
            f"halter={halter_of(IDENTIFIER, schluessel=REQUEST_CONFIG.sperrliste_schluessel)}"
        ]
        # The premise last: one commit refused, so the line above is the rerun's alone.
        assert (refused, erased) == ([WRITE_CONFLICT, None], 1)

    def test_a_commit_whose_answer_is_lost_is_journalled_all_the_same(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches a route journalling once its commit answers: this one landed and answered only that its time ran out."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            commits = _Commits()
            losing = AsyncMongoClient(mongo_replica_set_url, serverMonitoringMode="poll", appname=LOST_COMMIT_APP, event_listeners=[commits])
            await client.admin.command("configureFailPoint", FAIL_POINT, mode={"times": 1}, data=UNANSWERED)
            try:
                with pytest.raises(PyMongoError) as lost:
                    await erased_on_request(losing[database.name], losing)
            finally:
                await client.admin.command("configureFailPoint", FAIL_POINT, mode="off")
                await losing.close()

            return commits.answered, lost.value.has_error_label(UNKNOWN_COMMIT_RESULT), await where_held(database, IDENTIFIER)

        with caplog.at_level(logging.INFO):
            commits, labelled, after = on_the_administrators_league(mongo_replica_set_url, body)

        # The premise first, so a failure names its cause: one commit ran, its answer was lost, and the erasure landed.
        assert (commits, labelled, after) == ([MAX_TIME_EXPIRED], True, {IDENTIFIER: []})
        assert journal_lines(caplog) == [
            f"{JOURNAL_TOKEN} {loeschung_journal_hash(IDENTIFIER, schluessel=REQUEST_CONFIG.sperrliste_schluessel)} loeschung "
            f"pseudonym={akteur_pseudonym(IDENTIFIER, schluessel=REQUEST_CONFIG.sperrliste_schluessel)} "
            f"halter={halter_of(IDENTIFIER, schluessel=REQUEST_CONFIG.sperrliste_schluessel)}"
        ]


# The pupil's own consent page, whose withdrawal is journalled.
CONSENT_PRESS = f"{V}/spieler/selbst/einwilligung"


def _as_app(url: str, app_name: str) -> str:
    """`url` for clients carrying `app_name`, the one name a configuration of the fail point reaches."""

    return f"{url}{'&' if '?' in url else '?'}appName={app_name}"


@pytest.fixture(scope="class")
def built_before_any_case() -> None:
    """Built before `caplog` attaches: the build's logging setup takes every handler off the root, the capture's among them."""

    _app()


@pytest.mark.db
@pytest.mark.usefixtures("built_before_any_case")
class TestAPersonsOwnPress:
    """A pupil withdrawing on their own page, through the routes: the journal follows the press's commit."""

    def test_a_press_whose_commit_answer_is_lost_is_journalled_all_the_same(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches the journal left to a commit that answered: this one landed and answered only that its time ran out."""

        withdrawn = {"umfang": "intern", "medien": False}

        async def chosen(database: AsyncDatabase) -> dict[str, Any]:
            stored = await database[Collection.SPIELER].find_one({"_id": PUPIL_OID})
            assert stored is not None

            return {key: stored["einwilligung"][key] for key in withdrawn}

        async def steps(http: AsyncClient, database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await chosen(database)
            await client.admin.command("configureFailPoint", FAIL_POINT, mode={"times": 1}, data=UNANSWERED)
            try:
                with caplog.at_level(logging.INFO):
                    response = await http.patch(CONSENT_PRESS, json=_withdrawal("konto_spieler", **withdrawn), headers=_person(PERSON))
            finally:
                await client.admin.command("configureFailPoint", FAIL_POINT, mode="off")

            return before, await chosen(database), response.status_code, response.json()

        before, after, status, body = served(_as_app(mongo_replica_set_url, LOST_COMMIT_APP), steps)

        # The premise first: the commit landed, its answer lost.
        assert (before != withdrawn, after) == (True, withdrawn)
        assert (status, body["error_code"], len(journalled(caplog))) == (500, UNKNOWN_OUTCOME, 1)

    def test_a_press_on_a_stale_stand_journals_nothing(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Refused before it writes, so it leaves no line; the same page's next press, standing on the record, journals one."""

        stale = {"umfang": "a" * 64, "medien": None}

        async def steps(http: AsyncClient, database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            before = await database[Collection.SPIELER].find_one({"_id": PUPIL_OID})
            withdrawal = _withdrawal("konto_spieler", umfang="intern", medien=False)
            with caplog.at_level(logging.INFO):
                refused = await http.patch(CONSENT_PRESS, json={**withdrawal, "nachweis_stand": stale}, headers=_person(PERSON))
                refused_lines = len(journalled(caplog))
                after_the_refusal = await database[Collection.SPIELER].find_one({"_id": PUPIL_OID})
                pressed = await http.patch(CONSENT_PRESS, json=withdrawal, headers=_person(PERSON))

            return (refused.status_code, refused.json()["error_code"], refused_lines, after_the_refusal == before), pressed.status_code

        refusal, pressed = served(mongo_replica_set_url, steps)

        assert refusal == (409, EINWILLIGUNG_STAND_VERALTET, 0, True)
        # The control: the capture reads the line a press that lands leaves.
        assert (pressed, len(journalled(caplog))) == (200, 1)


async def _first_commit_unanswered(
    url: str, database: AsyncDatabase, client: AsyncMongoClient, call: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]
) -> list[int | None]:
    """`call` on a client of its own, whose first commit lands and answers only that its time ran out; each commit's answer."""

    commits = _Commits()
    losing = AsyncMongoClient(url, serverMonitoringMode="poll", appname=LOST_COMMIT_APP, event_listeners=[commits])
    await client.admin.command("configureFailPoint", FAIL_POINT, mode={"times": 1}, data=UNANSWERED)
    try:
        await call(losing[database.name], losing)
    finally:
        await client.admin.command("configureFailPoint", FAIL_POINT, mode="off")
        await losing.close()

    return commits.answered


def _stopping_lines(caplog: pytest.LogCaptureFixture) -> list[tuple[str | None, str]]:
    return [
        (getattr(record, "error_code", None), record.getMessage())
        for record in caplog.records
        if getattr(record, "error_code", None) in {DATABASE_FAILED, UNKNOWN_OUTCOME}
    ]


@pytest.mark.db
class TestTheSweepsNameACommitTheyCannotRead:
    """Each sweep reads the unknown-result label off the timeout its commit raised: without it, the line says the row stays due."""

    def test_the_deletion_pass_names_the_pupil_whose_erasure_went_unanswered(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1), a_due_pupil(2))

            return await _first_commit_unanswered(mongo_replica_set_url, database, client, a_deletion_call)

        with caplog.at_level(logging.WARNING):
            commits = on_the_pupils_league(mongo_replica_set_url, body)

        assert commits == [MAX_TIME_EXPIRED]
        assert _stopping_lines(caplog) == [
            (
                UNKNOWN_OUTCOME,
                f"Database deadline passed at pupil {pupil_numbered(1)}, its erasure unanswered: the call stops, and the rest stay due",
            )
        ]

    def test_the_address_change_sweep_names_the_referee_whose_removal_went_unanswered(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].insert_many(
                [a_referee(position, minted=MINTED_TO_LAPSE_YESTERDAY) for position in (1, 2)]
            )

            return await _first_commit_unanswered(mongo_replica_set_url, database, client, an_address_change_call)

        with caplog.at_level(logging.WARNING):
            commits = on_the_referees_league(mongo_replica_set_url, body)

        assert commits == [MAX_TIME_EXPIRED]
        assert _stopping_lines(caplog) == [
            (
                UNKNOWN_OUTCOME,
                f"Database deadline passed at the lapsed address change of referee {referee_numbered(1)}, its removal unanswered: "
                "the call stops, and the rest stay due",
            )
        ]


@pytest.mark.db
class TestTheConfirmationPassNamesAMintItCannotRead:
    """The driver's own lost answer, a `WTimeoutError` whose label the driver adds and the server's reply never carries.

    The sweep sheet's stand-in carries it in the reply, so a judge reading the reply rather than `has_error_label` passes there alone.
    """

    def test_the_mints_rows_stand_unmailed_the_line_names_them_and_the_next_pass_asks_them(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """The close's notices committed first, so the pass answers them rather than raising (`docs/backend/spec.md :: I753`).

        Its rows hold links nobody was mailed, so the next pass asks each again (`:: I765`), a fresh link a seat beside the first.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirmations.sweep(database, client)
            await confirmations.angefragt(database, client, [row["_id"] for row in await confirmations.rows(database)])
            await database[Collection.SPIELE].update_one({"_id": confirmations.SPIEL}, {"$set": {"uhrzeit": "19:00:00"}})
            commits = _Commits()
            losing = AsyncMongoClient(mongo_replica_set_url, serverMonitoringMode="poll", appname=LOST_COMMIT_APP, event_listeners=[commits])
            # The close's commit passes; the mint's, the next one this client sends, lands and loses its answer.
            await client.admin.command("configureFailPoint", FAIL_POINT, mode={"skip": 1}, data=UNANSWERED)
            try:
                answer = await confirmations.sweep(losing[database.name], losing)
            finally:
                await client.admin.command("configureFailPoint", FAIL_POINT, mode="off")
                await losing.close()
            standing = await confirmations.rows(database, geschlossen=None)

            return (
                commits.answered,
                answer,
                standing,
                await confirmations.sweep(database, client),
                await confirmations.rows(database, geschlossen=None),
            )

        with caplog.at_level(logging.WARNING):
            commits, answer, standing, nxt, asked = confirmations.on_a_league(
                mongo_replica_set_url, body, spiele=[confirmations.fixture(confirmations.SPIEL, 1, confirmations.NEXT_WEEK)]
            )

        # The premise first: the close committed, and the mint's commit landed with its answer lost.
        assert commits == [None, MAX_TIME_EXPIRED]
        assert (len(answer.neue_ansetzungen), len(answer.schiedsrichter_neue_ansetzungen)) == (2, 1)
        assert (answer.anfragen, answer.einteilungen) == ([], [])
        # Each side's fresh row and the referee's, about the moved Ansetzung, none recorded as sent.
        assert sorted((row["partei"]["art"], row["ansetzung"]["uhrzeit"], row["angefragt_am"]) for row in standing) == [
            ("schiedsrichter", "19:00:00", None),
            ("team", "19:00:00", None),
            ("team", "19:00:00", None),
        ]
        assert _stopping_lines(caplog) == [
            (
                UNKNOWN_OUTCOME,
                "The mint clock's commit went unanswered after the call committed messages it owes: the rows minted for "
                f"fixture(s) {confirmations.SPIEL} may have been written with nobody told, the call answers what else committed, "
                "and the rest stay due",
            )
        ]
        assert sorted((anfrage.spielbestaetigung_id, anfrage.seite) for anfrage in nxt.anfragen) == sorted(
            (row["_id"], seite_of(row)) for row in standing if row["partei"]["art"] == "team"
        )
        assert [einteilung.spielbestaetigung_id for einteilung in nxt.einteilungen] == [
            row["_id"] for row in standing if row["partei"]["art"] == "schiedsrichter"
        ]
        assert {len(entry["token_hashes"]) for row in asked if row["kontakte"] is not None for entry in row["kontakte"].values()} == {2}
