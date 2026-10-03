"""
API · `REQ-AUTH-006` over the real grants read, on every admin-tier operation

The default tier proves the check's order and its code through `tests/grants.py :: admit`, whose set
stands in for the read; this proves the read itself, on every operation the admin key reaches.
"""

import asyncio
import functools
import re
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from pymongo import MongoClient

from app.core.collections import Collection
from app.core.security import ACTOR_NOT_ADMIN, verify_access_admin
from app.main import create_app
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.config import ADMIN_KEY, grants_for_the_suite
from tests.core.app_source import api_routes, application
from tests.database import a_clean_database_sync
from tests.worker import worker_database

from .conftest import config_for
from .test_admin_guard import PERSON_OPERATIONS, strip_convertors

DATABASE_NAME = worker_database("fl_actor_grants_test")

CONFIG = config_for(DATABASE_NAME)

_PARAMETER = re.compile(r"\{(\w+)(?::(\w+))?\}")
AN_OBJECT_ID = "0" * 23 + "1"

# Well-formed, and holding none of the grants `grants_for_the_suite` seeds.
NOT_AN_ADMINISTRATOR = "schueler@example.com"
# One of them, as the control.
AN_ADMINISTRATOR = grants_for_the_suite()[1]["adresse"]

# The operations the check guards, rather than a list: a router added later is swept without an edit here.
ADMIN_TIER = sorted(
    (route.path, method)
    for route in api_routes(application())
    if isinstance(route, APIRoute) and route.include_in_schema
    for method in sorted(route.methods or ())
    if verify_access_admin in {dependency.call for dependency in route.dependant.dependencies}
    # A person's operation runs no grants check: its binder refuses an administrator's token first.
    and (strip_convertors(route.path), method.lower()) not in PERSON_OPERATIONS
)

# The floor: an empty sweep would pass every case below.
ADMIN_TIER_FLOOR = 60


def _url(path: str) -> str:
    return _PARAMETER.sub(lambda match: AN_OBJECT_ID if match[2] == "objectid" else "x", path)


@pytest.fixture(scope="module")
def seeded_url(mongo_replica_set_url: str) -> Iterator[str]:
    client = MongoClient(mongo_replica_set_url)
    try:
        a_clean_database_sync(client, mongo_replica_set_url, DATABASE_NAME)[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())

        yield mongo_replica_set_url
    finally:
        client.close()


@functools.cache
def _served() -> FastAPI:
    """One app for every case, an app per case costing most of this file's run.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(CONFIG)


def answered(url: str, method: str, path: str, actor: str) -> tuple[int, str | None]:
    """One bodiless request: a check refusing answers before the body is judged, and a request it admits meets a 422 or a 404 at most."""

    async def _answered() -> tuple[int, str | None]:
        async with app_client(url, app=_served()) as http:
            response = await http.request(method, _url(path), headers=SignedActor(actor, ADMIN_KEY))

        return response.status_code, response.json().get("error_code")

    return asyncio.run(_answered())


def test_the_sweep_reaches_every_admin_tier_operation():
    assert len(ADMIN_TIER) >= ADMIN_TIER_FLOOR


@pytest.mark.db
@pytest.mark.parametrize(("path", "method"), ADMIN_TIER, ids=lambda value: value)
def test_an_actor_holding_no_grant_is_refused_by_the_real_read(seeded_url: str, path: str, method: str):
    assert answered(seeded_url, method, path, NOT_AN_ADMINISTRATOR) == (403, ACTOR_NOT_ADMIN)


@pytest.mark.db
@pytest.mark.parametrize(("path", "method"), ADMIN_TIER, ids=lambda value: value)
def test_an_actor_holding_a_grant_passes_the_real_read(seeded_url: str, path: str, method: str):
    """The control: a read refusing everybody passes the case above on every operation."""

    assert answered(seeded_url, method, path, AN_ADMINISTRATOR.upper())[1] != ACTOR_NOT_ADMIN
