from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

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
_UNMARKED_COMMAND = "{test} carries no `@pytest.mark.db` and sent a MongoDB server {commands}."
_UNMARKED_ADVICE = (
    "The default tier starts no server, so this passes only where one happens to answer. Mark it, or keep it off the database"
    " (`docs/backend/spec.md` §1.6)."
)


def is_db_marked(item: pytest.Item) -> bool:
    return item.get_closest_marker("db") is not None


def refuse_server_fixtures(test: str, fixturenames: Iterable[str]) -> None:
    """Read from pytest's own fixture closure, which already holds a plugin's fixture and a `usefixtures`."""

    asked = sorted(SERVER_FIXTURES.intersection(fixturenames))
    if asked:
        pytest.fail(_UNMARKED_FIXTURE.format(test=test, fixtures=", ".join(f"`{name}`" for name in asked)), pytrace=False)


@dataclass
class _Phase:
    test: str
    marked: bool
    # Sent since the last fixture finished tearing down: whose they are is known only once the next
    # one does. Kept raw, a db test sending thousands that are never read.
    pending: list[tuple[str, str, int | None]] = field(default_factory=list)
    # Against the unmarked test each was sent for, which is not always the test whose phase this is.
    refused: list[tuple[str, str]] = field(default_factory=list)


def _named(sent: tuple[str, str, int | None]) -> str:
    command, host, port = sent
    return f"`{command}` at {host}:{port}"


class UnmarkedDatabaseUse(monitoring.CommandListener):
    """pytest-django's database block, held at the driver's documented listener rather than a patch.

    A command sent while a fixture tears down is the builder's (`docs/backend/spec.md` §1.6).
    """

    def __init__(self) -> None:
        self._phase: _Phase | None = None
        self._built_for_unmarked: dict[object, str] = {}

    # Recorded rather than raised: the driver prints a listener's exception and sends the command anyway.
    def started(self, event: monitoring.CommandStartedEvent) -> None:
        phase = self._phase
        if phase is not None and event.command_name not in _HOUSEKEEPING:
            host, port = event.connection_id
            phase.pending.append((event.command_name, host, port))

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        pass

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        pass

    @contextmanager
    def watching(self, test: str, *, marked: bool = False) -> Iterator[None]:
        """One phase of one test, which may be one nested inside another's; that one resumes as it was."""

        outer = self._phase
        phase = self._phase = _Phase(test, marked)
        try:
            yield
        finally:
            self._phase = outer
            if not marked:
                phase.refused += [(test, _named(sent)) for sent in phase.pending]
            # In the `finally`, so a test the database broke still names the database as the cause:
            # the test's own exception rides along as this one's context.
            if phase.refused:
                pytest.fail(_refusal(phase.refused), pytrace=False)

    def building(self, fixturedef: object) -> None:
        """A fixture is set up for the test whose phase is running, and its teardown is that test's."""

        phase = self._phase
        if phase is not None and not phase.marked:
            self._built_for_unmarked[fixturedef] = phase.test
        else:
            self._built_for_unmarked.pop(fixturedef, None)

    def torn_down(self, fixturedef: object, name: str) -> None:
        """What was sent since the last fixture finished is this one's teardown."""

        phase = self._phase
        if phase is None:
            return
        owner = self._built_for_unmarked.pop(fixturedef, None)
        if owner is not None:
            phase.refused += [(owner, f"{_named(sent)} as `{name}` tore down") for sent in phase.pending]
        phase.pending.clear()


def _refusal(refused: list[tuple[str, str]]) -> str:
    by_test: dict[str, list[str]] = {}
    for test, sent in refused:
        by_test.setdefault(test, []).append(sent)
    lines = [_UNMARKED_COMMAND.format(test=test, commands=", ".join(sent)) for test, sent in by_test.items()]
    return " ".join([*lines, _UNMARKED_ADVICE])


# One per process, registered by `tests/conftest.py :: pytest_configure`: `pymongo.monitoring` offers
# no way to unregister a listener, so a second registration would record every command twice.
UNMARKED_USE = UnmarkedDatabaseUse()


class TierGuard:
    """A plugin rather than `tests/conftest.py`'s own hooks.

    pytest asks a conftest about a fixture only from that fixture's scope's directory, so a session
    fixture's teardown would never reach one below the root.
    """

    # Setup as well as call and teardown: a fixture the test takes seeds in setup, and that is the
    # test's own use.
    @pytest.hookimpl(wrapper=True)
    def pytest_runtest_setup(self, item: pytest.Item) -> Iterator[None]:
        marked = is_db_marked(item)
        if not marked:
            refuse_server_fixtures(item.nodeid, getattr(item, "fixturenames", ()))
        with UNMARKED_USE.watching(item.nodeid, marked=marked):
            return (yield)

    @pytest.hookimpl(wrapper=True)
    def pytest_runtest_call(self, item: pytest.Item) -> Iterator[None]:
        with UNMARKED_USE.watching(item.nodeid, marked=is_db_marked(item)):
            return (yield)

    @pytest.hookimpl(wrapper=True)
    def pytest_runtest_teardown(self, item: pytest.Item) -> Iterator[None]:
        with UNMARKED_USE.watching(item.nodeid, marked=is_db_marked(item)):
            return (yield)

    # Before the fixture's own code, so one whose setup raises is still attributed when it finishes.
    @pytest.hookimpl(wrapper=True)
    def pytest_fixture_setup(self, fixturedef: pytest.FixtureDef[object]) -> Iterator[object]:
        UNMARKED_USE.building(fixturedef)
        return (yield)

    def pytest_fixture_post_finalizer(self, fixturedef: pytest.FixtureDef[object]) -> None:
        UNMARKED_USE.torn_down(fixturedef, fixturedef.argname)


TIER_GUARD = TierGuard()
