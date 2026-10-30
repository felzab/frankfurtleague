"""
API · who a request acts for: the session headers behind the admin key, the step-up and the binders

Which routes carry which binder is `tests/api/test_admin_guard.py`'s sweep; this file proves what each
binder and each check does with a request. The grants and the ban list each check reads are the db
tier's (`tests/api/test_actor_grants_execution.py`, `tests/api/test_person_ban_execution.py`): here a
request clearing every session check meets the missing database at the first of those reads.
"""

import asyncio
import contextlib
import inspect
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from typing import Any, cast, get_args

import pytest
from fastapi import Depends, params
from fastapi.testclient import TestClient
from pydantic import SecretStr
from pymongo.asynchronous.collection import AsyncCollection
from starlette.requests import Request

from app.api.sperrliste.guard import PERSON_ACTOR_BINDERS
from app.api.sperrliste.services import adresse_hash
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import ACTOR_CHALLENGE, APIError
from app.core.recording import PUBLIC_ACTOR, SYSTEM_ACTOR, Actor, AktorFunktion, PersonActor, actor_var, record_write, request_var
from app.core.security import (
    AUTH_TIME_HEADER,
    ENROLMENT_WINDOW_S,
    PASSKEY_FACTOR,
    STEP_UP_WINDOW_S,
    Attribution,
    Factor,
    SessionActor,
    akteur_pseudonym,
    attribute_the_administrator,
    bind_actor,
    bind_public_actor,
    get_actor_email,
    loeschung_journal_hash,
    verify_recent_confirmation,
    verify_recent_person_confirmation,
    verify_step_up,
)
from app.main import create_app
from app.shared.schemas.bounds import ADMIN_WINDOW_HOURS, PERSON_WINDOW_DAYS
from tests.actor_tokens import SESSION_AGE_S, SignedActor, actor_headers, verified_actor
from tests.config import ADMIN_KEY, BASE_AUTH, build_test_config
from tests.core.app_source import api_routes, application, dependency_calls

CONFIG = build_test_config()

TEAM_ID = "6890a1b2c3d4e5f607182930"
WRITE_PATH = f"/api/v0/teams/{TEAM_ID}"
ROUTE_TEMPLATE = "/api/v0/teams/{team_id}"

# An admin-tier read on a router that writes nothing: the session reaches a read as it reaches a write.
READ_PATH = "/api/v0/spielorte"

ACTOR = "admin@example.com"

# A route added to a case's own app, its handler reading what the binder bound.
PUBLIC_PROBE = "/api/v0/public-probe"

# Named rather than compared with `!=`: a control asserting only "not 401" passes on any failure,
# the harness's own included.
UNREACHED_DATABASE = Code.NO_DATABASE_CLIENT


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
    def test_a_passkey_session_reaches_the_grant_read(self):
        """The control: every refusal below would pass on a guard that refuses everything."""

        assert answer(client().delete(WRITE_PATH, headers=SignedActor(ACTOR, ADMIN_KEY))) == (503, UNREACHED_DATABASE)

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


# The writes held to the enrolment window, each declaring the check.
GRANT_WRITES = [
    pytest.param("post", "/api/v0/grants", id="a grant"),
    pytest.param("delete", "/api/v0/grants/{grant_id}", id="a revoke"),
    pytest.param("patch", "/api/v0/grants/{grant_id}", id="a tier change"),
    pytest.param("post", "/api/v0/address_change/{address_change_id}/approval", id="an approval of a grant's move"),
    pytest.param("post", "/api/v0/grants/approval_requests/{approval_request_id}/approval", id="an approval of a grant or a promotion"),
]

