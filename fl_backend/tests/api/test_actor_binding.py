"""
API · who a request acts for: the session headers behind the admin key and the binder

Which routes carry which guard is `tests/api/test_admin_guard.py`'s sweep; this file proves what each
guard does with a request. The grants each check reads are the db tier's
(`tests/api/test_actor_grants_execution.py`): here a request clearing every session check meets the
missing database at the first of those reads.
"""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Mapping
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import ACTOR_CHALLENGE
from app.core.recording import actor_var, record_act
from app.core.security import AUTH_TIME_HEADER, PASSKEY_FACTOR, Factor, PersonIdentifier, bind_actor, get_actor_email
from app.main import create_app
from app.shared.schemas.bounds import ADMIN_WINDOW_HOURS, PERSON_WINDOW_DAYS
from tests.config import ADMIN_KEY, BASE_AUTH, build_test_config
from tests.session_headers import SESSION_AGE_S, actor_headers, verified_actor

CONFIG = build_test_config()

TEAM_ID = "6890a1b2c3d4e5f607182930"
WRITE_PATH = f"/api/v0/teams/{TEAM_ID}"

# An admin-tier read on a router that writes nothing: the session reaches a read as it reaches a write.
READ_PATH = "/api/v0/spielorte"

ACTOR = "admin@example.com"


def client() -> TestClient:
    """No lifespan, so nothing opens the database: a request clearing every session check fails on `no_database_client`, which is observable."""

    return TestClient(create_app(CONFIG), raise_server_exceptions=False)


