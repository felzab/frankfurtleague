"""
API · every administrator operation acting on a mailbox refuses the administrator's own address and a grant holder's

`own_address` refuses the address the administrator acts as, and `admin_address` an address holding a grant to anyone
without an owner's power, each through `app/api/identity/crud.py :: refuse_an_address_off_limits`. Each operation is
one row of `ACTS_ON_AN_ADDRESS`, asked by an administrator holding no owner's power, and every operation the two
mailbox routers mount is a row there or in `LEFT_OUT_BY_DESIGN`, so an operation added to either router is judged here
before it serves. A mailbox operation on a third router escapes that census.
"""

import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import pytest
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.address_change import admin_router as address_change_admin_router
from app.api.identity import admin_router as identity_admin_router
from app.api.identity.admin_router import get_erasure_view, post_withdrawal
from app.api.identity.schemas import FLEinwilligungWithdrawalPayload, FLErasureAddressPayload
from app.core.codes import Code
from tests.acts import journal_records
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_KEY
from tests.core.app_source import api_routes, application
from tests.erasure_corpus import everything_in
from tests.isolation import refused_code
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

from .address_change_harness import ADMIN, EMAIL, NEW_EMAIL, NOW, OWNER, administrator_starts, granted, on_a_person

DATABASE_NAME = worker_database("fl_address_refusals_test")

# What a request sends: the path it is made on, and its body or none.
Request = tuple[str, dict[str, Any] | None]
Builder = Callable[[AsyncDatabase, AsyncMongoClient, str], Awaitable[Request]]
Handler = Callable[[str], Awaitable[Any]]


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


# Every handle a handler below is handed: a read or a write reaching one fails on `None`, so a refusal raised is one judged
# ahead of anything read or written.
NO_HANDLE: Any = None


def counted_alone(address: str) -> Awaitable[Any]:
    return get_erasure_view(
        view_data=FLErasureAddressPayload.model_validate({"email": address}),
        saison_teams_collection=NO_HANDLE,
        bewerbungen_collection=NO_HANDLE,
        schiedsrichter_collection=NO_HANDLE,
        spieler_collection=NO_HANDLE,
        registrierungen_collection=NO_HANDLE,
        spiele_collection=NO_HANDLE,
        grants_collection=NO_HANDLE,
        address_changes_collection=NO_HANDLE,
        session=NO_HANDLE,
        operator=ADMIN,
        germany_now=NOW,
    )


def withdrawn_alone(address: str) -> Awaitable[Any]:
    # The dry run, where the db tier's row enters the withdrawal: the refusal precedes the branch, and each case holds one side.
    return post_withdrawal(
        withdrawal_data=FLEinwilligungWithdrawalPayload.model_validate({"email": address, "choices": ["media"]}),
        spieler_collection=NO_HANDLE,
        schiedsrichter_collection=NO_HANDLE,
        saison_teams_collection=NO_HANDLE,
        bewerbungen_collection=NO_HANDLE,
        registrierungen_collection=NO_HANDLE,
        teams_collection=NO_HANDLE,
        grants_collection=NO_HANDLE,
        db=NO_HANDLE,
        session=NO_HANDLE,
        operator=ADMIN,
        germany_now=NOW,
        dry_run=True,
    )


@dataclass(frozen=True)
class Act:
    request: Builder
    # The handler as a function, where its own-address refusal precedes every read and the default tier reaches it;
    # `None` where that refusal follows the start of a transaction, which the db tier reaches.
    alone: Handler | None = None


# Keyed as `api_routes` serves each operation: its method and its path under the prefix, convertors dropped.
ACTS_ON_AN_ADDRESS: dict[tuple[str, str], Act] = {
    ("POST", "/api/identity/erasure/view"): Act(by_body("/api/identity/erasure/view", lambda address: {"email": address}), counted_alone),
    ("POST", "/api/identity/erasure"): Act(
        by_body("/api/identity/erasure", lambda address: {"email": address, "reason": "Mail vom 30.03.2126"})
    ),
    ("POST", "/api/identity/withdrawal"): Act(
        by_body("/api/identity/withdrawal", lambda address: {"email": address, "choices": ["media"]}), withdrawn_alone
    ),
    ("POST", "/api/address_change"): Act(by_body("/api/address_change", lambda address: {"address": address, "email": NEW_EMAIL})),
    ("POST", "/api/address_change/{address_change_id}/confirmation/resend"): Act(
        by_a_change("/api/address_change/{address_change_id}/confirmation/resend")
    ),
    ("DELETE", "/api/address_change/{address_change_id}"): Act(by_a_change("/api/address_change/{address_change_id}")),
}

# The mailbox routers' operations acting on no one address, each with what takes the refusals' place.
LEFT_OUT_BY_DESIGN: dict[tuple[str, str], str] = {
    ("GET", "/api/address_change"): "left out rather than refused: the list leaves out each change the tool would refuse",
}

MAILBOX_ROUTERS = frozenset({identity_admin_router.__name__, address_change_admin_router.__name__})

CONVERTOR_IN_PATH = re.compile(r"\{([^}:]+):[^}]+\}")


async def asked(
    url: str, caplog: pytest.LogCaptureFixture, key: tuple[str, str], address: str, *, granted_first: bool
) -> tuple[str, bool, list[Any]]:
    """The operation asked at `address` by an administrator holding no owner's power: its refusal, whether nothing moved, its journal."""

    method, _ = key

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

        return response.json()["error_code"], held == await everything_in(database), journal_records(caplog)

    return await on_a_person(url, DATABASE_NAME, body)


@pytest.mark.db
@pytest.mark.parametrize("key", ACTS_ON_AN_ADDRESS, ids=" ".join)
async def test_a_grant_holders_address_is_refused_and_nothing_is_written(
    mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, key: tuple[str, str]
):
    assert await asked(mongo_replica_set_url, caplog, key, EMAIL, granted_first=True) == (Code.ADMIN_ADDRESS, True, [])


@pytest.mark.db
@pytest.mark.parametrize("key", [key for key, act in ACTS_ON_AN_ADDRESS.items() if act.alone is None], ids=" ".join)
async def test_their_own_address_in_other_capitals_is_refused_and_nothing_is_written(
    mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, key: tuple[str, str]
):
    assert await asked(mongo_replica_set_url, caplog, key, ADMIN.upper(), granted_first=False) == (Code.OWN_ADDRESS, True, [])


@pytest.mark.parametrize("key", [key for key, act in ACTS_ON_AN_ADDRESS.items() if act.alone is not None], ids=" ".join)
async def test_their_own_address_in_other_capitals_and_between_spaces_is_refused_before_anything_is_read(key: tuple[str, str]):
    """Called as a function, as the administrator: the route and its binding of the actor are the db tier's."""

    alone = ACTS_ON_AN_ADDRESS[key].alone
    assert alone is not None

    assert await refused_code(alone(f"  {ADMIN.upper()} ")) == Code.OWN_ADDRESS


def test_every_operation_of_the_mailbox_routers_is_judged_here():
    """An equality, so an operation added to either router without a row fails, and so does a row naming no operation."""

    mounted = {
        (method, CONVERTOR_IN_PATH.sub(r"{\1}", route.path))
        for route in api_routes(application())
        if route.endpoint.__module__ in MAILBOX_ROUTERS
        for method in route.methods or ()
    }

    assert mounted == ACTS_ON_AN_ADDRESS.keys() | LEFT_OUT_BY_DESIGN.keys()
    assert ACTS_ON_AN_ADDRESS.keys().isdisjoint(LEFT_OUT_BY_DESIGN)
