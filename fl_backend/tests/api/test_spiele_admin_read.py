from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from httpx import Response
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

from app.core.collections import Collection
from app.core.config import API_VERSION
from app.main import create_app
from tests.config import build_test_config

ADMIN_AUTH = {"Authorization": "Bearer test-key-admin"}
BASE_AUTH = {"Authorization": "Bearer test-key-base"}

# Which guard refused, and so which route answered: `verify_access_base` guards the public router
# and `verify_access_admin` the admin one, and no key satisfies both.
BASE_GUARD_REFUSED = "REQ-AUTH-002"
ADMIN_GUARD_REFUSED = "REQ-AUTH-004"

# Named rather than compared with `!=`: a control asserting only "not 401" passes on any failure,
# the harness's own included.
UNREACHED_DATABASE = "DB-FAIL-001"
DOCUMENT_NOT_FOUND = "DB-COMMON-001"

# Not the configured URI: a developer plausibly runs a real `mongod` on 27017, and a database that
# answers gives each control something other than the failure it asserts.
UNANSWERED_URI = "mongodb://localhost:1"

# Short for the unreachable URI above, so a control fails in a test's time rather than in Motor's
# default thirty seconds; ample for a container already accepting connections.
UNANSWERED_SELECTION_MS = 100
CONTAINER_SELECTION_MS = 10_000

SAISON_ID = "2026"

# Fixed rather than generated, so a failure names the same fixture every run.
SPIEL_ID = ObjectId("6890a1b2c3d4e5f607230001")
ABSENT_SPIEL_ID = ObjectId("6890a1b2c3d4e5f607230009")
SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f6072300a1")
HOME = ObjectId("6890a1b2c3d4e5f607230011")
AWAY = ObjectId("6890a1b2c3d4e5f607230012")
SPIELORT_ID = ObjectId("6890a1b2c3d4e5f607230021")
SCHIEDSRICHTER_ID = ObjectId("6890a1b2c3d4e5f607230022")

MIETPREIS = 80
PAYMENT = 30

PUBLIC_PATH = f"/api/v{API_VERSION}/spiele/{SPIEL_ID}"
ADMIN_PATH = f"{PUBLIC_PATH}/admin"

# Joined onto `team2`, which is how a response proves it came through `build_spiele_pipeline` rather
# than through a plain `find`.
AUSTRITT = {"type": "disqualifikation", "grund": "Nicht angetreten zum Spieltag", "datum": "2026-03-14"}


def spiel_document() -> dict[str, Any]:
    """Every field `FLSpielJoined` requires, so a response that validates proves the whole shape rather than the fields asserted on."""

    return {
        "_id": SPIEL_ID,
        "spiel_nr": 1,
        "saison_id": SAISON_ID,
        "saison_phase": "gruppenphase",
        "spieltag_id": SPIELTAG_ID,
        "team1": {"team_id": HOME, "name": "Alpha", "shorthand": "AL", "tore": 2},
        "team2": {"team_id": AWAY, "name": "Beta", "shorthand": "BE", "tore": 1},
        "team1_quelle": None,
        "team2_quelle": None,
        "datum": "2026-03-15",
        "uhrzeit": "14:00:00",
        "ort": {"spielort_id": SPIELORT_ID, "name": "Sportplatz Ost", "maps_link": "Sportplatz Ost, Frankfurt", "mietpreis": MIETPREIS},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER_ID, "name": "Ada Kern", "payment": PAYMENT},
        "ergebnis": "2:1",
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "notiz": None,
    }


def junction_row() -> dict[str, Any]:
    """A dict rather than a model: `saison_teams` has no model of the row."""

    return {"saison_id": SAISON_ID, "team_id": AWAY, "gruppe": "A", "austritt": dict(AUSTRITT), "name": "Beta", "shorthand": "BE"}


def answered(uri: str, path: str, headers: Mapping[str, str], *, selection_timeout_ms: int) -> Response:
    """One request per client: Motor binds to the loop `TestClient` first ran on.

    No lifespan either, for the reason `fl_backend/tests/api/test_malformed_ids.py :: client` gives.
    """

    app = create_app(build_test_config())
    app.state.db_client = AsyncIOMotorClient(host=uri, serverSelectionTimeoutMS=selection_timeout_ms)

    try:
        return TestClient(app, raise_server_exceptions=False).get(path, headers=dict(headers))
    finally:
        app.state.db_client.close()


