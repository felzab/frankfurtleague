"""
API · an administrator's erasure on a mailed request, held against the person's own erasure's whole-database seed

The seed is `tests/api/test_identity_erasure_execution.py`'s, one address holding every kind of record, beside
the suite's grants an administrator signs in through. Every case asks what the database holds after
the request, so a step, a refusal or a reset missing from the route fails here.
"""

import asyncio
import functools
import logging
from collections.abc import Awaitable, Callable, Iterator, Mapping
from typing import Any, cast

import pytest
from bson import ObjectId
from fastapi import FastAPI
from httpx2 import AsyncClient, Response
from pydantic import ValidationError
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identity.admin_router import get_erasure_view, post_erasure
from app.api.identity.schemas import FLErasureAddressPayload, FLErasurePayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import ANCHOR_FIELD
from app.core.db import collection_dependency
from app.core.exceptions import APIError
from app.core.recording import actor_var
from app.main import create_app
from tests.app_client import app_client
from tests.config import ADMIN_KEY, ADMINISTRATORS, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import address_change_document, spiel_document, spieler_document
from tests.erasure import erasure_collections, what_the_erasure_took
from tests.isolation import InterleavedCollection
from tests.session_headers import StampedHeaders
from tests.whole_database import where_held
from tests.worker import worker_database

from .conftest import config_for
from .test_identity_erasure_execution import (
    FIRST_NAME,
    IDENTIFIER,
    LAST_NAME,
    NOW,
    OTHER_REFEREE_CHANGE_OID,
    PAYMENT,
    PUPIL_OID,
    REFEREE_OID,
    SAISON_ID,
    SPIELTAG_OID,
    THEIR_GRANT_OID,
    THEIR_VALUES,
    TYPED,
    a_grant,
    a_person_holding_everything,
    as_person,
    everything_in,
    journal_records,
)
from .test_identity_erasure_execution import PATH as OWN_ERASURE_PATH

DATABASE_NAME = worker_database("fl_erasure_on_request_test")

CONFIG = config_for(DATABASE_NAME)

PATH = f"/api/v{API_VERSION}/identity/erasure"
VIEW_PATH = f"{PATH}/view"

# The suite's owner, and an administrator holding no owner's power, who presses unless a case says otherwise.
OWNER, OPERATOR = ADMINISTRATORS[0], ADMINISTRATORS[1]
ANOTHER_ADMINISTRATOR = ADMINISTRATORS[3]

REASON = "Mail vom 30.03.2026, Betreff: Bitte löscht alle meine Daten"


# A grant typed in the person's capitals, which admits nobody and goes with their erasure.
# Another such row, of an address nobody erases: no request matches it, so it stands.

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


@functools.cache
def _app() -> FastAPI:
    return create_app(CONFIG)


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Never inside a case: a build re-runs the logging `dictConfig`, which strips the handler `caplog` reads that case's records from."""

    _app()


def on_a_league(url: str, body: Body) -> Any:
    """The person holding everything, beside the suite's grants, on the shipped indexes."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())
            await a_person_holding_everything(database)

            return await body(database, client)

    return on_the_seed_loop(_run())


def on_a_league_of_its_own(url: str, body: Body) -> Any:
    """The suite's grants alone, the body seeding what else it needs."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def posted(url: str, path: str, body: Mapping[str, Any], *, by: str = OPERATOR) -> Response:
    async with app_client(url, app=_app(), now=NOW) as http:
        return await http.post(path, json=dict(body), headers=StampedHeaders(by, ADMIN_KEY))


def erasure_of(email: str = TYPED, reason: str = REASON) -> dict[str, str]:
    return {"email": email, "reason": reason}


def view_of(email: str = TYPED) -> dict[str, str]:
    return {"email": email}


