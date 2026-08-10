"""
CORE · what a malformed ObjectId answers in a path, and in a query

ADR-0057 ratifies the split rather than tolerating it: a path identifies, so an id naming nothing is
a 404, and a query validates, so a malformed one is a 422. Each is settled before a handler runs —
the `objectid` convertor decides whether a route matches at all, and `CustomObjectId` decides a query
value while FastAPI is still assembling the call.

Invariants:
- No database answers here. A client is attached so the dependency resolves, and nothing listens on it.

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

# The right length and no hex in it. Every shorter malformed value is refused by the length anchor
# before the character class is reached, so this is the one that tests the class.
NON_HEX_ID = "z" * 24


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """
    A client whose database dependency resolves, and whose database does not answer.

    `get_database` raises `DB-CONN-001` on a missing `app.state.db_client` and never pings, so
    attaching one is what lets a request travel far enough for routing and validation to be the thing
    under test. The lifespan is not run: it reads the settings singleton rather than the injected
    config, so it would build a client against whatever `.env` happens to hold.

    Reaching the unanswered server is deliberate — it is what makes the well-formed controls below
    mean something, because a status that is neither 404 nor 422 is only informative if the request
    actually got that far.
    """
    config = build_test_config()
    app = create_app(config)
    app.state.db_client = AsyncIOMotorClient(host=config.mongodb_uri.get_secret_value(), serverSelectionTimeoutMS=100)
    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        app.state.db_client.close()


@pytest.mark.parametrize("spiel_id", ["not-an-id", NON_HEX_ID, HEX_ID[:-1], f"{HEX_ID}0"])
def test_a_malformed_path_id_is_a_404(client: TestClient, spiel_id: str):
    """Nonsense, 24 non-hex characters, one hex character short and one too many — none of them address anything."""
    assert client.get(f"/api/v0/spiele/{spiel_id}", headers=AUTH).status_code == 404


def test_a_well_formed_path_id_is_not_a_404(client: TestClient):
    """The control: 24 hex characters match the route, so the request gets past routing to the database."""
    assert client.get(f"/api/v0/spiele/{HEX_ID}", headers=AUTH).status_code != 404


# No `db` marker: nothing here reaches a database, because 422 arrives ahead of any query. With
# no client attached the same request answers 503 instead, which is what
# `fl_backend/tests/api/test_error_responses.py` records.
@pytest.mark.parametrize("team_id", ["not-an-id", NON_HEX_ID, HEX_ID[:-1]])
def test_a_malformed_query_id_is_a_422(client: TestClient, team_id: str):
    """The same values in the other spelling, where no convertor stands in front of them and the filter model refuses each."""
    response = client.get("/api/v0/spieler", params={"team_id": team_id}, headers=AUTH)

    assert response.status_code == 422
    assert response.json()["error_code"] == "REQ-VAL-001"


def test_a_well_formed_query_id_is_not_a_422(client: TestClient):
    """The control: the same parameter carrying a real id is validated, and the request fails further in."""
    assert client.get("/api/v0/spieler", params={"team_id": HEX_ID}, headers=AUTH).status_code != 422