def answer(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["error_code"]


def signed_in_before(age_s: int, *, email: str = ACTOR, factor: Factor = PASSKEY_FACTOR) -> dict[str, str]:
    return {**ADMIN_KEY, **actor_headers(email, signed_in_before_s=age_s, factor=factor)}


def test_a_request_without_the_admin_key_sets_no_actor():
    """The admin key is what makes the headers believed: a full administrator's session beside the base key reaches nothing."""

    response = client().delete(WRITE_PATH, headers={**BASE_AUTH, **actor_headers(ACTOR)})

    assert answer(response) == (401, Code.ACCESS_KEY_REFUSED)


@pytest.mark.parametrize(
    "headers",
    [
        pytest.param({}, id="no session"),
        pytest.param({AUTH_TIME_HEADER: ""}, id="no sign-in time"),
        pytest.param({AUTH_TIME_HEADER: "-60"}, id="a signed sign-in time"),
        pytest.param({"X-FL-Auth-Factor": "sms"}, id="a factor no session is made by"),
        pytest.param({"X-FL-Actor": ""}, id="no address"),
        # Decoded leniently, `%41` would read as `A` and name another mailbox.
        pytest.param({"X-FL-Actor": ACTOR}, id="an address sent unencoded"),
        pytest.param({"X-FL-Actor": "admin%4example.com"}, id="a truncated escape"),
        pytest.param({"X-FL-Actor": "k%c3%a4the%40example.com"}, id="a lower-case escape"),
        pytest.param({"X-FL-Actor": "k%E4the%40example.com"}, id="an escape decoding to no UTF-8"),
        # Bytes, as a client sending the address raw puts them on the wire; Starlette reads them as Latin-1.
        pytest.param({"X-FL-Actor": "käthe%40example.com".encode("latin-1")}, id="a byte past ASCII"),
    ],
)
def test_a_request_naming_no_session_is_refused_before_the_grant_read(headers: Mapping[str, str | bytes]):
    """The real read and no database: a 503 here would mean the grants were asked before the session was read."""

    sent = {**ADMIN_KEY} if not headers else {**ADMIN_KEY, **actor_headers(ACTOR), **headers}
    response = client().get(READ_PATH, headers=sent)

    assert answer(response) == (400, Code.MISSING_ACTOR)


class TestTheAdministratorsSession:
    @pytest.mark.parametrize(
        "headers",
        [
            pytest.param(signed_in_before(SESSION_AGE_S, factor="code"), id="a session by code"),
            pytest.param(signed_in_before(ADMIN_WINDOW_HOURS * 3600 + 60), id="a session past the administrator's window"),
        ],
    )
    def test_a_session_the_admin_tier_does_not_take_is_refused_before_the_grant_read(self, headers: Mapping[str, str]):
        """A person's session sent to an admin route meets this, whatever the grants hold."""

        response = client().delete(WRITE_PATH, headers=headers)

        assert answer(response) == (401, Code.SESSION_REFUSED)
        assert response.headers["www-authenticate"] == ACTOR_CHALLENGE


async def through(binder: AsyncIterator[None]) -> tuple[str | None, str | None]:
    """Driven as FastAPI's exit stack drives it, in one task, so what the binder sets and resets is visible here."""

    await anext(binder)
    during = actor_var.get()
    with contextlib.suppress(StopAsyncIteration):
        await anext(binder)

    return during, actor_var.get()


@pytest.fixture
def an_administrator_bound() -> None:
    """Overrides the suite's own: these cases read what a binder binds and what it leaves behind, so nothing is bound ahead of it."""


def test_the_administrator_is_bound_folded_for_the_request_alone():
    """Folded, so one administrator is one spelling in `action_log`; reset, or the address lands on the loop's next request."""

    during, after = asyncio.run(through(bind_actor(verified_actor(ACTOR.upper()))))

    assert (during, after) == (ACTOR, None)


class _LogDouble:
    """A collection as `record_act` reaches it: the target's own database handle, and one insert."""

    def __init__(self) -> None:
        self.rows: list[Mapping[str, Any]] = []
        self.database = {Collection.ACTION_LOG: self}

    async def insert_one(self, document: Mapping[str, Any], session: Any = None) -> None:
        self.rows.append(document)


def test_an_act_on_a_route_binding_no_administrator_names_who_acted_or_fails():
    """What a request served over the wire meets on a route that forgot its `by`; a direct call runs with the suite's administrator bound."""

    log = _LogDouble()

    with pytest.raises(LookupError):
        asyncio.run(record_act(collection=cast(AsyncCollection, log), action="team.retired", session=cast(AsyncClientSession, None)))
    with pytest.raises(LookupError):
        get_actor_email()

    assert log.rows == []


KNOWN_IDENTIFIER = "anna@beispielschule.de"
MIXED_CASE = "Anna@BeispielSchule.DE"

PERSON_PROBE = "/api/v0/person-probe"


def person_client() -> TestClient:
    """The real application and one probe route declaring a person's guard, answering what it handed the handler."""

    def probe(identifier: PersonIdentifier) -> dict[str, str]:
        return {"identifier": identifier}

    app = create_app(CONFIG)
    app.add_api_route(PERSON_PROBE, probe, methods=["GET"])

    return TestClient(app, raise_server_exceptions=False)


def as_person(email: str = KNOWN_IDENTIFIER, *, age_s: int = SESSION_AGE_S, factor: Factor = "code") -> dict[str, str]:
    return actor_headers(email, signed_in_before_s=age_s, factor=factor)


class TestThePersonsSession:
    def test_a_person_is_handed_on_folded(self):
        """So one mailbox's two spellings cannot hold two answers."""

        assert person_client().get(PERSON_PROBE, headers=as_person(MIXED_CASE)).json() == {"identifier": KNOWN_IDENTIFIER}

    def test_a_session_past_the_person_s_window_is_refused(self):
        response = person_client().get(PERSON_PROBE, headers=as_person(age_s=PERSON_WINDOW_DAYS * 86400 + 60))

        assert answer(response) == (401, Code.SESSION_REFUSED)

    def test_a_request_naming_nobody_is_refused(self):
        assert answer(person_client().get(PERSON_PROBE)) == (400, Code.MISSING_ACTOR)