async def erased_by_the_handler(
    database: AsyncDatabase, client: AsyncMongoClient, *, email: str = TYPED, reason: str = REASON, **replaced: Any
) -> None:
    """The route's own function outside a request, as `OPERATOR`, for a case driving the driver itself."""

    token = actor_var.set(OPERATOR)
    try:
        await post_erasure(
            erasure_data=FLErasurePayload(email=email, reason=reason),
            **erasure_collections(database, **replaced),
            db=client,
            operator=OPERATOR,
            germany_now=NOW,
        )
    finally:
        actor_var.reset(token)


def _object_ids(value: Any) -> Iterator[ObjectId]:
    if isinstance(value, ObjectId):
        yield value
    elif isinstance(value, Mapping):
        for item in value.values():
            yield from _object_ids(item)
    elif isinstance(value, list):
        for item in value:
            yield from _object_ids(item)


def _ranked(value: Any, rank: Mapping[ObjectId, int]) -> Any:
    if isinstance(value, ObjectId):
        return rank[value]
    if isinstance(value, Mapping):
        return {key: _ranked(item, rank) for key, item in value.items()}
    if isinstance(value, list):
        return [_ranked(item, rank) for item in value]
    return value


def what_is_left(collections: Mapping[str, list[Any]]) -> Any:
    """The database by rank: two seeds mint ids in one order, so ranks compare where ids cannot.

    The log differs by its one row, who wrote it: each grant drops its anchor's count.
    """

    left = {name: [dict(document) for document in documents] for name, documents in collections.items() if name != Collection.ACTION_LOG}
    for row in left.get(Collection.GRANTS, []):
        row.pop(ANCHOR_FIELD, None)

    return _ranked(left, {object_id: index for index, object_id in enumerate(sorted(set(_object_ids(left))))})


@pytest.mark.db
class TestTheRegistryRunsWhole:
    """The person's whole data on one pass, with no precondition about their state."""

    def test_the_persons_own_route_leaves_the_same_database(self, mongo_replica_set_url: str):
        """Fails where the two routes ever run different scopes or steps; the log's one row, who acted, is all that differs."""

        def after(request: Callable[[AsyncClient], Awaitable[Response]]) -> Any:
            async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
                async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                    status = (await request(http)).status_code

                return status, what_is_left(await everything_in(database))

            return on_a_league(mongo_replica_set_url, body)

        by_the_administrator = after(lambda http: http.post(PATH, json=erasure_of(), headers=StampedHeaders(OPERATOR, ADMIN_KEY)))
        by_the_person = after(lambda http: http.post(OWN_ERASURE_PATH, headers=as_person(TYPED)))

        assert (by_the_administrator[0], by_the_person[0]) == (204, 204)
        assert by_the_administrator[1] == by_the_person[1]


# Every handle a handler below is handed: a read or a write reaching one fails on `None`, so a refusal raised is one judged
# ahead of anything read or written.
NO_HANDLE: Any = None


def counted_by_the_handler(email: str) -> Awaitable[Any]:
    return get_erasure_view(
        view_data=FLErasureAddressPayload.model_validate(view_of(email)),
        saison_teams_collection=NO_HANDLE,
        bewerbungen_collection=NO_HANDLE,
        schiedsrichter_collection=NO_HANDLE,
        spieler_collection=NO_HANDLE,
        registrierungen_collection=NO_HANDLE,
        spiele_collection=NO_HANDLE,
        grants_collection=NO_HANDLE,
        address_changes_collection=NO_HANDLE,
        session=NO_HANDLE,
        operator=OPERATOR,
        now=NOW,
    )


