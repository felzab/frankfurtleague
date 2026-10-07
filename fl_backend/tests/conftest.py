import copy
import io
import json
import logging
import re
import sys
import time
from collections.abc import Callable, Generator, Iterator, Mapping
from concurrent.futures import ThreadPoolExecutor
from contextlib import AbstractContextManager, ExitStack, contextmanager
from datetime import datetime
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError
from pymongo import MongoClient, monitoring
from pymongo.database import Database

from tests.documents import EINWILLIGUNG, rules_document
from tests.tier import TIER_GUARD, UNMARKED_USE, expired_transaction_kills, expired_transactions_refusal
from tests.worker import guard_every_database, release_every_database, worker_database

# testcontainers' reaper teardown logs after pytest closes its capture stream, printing a traceback on
# a passing run. Not `raiseExceptions = False`: that would hide real handler failures too.
logging.getLogger("urllib3").setLevel(logging.INFO)

# pytest's own, so `tests/core/test_tier.py` can run a session through the guard's registration; the
# refusal of a test module that collects nothing; and the db tier's choice of modules.
pytest_plugins = ("pytester", "tests.collection", "tests.db_modules")


# Fixed rather than generated: a failing test points at the same value every run.
TEAM_ID = "6890a1b2c3d4e5f607182930"
SPIEL_ID = "6890a1b2c3d4e5f607182931"
SPIELTAG_ID = "6890a1b2c3d4e5f607182932"
SPIELORT_ID = "6890a1b2c3d4e5f607182933"
SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607182934"
SPIELER_ID = "6890a1b2c3d4e5f607182935"
SAISON_SPIELER_ID = "6890a1b2c3d4e5f607182936"

PayloadFactory = Callable[..., dict[str, Any]]


def _factory(base: dict[str, Any]) -> PayloadFactory:
    """`deepcopy`, not shallow: several bases nest dicts, and two calls in one test would share the inner object."""

    def make(**overrides: Any) -> dict[str, Any]:
        payload = copy.deepcopy(base)
        payload.update(overrides)
        return payload

    return make


RejectsAssertion = Callable[[type[BaseModel], dict[str, Any], str], ValidationError]


@pytest.fixture
def assert_rejects() -> RejectsAssertion:
    """Names the field that refused: a payload rejected for an UNRELATED field would otherwise read as the constraint holding.

    When to prefer it: `docs/backend/spec.md` §1.6.
    """

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
            "strasse": "Hanauer Landstraße",
            "hausnummer": "12a",
            "plz": "60314",
            "stadtteil": "Ostend",
            "stadt": "Frankfurt am Main",
        }
    )


@pytest.fixture
def kontakt() -> PayloadFactory:
    return _factory({"telefon": "+49 69 1234567", "email": "kontakt@example.com"})


