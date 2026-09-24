import asyncio

import pytest
from pymongo import AsyncMongoClient
from pymongo.database import Database
from pymongo.errors import ServerSelectionTimeoutError

from tests.tier import UNMARKED_USE, refuse_server_fixtures

PLANTED = "tests/planted.py::test_planted"

# Not the configured URI, for `tests/api/test_malformed_ids.py :: UNANSWERED_URI`'s reason.
UNANSWERED_URI = "mongodb://localhost:1"


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

    with pytest.raises(pytest.fail.Exception, match="`ping` to .* and carries no"):
        with UNMARKED_USE.watching(PLANTED):
            mongo_database.command("ping")