# Every write the page steps up on every call: nothing reverses what it does, or it mints or voids a
# link to an address. Listed, and held to the declarations by the case below.
STEP_UP_WRITES = [
    pytest.param("post", "/api/v0/bewerbungen/{bewerbung_id}/accept", id="an acceptance"),
    pytest.param("post", "/api/v0/bewerbungen/{bewerbung_id}/decline", id="a decline"),
    pytest.param("post", "/api/v0/bewerbungen/{bewerbung_id}/einwilligung/{seat}/resend", id="a seat's re-send"),
    pytest.param("post", "/api/v0/bewerbungen/{bewerbung_id}/kontakte/{seat}/email", id="a seat's address correction"),
    pytest.param("post", "/api/v0/bewerbungen/{bewerbung_id}/kontakte/{seat}", id="a reseat"),
    pytest.param("post", "/api/v0/identity/erasure", id="an erasure on a mailed request"),
    pytest.param("post", "/api/v0/identity/sign_out", id="an address's sign-out of every session"),
    pytest.param("post", "/api/v0/saisons", id="a season's creation"),
    pytest.param("post", "/api/v0/saisons/{saison_id}/activate", id="the rollover"),
    pytest.param("delete", "/api/v0/saisons/{saison_id}/spielplan", id="the undraw"),
    pytest.param("post", "/api/v0/saisons/{saison_id}/invitations/dispatch", id="the season's invitation send"),
    pytest.param("post", "/api/v0/schiedsrichter", id="a referee's entry"),
    pytest.param("post", "/api/v0/schiedsrichter/{schiedsrichter_id}/confirmation/invite", id="a referee's fresh link"),
    pytest.param("post", "/api/v0/sperrliste", id="a ban"),
    pytest.param("delete", "/api/v0/sperrliste/{sperrliste_id}", id="a ban's lift"),
    pytest.param("post", "/api/v0/spielbestaetigungen/{spielbestaetigung_id}/enter", id="a party's Zusage recorded for it"),
    pytest.param("post", "/api/v0/spielbestaetigungen/{spielbestaetigung_id}/discard", id="a club's proposal discarded"),
    pytest.param("patch", "/api/v0/spielberichte/{spiel_id}", id="an administrator's write of a report"),
    pytest.param("post", "/api/v0/address_change", id="an address change asked"),
    pytest.param("post", "/api/v0/address_change/{address_change_id}/invite", id="an address change's fresh link"),
    pytest.param("delete", "/api/v0/address_change/{address_change_id}", id="an address change discarded"),
    pytest.param("delete", "/api/v0/grants/approval_requests/{approval_request_id}", id="a request for a grant refused or withdrawn"),
    pytest.param("post", "/api/v0/teams/{team_id}/saisons", id="a club's entry into a season"),
    pytest.param("post", "/api/v0/teams/{team_id}/saisons/{saison_id}/kontakte/{seat}/confirmation/invite", id="a contact seat's fresh link"),
    pytest.param("post", "/api/v0/teams/{team_id}/saisons/{saison_id}/replace", id="a club's replacement"),
    pytest.param("delete", "/api/v0/teams/{team_id}/saisons/{saison_id}/invitation", id="a club's link revoked"),
    pytest.param("post", "/api/v0/teams/{team_id}/saisons/{saison_id}/invitation/dispatch", id="a club's link mailed to its seats"),
]

# The person's own address change, started or approved, held to the enrolment window by either factor.
ADDRESS_CHANGE_WRITES = [
    pytest.param("post", "/api/v0/account/address_change", id="a start"),
    pytest.param("post", "/api/v0/account/address_change/release", id="an approval"),
]

WindowCheck = Callable[[SessionActor], None]

# Each window check and the window it holds a sign-in to.
WINDOWS = [
    pytest.param(verify_recent_confirmation, ENROLMENT_WINDOW_S, id="the grants' enrolment window"),
    pytest.param(verify_step_up, STEP_UP_WINDOW_S, id="the step-up window"),
    pytest.param(verify_recent_person_confirmation, ENROLMENT_WINDOW_S, id="the person's enrolment window"),
]

# Each window check and the writes declaring it.
DECLARATIONS = [
    pytest.param(verify_recent_confirmation, GRANT_WRITES, id="the grants' enrolment window"),
    pytest.param(verify_step_up, STEP_UP_WRITES, id="the step-up window"),
    pytest.param(verify_recent_person_confirmation, ADDRESS_CHANGE_WRITES, id="the person's enrolment window"),
]


def challenge(window_s: int) -> str:
    return f'{ACTOR_CHALLENGE} error="insufficient_user_authentication", max_age="{window_s}"'


