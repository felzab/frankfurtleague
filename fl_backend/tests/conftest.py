"""
Shared fixtures for the schema suite, plus the one real `mongod` the whole session shares.

Every payload fixture is a **factory** returning a fresh, fully valid payload dict. Tests then
override the one field under test, so each case states exactly what makes it invalid and no test can
leak state into another through a shared mutable dict.

Payloads are keyed the way MongoDB serves them — `_id`, not `id` — because that is the validation
alias the models declare and therefore the shape they are actually validated against in production.

The container fixtures at the bottom live here rather than in `api/conftest.py` because two suites now
want a database: the executing team-pipeline tests and the executing constraint tests. Session-scoped,
so one container serves both (ADR-0030).
"""

import copy
import logging
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from pydantic import BaseModel, ValidationError
from pymongo.database import Database

from app.core.config import BackendConfig
from app.main import create_app
from tests.config import build_test_config

# testcontainers removes its reaper container from an `atexit` hook, which makes an HTTP call, which
# urllib3 logs at DEBUG -- by which point pytest has closed the stream its capture handler writes to.
# The logging module catches that itself and prints "--- Logging error ---" with a full traceback to
# stderr, AFTER a passing run and with the teardown having succeeded (the call returns 204).
#
# Silenced at the source rather than by suppressing logging errors globally: `raiseExceptions = False`
# would hide real handler failures too. urllib3's DEBUG stream is per-request chatter to the Docker
# daemon and diagnoses nothing here -- a container that fails to start raises instead.
logging.getLogger("urllib3").setLevel(logging.INFO)


@pytest.fixture(scope="session")
def test_config() -> BackendConfig:
    """The suite's settings. Built in `tests/config.py`, which says why they are not a fixture alone."""
    return build_test_config()


@pytest.fixture(scope="session")
def app(test_config: BackendConfig) -> FastAPI:
    """The application under test, built from `test_config` rather than from the environment."""
    return create_app(test_config)


# 24-hex ObjectId strings. Fixed rather than generated: a failing test should point at the same
# value every run.
TEAM_ID = "6890a1b2c3d4e5f607182930"
SPIEL_ID = "6890a1b2c3d4e5f607182931"
SPIELTAG_ID = "6890a1b2c3d4e5f607182932"
SPIELORT_ID = "6890a1b2c3d4e5f607182933"
SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607182934"
SPIELER_ID = "6890a1b2c3d4e5f607182935"

PayloadFactory = Callable[..., dict[str, Any]]


def _factory(base: dict[str, Any]) -> PayloadFactory:
    """
    Returns a callable producing a fresh copy of `base`, with `**overrides` applied.

    `deepcopy`, not a one-level dict comprehension: no fixture nests a dict inside a dict *today*,
    so one level happens to be enough, but the first time one does (an `address` inside
    `spiel_ort_field`, say) two calls in the same test would share the inner object and a mutation
    to one would be visible in the other. Copying properly costs nothing at this size.
    """

    def make(**overrides: Any) -> dict[str, Any]:
        payload = copy.deepcopy(base)
        payload.update(overrides)
        return payload

    return make


RejectsAssertion = Callable[[type[BaseModel], dict[str, Any], str], ValidationError]


@pytest.fixture
def assert_rejects() -> RejectsAssertion:
    """
    Assert a payload fails validation **because of a named field**, and return the error.

    A bare `pytest.raises(ValidationError)` passes whatever went wrong, so a test meant to prove one
    constraint can be satisfied by an unrelated typo in the payload — it stays green while the
    constraint it names goes unenforced. Use this wherever more than one field could plausibly fail,
    and always where the payload is hand-built rather than produced by a factory.

    A fixture rather than a module-level function because `--import-mode=importlib` does not put
    `conftest` on `sys.path`; fixtures are how pytest shares helpers without an import.

    The field is matched against the last element of the error location, so nested payloads work
    (`("ort", "mietpreis")` matches `"mietpreis"`) without the caller spelling out the path.
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
            "is_disqualified": False,
            "shorthand": "CS",
            "description": "",
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
            # A group-phase fixture: both sides are drawn by the schedule rather than fed by the
            # standings or by an earlier match, so neither carries a source (ADR-0041, ADR-0042).
            "team1_quelle": None,
            "team2_quelle": None,
            "datum": "2026-03-15",
            "uhrzeit": "18:00:00",
            "ort": spiel_ort_field(),
            "schiedsrichter": spiel_schiedsrichter_field(),
            "ergebnis": "2:1",
            "spieltag_id": SPIELTAG_ID,
            "spiel_nr": 1,
            "is_canceled": False,
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
def spieler() -> PayloadFactory:
    return _factory(
        {
            "_id": SPIELER_ID,
            "vorname": "Max",
            "nachname": "Mustermann",
            "stufe": "Q2",
            "nummer": "10",
            "position": "Sturm",
            "is_nachgetragen": False,
            "team_id": TEAM_ID,
            "inactive_since": None,
        }
    )


@pytest.fixture
def spieltag() -> PayloadFactory:
    return _factory(
        {
            "_id": SPIELTAG_ID,
            "name": "1. Spieltag",
            "beginn": "2026-03-15",
            "ende": "2026-03-15",
            "anzahl_spiele": 4,
            "order_val": 0,
            "saison_phase": "gruppenphase",
            "saison_id": "2026",
            "inactive_since": None,
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
            "rules": {"win_points": 3, "draw_points": 1},
        }
    )


# ── The real mongod, for the `db` tier only (ADR-0030) ──────────────────────────────────────────────


@pytest.fixture(scope="session")
def mongo_container() -> Iterator[Any]:
    """
    A real `mongod`, started once for the whole session and thrown away after it.

    `mongo:8` is pinned rather than `:latest` for the reason every other image in this repo is: a test
    that silently starts running against a different engine version is a test whose result changed for
    a reason nobody recorded.

    The import is deliberately inside the function. This module holds the fast schema suite's fixtures
    too, so it is imported on every run — importing `testcontainers` at module scope would make the
    default tier depend on a package it never uses, and pytest would pay for it 250 times.

    `testcontainers.community.mongodb` is the current path; `testcontainers.mongodb` still resolves
    and emits a DeprecationWarning.

    Yields the CONTAINER, not a client, because the two consumers want different drivers: the pipeline
    suite reads with pymongo and the constraint suite drives Motor, which needs the URL.
    """
    from testcontainers.community.mongodb import MongoDbContainer

    with MongoDbContainer("mongo:8") as container:
        yield container


@pytest.fixture(scope="session")
def mongo_database(mongo_container: Any) -> Iterator[Database]:
    """The pymongo handle onto that container, on a database named for the suite rather than `test`."""
    client = mongo_container.get_connection_client()
    try:
        yield client["fl_test"]
    finally:
        client.close()
