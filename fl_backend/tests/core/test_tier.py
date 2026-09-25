import asyncio
from pathlib import Path
from typing import Final

import pytest
from pymongo import AsyncMongoClient
from pymongo.database import Database
from pymongo.errors import ServerSelectionTimeoutError

from tests.config import UNANSWERED_URI
from tests.tier import UNMARKED_USE, refuse_server_fixtures

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
