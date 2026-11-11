import copy
import io
import logging
import re
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager
from typing import TYPE_CHECKING, Any

import pytest
from pydantic import BaseModel, ValidationError
from pymongo import MongoClient

from app.core.recording import actor_var
from tests.documents import EINWILLIGUNG, rules_document
from tests.tier import is_db_marked, refuse_server_fixtures
from tests.worker import guard_every_database, release_every_database

if TYPE_CHECKING:
    from testcontainers.core.container import DockerContainer

# testcontainers' reaper teardown logs after pytest closes its capture stream, printing a traceback on
# a passing run. Not `raiseExceptions = False`: that would hide real handler failures too.
logging.getLogger("urllib3").setLevel(logging.INFO)


# Fixed rather than generated: a failing test points at the same value every run.
TEAM_ID = "6890a1b2c3d4e5f607182930"
SPIEL_ID = "6890a1b2c3d4e5f607182931"
SPIELTAG_ID = "6890a1b2c3d4e5f607182932"
SPIELORT_ID = "6890a1b2c3d4e5f607182933"
SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607182934"
SPIELER_ID = "6890a1b2c3d4e5f607182935"

PayloadFactory = Callable[..., dict[str, Any]]


def _factory(base: dict[str, Any]) -> PayloadFactory:
    """`deepcopy`, not shallow: several bases nest dicts, and two calls in one test would share the inner object."""

    def make(**overrides: Any) -> dict[str, Any]:
        payload = copy.deepcopy(base)
        payload.update(overrides)
        return payload

    return make


@pytest.fixture(autouse=True)
def an_administrator_bound() -> Iterator[None]:
    """What `bind_actor` binds on a request, for the suite's direct calls of an admin handler, which `record_act` reads.

    Set in the test's own context, which `tests/database.py :: on_the_seed_loop` copies into a seed's task, and bound to
    nobody again for what `tests/app_client.py :: app_client` serves.
    """

    token = actor_var.set("admin@frankfurtleague.de")
    yield
    actor_var.reset(token)


RejectsAssertion = Callable[[type[BaseModel], dict[str, Any], str], ValidationError]


@pytest.fixture
def assert_rejects() -> RejectsAssertion:
    """Names the field that refused: a payload rejected for an UNRELATED field would otherwise read as the constraint holding."""

    def _assert(model: type[BaseModel], payload: dict[str, Any], field: str) -> ValidationError:
        with pytest.raises(ValidationError) as excinfo:
            model.model_validate(payload)

        failed = [str(error["loc"][-1]) for error in excinfo.value.errors() if error["loc"]]
        assert field in failed, f"expected {model.__name__} to reject {field!r}, but the failing field(s) were {failed}"

        return excinfo.value

    return _assert


@pytest.fixture
def address() -> PayloadFactory:
    return _factory(
        {
            "street": "Hanauer Landstraße",
            "house_number": "12a",
            "postcode": "60314",
            "district": "Ostend",
            "city": "Frankfurt am Main",
        }
    )


@pytest.fixture
def kontakt() -> PayloadFactory:
    return _factory({"phone": "+49 69 1234567", "email": "kontakt@example.com"})


@pytest.fixture
def statistik() -> PayloadFactory:
    return _factory(
        {
            "count_played_spiele": 3,
            "siege": 2,
            "niederlagen": 1,
            "unentschieden": 0,
            "tore_scored": 7,
            "tore_conceded": 4,
            "punkte": 6,
            "count_cancelled_spiele": 1,
        }
    )


@pytest.fixture
def team(address: PayloadFactory, statistik: PayloadFactory) -> PayloadFactory:
    return _factory(
        {
            "_id": TEAM_ID,
            "name": "Carl-Schurz",
            "gruppe": "A",
            "statistik": statistik(),
            "austritt": None,
            "shorthand": "CSX",
            "description": "",
            "schulform": "gymnasium_g9",
            "full_name": "Carl-Schurz-Schule",
            "website_url": "https://carl-schurz-schule.de",
            "address": address(),
            "inactive_since": None,
        }
    )


@pytest.fixture
def spiel_team_field() -> PayloadFactory:
    return _factory({"team_id": TEAM_ID, "tore": 2})


