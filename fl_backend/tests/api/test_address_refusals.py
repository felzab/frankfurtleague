"""
API · each administrator operation of `ACTS_ON_AN_ADDRESS` refuses the administrator's own address and a grant holder's

`own_address` refuses the address the administrator acts as, and `admin_address` an address holding a grant to anyone
without an owner's power, each through `app/api/identity/services.py :: find_off_limits_refusal`: on the box where the
address is typed, and as a gate where a change's id names it. Each row is asked by an administrator holding no owner's
power.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import pytest
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.codes import Code
from tests.acts import journal_records
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_KEY
from tests.erasure_corpus import everything_in
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

from .address_change_harness import ADMIN, EMAIL, NEW_EMAIL, NOW, OWNER, administrator_starts, granted, on_a_person

DATABASE_NAME = worker_database("fl_address_refusals_test")

# What a request sends: the path it is made on, and its body or none.
Request = tuple[str, dict[str, Any] | None]
Builder = Callable[[AsyncDatabase, AsyncMongoClient, str], Awaitable[Request]]


def by_body(path: str, body: Callable[[str], dict[str, Any]]) -> Builder:
    """An operation keyed by the address its body types."""

    async def build(database: AsyncDatabase, client: AsyncMongoClient, address: str) -> Request:
        return path, body(address)

    return build


def by_a_change(path: str) -> Builder:
    """An operation keyed by a change's id: the owner starts one at the address first, which only the owner may at a holder's."""

    async def build(database: AsyncDatabase, client: AsyncMongoClient, address: str) -> Request:
        started = await administrator_starts(database, client, address=address, operator=OWNER)
        return path.format(address_change_id=started.id), None

    return build


@dataclass(frozen=True)
class Act:
    request: Builder
    # The box the typed address stands in, which the refusal names; `None` where a change's id names the address, which
    # stands in no box, so the refusal is a gate.
    box: str | None


# Keyed by each operation's method and its path under the prefix.
ACTS_ON_AN_ADDRESS: dict[tuple[str, str], Act] = {
    ("POST", "/api/identity/erasure/view"): Act(by_body("/api/identity/erasure/view", lambda address: {"email": address}), "email"),
    ("POST", "/api/identity/erasure"): Act(
        by_body("/api/identity/erasure", lambda address: {"email": address, "reason": "Mail vom 30.03.2126"}), "email"
    ),
    ("POST", "/api/identity/withdrawal"): Act(
        by_body("/api/identity/withdrawal", lambda address: {"email": address, "choices": ["media"]}), "email"
    ),
    ("POST", "/api/address_change"): Act(by_body("/api/address_change", lambda address: {"address": address, "email": NEW_EMAIL}), "address"),
    ("POST", "/api/address_change/{address_change_id}/confirmation/resend"): Act(
        by_a_change("/api/address_change/{address_change_id}/confirmation/resend"), None
    ),
    ("DELETE", "/api/address_change/{address_change_id}"): Act(by_a_change("/api/address_change/{address_change_id}"), None),
}


async def asked(
    url: str, caplog: pytest.LogCaptureFixture, key: tuple[str, str], address: str, *, granted_first: bool
) -> tuple[str, bool, list[Any]]:
    """The operation asked at `address` by an administrator holding no owner's power: its refusal, whether nothing moved, its journal.

    The refusal stands on the box the address was typed into, and on none where a change's id names it.
    """

    method, _ = key
    box = ACTS_ON_AN_ADDRESS[key].box

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, bool, list[Any]]:
        if granted_first:
            await granted(database, address)
        path, json = await ACTS_ON_AN_ADDRESS[key].request(database, client, address)
        held = await everything_in(database)
        # Cleared after the seed, whose own writes may journal, so what remains is the request's.
        caplog.clear()
        with caplog.at_level(logging.INFO):
            async with app_client(url, app=app_under_test(DATABASE_NAME), now=NOW) as http:
                response = await http.request(method, path, json=json, headers=StampedHeaders(ADMIN, ADMIN_KEY))
        assert response.status_code == 403, response.text
        refused = response.json()
        assert [field["path"] for field in refused["fields"]] == ([] if box is None else [[box]]), response.text

        return refused["error_code"], held == await everything_in(database), journal_records(caplog)

    return await on_a_person(url, DATABASE_NAME, body)


@pytest.mark.db
@pytest.mark.parametrize("key", ACTS_ON_AN_ADDRESS, ids=" ".join)
async def test_a_grant_holders_address_is_refused_and_nothing_is_written(
    mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, key: tuple[str, str]
):
    assert await asked(mongo_replica_set_url, caplog, key, EMAIL, granted_first=True) == (Code.ADMIN_ADDRESS, True, [])


@pytest.mark.db
@pytest.mark.parametrize("key", ACTS_ON_AN_ADDRESS, ids=" ".join)
async def test_their_own_address_in_other_capitals_is_refused_and_nothing_is_written(
    mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, key: tuple[str, str]
):
    assert await asked(mongo_replica_set_url, caplog, key, ADMIN.upper(), granted_first=False) == (Code.OWN_ADDRESS, True, [])
