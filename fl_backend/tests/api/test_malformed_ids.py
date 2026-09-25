import asyncio
from collections.abc import Mapping
from typing import Any

import pymongo
import pytest
from httpx2 import Response

from app.core.exception_handlers import DATABASE_FAILED, PAYLOAD_REFUSED
from tests.app_client import app_client
from tests.config import BASE_AUTH, UNANSWERED_DEADLINE_S, UNANSWERED_URI

HEX_ID = "6890a1b2c3d4e5f607182930"

# `ObjectId` tests length before it decodes hex, so query validation refuses this one on its
# characters rather than on its length.
NON_HEX_ID = "z" * 24

# Named rather than compared with `!=`: a control asserting only "not 404" passes on any failure,
# the harness's own included.
UNREACHED_DATABASE = DATABASE_FAILED


def answered(path: str, *, params: Mapping[str, Any] | None = None) -> Response:
    """The response, never the client: the driver binds a client to the loop it first ran on."""

    async def _answered() -> Response:
        async with app_client(UNANSWERED_URI) as http:
            with pymongo.timeout(UNANSWERED_DEADLINE_S):
                return await http.get(path, params=params, headers=BASE_AUTH)

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
    assert response.json()["error_code"] == PAYLOAD_REFUSED


def test_a_well_formed_query_id_reaches_the_database():
    """The control: the same parameter carrying a real id is validated, and fails at the database instead."""
    response = answered("/api/v0/spieler", params={"team_id": HEX_ID})

    assert response.status_code == 500
    assert response.json()["error_code"] == UNREACHED_DATABASE