@pytest.fixture
def spielort_field() -> PayloadFactory:
    return _factory({"spielort_id": SPIELORT_ID, "mietpreis": 80})


@pytest.fixture
def spiel_schiedsrichter_field() -> PayloadFactory:
    return _factory({"schiedsrichter_id": SCHIEDSRICHTER_ID, "payment": 20})


@pytest.fixture
def spiel(
    spiel_team_field: PayloadFactory,
    spielort_field: PayloadFactory,
    spiel_schiedsrichter_field: PayloadFactory,
) -> PayloadFactory:
    return _factory(
        {
            "_id": SPIEL_ID,
            "team1": spiel_team_field(),
            "team2": spiel_team_field(team_id=SPIELER_ID, tore=1),
            # A group-phase fixture: both sides are drawn by the schedule, so neither has a source.
            "team1_quelle": None,
            "team2_quelle": None,
            "date": "2026-03-15",
            "time": "18:00:00",
            "spielort": spielort_field(),
            "schiedsrichter": spiel_schiedsrichter_field(),
            "ergebnis": "2:1",
            "elfmeterschiessen": None,
            "spieltag_id": SPIELTAG_ID,
            "spiel_nr": 1,
            "sonderereignis": None,
            "saison_phase": "gruppenphase",
            "saison_id": "2026",
        }
    )


@pytest.fixture
def einwilligung() -> PayloadFactory:
    return _factory(dict(EINWILLIGUNG))


@pytest.fixture
def saison() -> PayloadFactory:
    return _factory(
        {
            "_id": "2026",
            "start_date": "2026-01-01",
            "end_date": "2026-06-30",
            "status": "active",
            # The points the model suites read back, and the shape the schedule below follows from, passed
            # rather than left to the builder's default.
            "rules": rules_document(win_points=3, number_of_gruppen=4, teams_per_gruppe=4, qualifiers_per_gruppe=2),
            "bewerbung": None,
            "registrierung": None,
            # Derived and on no document; spelled out rather than computed, so a `schedule_for` change shows here.
            "schedule": [
                {"phase": "gruppenphase", "spieltage": 3, "matches_per_spieltag": 8},
                {"phase": "viertelfinale", "spieltage": 1, "matches_per_spieltag": 4},
                {"phase": "halbfinale", "spieltage": 1, "matches_per_spieltag": 2},
                {"phase": "finale", "spieltage": 1, "matches_per_spieltag": 2},
            ],
        }
    )


# The container's image, by tag and digest (`docs/ops/spec.md` §1.1): the local stack's server, with
# its full version, which `scripts/tests/test_image_pins.py` holds to that form.
MONGO_IMAGE = "mongo:8.3.13@sha256:0e900a3364da37b76d642b73b0bba56bd4c6c509ab470cf700436fd866bee3ff"

# A majority write's acknowledgement waits on the oplog entry reaching the journal, and this
# container's data is discarded at session end, so the disk buys nothing the tier needs.
TMPFS_DATA_PATH = "/data/db"
# Docker's raw mount options, not a size: `with_tmpfs_mount`'s docstring offers `1g`, which the
# daemon refuses at start. Bounded at all because an unsized tmpfs takes half the host's memory.
TMPFS_DATA_OPTIONS = "size=1g"

# Megabytes, and it moves with the bound above: mongod would derive its 990 MiB floor, a ceiling
# over the ~820 MiB the mount leaves free. It truncates on that, not the filesystem: a full mount
# is ENOSPC, then `WT_PANIC`, then a dead container.
REPLICA_SET_OPLOG_MB = 128

# In the url `_elected` builds: a streaming monitor's close leaves no
# TIME_WAIT on Windows, so its port is reused at once, and under load WSL's mirrored loopback
# relay stalls a connect on it past the request deadline.
POLLING_MONITORS = "serverMonitoringMode=poll"

# What `pytest_configure_node` hands each worker, so one container serves the whole run.
REPLICA_SET_KEY = "fl_replica_set_mongodb_url"
# Handed to the workers in the url's place, so a test asking for a server fails naming the cause.
UNSTARTED_KEY = "fl_mongodb_unstarted"

REPLICA_SET_ELECTION_TIMEOUT_S = 60

