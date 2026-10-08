import asyncio
import re
from pathlib import Path
from typing import Final

import pytest
from pymongo import AsyncMongoClient
from pymongo.database import Database
from pymongo.errors import ServerSelectionTimeoutError

from tests.config import UNANSWERED_URI
from tests.tier import UNMARKED_USE, expired_transaction_kills, expired_transactions_refusal, refuse_server_fixtures

PLANTED = "tests/planted.py::test_planted"
MARKED = "tests/planted.py::test_marked"


def test_a_server_fixture_in_the_closure_is_refused_before_it_starts() -> None:
    with pytest.raises(pytest.fail.Exception, match="asks for `mongo_url` and carries no"):
        refuse_server_fixtures(PLANTED, ["address", "mongo_url"])


# Each refusal is driven the other way too: a guard failing every test passes every refusal case.
def test_a_closure_holding_no_server_fixture_passes() -> None:
    refuse_server_fixtures(PLANTED, ["address", "kontakt"])


def test_a_client_aimed_at_nothing_sends_no_command_and_passes() -> None:
    """The default tier's own idiom: a guard's refusal is told from a route that does not exist."""

    async def _refused() -> None:
        client = AsyncMongoClient(host=UNANSWERED_URI, serverSelectionTimeoutMS=100)
        try:
            with UNMARKED_USE.watching(PLANTED), pytest.raises(ServerSelectionTimeoutError):
                await client.admin.command("ping")
        finally:
            await client.close()

    asyncio.run(_refused())


@pytest.mark.db
def test_a_command_an_unmarked_test_sends_fails_it(mongo_database: Database) -> None:
    """The registration and the event together, against a server that answers."""

    with pytest.raises(pytest.fail.Exception, match="carries no `@pytest.mark.db` and sent a MongoDB server .*`ping` at "):
        with UNMARKED_USE.watching(PLANTED):
            mongo_database.command("ping")


@pytest.mark.db
def test_a_phase_nested_inside_another_hands_it_back_still_watched(mongo_database: Database) -> None:
    """A watch that ended by switching watching off would pass every command sent after it."""

    with pytest.raises(pytest.fail.Exception, match="sent a MongoDB server .*`ping`"):
        with UNMARKED_USE.watching(PLANTED):
            with UNMARKED_USE.watching(MARKED, marked=True):
                pass
            mongo_database.command("ping")


@pytest.mark.db
def test_a_fixture_built_for_an_unmarked_test_fails_the_teardown_it_finishes_in(mongo_database: Database) -> None:
    """Whichever test's teardown it finishes in, a marked one here, the command is its builder's."""

    fixture = object()
    with UNMARKED_USE.watching(PLANTED):
        UNMARKED_USE.building(fixture)
    with pytest.raises(pytest.fail.Exception, match="test_planted carries no .* `ping` at .* as `planted` tore down"):
        with UNMARKED_USE.watching(MARKED, marked=True):
            UNMARKED_USE.tearing_down()
            mongo_database.command("ping")
            UNMARKED_USE.torn_down(fixture, "planted")


@pytest.mark.db
def test_a_fixture_built_for_a_marked_test_tears_down_freely_in_an_unmarked_one(mongo_database: Database) -> None:
    """A session fixture a db test opened finishes in whichever test's teardown ends the session."""

    fixture = object()
    with UNMARKED_USE.watching(MARKED, marked=True):
        UNMARKED_USE.building(fixture)
    with UNMARKED_USE.watching(PLANTED):
        UNMARKED_USE.tearing_down()
        mongo_database.command("ping")
        UNMARKED_USE.torn_down(fixture, "planted")


@pytest.mark.db
def test_a_command_sent_before_a_fixture_s_teardown_starts_is_the_running_test_s(mongo_database: Database) -> None:
    """The twin above with the command moved ahead of the teardown: a marked builder excuses its own teardown alone."""

    fixture = object()
    with UNMARKED_USE.watching(MARKED, marked=True):
        UNMARKED_USE.building(fixture)
    with pytest.raises(pytest.fail.Exception, match="test_planted carries no .* `ping` at "):
        with UNMARKED_USE.watching(PLANTED):
            mongo_database.command("ping")
            UNMARKED_USE.tearing_down()
            UNMARKED_USE.torn_down(fixture, "planted")


# Run by pytest itself, so the hooks are reached as a session reaches them rather than called here.
# A session fixture finishes at the root, where a conftest below it is never asked.
PROBE_CONFTEST: Final = b"from tests.conftest import pytest_configure\n"

MARKED_FIXTURE: Final = "built_by_a_marked_test"