@pytest.fixture
def seeded_url(mongo_container: Any) -> Iterator[str]:
    """The fixture and its junction row, in the database `build_test_config` names -- the one the app resolves its collections from."""

    url = str(mongo_container.get_connection_url())
    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        client.drop_database(database_name)
        database = client[database_name]
        database[Collection.SPIELE].insert_one(spiel_document())
        database[Collection.SAISON_TEAMS].insert_one(junction_row())

        yield url
    finally:
        client.drop_database(database_name)
        client.close()


# The shadowing proof. Both routers mount at the same prefix, so the question is which one answers
# each path -- and the guard that refuses a wrong key names it, no database needed.
GUARD_CASES = [
    pytest.param(ADMIN_PATH, BASE_AUTH, ADMIN_GUARD_REFUSED, id="the admin path is the admin router's"),
    pytest.param(PUBLIC_PATH, ADMIN_AUTH, BASE_GUARD_REFUSED, id="the public path is still the public router's"),
]


@pytest.mark.parametrize(("path", "headers", "error_code"), GUARD_CASES)
def test_the_wrong_key_is_refused_by_the_guard_of_the_route_that_matched(path: str, headers: Mapping[str, str], error_code: str):
    """A base credential reaching the admin read is the failure that matters: it carries the rent and the referee's Entschädigung."""

    response = answered(UNANSWERED_URI, path, headers, selection_timeout_ms=UNANSWERED_SELECTION_MS)

    assert response.status_code == 401
    assert response.json()["error_code"] == error_code


REACHING_CASES = [
    pytest.param(ADMIN_PATH, ADMIN_AUTH, id="the admin key on the admin path"),
    pytest.param(PUBLIC_PATH, BASE_AUTH, id="the base key on the public path"),
]


@pytest.mark.parametrize(("path", "headers"), REACHING_CASES)
def test_the_matching_key_clears_the_guard_and_reaches_the_database(path: str, headers: Mapping[str, str]):
    """The control for the pair above: without it, a refusal from a route that does not exist would read as the guard's."""

    response = answered(UNANSWERED_URI, path, headers, selection_timeout_ms=UNANSWERED_SELECTION_MS)

    assert response.status_code == 500
    assert response.json()["error_code"] == UNREACHED_DATABASE


@pytest.mark.parametrize("spiel_id", ["not-an-id", "z" * 24, str(SPIEL_ID)[:-1], f"{SPIEL_ID}0"])
def test_a_malformed_id_is_a_404_on_the_admin_path_too(spiel_id: str):
    """`by_id`, not a bare `{spiel_id}`: the convertor is what keeps a malformed path id off the 422 a query id gets."""

    path = f"/api/v{API_VERSION}/spiele/{spiel_id}/admin"

    assert answered(UNANSWERED_URI, path, ADMIN_AUTH, selection_timeout_ms=UNANSWERED_SELECTION_MS).status_code == 404


@pytest.mark.db
def test_the_admin_key_gets_the_fixture_with_the_rent_and_the_payment(seeded_url: str):
    """The endpoint's whole point: the two figures the editor round-trips arrive, joined as the public read's shape joins them."""

    response = answered(seeded_url, ADMIN_PATH, ADMIN_AUTH, selection_timeout_ms=CONTAINER_SELECTION_MS)

    assert response.status_code == 200
    spiel = response.json()["spiel"]
    assert spiel["id"] == str(SPIEL_ID)
    assert spiel["ort"]["mietpreis"] == MIETPREIS
    assert spiel["schiedsrichter"]["payment"] == PAYMENT
    # The joined field, which only `build_spiele_pipeline` produces. The route out and not the
    # record: the reason is free text about a school, and only a club's own page renders it.
    assert spiel["team2"]["austritt_type"] == AUSTRITT["type"]
    assert spiel["team1"]["austritt_type"] is None


@pytest.mark.db
def test_an_id_naming_no_fixture_is_a_404(seeded_url: str):
    """Well-formed and absent, so the 404 is the handler's answer to an empty aggregation rather than the convertor's."""

    response = answered(
        seeded_url,
        f"/api/v{API_VERSION}/spiele/{ABSENT_SPIEL_ID}/admin",
        ADMIN_AUTH,
        selection_timeout_ms=CONTAINER_SELECTION_MS,
    )

    assert response.status_code == 404
    assert response.json()["error_code"] == DOCUMENT_NOT_FOUND
