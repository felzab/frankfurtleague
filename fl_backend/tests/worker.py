import os
from typing import Any, Callable

import pytest
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.database import Database

# `xdist/remote.py` sets this in every worker process; it is absent on a serial run and on the xdist
# controller, where a bare name is already this process's alone.
WORKER = os.environ.get("PYTEST_XDIST_WORKER", "")

# Mongo's own, opened by the driver's handshake and by the fixtures' `ping`, `hello` and
# `replSetInitiate`. No suite seeds through it, so exempting it costs the guard nothing.
_SERVER_OWNED = frozenset({"admin"})

# Every name `worker_database` handed out in THIS process. Membership rather than a suffix test: the
# suffix is empty on a serial run, so a name's spelling cannot say whether it was ever issued.
_ISSUED: set[str] = set()

_UNISSUED = (
    "'{database}' was opened without passing through `tests/worker.py :: worker_database`. Every database this suite opens goes"
    " through it, so that two workers of one run cannot hold one name; two holding one would each empty the other's seeds mid-test,"
    " and the test that failed for it would be somewhere else entirely."
)

# A handle rather than a bare assignment: pytest's own patcher restores what it replaced, and the
# install below runs from a hook, so importing this module patches nothing by itself.
_PATCH = pytest.MonkeyPatch()


def worker_database(name: str) -> str:
    """`name` under this worker alone, recorded so that opening it is permitted.

    Workers share one `mongod` and are separate processes, so a name is only isolating while it
    carries the worker that chose it.
    """

    scoped = f"{name}_{WORKER}" if WORKER else name
    _ISSUED.add(scoped)

    return scoped


def assert_worker_database(name: str) -> None:
    """Refuses a database name this process never issued, at the open rather than in a neighbour's assertion."""

    if name not in _SERVER_OWNED and name not in _ISSUED:
        raise AssertionError(_UNISSUED.format(database=name))


def _guarded(open_database: Callable[..., None]) -> Callable[..., None]:
    def __init__(self: Any, client: Any, name: str, *args: Any, **kwargs: Any) -> None:
        assert_worker_database(name)
        open_database(self, client, name, *args, **kwargs)

    return __init__


def guard_every_database() -> None:
    """The rule held at the driver's own constructor, so a suite hand-rolling `client[name]` cannot sidestep it.

    Both classes: a fixture seeding through `MongoClient` opens the synchronous one, and the async
    seeds and the app under test open the other.
    """

    for opened in (Database, AsyncDatabase):
        _PATCH.setattr(opened, "__init__", _guarded(opened.__init__))


def release_every_database() -> None:
    """The driver back as it was, so a session that ends leaves nothing patched behind it."""

    _PATCH.undo()
