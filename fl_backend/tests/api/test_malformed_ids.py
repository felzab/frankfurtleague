import asyncio
from collections.abc import Mapping
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient, Response
from pymongo import AsyncMongoClient

from app.main import create_app
from tests.config import TEST_BASE_URL, build_test_config

AUTH = {"Authorization": "Bearer test-key-base"}

HEX_ID = "6890a1b2c3d4e5f607182930"

# `ObjectId` tests length before it decodes hex, so query validation refuses this one on its
# characters rather than on its length.
NON_HEX_ID = "z" * 24

# Not the configured URI: a developer plausibly runs a real `mongod` on 27017, and a database that
# answers gives each control something other than the failure it asserts.
UNANSWERED_URI = "mongodb://localhost:1"

# Named rather than compared with `!=`: a control asserting only "not 404" passes on any failure,
# the harness's own included.
UNREACHED_DATABASE = "DB-FAIL-001"


def answered(path: str, *, params: Mapping[str, Any] | None = None) -> Response:
    """One request per client, the request and the close on ONE loop.

    The driver binds a client to the loop it first ran on, so this returns the response, never the
    client. No lifespan: it would read the settings singleton and build a client at `.env`.
    """

    async def _answered() -> Response:
        app = create_app(build_test_config())
        app.state.db_client = AsyncMongoClient(host=UNANSWERED_URI, serverSelectionTimeoutMS=100)

        try:
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url=TEST_BASE_URL) as http:
                return await http.get(path, params=params, headers=AUTH)
        finally:
            await app.state.db_client.close()

    return asyncio.run(_answered())


MALFORMED_IDS = ["not-an-id", NON_HEX_ID, HEX_ID[:-1], f"{HEX_ID}0"]


@pytest.mark.parametrize("spiel_id", MALFORMED_IDS)
def test_a_malformed_path_id_is_a_404(spiel_id: str):
    """A path identifies, so an id naming nothing is a 404 — decided by the `objectid` convertor before a handler runs."""
    assert answered(f"/api/v0/spiele/{spiel_id}").status_code == 404


def test_a_well_formed_path_id_reaches_the_database():
    """The control: a well-formed id matches the route, so the failure moves off routing and onto the database."""
    response = answered(f"/api/v0/spiele/{HEX_ID}")

    assert response.status_code == 500
    assert response.json()["error_code"] == UNREACHED_DATABASE


# No `db` marker: every refusal is decided before a query, and each control is answered by an
# unreachable database rather than by what it holds.
@pytest.mark.parametrize("team_id", MALFORMED_IDS)
def test_a_malformed_query_id_is_a_422(team_id: str):
    """A query validates, so a malformed id is a 422 — decided while FastAPI is still assembling the call."""
    response = answered("/api/v0/spieler", params={"team_id": team_id})

    assert response.status_code == 422
    assert response.json()["error_code"] == "REQ-VAL-001"


def test_a_well_formed_query_id_reaches_the_database():
    """The control: the same parameter carrying a real id is validated, and fails at the database instead."""
    response = answered("/api/v0/spieler", params={"team_id": HEX_ID})

    assert response.status_code == 500
    assert response.json()["error_code"] == UNREACHED_DATABASE