PROBE_SUITE: Final = f"""import os
from collections.abc import Iterator

import pytest
from pymongo import MongoClient


def _ping() -> None:
    client = MongoClient(os.environ["FL_TIER_PROBE_URL"])
    try:
        client.admin.command("ping")
    finally:
        client.close()


@pytest.fixture(scope="session")
def {MARKED_FIXTURE}() -> Iterator[None]:
    yield
    _ping()


@pytest.fixture(scope="session")
def built_by_an_unmarked_test() -> Iterator[None]:
    yield
    _ping()


@pytest.fixture(scope="module")
def module_fixture_a_marked_test_built() -> Iterator[None]:
    yield


@pytest.mark.db
def test_marked({MARKED_FIXTURE}: None, module_fixture_a_marked_test_built: None) -> None:
    pass


def test_unmarked(built_by_an_unmarked_test: None) -> None:
    pass


def test_unmarked_and_last(request: pytest.FixtureRequest) -> None:
    request.addfinalizer(_ping)
""".encode()


@pytest.mark.db
def test_a_session_s_teardown_is_charged_to_the_test_each_command_belongs_to(
    pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch, mongo_url: str
) -> None:
    """Every fixture finishes in the last test's teardown: a marked test's session fixture pings freely.

    An unmarked test's is charged to that test, and the last test's own finalizer to itself though a
    marked test's module fixture finishes next.
    """

    suite = pytester.path / "suite"
    suite.mkdir()
    (pytester.path / "pytest.ini").write_bytes(b"[pytest]\nmarkers =\n    db: a stand-in\n")
    (suite / "conftest.py").write_bytes(PROBE_CONFTEST)
    (suite / "test_probe.py").write_bytes(PROBE_SUITE)
    monkeypatch.setenv("FL_TIER_PROBE_URL", mongo_url)
    monkeypatch.setenv("PYTHONPATH", str(Path(__file__).resolve().parents[2]))
    result = pytester.runpytest_subprocess("-p", "no:cacheprovider", "-p", "no:xdist", "-m", "", str(suite))
    output = result.stdout.str()
    result.assert_outcomes(passed=3, errors=1)
    assert "test_unmarked carries no `@pytest.mark.db`" in output, output
    assert "as `built_by_an_unmarked_test` tore down" in output, output
    assert "test_unmarked_and_last carries no `@pytest.mark.db`" in output, output
    assert f"{MARKED_FIXTURE}` tore down" not in output, output


# --- a transaction the replica set aborted at its lifetime limit ------------------------------------------


def _status(kills: object, timed_out: object = 0) -> dict[str, object]:
    """`serverStatus` as the replica set answers it, cut to the counts the check reads."""
    return {"metrics": {"abortExpiredTransactions": {"passes": 4, "successfulKills": kills, "timedOutKills": timed_out}}}


@pytest.mark.parametrize(
    ("status", "kills"),
    [
        pytest.param(_status(3), 3, id="reported"),
        pytest.param(_status(0, 2), 2, id="timed-out-alone"),
        pytest.param(_status(1, 2), 3, id="both"),
        pytest.param({"metrics": {}}, None, id="metric-absent"),
        pytest.param({}, None, id="metrics-absent"),
        pytest.param(_status("3"), None, id="not-a-count"),
        pytest.param(_status(3, "2"), None, id="timed-out-not-a-count"),
        pytest.param({"metrics": {"abortExpiredTransactions": {"passes": 4, "successfulKills": 3}}}, None, id="timed-out-absent"),
    ],
)
def test_the_count_is_read_off_the_status_or_named_unread(status: dict[str, object], kills: int | None) -> None:
    """An absent count read as zero would pass every run the server stops reporting it on.

    `timed-out-alone` is load-bearing: an expired transaction whose operation was in flight is counted there and nowhere else.
    """
    assert expired_transaction_kills(status) == kills


def test_a_count_that_rose_during_the_run_fails_it_with_how_many_kills() -> None:
    refusal = expired_transactions_refusal(2, 3)

    assert refusal is not None
    assert "counted 1 kill(s)" in refusal, refusal


def test_a_count_that_did_not_move_passes() -> None:
    assert expired_transactions_refusal(2, 2) is None


def test_a_refusal_carries_the_cases_named_for_each_abort() -> None:
    refusal = expired_transactions_refusal(2, 3, lambda: ["\n  running as it opened: ['tests/a.py::test_left_open']"])

    assert refusal is not None
    assert refusal.endswith("running as it opened: ['tests/a.py::test_left_open']"), refusal


def test_an_unmoved_count_never_reads_the_server_s_log() -> None:
    """The naming reads the container's whole log, a cost no passing run pays."""

    def refuse_to_read() -> list[str]:
        raise AssertionError("the log was read for a count that did not move")

    assert expired_transactions_refusal(2, 2, refuse_to_read) is None