@pytest.fixture
def statistik() -> PayloadFactory:
    return _factory(
        {
            "anzahl_gespielte_spiele": 3,
            "siege": 2,
            "niederlagen": 1,
            "unentschieden": 0,
            "tore_geschossen": 7,
            "tore_kassiert": 4,
            "punkte": 6,
            "anzahl_abgesagte_spiele": 1,
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
            "shorthand": "CS",
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
    return _factory({"team_id": TEAM_ID, "name": "Carl-Schurz", "tore": 2, "shorthand": "CS"})


@pytest.fixture
def spiel_ort_field() -> PayloadFactory:
    return _factory({"spielort_id": SPIELORT_ID, "name": "Sportplatz Ost", "maps_link": "Sportplatz Ost, Frankfurt", "mietpreis": 80})


@pytest.fixture
def spiel_schiedsrichter_field() -> PayloadFactory:
    return _factory({"schiedsrichter_id": SCHIEDSRICHTER_ID, "name": "A. Referee", "payment": 20})


@pytest.fixture
def spiel(
    spiel_team_field: PayloadFactory,
    spiel_ort_field: PayloadFactory,
    spiel_schiedsrichter_field: PayloadFactory,
) -> PayloadFactory:
    return _factory(
        {
            "_id": SPIEL_ID,
            "team1": spiel_team_field(),
            "team2": spiel_team_field(team_id=SPIELER_ID, name="Lessing", shorthand="LE", tore=1),
            # A group-phase fixture: both sides are drawn by the schedule, so neither has a source.
            "team1_quelle": None,
            "team2_quelle": None,
            "datum": "2026-03-15",
            "uhrzeit": "18:00:00",
            "ort": spiel_ort_field(),
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
def spielort(address: PayloadFactory) -> PayloadFactory:
    return _factory(
        {
            "_id": SPIELORT_ID,
            "address": address(),
            "name": "Sportplatz Ost",
            "maps_link": "Sportplatz Ost, Frankfurt",
            "default_mietpreis": 80,
            "inactive_since": None,
        }
    )


@pytest.fixture
def schiedsrichter(kontakt: PayloadFactory) -> PayloadFactory:
    return _factory(
        {
            "_id": SCHIEDSRICHTER_ID,
            "name": "A. Referee",
            "schule": None,
            "default_payment": 20,
            "kontakt": kontakt(),
            "inactive_since": None,
        }
    )


@pytest.fixture
def einwilligung() -> PayloadFactory:
    return _factory(dict(EINWILLIGUNG))


@pytest.fixture
def saison_spieler() -> PayloadFactory:
    """The junction row as STORED, which is also what every payload and echo of it is a subset of."""

    return _factory(
        {
            "_id": SAISON_SPIELER_ID,
            "spieler_id": SPIELER_ID,
            "saison_id": "2026",
            "team_id": TEAM_ID,
            "ist_nachnominiert": False,
            "rolle": None,
            "stufe": "Q2",
            "position": "Angriff",
            "nummer": "10",
            "inactive_since": None,
        }
    )


@pytest.fixture
def spieler() -> PayloadFactory:
    return _factory(
        {
            "_id": SPIELER_ID,
            "vorname": "Max",
            "nachname": "Mustermann",
            "stufe": "Q2",
            "nummer": "10",
            # `Angriff`, not `Sturm`: the enum closed on this spelling.
            "position": "Angriff",
            "ist_nachnominiert": False,
            "rolle": None,
            "team_id": TEAM_ID,
            "inactive_since": None,
            # Collected rather than carried over, so the default corpus is the case the rule is for.
            "einwilligung": {**EINWILLIGUNG, "erteilt_von": "erziehungsberechtigt"},
        }
    )


@pytest.fixture
def spieltag() -> PayloadFactory:
    return _factory(
        {
            "_id": SPIELTAG_ID,
            # No `name`: a matchday's label is composed by the reader, from `position` and the phase.
            "beginn": "2026-03-15",
            "ende": "2026-03-15",
            "anzahl_spiele": 4,
            "position": 1,
            "saison_phase": "gruppenphase",
            "saison_id": "2026",
        }
    )


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
            "rules": rules_document(win_points=3, number_of_groups=4, teams_per_group=4, qualifiers_per_group=2),
            # Derived and on no document; spelled out rather than computed, so a `schedule_for` change shows here.
            "schedule": [
                {"phase": "gruppenphase", "matchdays": 3, "matches_per_matchday": 8},
                {"phase": "viertelfinale", "matchdays": 1, "matches_per_matchday": 4},
                {"phase": "halbfinale", "matchdays": 1, "matches_per_matchday": 2},
                {"phase": "finale", "matchdays": 1, "matches_per_matchday": 1},
            ],
        }
    )


# Both containers' image, by tag and digest (`docs/ops/spec.md` §1.1): the local stack's server, with
# its full version, which `scripts/tests/test_image_pins.py` holds to that form.
MONGO_IMAGE = "mongo:8.3.11@sha256:d731d77bfd7afd66bd487bdf627b5bf7ce4c3602ec461d635977021db529ebbc"

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

# What `pytest_configure_node` hands each worker, so one pair of containers serves the whole run.
STANDALONE_KEY = "fl_standalone_mongodb_url"
REPLICA_SET_KEY = "fl_replica_set_mongodb_url"
# Handed to the workers in the pair's place, so a test asking for a server fails naming the cause.
UNSTARTED_KEY = "fl_mongodb_unstarted"

REPLICA_SET_ELECTION_TIMEOUT_S = 60

# The controller's alone; empty on a serial run, where the fixtures below start their own.
_SHARED_SERVERS: dict[str, str] = {}
_UNSTARTED: dict[str, str] = {}
_SHARED_STACK = ExitStack()

_NO_SERVER = (
    "this test asked for a `mongod` under `-n`, and the xdist controller started none because the run's `-m` deselects the db tier."
    " A test wanting one carries `@pytest.mark.db`, and this one does not: without it, it runs in the default tier too, which has no server."
)

_UNSTARTABLE = "the xdist controller could not start the db tier's servers, so no test needing one can run in this worker -- {reason}"

# Each replica set's count as it became primary, so only the run's own expired transactions count.
_KILLS_AT_START: dict[str, int | None] = {}

# Each replica set's container, so a refusal can read when the server aborted each transaction.
_REPLICA_SET_CONTAINERS: dict[str, Any] = {}

# Each case's span, its setup's start to its teardown's end, on the clock the worker reports.
_CASE_SPANS: dict[str, list[float]] = {}

# mongod's log ids: the expired-transaction pass aborting one, and any transaction's record as it ends.
_EXPIRED_ABORT_LOG_ID = 20707
_TRANSACTION_LOG_ID = 51802

# The server's clock is the container's, which can sit a moment off the host's.
_CLOCK_SLACK_S = 2.0

# Set by the controller's check, printed after pytest's closing line: the refusal has no test to be reported against.
_EXPIRED_REFUSAL: list[str] = []


def _server_status(url: str) -> Mapping[str, Any]:
    """Apart from the judgement, so `tests/core/test_tier.py` can drive the hooks calling it against a stand-in server."""

    client = MongoClient(url)
    try:
        return client.admin.command("serverStatus")
    finally:
        client.close()


def _expired_since_start(url: str) -> str | None:
    """The refusal for a transaction the server aborted at its lifetime limit during this run, or `None`."""

    now = expired_transaction_kills(_server_status(url))

    return expired_transactions_refusal(_KILLS_AT_START.get(url), now, lambda: _named_aborts(url))


def _running_at(moment: float) -> list[str]:
    return sorted(case for case, (start, stop) in _CASE_SPANS.items() if start - _CLOCK_SLACK_S <= moment <= stop + _CLOCK_SLACK_S)


def _named_aborts(url: str) -> Iterator[str]:
    """Time spent inside an operation means a case waited on it, the deadlock; time spent idle means the case that opened it went on."""

    container = _REPLICA_SET_CONTAINERS.get(url)
    if container is None:
        return
    stdout, _ = container.get_logs()
    entries = [json.loads(line) for line in stdout.decode("utf-8", errors="replace").splitlines() if line.startswith("{")]
    # The abort names the session; the transaction's own record, logged by whichever thread unwinds it, carries its times.
    records = {
        (entry["attr"]["parameters"]["lsid"]["id"]["$uuid"], entry["attr"]["parameters"]["txnNumber"]): entry["attr"]
        for entry in entries
        if entry.get("id") == _TRANSACTION_LOG_ID and "parameters" in entry.get("attr", {})
    }
    for entry in entries:
        if entry.get("id") != _EXPIRED_ABORT_LOG_ID:
            continue
        session = (entry["attr"]["sessionId"]["uuid"]["$uuid"], entry["attr"]["txnNumberAndRetryCounter"]["txnNumber"])
        record = records.get(session, {})
        aborted = datetime.fromisoformat(entry["t"]["$date"]).timestamp()
        active_s = record.get("timeActiveMicros", 0) / 1e6
        inactive_s = record.get("timeInactiveMicros", 0) / 1e6
        writes = {key: value for key, value in record.items() if key in {"ninserted", "nModified", "ndeleted"}}
        opened = aborted - active_s - inactive_s
        yield (
            f"\n  aborted at {entry['t']['$date']} after {active_s + inactive_s:.1f} s open, {active_s:.1f} s of it inside an"
            f" operation, {writes or 'no writes recorded'}:\n    running as it opened: {_running_at(opened) or 'none recorded'}"
            f"\n    running as it was aborted: {_running_at(aborted) or 'none recorded'}"
        )


@contextmanager
def _standalone_mongod() -> Iterator[str]:
    """Imported inside the function, so the default tier never pays for `testcontainers`."""

    # The `community` path is the current one; the bare `testcontainers.mongodb` still resolves, on
    # a DeprecationWarning.
    from testcontainers.community.mongodb import MongoDbContainer

    with MongoDbContainer(MONGO_IMAGE).with_tmpfs_mount(TMPFS_DATA_PATH, TMPFS_DATA_OPTIONS) as container:
        yield str(container.get_connection_url())


@contextmanager
def _replica_set_mongod() -> Iterator[str]:
    """`_standalone_mongod`'s server refuses a transaction and a snapshot read alike, so every endpoint taking either needs this second one."""

    from testcontainers.core.container import DockerContainer
    from testcontainers.core.wait_strategies import LogMessageWaitStrategy

    # `enableTestCommands` admits `configureFailPoint`, the one way to land a commit inside a single
    # server command; every worker shares this server, so a failpoint names its case's own namespace.
    container = (
        DockerContainer(MONGO_IMAGE)
        # No `--auth`: with `--replSet` mongod demands a bind-mounted keyFile whose permissions it checks,
        # fragile on a Windows host. The other container keeps its credentials for the limited-user tests.
        .with_command(f"--replSet rs0 --bind_ip_all --oplogSize {REPLICA_SET_OPLOG_MB} --setParameter enableTestCommands=1")
        .with_exposed_ports(27017)
        .with_tmpfs_mount(TMPFS_DATA_PATH, TMPFS_DATA_OPTIONS)
        .waiting_for(LogMessageWaitStrategy(re.compile(r"waiting for connections", re.IGNORECASE)))
    )

    with container:
        # `directConnection=true`: the set advertises its container-internal address, which topology discovery would follow and find nothing.
        url = f"mongodb://{container.get_container_host_ip()}:{container.get_exposed_port(27017)}/?directConnection=true"

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
            _KILLS_AT_START[url] = expired_transaction_kills(client.admin.command("serverStatus"))
        finally:
            client.close()

        _REPLICA_SET_CONTAINERS[url] = container
        try:
            yield url
        finally:
            _REPLICA_SET_CONTAINERS.pop(url, None)


def _entered(factory: Callable[[], AbstractContextManager[str]]) -> tuple[AbstractContextManager[str], str]:
    """One server started, handed back unregistered: the stack it belongs on is the calling thread's to touch."""

    server = factory()

    return server, server.__enter__()


def _warm_the_reaper() -> None:
    """`Reaper.get_instance` tests and assigns unlocked, so two starts at once make two reapers.

    `ryuk_disabled` -- and `ryuk_docker_socket` and `ryuk_privileged` inside -- memoise the same way,
    so this is live with ryuk off.
    """

    from testcontainers.core.config import testcontainers_config
    from testcontainers.core.container import Reaper

    if not testcontainers_config.ryuk_disabled:
        Reaper.get_instance()


def _start_shared_servers() -> None:
    """Both servers at once, so the pair costs the longer start rather than the sum.

    They share no handle a thread could tear: a client is built per instance.
    """

    _warm_the_reaper()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {
            STANDALONE_KEY: pool.submit(_entered, _standalone_mongod),
            REPLICA_SET_KEY: pool.submit(_entered, _replica_set_mongod),
        }

    failure: BaseException | None = None
    for key, future in futures.items():
        # `exception()`, not `try`/`result()`: every server that started must reach the stack before
        # the raise, or the caller's `close()` cannot reclaim it.
        error = future.exception()
        if error is not None:
            failure = failure or error
            continue

        server, url = future.result()
        _SHARED_STACK.push(server)
        _SHARED_SERVERS[key] = url

    if failure is not None:
        raise failure


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
    monitoring.register(UNMARKED_USE)
    config.pluginmanager.register(TIER_GUARD, "fl-db-tier-guard")


# `optionalhook`, because xdist SPECS this hook. Where an environment is behind `uv.lock` the plugin
# is absent, and pluggy answers an unknown hook with `PluginValidationError` -- an INTERNALERROR at
# exit 3 on every run, the default tier included.
@pytest.hookimpl(optionalhook=True)
def pytest_configure_node(node: Any) -> None:
    """xdist's controller hook, unreached without `-n`.

    A worker is a session of its own and would start both servers. The controller also KEEPS them:
    testcontainers' reaper reclaims a container when its starter disconnects.
    """

    # A cost heuristic, never a decision: the default tier's own `-m` is the one run known to want
    # no server, and any other spelling pays a start.
    if node.config.option.markexpr.strip() == _default_tier_markexpr(node.config):
        return

    if not _SHARED_SERVERS and not _UNSTARTED:
        try:
            _start_shared_servers()
        except Exception as error:
            # Carried to the fixtures rather than raised: raising in this hook is an INTERNALERROR
            # with no test summary, on a run the heuristic above only guessed selects a db test.
            _SHARED_STACK.close()
            _SHARED_SERVERS.clear()
            _UNSTARTED[UNSTARTED_KEY] = f"{type(error).__name__}: {error}"

    node.workerinput.update(_SHARED_SERVERS or _UNSTARTED)


@pytest.hookimpl(wrapper=True)
def pytest_runtestloop(session: pytest.Session) -> Generator[None, object, object]:
    """Under `-n`, after every worker's last test and while the controller still holds the servers.

    A failure counted here is what pytest's own exit code reads, as `--cov-fail-under` does it.
    """

    finished = yield
    url = _SHARED_SERVERS.get(REPLICA_SET_KEY)
    expired = None if url is None else _expired_since_start(url)
    if expired is not None:
        refuse_the_run(session, expired)

    return finished


def refuse_the_run(session: pytest.Session, refusal: str) -> None:
    """The run's failure with no test to be reported against, counted where pytest's exit code reads it."""
    _EXPIRED_REFUSAL.append(refusal)
    session.testsfailed += 1


# Outermost, so it prints after pytest's own closing line: that line counts tests alone, and would
# read "passed" over a run this refusal failed.
@pytest.hookimpl(wrapper=True, tryfirst=True)
def pytest_sessionfinish(session: pytest.Session) -> Generator[None, object, object]:
    finished = yield
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    for refusal in _EXPIRED_REFUSAL:
        if reporter is not None:
            reporter.write_line(f"FAILED {refusal}", red=True)

    return finished


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    """Under `-n` the controller hears every worker's reports, so it holds every case's span when the check asks."""

    span = _CASE_SPANS.setdefault(report.nodeid, [report.start, report.stop])
    span[0] = min(span[0], report.start)
    span[1] = max(span[1], report.stop)


_EDITED_SHARED_APP = (
    "{module} edited the app `tests/core/app_source.py :: application` shares with every module in its process, {when}: {edits}."
    " Build an app of its own to edit. The edits are undone, so no later module is charged with them."
)


@pytest.hookimpl(wrapper=True)
def pytest_make_collect_report(collector: pytest.Collector) -> Generator[None, pytest.CollectReport, pytest.CollectReport]:
    """After each module's import: an edit made there precedes every test the module holds, so none of them could be charged with it."""

    report = yield
    if isinstance(collector, pytest.Module):
        # Here rather than at the top: the module imports the whole application, which the xdist
        # controller, collecting nothing, would otherwise pay for on every run.
        from tests.core.app_source import undo_edits_to_application

        if edits := undo_edits_to_application():
            report.outcome = "failed"
            report.longrepr = _EDITED_SHARED_APP.format(module=collector.nodeid, when="on import", edits="; ".join(edits))

    return report


@pytest.fixture(scope="module", autouse=True)
def _shared_app_left_as_built(request: pytest.FixtureRequest) -> Iterator[None]:
    """Torn down after the module's own fixtures, so an edit one of them made is seen."""

    yield
    from tests.core.app_source import undo_edits_to_application

    if edits := undo_edits_to_application():
        pytest.fail(_EDITED_SHARED_APP.format(module=request.node.nodeid, when="while its tests ran", edits="; ".join(edits)), pytrace=False)


def pytest_unconfigure(config: pytest.Config) -> None:
    release_every_database()
    _UNSTARTED.clear()

    if _SHARED_SERVERS:
        _SHARED_SERVERS.clear()
        _SHARED_STACK.close()


def _shared(request: pytest.FixtureRequest, key: str) -> str | None:
    """The controller's url, or `None` on a serial run, where this process starts its own.

    A worker starts none: reaching this without one means a server the controller was never told
    about, and a pair per worker is the arithmetic the shared pair avoids.
    """

    workerinput: dict[str, Any] | None = getattr(request.config, "workerinput", None)
    if workerinput is None:
        return None

    url = workerinput.get(key)
    if url is None:
        pytest.fail(_UNSTARTABLE.format(reason=workerinput[UNSTARTED_KEY]) if UNSTARTED_KEY in workerinput else _NO_SERVER)

    return str(url)


@pytest.fixture(scope="session")
def mongo_url(request: pytest.FixtureRequest) -> Iterator[str]:
    """A url rather than a container: a connection string is all the suites take, and under `-n` the process holding it runs no test."""

    shared = _shared(request, STANDALONE_KEY)
    if shared is not None:
        yield shared
        return

    with _standalone_mongod() as url:
        yield url


@pytest.fixture(scope="session")
def mongo_replica_set_url(request: pytest.FixtureRequest) -> Iterator[str]:
    """The transactional server; see `_replica_set_mongod` for why it is a second one."""

    shared = _shared(request, REPLICA_SET_KEY)
    if shared is not None:
        yield shared
        return

    with _replica_set_mongod() as url:
        yield url
        # The serial run's half of the check `pytest_runtestloop` makes under `-n`: this server stops
        # before that hook would ask it.
        expired = _expired_since_start(url)
        if expired is not None:
            pytest.fail(expired, pytrace=False)


@pytest.fixture(scope="session")
def mongo_database(mongo_url: str) -> Iterator[Database]:
    """UNCONSTRAINED, unlike `tests/database.py :: a_clean_database`, and its consumers are why.

    `tests/api/test_spieler_memberships_read.py :: squads` seeds a person predating `einwilligung`,
    which the shipped validator requires; and both it and `tests/api/conftest.py :: league` drop
    their collections, taking any validator with them.
    """

    client = MongoClient(mongo_url)
    try:
        yield client[worker_database("fl_test")]
    finally:
        client.close()