def refusal_of(check: WindowCheck, actor: SessionActor) -> APIError | None:
    """What a window check raises for `actor`, called with a plain argument as FastAPI calls it once the session checks have answered."""

    try:
        check(actor)
    except APIError as refused:
        return refused

    return None


class TestTheStepUp:
    """The grants' writes and a person's address change are held to the enrolment window, every other step-up write to the step-up window."""

    @pytest.mark.parametrize(("check", "window_s"), WINDOWS)
    def test_a_sign_in_older_than_the_window_is_refused_with_its_challenge(self, check: WindowCheck, window_s: int):
        refused = refusal_of(check, verified_actor(ACTOR, signed_in_before_s=window_s + 1))

        assert refused is not None
        assert (refused.status_code, refused.error_code) == (401, Code.CONFIRMATION_REQUIRED)
        assert refused.headers == {"WWW-Authenticate": challenge(window_s)}

    @pytest.mark.parametrize(("check", "window_s"), WINDOWS)
    def test_a_sign_in_inside_the_window_passes(self, check: WindowCheck, window_s: int):
        """The control: every refusal above would pass on a check refusing everything."""

        assert refusal_of(check, verified_actor(ACTOR, signed_in_before_s=window_s - SESSION_AGE_S)) is None

    @pytest.mark.parametrize("factor", ["code", PASSKEY_FACTOR])
    def test_a_person_s_address_change_takes_either_factor_inside_the_window(self, factor: Factor):
        """The code goes to the address on file, the confirmation OWASP's process asks of it."""

        actor = verified_actor(ACTOR, signed_in_before_s=ENROLMENT_WINDOW_S - SESSION_AGE_S, factor=factor)

        assert refusal_of(verify_recent_person_confirmation, actor) is None

    @pytest.mark.parametrize(("check", "writes"), DECLARATIONS)
    def test_every_route_declaring_the_check_is_one_listed_above(self, check: WindowCheck, writes: list[Any]):
        """Both ways: a listed write dropping its declaration fails here, and so does a write declaring it unlisted."""

        declared = {
            operation
            for route in api_routes(application())
            if check in set(dependency_calls(route.dependant))
            for operation in [(route.path_format, method.lower()) for method in route.methods or ()]
        }

        assert declared == {(param.values[1], param.values[0]) for param in writes}


class _Route:
    """A route carrying nothing but its `path`, which is all a binder reads off one."""

    def __init__(self, path: str) -> None:
        self.path = path


def request_for(method: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": WRITE_PATH,
            "query_string": b"",
            "headers": [],
            "route": _Route(ROUTE_TEMPLATE),
        }
    )


Bound = tuple[Actor | PersonActor, tuple[str, str] | None]


async def through(binder: AsyncIterator[Any], inside: Callable[[], Awaitable[Any]] | None = None) -> tuple[Any, Bound, Bound]:
    """Driven as FastAPI's exit stack drives it, in one task, so what the binder sets and resets is visible here.

    `inside` runs where the handler would.
    """

    value = await anext(binder)
    during = (actor_var.get(), request_var.get())
    if inside is not None:
        await inside()
    with contextlib.suppress(StopAsyncIteration):
        await anext(binder)

    return value, during, (actor_var.get(), request_var.get())


def test_the_administrator_is_bound_folded_under_the_route_s_template_for_the_request_alone():
    """Folded, so one administrator is one spelling in `aktionen`; the template, so the page reads one row per kind of action."""

    attribution = attribute_the_administrator(verified_actor(ACTOR.upper()))
    _, during, after = asyncio.run(through(bind_actor(request_for("PATCH"), attribution)))

    assert during == (Actor(kind="admin_session", email=ACTOR), ("PATCH", ROUTE_TEMPLATE))
    assert after == (SYSTEM_ACTOR, None)