# A server's reason for exiting is its last lines, and under `-n` the message carrying them repeats in
# every case the failed start errors.
FAILED_START_LOG_LINES = 10

# The controller's alone; empty on a serial run, where the fixture below starts its own.
_SHARED_SERVERS: dict[str, str] = {}
_UNSTARTED: dict[str, str] = {}
_SHARED_STACK = ExitStack()

_NO_SERVER = (
    "this test asked for a `mongod` under `-n`, and the xdist controller started none because the run's `-m` deselects the db tier."
    " A test wanting one carries `@pytest.mark.db`, and this one does not: without it, it runs in the default tier too, which has no server."
)

_UNSTARTABLE = "the xdist controller could not start the db tier's server, so no test needing one can run in this worker -- {reason}"


def _log_tail(container: DockerContainer) -> str | None:
    """`None` for a container the daemon never created, which ran nothing to log."""

    from testcontainers.core.exceptions import ContainerStartException

    try:
        wrapped = container.get_wrapped_container()
    except ContainerStartException:
        return None

    return wrapped.logs(tail=FAILED_START_LOG_LINES).decode("utf-8", errors="replace").rstrip()


@contextmanager
def _started(container: DockerContainer, ready: Callable[[], str]) -> Iterator[str]:
    """`with container:`, but a start failing before `ready` returns carries the tail of the container's log.

    Neither phase's own error carries it, and stopping the container discards it. In the message,
    never a note: `pytest_configure_node` hands the workers `str(error)`.
    """

    try:
        container.start()
        url = ready()
    except Exception as error:
        try:
            log = _log_tail(container)
        finally:
            container.stop()
        if log is None:
            raise
        raise RuntimeError(
            f"{type(error).__name__}: {error}\nThe container's last {FAILED_START_LOG_LINES} log lines:\n{log or '(it logged nothing)'}"
        ) from error
    except BaseException:
        container.stop()
        raise

    try:
        yield url
    finally:
        container.stop()


def _elected(container: DockerContainer) -> str:
    # `directConnection=true`: the set advertises its container-internal address, which topology discovery would follow and find nothing.
    url = f"mongodb://{container.get_container_host_ip()}:{container.get_exposed_port(27017)}/?directConnection=true&{POLLING_MONITORS}"

    client = MongoClient(url)
    try:
        client.admin.command("replSetInitiate", {"_id": "rs0", "members": [{"_id": 0, "host": "127.0.0.1:27017"}]})

        # Initiation returns before the node elects itself, and the first write then fails with `NotWritablePrimary`.
        deadline = time.monotonic() + REPLICA_SET_ELECTION_TIMEOUT_S
        while not client.admin.command("hello").get("isWritablePrimary"):
            if time.monotonic() > deadline:
                # Never `pytest.fail`: `Failed` is a `BaseException`, which `pytest_configure_node`'s
                # `except Exception` misses.
                raise TimeoutError(f"the single-node replica set did not become primary within {REPLICA_SET_ELECTION_TIMEOUT_S}s")
            time.sleep(0.25)
    finally:
        client.close()

    return url


@contextmanager
def _replica_set_mongod() -> Iterator[str]:
    """A single-node replica set: a standalone server refuses a transaction and a snapshot read, and no environment the app runs on is one."""

    from testcontainers.core.container import DockerContainer
    from testcontainers.core.wait_strategies import LogMessageWaitStrategy

    # `enableTestCommands` admits `configureFailPoint`, the one way to land a commit inside one server
    # command. A fail point is one setting every worker shares, so its cases sit in one module, which
    # `--dist loadfile` keeps on one worker.
    container = (
        DockerContainer(MONGO_IMAGE)
        # No `--auth`: with `--replSet` mongod demands a bind-mounted keyFile whose permissions it checks,
        # fragile on a Windows host.
        .with_command(f"--replSet rs0 --bind_ip_all --oplogSize {REPLICA_SET_OPLOG_MB} --setParameter enableTestCommands=1")
        .with_exposed_ports(27017)
        .with_tmpfs_mount(TMPFS_DATA_PATH, TMPFS_DATA_OPTIONS)
        .waiting_for(LogMessageWaitStrategy(re.compile(r"waiting for connections", re.IGNORECASE)))
    )

    with _started(container, lambda: _elected(container)) as url:
        yield url


