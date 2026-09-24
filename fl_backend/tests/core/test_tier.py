import asyncio

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
            mongo_database.command("ping")
            UNMARKED_USE.torn_down(fixture, "planted")


@pytest.mark.db
def test_a_fixture_built_for_a_marked_test_tears_down_freely_in_an_unmarked_one(mongo_database: Database) -> None:
    """A session fixture a db test opened finishes in whichever test's teardown ends the session."""

    fixture = object()
    with UNMARKED_USE.watching(MARKED, marked=True):
        UNMARKED_USE.building(fixture)
    with UNMARKED_USE.watching(PLANTED):
        mongo_database.command("ping")
        UNMARKED_USE.torn_down(fixture, "planted")