def test_the_public_binder_names_the_public_whatever_the_headers_say():
    """A visitor's own session headers name nobody: the public binder never reads them, and refuses no request over them."""

    app = create_app(CONFIG)
    seen: list[Bound] = []

    def probe() -> dict[str, bool]:
        seen.append((actor_var.get(), request_var.get()))
        return {"erreicht": True}

    app.add_api_route(PUBLIC_PROBE, probe, methods=["POST"], dependencies=[Depends(bind_public_actor)])
    response = TestClient(app, raise_server_exceptions=False).post(PUBLIC_PROBE, headers=actor_headers(ACTOR))

    assert response.status_code == 200
    assert seen == [(PUBLIC_ACTOR, ("POST", PUBLIC_PROBE))]


# Obviously fake, padded to the boot's floor, and the key the pseudonym below was computed under.
KNOWN_MASTER = SecretStr("known-answer-key".ljust(64, "0"))
KNOWN_IDENTIFIER = "anna@beispielschule.de"
# The VALUE, computed outside this package with `hmac` and `hashlib` alone:
# HMAC-SHA256(HMAC-SHA256(master, "akteur-v1"), identifier), nothing under `app/` imported.
KNOWN_PSEUDONYM = "a34dad0e53a78bc549a6035faaa0dd5febf37bb83ca1585a8109fc0e626f8722"

MIXED_CASE = "Anna@BeispielSchule.DE"

# Any one of the three: the cases below are about what every person binder does alike.
SPIELER: AktorFunktion = "spieler"


class _LogDouble:
    """The log's collection as `record_write` reaches it: the target's own database handle, and one insert."""

    def __init__(self) -> None:
        self.name = str(Collection.TEAMS)
        self.rows: list[Mapping[str, Any]] = []
        self.database = {Collection.AKTIONEN: self}

    async def insert_one(self, document: Mapping[str, Any], session: Any = None) -> None:
        self.rows.append(document)


PERSON_PROBE = "/api/v0/person-probe"


def _probe() -> dict[str, bool]:
    return {"erreicht": True}


def person_client() -> TestClient:
    """The real application and one probe route declaring a person's binder, its ban read meeting the missing database."""

    app = create_app(CONFIG)
    app.add_api_route(PERSON_PROBE, _probe, methods=["GET"], dependencies=[Depends(PERSON_ACTOR_BINDERS[SPIELER])])

    return TestClient(app, raise_server_exceptions=False)


def as_person(email: str = KNOWN_IDENTIFIER, *, age_s: int = SESSION_AGE_S, factor: Factor = "code") -> dict[str, str]:
    return actor_headers(email, signed_in_before_s=age_s, factor=factor)


def attributed_person(funktion: AktorFunktion, email: str) -> Attribution[str]:
    """What the Funktion's binder is handed for a person the ban check let through, by the attribute its own `Depends` names.

    Called with plain arguments, as FastAPI calls it once that check has answered.
    """

    [declared] = [
        marker
        for marker in inspect.signature(PERSON_ACTOR_BINDERS[funktion]).parameters["attribution"].annotation.__metadata__
        if isinstance(marker, params.Depends)
    ]
    assert declared.dependency is not None

    return declared.dependency(actor=verified_actor(email, factor="code"), config=CONFIG)


