import copy
import logging
import re
import time
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError
from pymongo import MongoClient
from pymongo.database import Database

from tests.worker import worker_database

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
    """A fixture, not a helper: `--import-mode=importlib` keeps `conftest` off `sys.path`. When to prefer it: `docs/backend/spec.md` §1.6."""

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
    return _factory(
        {
            "umfang": "kader_oeffentlich",
            "erteilt_von": "erziehungsberechtigt",
            "datum": "2026-01-15",
            "bestaetigt_am": "2026-01-20",
        }
    )


@pytest.fixture
def saison_spieler() -> PayloadFactory:
    """The junction row as STORED, which is also what every payload and echo of it is a subset of."""

    return _factory(
        {
            "_id": SAISON_SPIELER_ID,
            "spieler_id": SPIELER_ID,
            "saison_id": "2026",
            "team_id": TEAM_ID,
            "is_nachgetragen": False,
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
            "is_nachgetragen": False,
            "rolle": None,
            "team_id": TEAM_ID,
            "inactive_since": None,
            # Collected rather than carried over, so the default corpus is the case the rule is for.
            "einwilligung": {
                "umfang": "kader_oeffentlich",
                "erteilt_von": "erziehungsberechtigt",
                "datum": "2026-01-15",
                "bestaetigt_am": "2026-01-20",
            },
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
            "rules": {
                "win_points": 3,
                "draw_points": 1,
                "qualifiers_per_group": 2,
                "number_of_groups": 4,
                "teams_per_group": 4,
                "tiebreak_order": "tordifferenz",
                "max_kadergroesse": 18,
                "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
                "erlaubte_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
            },
            # Derived and on no document; spelled out rather than computed, so a `schedule_for` change shows here.
            "schedule": [
                {"phase": "gruppenphase", "matchdays": 3, "matches_per_matchday": 8},
                {"phase": "viertelfinale", "matchdays": 1, "matches_per_matchday": 4},
                {"phase": "halbfinale", "matchdays": 1, "matches_per_matchday": 2},
                {"phase": "finale", "matchdays": 1, "matches_per_matchday": 1},
            ],
        }
    )


# What `pytest_configure_node` hands each worker, so one pair of containers serves the whole run.
STANDALONE_KEY = "fl_standalone_mongodb_url"
REPLICA_SET_KEY = "fl_replica_set_mongodb_url"

REPLICA_SET_ELECTION_TIMEOUT_S = 60

# The controller's own, never a worker's: a worker process holds neither, and both are empty on a
# serial run, where the fixtures below start containers of their own.
_SHARED_SERVERS: dict[str, str] = {}
_SHARED_STACK = ExitStack()

# `fl_backend/pyproject.toml :: addopts`, the one run wanting no server. A cost heuristic: it names
# the marker deselecting every test that would ask for one, so a stale spelling costs two idle
# containers and nothing else.
_DEFAULT_TIER_MARKEXPR = "not db"


@contextmanager
def _standalone_mongod() -> Iterator[str]:
    """Imported inside the function, so the default tier never pays for `testcontainers`."""

    # The `community` path is the current one; the bare `testcontainers.mongodb` still resolves, on
    # a DeprecationWarning.
    from testcontainers.community.mongodb import MongoDbContainer

    with MongoDbContainer("mongo:8") as container:
        yield str(container.get_connection_url())


@contextmanager
def _replica_set_mongod() -> Iterator[str]:
    """`_standalone_mongod`'s server answers any transaction with `IllegalOperation`, so the transactional endpoints need this second one."""

    from testcontainers.core.container import DockerContainer
    from testcontainers.core.wait_strategies import LogMessageWaitStrategy

    container = (
        DockerContainer("mongo:8")
        # No `--auth`: with `--replSet` mongod demands a bind-mounted keyFile whose permissions it checks,
        # fragile on a Windows host. The other container keeps its credentials for the limited-user tests.
        .with_command("--replSet rs0 --bind_ip_all")
        .with_exposed_ports(27017)
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
                    pytest.fail(f"the single-node replica set did not become primary within {REPLICA_SET_ELECTION_TIMEOUT_S}s")
                time.sleep(0.25)
        finally:
            client.close()

        yield url


def pytest_configure_node(node: Any) -> None:
    """xdist's controller hook, unreached without `-n`.

    A worker is a session of its own and would start both servers. The controller also KEEPS them:
    testcontainers' reaper reclaims a container when its starter disconnects.
    """

    if node.config.option.markexpr.strip() == _DEFAULT_TIER_MARKEXPR:
        return

    if not _SHARED_SERVERS:
        _SHARED_SERVERS[STANDALONE_KEY] = _SHARED_STACK.enter_context(_standalone_mongod())
        _SHARED_SERVERS[REPLICA_SET_KEY] = _SHARED_STACK.enter_context(_replica_set_mongod())

    node.workerinput.update(_SHARED_SERVERS)


def pytest_unconfigure(config: pytest.Config) -> None:
    """Runs in the controller and in every worker; only the controller ever filled the stack."""

    if _SHARED_SERVERS:
        _SHARED_SERVERS.clear()
        _SHARED_STACK.close()


def _shared(request: pytest.FixtureRequest, key: str) -> str | None:
    """The controller's url for this server, or `None` on a serial run, where this process starts its own."""

    return getattr(request.config, "workerinput", {}).get(key)


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


@pytest.fixture(scope="session")
def mongo_database(mongo_url: str) -> Iterator[Database]:
    client = MongoClient(mongo_url)
    try:
        yield client[worker_database("fl_test")]
    finally:
        client.close()
