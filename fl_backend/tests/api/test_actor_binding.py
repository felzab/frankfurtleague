"""
API · who a request acts for: the session headers behind the admin key and the binder

Which routes carry which guard is `tests/api/test_admin_guard.py`'s sweep; this file proves what each
guard does with a request. The grants each check reads are in the database, which this file never
starts: here a request clearing every session check meets the missing database at the first of
those reads.
"""

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
from app.core.security import (
    ACTOR_HEADER,
    AUTH_FACTOR_HEADER,
    AUTH_TIME_HEADER,
    PASSKEY_FACTOR,
    FLAuthFactor,
    bind_actor,
    get_actor_email,
    get_person_identifier,
)
from app.shared.schemas.bounds import ADMIN_WINDOW_HOURS, PERSON_WINDOW_DAYS
from tests.app_client import app_under_test
from tests.config import ADMIN_KEY, BASE_AUTH
from tests.session_headers import SESSION_AGE_S, actor_headers, verified_actor

TEAM_ID = "6890a1b2c3d4e5f607182930"
WRITE_PATH = f"/api/teams/{TEAM_ID}"

# An admin-tier read on a router that writes nothing: the session reaches a read as it reaches a write.
READ_PATH = "/api/spielorte"

ACTOR = "admin@example.com"


def client() -> TestClient:
    """No lifespan, so nothing opens the database: a request clearing every session check fails on the missing client with a 500."""

    return TestClient(app_under_test(), raise_server_exceptions=False)


def answer(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["error_code"]


def signed_in_before(age_s: int, *, email: str = ACTOR, factor: FLAuthFactor = PASSKEY_FACTOR) -> dict[str, str]:
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
        pytest.param({AUTH_FACTOR_HEADER: "sms"}, id="a factor no session is made by"),
        pytest.param({ACTOR_HEADER: ""}, id="no address"),
        # Bytes, as a fetch puts an address below U+0100 on the wire; Starlette reads them back as Latin-1.
        pytest.param({ACTOR_HEADER: "käthe@example.com".encode("latin-1")}, id="an address past ASCII"),
    ],
)
def test_a_request_naming_no_session_is_refused_before_the_grant_read(headers: Mapping[str, str | bytes]):
    """The real read and no database: a 500 here would mean the grants were asked before the session was read."""

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
        """A person's session by code, or an administrator's passkey session past its window, meets this, whatever the grants hold."""

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


async def test_the_administrator_is_bound_folded_for_the_request_alone():
    """Folded, so one administrator is one spelling in `action_log`; reset, or the address lands on the loop's next request."""

    during, after = await through(bind_actor(verified_actor(ACTOR.upper())))

    assert (during, after) == (ACTOR, None)


class _LogDouble:
    """A collection as `record_act` reaches it: the target's own database handle, and one insert."""

    def __init__(self) -> None:
        self.rows: list[Mapping[str, Any]] = []
        self.database = {Collection.ACTION_LOG: self}

    async def insert_one(self, document: Mapping[str, Any], session: Any = None) -> None:
        self.rows.append(document)


async def test_an_act_on_a_route_binding_no_administrator_names_who_acted_or_fails():
    """What a request served over the wire meets on a route that forgot its `by`; a direct call runs with the suite's administrator bound."""

    log = _LogDouble()

    with pytest.raises(LookupError):
        await record_act(collection=cast(AsyncCollection, log), action="team.retired", session=cast(AsyncClientSession, None))
    with pytest.raises(LookupError):
        get_actor_email()

    assert log.rows == []


KNOWN_IDENTIFIER = "anna@beispielschule.example.org"
MIXED_CASE = "Anna@BeispielSchule.EXAMPLE.ORG"

# A person's read with no path parameter, so a refusal can only come from the session it is sent.
PERSON_READ_PATH = "/api/spieler/self/saisons"


def as_person(email: str = KNOWN_IDENTIFIER, *, age_s: int = SESSION_AGE_S, factor: FLAuthFactor = "code") -> dict[str, str]:
    return {**ADMIN_KEY, **actor_headers(email, signed_in_before_s=age_s, factor=factor)}


class TestThePersonsSession:
    def test_a_person_is_handed_on_folded(self):
        """So one mailbox's two spellings cannot hold two answers."""

        assert get_person_identifier(verified_actor(MIXED_CASE, factor="code")) == KNOWN_IDENTIFIER

    def test_a_session_past_the_person_s_window_is_refused(self):
        response = client().get(PERSON_READ_PATH, headers=as_person(age_s=PERSON_WINDOW_DAYS * 86400 + 60))

        assert answer(response) == (401, Code.SESSION_REFUSED)

    def test_a_request_naming_nobody_is_refused(self):
        assert answer(client().get(PERSON_READ_PATH, headers=ADMIN_KEY)) == (400, Code.MISSING_ACTOR)