class TestThePersonsSession:
    @pytest.mark.parametrize("funktion", get_args(AktorFunktion))
    def test_a_person_is_bound_under_the_funktion_its_router_declares(self, funktion: AktorFunktion):
        """Folded before it is hashed or handed on, so one mailbox's two spellings cannot hold two answers."""

        binder = PERSON_ACTOR_BINDERS[funktion]
        identifier, during, after = asyncio.run(through(binder(request_for("GET"), attributed_person(funktion, MIXED_CASE))))

        pseudonym = akteur_pseudonym(KNOWN_IDENTIFIER, key=CONFIG.sperrliste_schluessel)
        assert identifier == KNOWN_IDENTIFIER
        assert during == (PersonActor(pseudonym=pseudonym, funktion=funktion), ("GET", ROUTE_TEMPLATE))
        assert after == (SYSTEM_ACTOR, None)

    def test_the_log_row_carries_the_pseudonym_and_no_address(self):
        """A person's route records a pseudonym, never an address, and hands no administrator to a field storing one."""

        log = _LogDouble()
        asked: list[str] = []

        async def handler() -> None:
            await record_write(collection=cast(AsyncCollection, log), operation="patch_one", document_id=TEAM_ID)
            with contextlib.suppress(LookupError):
                asked.append(get_actor_email())

        binder = PERSON_ACTOR_BINDERS[SPIELER]
        asyncio.run(through(binder(request_for("PATCH"), attributed_person(SPIELER, MIXED_CASE)), handler))

        [row] = log.rows
        pseudonym = akteur_pseudonym(KNOWN_IDENTIFIER, key=CONFIG.sperrliste_schluessel)
        # An equality, so an `email` beside the two is a failure rather than an extra key nobody reads.
        assert row["actor"] == {"kind": "person_session", "pseudonym": pseudonym, "funktion": SPIELER}
        assert "beispielschule" not in str(row).lower()
        assert asked == []

    def test_a_session_inside_the_person_s_window_reaches_the_ban_read(self):
        """The control: the refusals below would pass on a check refusing everybody."""

        assert answer(person_client().get(PERSON_PROBE, headers=as_person())) == (503, UNREACHED_DATABASE)

    def test_a_session_past_the_person_s_window_is_refused(self):
        response = person_client().get(PERSON_PROBE, headers=as_person(age_s=PERSON_WINDOW_DAYS * 86400 + 60))

        assert answer(response) == (401, Code.SESSION_REFUSED)

    def test_a_request_naming_nobody_is_refused_before_the_ban_read_opens_the_database(self):
        """No database and the real read: a 503 here would mean the list was asked before the session was read."""

        assert answer(person_client().get(PERSON_PROBE)) == (400, Code.MISSING_ACTOR)


class TestThePseudonym:
    def test_it_is_the_value_computed_outside_this_package(self):
        """The known answer: every other case compares the function with itself, so a construction swapped end for end passes them all."""
        assert akteur_pseudonym(KNOWN_IDENTIFIER, key=KNOWN_MASTER) == KNOWN_PSEUDONYM

    def test_it_is_never_the_ban_rows_digest_of_the_same_address(self):
        """One label per purpose under one master: a shared one would let the log say who the ban list holds."""
        assert akteur_pseudonym(KNOWN_IDENTIFIER, key=KNOWN_MASTER) != adresse_hash(KNOWN_IDENTIFIER, key=KNOWN_MASTER)


# The journal's answer for `KNOWN_IDENTIFIER` under `KNOWN_MASTER`, computed as `KNOWN_PSEUDONYM` was, under "loeschung-v1".
KNOWN_JOURNAL_HASH = "4bfa0be6fffe4c90adfc3290ec83efeb21a9845508cf2d170b39d047266a84a1"


class TestTheJournalHash:
    def test_it_is_the_value_computed_outside_this_package(self):
        assert loeschung_journal_hash(KNOWN_IDENTIFIER, key=KNOWN_MASTER) == KNOWN_JOURNAL_HASH

    def test_it_is_neither_the_pseudonym_nor_the_ban_rows_digest(self):
        """A shared label would let a journal line name the pseudonym an erasure removed, or the ban a person holds."""
        journal = loeschung_journal_hash(KNOWN_IDENTIFIER, key=KNOWN_MASTER)

        assert journal not in {KNOWN_PSEUDONYM, adresse_hash(KNOWN_IDENTIFIER, key=KNOWN_MASTER)}


# A stored spelling as a registration or a contact seat keeps one: case, and the spaces a form trims.
UNFOLDED_IDENTIFIER = f" {MIXED_CASE} "


@pytest.mark.parametrize(
    ("helper", "folded"),
    [(akteur_pseudonym, KNOWN_PSEUDONYM), (loeschung_journal_hash, KNOWN_JOURNAL_HASH)],
    ids=("the pseudonym", "the journal hash"),
)
def test_an_unfolded_spelling_hashes_as_its_fold(helper: Callable[..., str], folded: str):
    """A restore hashes every stored spelling against the journal, so a helper hashing the spelling as given matches nothing."""
    assert helper(UNFOLDED_IDENTIFIER, key=KNOWN_MASTER) == folded