def erased_by_the_handler_alone(email: str) -> Awaitable[Any]:
    return post_erasure(
        erasure_data=FLErasurePayload.model_validate(erasure_of(email)),
        spieler_collection=NO_HANDLE,
        saison_spieler_collection=NO_HANDLE,
        saison_teams_collection=NO_HANDLE,
        bewerbungen_collection=NO_HANDLE,
        schiedsrichter_collection=NO_HANDLE,
        spiele_collection=NO_HANDLE,
        spielbestaetigungen_collection=NO_HANDLE,
        spielberichte_collection=NO_HANDLE,
        aufstellungen_collection=NO_HANDLE,
        registrierungen_collection=NO_HANDLE,
        action_log_collection=NO_HANDLE,
        grants_collection=NO_HANDLE,
        outbox_collection=NO_HANDLE,
        address_changes_collection=NO_HANDLE,
        db=NO_HANDLE,
        operator=OPERATOR,
        germany_now=NOW,
    )


class TestTheirOwnAddress:
    """`own_address`: an administrator's own address goes through their account page, or through another administrator.

    Each handler is called as a function, as `OPERATOR`: the route and the binding of the actor from the request's
    headers are not exercised here.
    """

    @pytest.mark.parametrize("handler", [counted_by_the_handler, erased_by_the_handler_alone], ids=["the counts", "the erasure"])
    def test_it_is_refused_in_other_capitals_and_between_spaces_before_anything_is_read(self, handler: Callable[[str], Awaitable[Any]]):
        with pytest.raises(APIError) as refused:
            asyncio.run(handler(f"  {OPERATOR.upper()} "))

        assert (refused.value.status_code, refused.value.error_code) == (403, Code.OWN_ADDRESS)


