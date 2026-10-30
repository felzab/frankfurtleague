"""
API · `REQ-AUTH-006` over the real grants read

`tests/api/test_admin_guard.py` proves that every admin-tier operation carries the check and
`tests/api/test_actor_binding.py` what it refuses before the read; this proves the read itself.
"""

import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from bson import ObjectId
from httpx2 import Response
from pymongo import MongoClient

from app.core.codes import Code
from app.core.collections import Collection
from app.main import create_app
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY, grants_for_the_suite
from tests.database import a_clean_database_sync
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_actor_grants_test")

CONFIG = config_for(DATABASE_NAME)

# An admin-tier read on a router that writes nothing.
READ_PATH = "/api/v0/spielorte"

# Granted as the module's database is seeded, so a session an hour older predates the grant.
GRANTED_AT_THE_SEED = "neu.admin@example.com"
AN_HOUR_S = 3600


@pytest.fixture(scope="module")
def seeded_url(mongo_replica_set_url: str) -> Iterator[str]:
    client = MongoClient(mongo_replica_set_url)
    try:
        now = datetime.now(UTC)
        granted = {
            "_id": ObjectId(),
            "adresse": GRANTED_AT_THE_SEED,
            "verwaltung": "administration",
            "erteilt_von": "PLAYGROUND",
            "erteilt_am": now,
        }
        a_clean_database_sync(client, mongo_replica_set_url, DATABASE_NAME)[Collection.BERECHTIGUNGEN].insert_many(
            [*grants_for_the_suite(), granted]
        )

        yield mongo_replica_set_url
    finally:
        client.close()


def answered(url: str, actor: SignedActor) -> Response:
    async def _answered() -> Response:
        async with app_client(url, app=create_app(CONFIG)) as http:
            return await http.get(READ_PATH, headers=actor)

    return asyncio.run(_answered())


def test_an_actor_holding_no_grant_is_refused_by_the_real_read(seeded_url: str):
    """No challenge beside it: a fresh sign-in would hold no grant either."""

    response = answered(seeded_url, SignedActor("schueler@example.com", ADMIN_KEY))

    assert (response.status_code, response.json()["error_code"]) == (403, Code.ACTOR_NOT_ADMIN)
    assert "www-authenticate" not in response.headers


def test_a_session_signed_in_before_its_grant_is_refused(seeded_url: str):
    """The grant's date is what the session is judged against, so a sign-in older than the grant holds none of it."""

    response = answered(seeded_url, SignedActor(GRANTED_AT_THE_SEED, ADMIN_KEY, signed_in_before_s=AN_HOUR_S))

    assert (response.status_code, response.json()["error_code"]) == (401, Code.ACTOR_TOKEN_REFUSED)


def test_an_actor_holding_a_grant_passes_the_real_read(seeded_url: str):
    """The control: a read refusing everybody passes the cases above. Spelled in capitals, as the stored grant is folded."""

    assert answered(seeded_url, SignedActor(grants_for_the_suite()[1]["adresse"].upper(), ADMIN_KEY)).status_code == 200
