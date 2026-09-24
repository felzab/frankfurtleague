from collections.abc import Iterable, Iterator
from contextlib import contextmanager

import pytest
from pymongo import monitoring

# The fixtures that start or hand out a server. Refused at setup, before the container starts, so a
# machine with no Docker daemon reads the missing marker rather than the daemon's own error.
SERVER_FIXTURES = frozenset({"mongo_url", "mongo_replica_set_url"})

# Sent by the driver on its own schedule -- a collected cursor, a client closing -- from whichever
# client holds it, so one opened by a db test can send them while an unmarked test is running.
_HOUSEKEEPING = frozenset({"killCursors", "endSessions"})

_UNMARKED_FIXTURE = (
    "{test} asks for {fixtures} and carries no `@pytest.mark.db`. The default tier starts no server, so mark it (`docs/backend/spec.md` §1.6)."
)
_UNMARKED_COMMAND = (
    "{test} sent {commands} to a MongoDB server and carries no `@pytest.mark.db`. The default tier starts no server,"
    " so this passes only where one happens to answer. Mark it, or keep it off the database (`docs/backend/spec.md` §1.6)."
)


def is_db_marked(item: pytest.Item) -> bool:
    return item.get_closest_marker("db") is not None


def refuse_server_fixtures(test: str, fixturenames: Iterable[str]) -> None:
    """Read from pytest's own fixture closure, which already holds a plugin's fixture and a `usefixtures`."""

    asked = sorted(SERVER_FIXTURES.intersection(fixturenames))
    if asked:
        pytest.fail(_UNMARKED_FIXTURE.format(test=test, fixtures=", ".join(f"`{name}`" for name in asked)), pytrace=False)


class UnmarkedDatabaseUse(monitoring.CommandListener):
    """pytest-django's database block, held at the driver's documented listener rather than a patch.

    `pymongo.monitoring.register` reaches every client constructed after it, sync and async alike.
    """

    def __init__(self) -> None:
        self._active = False
        self._sent: list[str] = []

    # Recorded rather than raised: the driver prints a listener's exception and sends the command anyway.
    def started(self, event: monitoring.CommandStartedEvent) -> None:
        if self._active and event.command_name not in _HOUSEKEEPING:
            host, port = event.connection_id
            self._sent.append(f"`{event.command_name}` to {host}:{port}")

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        pass

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        pass

    @contextmanager
    def watching(self, test: str) -> Iterator[None]:
        """One phase of one unmarked test."""

        self._sent.clear()
        self._active = True
        try:
            yield
        finally:
            self._active = False
            # In the `finally`, so a test the database broke still names the database as the cause:
            # the test's own exception rides along as this one's context.
            if self._sent:
                pytest.fail(_UNMARKED_COMMAND.format(test=test, commands=", ".join(self._sent)), pytrace=False)


# One per process, registered by `tests/conftest.py :: pytest_configure`: `pymongo.monitoring` offers
# no way to unregister a listener, so a second registration would record every command twice.
UNMARKED_USE = UnmarkedDatabaseUse()