@pytest.mark.db
class TestAGrantHoldersAddress:
    """`admin_address`: judged inside the erasure's transaction, and in the counts' snapshot."""

    @pytest.mark.parametrize(
        ("path", "body", "address"),
        [
            (VIEW_PATH, view_of, OWNER),
            (PATH, erasure_of, OWNER),
            (VIEW_PATH, view_of, ANOTHER_ADMINISTRATOR),
            (PATH, erasure_of, ANOTHER_ADMINISTRATOR),
        ],
        ids=[
            "the counts of an owner",
            "the erasure of an owner",
            "the counts of an administrator",
            "the erasure of an administrator",
        ],
    )
    def test_an_administrator_holding_no_owners_power_is_refused_and_nothing_is_written(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, path: str, body: Callable[[str], dict[str, str]], address: str
    ):
        async def run(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await everything_in(database)
            response = await posted(mongo_replica_set_url, path, body(address))

            return response, before == await everything_in(database)

        with caplog.at_level(logging.INFO):
            response, untouched = on_a_league(mongo_replica_set_url, run)

        assert (response.status_code, response.json()["error_code"], untouched) == (403, Code.ADMIN_ADDRESS, True)
        assert journal_records(caplog) == []

    def test_a_grant_landing_inside_the_erasure_is_refused_by_its_retry(self, mongo_replica_set_url: str):
        """The rival adds the address after the first attempt's judgement and before its first write.

        Judged once ahead of the transaction instead, the retry ends a grant this administrator could not revoke. The person
        holds one pupil row, so nothing the erasure writes but the grants' anchor meets what the addition writes: on a fuller
        seed another row conflicts, and the case passes with the anchor gone.
        """

        granted: list[int] = []
        racing: list[PupilsReadMeetingARival] = []

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(spieler_document(PUPIL_OID, FIRST_NAME, LAST_NAME, email=IDENTIFIER))
            held = await where_held(database, *THEIR_VALUES)
            served = _app()
            async with app_client(mongo_replica_set_url, app=served, now=NOW) as http:

                async def grant() -> None:
                    added = await http.post(f"/api/v{API_VERSION}/grants", json={"email": IDENTIFIER}, headers=StampedHeaders(OWNER, ADMIN_KEY))
                    granted.append(added.status_code)

                async def pupils() -> AsyncCollection:
                    # The app's own client: the request's session belongs to it.
                    racing.append(PupilsReadMeetingARival(served.state.db_client[DATABASE_NAME][Collection.SPIELER], grant))
                    return cast(AsyncCollection, racing[-1])

                served.dependency_overrides[collection_dependency(Collection.SPIELER)] = pupils
                response = await http.post(PATH, json=erasure_of(), headers=StampedHeaders(OPERATOR, ADMIN_KEY))

            return (
                response,
                held,
                await where_held(database, *THEIR_VALUES),
                await database[Collection.GRANTS].find_one({"address": IDENTIFIER}),
            )

        response, held, left, row = on_a_league_of_its_own(mongo_replica_set_url, body)

        assert (response.status_code, response.json().get("error_code"), granted) == (403, Code.ADMIN_ADDRESS, [201])
        assert row is not None and row["admin_tier"] == "administration"
        # The rows the grant wrote aside, every value stands where it stood.
        assert aside_the_grants_own_rows(left) == aside_the_grants_own_rows(held)
        # The premise last: the first attempt passed its judgement and read the pupils, which a grant landing first refuses.
        racing[0].assert_landed_inside(serially=0)


@pytest.mark.db
class TestTheCounts:
    """What the person's erasure removes or empties, by its own selections, counted, named nowhere and stored nowhere."""

    def test_they_count_what_the_erasure_then_takes_and_name_nobody(self, mongo_replica_set_url: str):
        """Read against the stored data the erasure takes, so a kind counted short is caught whatever the seed holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            # A change still asking its address on file, which the person's own preview leaves uncounted and this one counts.
            await database[Collection.ADDRESS_CHANGES].insert_one(
                address_change_document(address="noch.gefragt@example.com", email=IDENTIFIER, token_hash=None, day="2126-03-30", way="account")
            )
            # One still to come beside the seed's own, which was played and keeps its booking naming nobody: a count of
            # every booking would read two. Later on `NOW`'s own day, so a count judging by the day alone reads none.
            await database[Collection.SPIELE].insert_one(
                spiel_document(
                    spiel_id=ObjectId(),
                    saison_id=SAISON_ID,
                    spiel_nr=5,
                    spieltag_id=SPIELTAG_OID,
                    date="2126-04-01",
                    time="18:00:00",
                    schiedsrichter={"schiedsrichter_id": REFEREE_OID, "payment": PAYMENT},
                )
            )
            before = await everything_in(database)
            view = await posted(mongo_replica_set_url, VIEW_PATH, view_of(), by=OWNER)
            untouched = before == await everything_in(database)
            erasure = await posted(mongo_replica_set_url, PATH, erasure_of(), by=OWNER)

            return view, untouched, erasure.status_code, what_the_erasure_took(before, await everything_in(database))

        view, untouched, status, taken = on_a_league(mongo_replica_set_url, body)
        counts = view.json()

        assert view.status_code == 200, counts
        assert (untouched, status) == (True, 204)
        # The fixture still to come is the one booking taken off, and the one the preview counts.
        assert counts == taken
        # The premise: an address holding nothing would agree on zeros.
        assert all(counts.values())


# The address the seed's referee change moves away from, given a grant by the cases below.
CHANGING_HOLDER = "kraus.bernd@example.com"
CHANGING_HOLDER_GRANT_OID = ObjectId("6890a1b2c3d4e5f607e00003")


@pytest.mark.db
class TestAGrantHoldersPendingChange:
    """A grant holder's change naming the address is shown and ended only where the tool would open it."""

    def test_the_counts_leave_it_out_for_an_administrator_without_an_owners_power(self, mongo_replica_set_url: str):
        """Counted, it would answer whether a typed address is that change's new one, which the administrators page withholds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, CHANGING_HOLDER_GRANT_OID, CHANGING_HOLDER, "administration")
            return [(await posted(mongo_replica_set_url, VIEW_PATH, view_of(), by=by)).json()["address_change"] for by in (OPERATOR, OWNER)]

        assert on_a_league(mongo_replica_set_url, body) == [1, 2]

    def test_the_erasure_ending_it_is_the_owners(self, mongo_replica_set_url: str):
        """Ending it is a discard, which only the owner makes of an administrator's change."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, CHANGING_HOLDER_GRANT_OID, CHANGING_HOLDER, "administration")
            before = await everything_in(database)
            by_operator = await posted(mongo_replica_set_url, PATH, erasure_of())
            untouched = before == await everything_in(database)
            by_owner = by_operator if by_operator.status_code == 204 else await posted(mongo_replica_set_url, PATH, erasure_of(), by=OWNER)
            ended = await database[Collection.ADDRESS_CHANGES].find_one({"_id": OTHER_REFEREE_CHANGE_OID})
            return by_operator, untouched, by_owner.status_code, ended

        by_operator, untouched, owners_status, ended = on_a_league(mongo_replica_set_url, body)

        assert (by_operator.status_code, by_operator.json()["error_code"], untouched) == (403, Code.FOREIGN_ADDRESS_CHANGE, True)
        assert owners_status == 204
        assert ended is not None and ended["ended"]["kind"] == "discarded"


@pytest.mark.db
class TestTheReference:
    def test_the_erasures_one_row_holds_it_stripped_and_names_the_administrator(self, mongo_replica_set_url: str):
        """Catches the row left out, or written under the erased person: it is the one record of an erasure past the mail thread."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await posted(mongo_replica_set_url, PATH, erasure_of(reason=f"  {REASON}  "))

            return response.status_code, await database[Collection.ACTION_LOG].find({"action": "erasure.on_request"}).to_list(length=None)

        status, rows = on_a_league(mongo_replica_set_url, body)

        assert status == 204
        assert [(row["by"], row["label"], row["record_id"]) for row in rows] == [(OPERATOR, REASON, None)]


class PupilsReadMeetingARival(InterleavedCollection):
    """The pupils the erasure reads ahead of its first write, a rival write committing first: inside the attempt."""

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.aggregate(*args, **kwargs)


# Where a grant's creation names its address: the grant, its notice and its act's label.
THE_GRANTS_OWN_ROWS = frozenset({Collection.GRANTS, Collection.OUTBOX, Collection.ACTION_LOG})


def aside_the_grants_own_rows(held: Mapping[str, list[str]]) -> dict[str, list[str]]:
    return {value: [name for name in found if name not in THE_GRANTS_OWN_ROWS] for value, found in held.items()}


# --- Refused by the payload, which the route validates before any read.


class TestTheReasonIsRefusedAtTheBox:
    """A refusal alone tells nothing: one refused for another field is refused too, so the location is asserted."""

    @pytest.mark.parametrize(
        "body",
        [
            pytest.param(erasure_of(reason="   "), id="spaces alone"),
            pytest.param(erasure_of(reason="Mail vom 30.03.\nBetreff: Löschung"), id="two lines"),
        ],
    )
    def test_the_erasure_is_refused_naming_it(self, body: dict[str, str]):
        with pytest.raises(ValidationError) as raised:
            FLErasurePayload.model_validate(body)

        assert [error["loc"] for error in raised.value.errors()] == [("reason",)]


class TestADomainIsRefusedBeyondAscii:
    """Every stored domain is ASCII, so a lookup typing one in Unicode would find nothing and say nothing is held."""

    @pytest.mark.parametrize(
        ("payload", "body"),
        [
            pytest.param(FLErasureAddressPayload, view_of("anna@müller.de"), id="the lookup"),
            pytest.param(FLErasurePayload, erasure_of("anna@müller.de"), id="the erasure"),
        ],
    )
    def test_the_address_rule_s_own_refusal_names_the_box(self, payload: type[FLErasureAddressPayload], body: dict[str, str]):
        with pytest.raises(ValidationError) as raised:
            payload.model_validate(body)

        assert [(error["loc"], error["type"]) for error in raised.value.errors()] == [(("email",), "email_not_accepted")]