@pytest.mark.parametrize(("at_start", "now"), [(None, 0), (0, None), (None, None)], ids=["start", "end", "both"])
def test_a_count_not_read_at_either_end_is_named_unjudged(at_start: int | None, now: int | None) -> None:
    refusal = expired_transactions_refusal(at_start, now)

    assert refusal is not None
    assert "reported no number" in refusal and "was not judged" in refusal, refusal


def test_a_count_that_fell_is_named_unjudged_by_the_restart() -> None:
    refusal = expired_transactions_refusal(3, 1)

    assert refusal is not None
    assert "fewer expiry kills" in refusal and "mongod restart" in refusal and "was not judged" in refusal, refusal


# The controller's own path, its refusal handed a stand-in count: what a reader quotes is the closing line.
CLOSING_CONFTEST: Final = b"""import pytest

from tests.conftest import pytest_configure, pytest_sessionfinish, refuse_the_run
from tests.tier import expired_transactions_refusal


@pytest.hookimpl(wrapper=True)
def pytest_runtestloop(session):
    finished = yield
    refuse_the_run(session, expired_transactions_refusal(0, 1))
    return finished
"""


def test_a_run_the_expiry_check_fails_ends_on_the_line_saying_so(pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch) -> None:
    """Pytest's own closing line counts tests alone, so it would say "passed" over a run that failed."""
    suite = pytester.path / "suite"
    suite.mkdir()
    (suite / "conftest.py").write_bytes(CLOSING_CONFTEST)
    (suite / "test_passes.py").write_bytes(b"def test_passes() -> None:\n    pass\n")
    monkeypatch.setenv("PYTHONPATH", str(Path(__file__).resolve().parents[2]))
    result = pytester.runpytest_subprocess("-p", "no:cacheprovider", "-p", "no:xdist", str(suite))
    lines = [line for line in result.stdout.lines if line.strip()]

    assert result.ret == pytest.ExitCode.TESTS_FAILED, result.stdout.str()
    assert "FAILED" in lines[-1] and "counted 1 kill(s)" in lines[-1], result.stdout.str()


# The check itself, end to end through the hooks and the fixture that make it, against a stand-in
# replica set: a status whose count rose by one, and a log holding that abort and its transaction's
# record.
EXPIRY_CONFTEST: Final = b"""import json
import os
import time
from contextlib import contextmanager
from datetime import UTC, datetime

import pytest

import tests.conftest as harness
from tests.conftest import (
    REPLICA_SET_KEY,
    mongo_replica_set_url,
    pytest_configure,
    pytest_runtest_logreport,
    pytest_runtestloop,
    pytest_sessionfinish,
)

STAND_IN = "mongodb://stand-in"
SESSION = "6f0c1a52-0000-4000-8000-000000000001"
TXN_NUMBER = 4
OPEN_S = 60.0
OPENED: list[float] = []


TIMED_OUT = os.environ["FL_EXPIRY_KILL"] == "timed-out"
OTHER = "6f0c1a52-0000-4000-8000-000000000002"


def _entry(log_id, moment, attr, ctx="conn12"):
    return json.dumps({"t": {"$date": datetime.fromtimestamp(moment, UTC).isoformat()}, "ctx": ctx, "id": log_id, "attr": attr})


def _record(session, txn_number, open_s, inside, **writes):
    return {
        "parameters": {"lsid": {"id": {"$uuid": session}}, "txnNumber": txn_number},
        "timeActiveMicros": int(open_s * 1e6) if inside else 0,
        "timeInactiveMicros": 0 if inside else int(open_s * 1e6),
        **writes,
    }


class _Container:
    def get_logs(self):
        aborted = OPENED[0] + OPEN_S
        pass_thread = "abortExpiredTransactions"
        # Interrupted in flight, the transaction's time is spent inside its operation; left idle, outside it.
        record = _record(SESSION, TXN_NUMBER, OPEN_S, TIMED_OUT, ninserted=1)
        # The session's other transactions name no case if taken: one long before, one long after, and one
        # logged nearer the kill than this transaction's record wherever the kill names its number.
        records = [
            _entry(51802, aborted - 300, _record(SESSION, TXN_NUMBER - 2, 1, False)),
            _entry(51802, aborted - (0.5 if TIMED_OUT else 0), _record(SESSION, TXN_NUMBER - 1, 1, False)),
            _entry(51802, aborted + (0 if TIMED_OUT else 0.5), record),
            _entry(51802, aborted + 300, _record(SESSION, TXN_NUMBER + 1, 1, False)),
        ]
        if TIMED_OUT:
            # As mongod r8.3.11's expiry pass logs one, the session alone; a later pass meets it still running.
            kill = {"lsidToKill": {"id": {"$uuid": SESSION}}, "durationMillis": 100}
            kills = [_entry(11790801, aborted, kill, pass_thread), _entry(11790801, aborted + 1, kill, pass_thread)]
        else:
            abort = {"sessionId": {"uuid": {"$uuid": SESSION}}, "txnNumberAndRetryCounter": {"txnNumber": TXN_NUMBER}}
            kills = [_entry(20707, aborted, abort, pass_thread)]
        # Another session's timed-out checkout on another thread, a step-down's: no expiry, never named.
        other = [
            _entry(51802, aborted, _record(OTHER, 1, OPEN_S, True, nModified=7)),
            _entry(11790801, aborted, {"lsidToKill": {"id": {"$uuid": OTHER}}, "durationMillis": 100}, "conn40"),
        ]
        return "\\n".join(["not json", *records, *other, *kills]).encode(), b""


def _server_status(url):
    assert url == STAND_IN, url
    return {"metrics": {"abortExpiredTransactions": {"successfulKills": int(not TIMED_OUT), "timedOutKills": 2 * TIMED_OUT}}}


@contextmanager
def _replica_set_mongod():
    harness._KILLS_AT_START[STAND_IN] = 0
    harness._REPLICA_SET_CONTAINERS[STAND_IN] = _Container()
    yield STAND_IN


harness._server_status = _server_status
harness._replica_set_mongod = _replica_set_mongod
if os.environ["FL_EXPIRY_PROBE"] == "controller":
    harness._SHARED_SERVERS[REPLICA_SET_KEY] = STAND_IN
    harness._KILLS_AT_START[STAND_IN] = 0
    harness._REPLICA_SET_CONTAINERS[STAND_IN] = _Container()


@pytest.fixture
def left_open():
    OPENED.append(time.time())
"""