def _start_shared_server() -> None:
    """Entered on the shared stack, which `pytest_unconfigure` closes; a start that raises stops its own container."""

    _SHARED_SERVERS[REPLICA_SET_KEY] = _SHARED_STACK.enter_context(_replica_set_mongod())


def _default_tier_markexpr(config: pytest.Config) -> str | None:
    """The `-m` that `fl_backend/pyproject.toml :: addopts` passes, or `None` where it passes none.

    Read rather than copied: a copy kept here drifts from that line with nothing to say so.
    """

    addopts: list[str] = config.getini("addopts")
    for index, option in enumerate(addopts):
        if option == "-m" and index + 1 < len(addopts):
            return addopts[index + 1].strip()
        if option.startswith("--markexpr="):
            return option.split("=", 1)[1].strip()

    return None


def pytest_configure(config: pytest.Config) -> None:
    # Windows gives a piped stream the ANSI code page, which writes a refusal's `§` as a byte no UTF-8
    # reader decodes. Set here rather than as `PYTHONUTF8`, which every launcher would have to export.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    guard_every_database()


# First, so the refusal lands before pytest sets up the server fixture it names.
@pytest.hookimpl(tryfirst=True)
def pytest_runtest_setup(item: pytest.Item) -> None:
    if not is_db_marked(item):
        refuse_server_fixtures(item.nodeid, getattr(item, "fixturenames", ()))


# `optionalhook`, because xdist SPECS this hook. Where an environment is behind `uv.lock` the plugin
# is absent, and pluggy answers an unknown hook with `PluginValidationError` -- an INTERNALERROR at
# exit 3 on every run, the default tier included.
@pytest.hookimpl(optionalhook=True)
def pytest_configure_node(node: Any) -> None:
    """xdist's controller hook, unreached without `-n`.

    A worker is a session of its own and would start a server of its own. The controller also KEEPS
    it: a server stops with its starter's teardown, and the reaper reclaims only after a kill.
    """

    # A cost heuristic, never a decision: the default tier's own `-m` is the one run known to want
    # no server, and any other spelling pays a start.
    if node.config.option.markexpr.strip() == _default_tier_markexpr(node.config):
        return

    if not _SHARED_SERVERS and not _UNSTARTED:
        try:
            _start_shared_server()
        except Exception as error:
            # Carried to the fixtures rather than raised: raising in this hook is an INTERNALERROR
            # with no test summary, on a run the heuristic above only guessed selects a db test.
            _SHARED_STACK.close()
            _SHARED_SERVERS.clear()
            _UNSTARTED[UNSTARTED_KEY] = f"{type(error).__name__}: {error}"

    node.workerinput.update(_SHARED_SERVERS or _UNSTARTED)


def pytest_unconfigure(config: pytest.Config) -> None:
    release_every_database()
    _UNSTARTED.clear()

    if _SHARED_SERVERS:
        _SHARED_SERVERS.clear()
        _SHARED_STACK.close()


def _shared(request: pytest.FixtureRequest) -> str | None:
    """The controller's url, or `None` on a serial run, where this process starts its own.

    A worker starts none: reaching this without one means a server the controller was never told
    about, and a server per worker is the arithmetic the shared one avoids.
    """

    workerinput: dict[str, Any] | None = getattr(request.config, "workerinput", None)
    if workerinput is None:
        return None

    url = workerinput.get(REPLICA_SET_KEY)
    if url is None:
        pytest.fail(_UNSTARTABLE.format(reason=workerinput[UNSTARTED_KEY]) if UNSTARTED_KEY in workerinput else _NO_SERVER)

    return str(url)


@pytest.fixture(scope="session")
def mongo_replica_set_url(request: pytest.FixtureRequest) -> Iterator[str]:
    """A url rather than a container: a connection string is all the suites take, and under `-n` the process holding it runs no test."""

    shared = _shared(request)
    if shared is not None:
        yield shared
        return

    with _replica_set_mongod() as url:
        yield url


@pytest.fixture(scope="session")
def mongo_url(mongo_replica_set_url: str) -> str:
    """The replica set's url, under a second name."""

    return mongo_replica_set_url
