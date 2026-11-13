"""
API · `actor_not_admin` over the real grants read

`tests/api/test_admin_guard.py` proves that every admin-tier operation carries the check and
`tests/api/test_actor_binding.py` what it refuses before the read; this proves the read itself.
"""

import asyncio
from collections.abc import Iterator

import pytest
from httpx2 import Response
from pymongo import MongoClient

from app.core.codes import Code
from app.core.collections import Collection
from app.main import create_app
from tests.app_client import app_client
from tests.config import ADMIN_KEY, grants_for_the_suite
from tests.database import a_clean_database_sync
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_actor_grants_test")

CONFIG = config_for(DATABASE_NAME)

# An admin-tier read on a router that writes nothing.
READ_PATH = "/api/v0/spielorte"


@pytest.fixture(scope="module")
def seeded_url(mongo_replica_set_url: str) -> Iterator[str]:
    client = MongoClient(mongo_replica_set_url)
    try:
        with a_clean_database_sync(client, mongo_replica_set_url, DATABASE_NAME) as database:
            database[Collection.GRANTS].insert_many(grants_for_the_suite())

            yield mongo_replica_set_url
    finally:
        client.close()


def answered(url: str, actor: StampedHeaders) -> Response:
    async def _answered() -> Response:
        async with app_client(url, app=create_app(CONFIG)) as http:
            return await http.get(READ_PATH, headers=actor)

    return asyncio.run(_answered())


def test_an_actor_holding_no_grant_is_refused_by_the_real_read(seeded_url: str):
    """No challenge beside it: a fresh sign-in would hold no grant either."""

    response = answered(seeded_url, StampedHeaders("schueler@example.com", ADMIN_KEY))

    assert (response.status_code, response.json()["error_code"]) == (403, Code.ACTOR_NOT_ADMIN)
    assert "www-authenticate" not in response.headers