EXPIRY_SUITE: Final = {
    "controller": b"def test_left_open(left_open) -> None:\n    pass\n",
    # Asking for the server is what runs the fixture's teardown, the serial run's half of the check.
    "serial": b"import pytest\n\n\n@pytest.mark.db\ndef test_left_open(left_open, mongo_replica_set_url) -> None:\n    pass\n",
}

LEFT_OPEN: Final = "suite/test_left_open.py::test_left_open"


def _expiry_run(pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch, mode: str, kill: str = "successful") -> pytest.RunResult:
    suite = pytester.path / "suite"
    suite.mkdir()
    (pytester.path / "pytest.ini").write_bytes(b"[pytest]\nmarkers =\n    db: a stand-in\n")
    (suite / "conftest.py").write_bytes(EXPIRY_CONFTEST)
    (suite / "test_left_open.py").write_bytes(EXPIRY_SUITE[mode])
    monkeypatch.setenv("PYTHONPATH", str(Path(__file__).resolve().parents[2]))
    monkeypatch.setenv("FL_EXPIRY_PROBE", mode)
    monkeypatch.setenv("FL_EXPIRY_KILL", kill)

    return pytester.runpytest_subprocess("-p", "no:cacheprovider", "-p", "no:xdist", "-m", "", str(suite))


def _names_the_case_that_left_it_open(output: str) -> bool:
    """Opened and aborted a minute apart: the case is named at the opening alone only where the abort met its transaction's record.

    Named for one kill alone, though the timed-out shape logs two, and never for the other session's.
    """

    return (
        f"running as it opened: ['{LEFT_OPEN}']" in output
        and "running as it was aborted: none recorded" in output
        and len(set(re.findall(r"aborted at (\S+) after", output))) == 1
        and "'nModified': 7" not in output
    )


def test_the_controller_fails_a_run_whose_replica_set_aborted_an_expired_transaction(
    pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Under `-n`, where the case passes in a worker and only the controller still holds the server."""

    result = _expiry_run(pytester, monkeypatch, "controller")
    output = result.stdout.str()

    result.assert_outcomes(passed=1)
    assert result.ret == pytest.ExitCode.TESTS_FAILED, output
    assert "FAILED the db tier's replica set's expiry pass counted 1 kill(s)" in output, output
    assert _names_the_case_that_left_it_open(output), output


def test_a_run_names_the_case_whose_transaction_the_pass_could_not_check_out(
    pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The kill counted under `timedOutKills`, whose log line names the session and no transaction number."""

    result = _expiry_run(pytester, monkeypatch, "controller", kill="timed-out")
    output = result.stdout.str()

    result.assert_outcomes(passed=1)
    assert result.ret == pytest.ExitCode.TESTS_FAILED, output
    assert "FAILED the db tier's replica set's expiry pass counted 2 kill(s)" in output, output
    assert _names_the_case_that_left_it_open(output), output


def test_a_serial_run_fails_the_teardown_of_the_server_that_aborted_one(pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch) -> None:
    """Serially the server stops with the session fixture, before the controller's hook would ask it."""

    result = _expiry_run(pytester, monkeypatch, "serial")
    output = result.stdout.str()

    result.assert_outcomes(passed=1, errors=1)
    assert "counted 1 kill(s)" in output, output
    assert _names_the_case_that_left_it_open(output), output
