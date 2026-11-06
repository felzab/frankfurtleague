"""
API · a write stepped up on some calls alone asks the step-up window on exactly those calls

Each of these handlers decides whether this call destroys what nothing restores, and refuses
`confirmation_required` there from a sign-in older than the step-up window.
Served over HTTP against the shipped indexes, so each refusal is
shown to leave the stored state as it was, and each call of the other kind to pass the same sign-in.
"""

import functools
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import AsyncClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.security import ENROLMENT_WINDOW_S, STEP_UP_WINDOW_S
from app.main import create_app
from tests.app_client import app_client
from tests.config import ADMIN_KEY, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    rules_document,
    saison_document,
    saison_team_document,
)
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_step_up_test")
CONFIG = config_for(DATABASE_NAME)

ADMIN = "admin@example.com"
# Past the step-up window by a minute, and inside the administrator's own.
OLDER = StampedHeaders(ADMIN, ADMIN_KEY, signed_in_before_s=STEP_UP_WINDOW_S + 60)
FRESH = StampedHeaders(ADMIN, ADMIN_KEY)

SAISON_ID = "2026"
TODAY = "2026-04-01"
TEAM_ID = ObjectId("6890a1b2c3d4e5f607950001")

REGISTRIERUNG: dict[str, Any] = {"open": True, "end": "2026-04-30"}

Body = Callable[[AsyncDatabase, AsyncClient], Awaitable[Any]]


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(CONFIG)


def on_a_season(url: str, body: Body, *, seed: Callable[[AsyncDatabase], Awaitable[None]] | None = None) -> Any:
    """The shipped indexes, a running season holding one club, and `seed`'s rows beside them."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await database[Collection.SAISONS].insert_one(
                saison_document(SAISON_ID, "active", rules=rules_document(number_of_gruppen=2), registrierung=dict(REGISTRIERUNG))
            )
            await database[Collection.SAISON_TEAMS].insert_one(saison_team_document(SAISON_ID, TEAM_ID, "Adler", "ADX", kontakte=None))
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())
            if seed is not None:
                await seed(database)
            async with app_client(url, app=_served()) as http:
                return await body(database, http)

    return on_the_seed_loop(_run())


def refused(response: Any) -> bool:
    return (response.status_code, response.json().get("error_code")) == (401, Code.CONFIRMATION_REQUIRED)


# An administrator's address beside the suite's, whose erasure on request takes that grant with the rest.
ERASED_ADMINISTRATOR = "zugang.anfrage@example.com"


async def an_administrators_grant(database: AsyncDatabase) -> None:
    await database[Collection.GRANTS].insert_one(
        {
            "address": ERASED_ADMINISTRATOR,
            "admin_tier": "administration",
            "granted_by": "PLAYGROUND",
            "granted_at": datetime(2026, 1, 1, tzinfo=UTC),
        }
    )


def an_erasure_of(email: str) -> dict[str, str]:
    return {"email": email, "reason": "Mail vom 30.03.2026"}


class TestAnErasureOnRequestEndingAGrant:
    """An administrator's erasure asks the revoke's window on the calls taking a live grant."""

    URL = f"/api/v{API_VERSION}/identity/erasure"

    def test_an_erasure_ending_a_grant_from_a_sign_in_past_that_window_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[bool, int, int]:
            # Inside the step-up window, past the revoke's by a minute: this suite's `OLDER` is past both.
            OLDER = StampedHeaders(ADMIN, ADMIN_KEY, signed_in_before_s=ENROLMENT_WINDOW_S + 60)
            logged = await database[Collection.ACTION_LOG].count_documents({})
            response = await http.post(self.URL, headers=OLDER, json=an_erasure_of(ERASED_ADMINISTRATOR))
            return (
                refused(response),
                await database[Collection.GRANTS].count_documents({"address": ERASED_ADMINISTRATOR}),
                await database[Collection.ACTION_LOG].count_documents({}) - logged,
            )

        assert on_a_season(mongo_replica_set_url, body, seed=an_administrators_grant) == (True, 1, 0)

    def test_an_erasure_ending_a_grant_from_a_fresh_sign_in_takes_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> tuple[int, int]:
            response = await http.post(self.URL, headers=FRESH, json=an_erasure_of(ERASED_ADMINISTRATOR))
            return response.status_code, response.json()["grants"]

        assert on_a_season(mongo_replica_set_url, body, seed=an_administrators_grant) == (200, 1)

    def test_an_address_holding_no_grant_asks_the_step_up_window_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, http: AsyncClient) -> int:
            past_the_revokes = StampedHeaders(ADMIN, ADMIN_KEY, signed_in_before_s=ENROLMENT_WINDOW_S + 60)
            return (await http.post(self.URL, headers=past_the_revokes, json=an_erasure_of("niemand@example.com"))).status_code

        assert on_a_season(mongo_replica_set_url, body) == 200
