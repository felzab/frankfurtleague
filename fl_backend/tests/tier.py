from collections.abc import Iterable

import pytest

# The fixture that starts or hands out the server, in the closure of every fixture asking for it.
# Refused at setup, before the container starts, so a machine with no Docker daemon reads the missing
# marker rather than the daemon's own error.
SERVER_FIXTURES = frozenset({"mongo_replica_set_url"})

_UNMARKED_FIXTURE = "{test} asks for {fixtures} and carries no `@pytest.mark.db`. The default tier starts no server, so mark it."


def is_db_marked(item: pytest.Item) -> bool:
    return item.get_closest_marker("db") is not None


def refuse_server_fixtures(test: str, fixturenames: Iterable[str]) -> None:
    """Read from pytest's own fixture closure, which already holds a plugin's fixture and a `usefixtures`."""

    asked = sorted(SERVER_FIXTURES.intersection(fixturenames))
    if asked:
        pytest.fail(_UNMARKED_FIXTURE.format(test=test, fixtures=", ".join(f"`{name}`" for name in asked)), pytrace=False)
