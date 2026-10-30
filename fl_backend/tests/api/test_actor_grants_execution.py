"""
API · `actor_not_admin` over the real grants read

The default tier proves the check's order and its code through `tests/grants.py :: admit`, whose set
stands in for the read, and `tests/api/test_admin_guard.py` that every admin-tier operation carries
it; this proves the read itself.
"""

import asyncio
from collections.abc import Iterator

import pytest
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


@pytest.fixture(scope="module")
def seeded_url(mongo_replica_set_url: str) -> Iterator[str]:
    client = MongoClient(mongo_replica_set_url)
    try:
        a_clean_database_sync(client, mongo_replica_set_url, DATABASE_NAME)[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())

        yield mongo_replica_set_url
    finally:
        client.close()


def answered(url: str, actor: str) -> tuple[int, str | None]:
    async def _answered() -> tuple[int, str | None]:
        async with app_client(url, app=create_app(CONFIG)) as http:
            response = await http.get(READ_PATH, headers=SignedActor(actor, ADMIN_KEY))

        return response.status_code, None if response.status_code == 200 else response.json().get("error_code")

    return asyncio.run(_answered())


def test_an_actor_holding_no_grant_is_refused_by_the_real_read(seeded_url: str):
    assert answered(seeded_url, "schueler@example.com") == (403, Code.ACTOR_NOT_ADMIN)


def test_an_actor_holding_a_grant_passes_the_real_read(seeded_url: str):
    """The control: a read refusing everybody passes the case above. Spelled in capitals, as the stored grant is folded."""

    assert answered(seeded_url, grants_for_the_suite()[1]["adresse"].upper()) == (200, None)
