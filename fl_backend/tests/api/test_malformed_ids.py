"""
CORE · what a malformed ObjectId answers in a path, and in a query

ADR-0057 ratifies the split rather than tolerating it: a path identifies, so an id naming nothing is
a 404, and a query validates, so a malformed one is a 422. Each is settled before a handler runs —
the `objectid` convertor decides whether a route matches at all, and `CustomObjectId` decides a query
value while FastAPI is still assembling the call.

Invariants:
- No `mongod` is needed. A client is attached so the dependency resolves, and nothing answers it.
- A well-formed id is asserted to fail AT the database, which is what makes each refusal above mean
  something: a control asserting only "not 404" would pass on any failure at all.

See:
- docs/backend/spec.md — the failure contract this split sits beside
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from motor.motor_asyncio import AsyncIOMotorClient

from app.main import create_app
from tests.config import build_test_config

AUTH = {"Authorization": "Bearer test-key-base"}

HEX_ID = "6890a1b2c3d4e5f607182930"

# The right length and no hex in it. `ObjectId` tests length before it decodes hex, so query
# validation refuses this one on its characters rather than on its length.
NON_HEX_ID = "z" * 24

# Not the configured URI: a developer plausibly runs a real `mongod` on 27017, and a database that
# answers gives each control something other than the failure it asserts -- 404 for the path one,
# 200 and an empty list for the query one.
UNANSWERED_URI = "mongodb://localhost:1"

# What a request answers once it gets past routing and validation to an unreachable database.
# Naming it is the point: `!=` on 404 or 422 passes on any failure, the harness's own included.
UNREACHED_DATABASE = "DB-FAIL-001"


@pytest.fixture
def client() -> Iterator[TestClient]:
    """
    A client whose database dependency resolves, and whose database does not answer.

    `get_database` raises `DB-CONN-001` on a missing `app.state.db_client` and never pings, so
    attaching one is what lets a request travel far enough for routing and validation to be the thing
    under test. The lifespan is not run: it reads the settings singleton rather than the injected
    config, so it would build a client against whatever `.env` happens to hold.

    Per test, and that is load-bearing rather than tidiness. `TestClient` runs each request on a fresh
    event loop while Motor binds to the first loop it sees, so one client shared across a module lets
    only its first database-reaching request reach the database — every later one dies inside the
    harness with `SRV-FAIL-001` in a hundredth of the time, and a control that merely refuses 404 or
    422 cannot tell the two apart.
    """
    app = create_app(build_test_config())
    app.state.db_client = AsyncIOMotorClient(host=UNANSWERED_URI, serverSelectionTimeoutMS=100)
    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        app.state.db_client.close()


MALFORMED_IDS = ["not-an-id", NON_HEX_ID, HEX_ID[:-1], f"{HEX_ID}0"]


@pytest.mark.parametrize("spiel_id", MALFORMED_IDS)
def test_a_malformed_path_id_is_a_404(client: TestClient, spiel_id: str):
    """Nonsense, 24 non-hex characters, one hex character short and one too many — none of them address anything."""
    assert client.get(f"/api/v0/spiele/{spiel_id}", headers=AUTH).status_code == 404


def test_a_well_formed_path_id_reaches_the_database(client: TestClient):
    """The control: 24 hex characters match the route, so the failure moves off routing and onto the database."""
    response = client.get(f"/api/v0/spiele/{HEX_ID}", headers=AUTH)

    assert response.status_code == 500
    assert response.json()["error_code"] == UNREACHED_DATABASE


# No `db` marker: no `mongod` is needed. Every refusal is decided before a query, and each control
# is answered by an unreachable database, not by what it holds. With none attached these 503 --
# `fl_backend/tests/api/test_error_responses.py`.
@pytest.mark.parametrize("team_id", MALFORMED_IDS)
def test_a_malformed_query_id_is_a_422(client: TestClient, team_id: str):
    """The same values in the other spelling, where no convertor stands in front of them and the filter model refuses each."""
    response = client.get("/api/v0/spieler", params={"team_id": team_id}, headers=AUTH)

    assert response.status_code == 422
    assert response.json()["error_code"] == "REQ-VAL-001"


def test_a_well_formed_query_id_reaches_the_database(client: TestClient):
    """The control: the same parameter carrying a real id is validated, and the request fails at the database instead."""
    response = client.get("/api/v0/spieler", params={"team_id": HEX_ID}, headers=AUTH)

    assert response.status_code == 500
    assert response.json()["error_code"] == UNREACHED_DATABASE
