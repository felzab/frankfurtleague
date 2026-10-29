"""
API · who a request acts for: the session headers behind the admin key, the grants, the step-up and the binders

Which routes carry which binder is `tests/api/test_admin_guard.py`'s sweep; this file proves what each
binder does with a request.
"""

import asyncio
import contextlib
import functools
import re
from collections.abc import AsyncIterator, Callable, Mapping
from datetime import UTC, datetime
from typing import Annotated, Any, cast, get_args

import pytest
from fastapi import Depends, FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import SecretStr
from pymongo.asynchronous.collection import AsyncCollection
from starlette.requests import Request

from app.api.sperrliste.services import adresse_hash
from app.core.collections import Collection
from app.core.exceptions import ACTOR_TOKEN_CHALLENGE, NO_DATABASE_CLIENT
from app.core.recording import PUBLIC_ACTOR, SYSTEM_ACTOR, Actor, AktorFunktion, PersonActor, actor_var, record_write, request_var
from app.core.security import (
    ACTOR_NOT_ADMIN,
    ACTOR_TOKEN_REFUSED,
    AUTH_TIME_HEADER,
    CONFIRMATION_REQUIRED,
    ENROLMENT_WINDOW_S,
    MISSING_ACTOR,
    PASSKEY_FACTOR,
    PERSON_ACTOR_BINDERS,
    PERSON_BARRED,
    STEP_UP_WINDOW_S,
    WRONG_ADMIN_KEY,
    BanLookup,
    Factor,
    GrantLookup,
    akteur_pseudonym,
    attribute_the_administrator,
    bind_actor,
    bind_public_actor,
    get_actor_email,
    get_ban_lookup,
    get_grant_lookup,
    loeschung_journal_hash,
    verify_step_up,
)
from app.main import create_app
from app.shared.schemas.bounds import ADMIN_WINDOW_HOURS, PERSON_WINDOW_DAYS
from tests.actor_tokens import SESSION_AGE_S, SignedActor, actor_headers, session_headers, verified_actor
from tests.config import ADMIN_KEY, BASE_AUTH, build_test_config
from tests.core.app_source import api_routes, application, dependency_calls
from tests.grants import admit

CONFIG = build_test_config()

TEAM_ID = "6890a1b2c3d4e5f607182930"
WRITE_PATH = f"/api/v0/teams/{TEAM_ID}"
ROUTE_TEMPLATE = "/api/v0/teams/{team_id}"

# An admin-tier read on a router that writes nothing: the grants reach a read as they reach a write.
READ_PATH = "/api/v0/spielorte"

ACTOR = "admin@example.com"

# A route added to a case's own app, its handler reading what the binder bound.
PUBLIC_PROBE = "/api/v0/public-probe"
# Well-formed, and holding none of the grants `_served` answers from.
NOT_AN_ADMINISTRATOR = "schueler@example.com"

# Named rather than compared with `!=`: a control asserting only "not 401" passes on any failure,
# the harness's own included.
UNREACHED_DATABASE = NO_DATABASE_CLIENT


# The mounted operations, keyed as Starlette spells them, and the methods that record nothing:
# `tests/api/test_drosselung.py` sweeps the person writes off these.
ROUTES_BY_OPERATION = {(route.path, method): route for route in api_routes(application()) for method in (route.methods or ())}
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def binds_a_person(route: APIRoute) -> bool:
    """Compared by identity: each Funktion's binder is one module-level object."""
    return any(dependency.call is binder for dependency in route.dependant.dependencies for binder in PERSON_ACTOR_BINDERS.values())


@functools.cache
def _served() -> FastAPI:
    """A case clearing the actor check meets the missing database at the handler: the check answers from `tests/config.py :: ADMINISTRATORS`."""

    return admit(create_app(CONFIG))


def client() -> TestClient:
    """No lifespan, so nothing opens the database: a request clearing every check then fails on `DB-CONN-001`, which is observable."""

    return TestClient(_served(), raise_server_exceptions=False)


def answer(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["error_code"]


def signed_in_before(age_s: int, *, email: str = ACTOR, factor: Factor = PASSKEY_FACTOR) -> dict[str, str]:
    return {**ADMIN_KEY, **actor_headers(email, signed_in_before_s=age_s, factor=factor)}


def test_a_request_without_the_admin_key_sets_no_actor():
    """The admin key is what makes the headers believed: a full administrator's session beside the base key reaches nothing."""

    response = client().delete(WRITE_PATH, headers={**BASE_AUTH, **actor_headers(ACTOR)})

    assert answer(response) == (401, WRONG_ADMIN_KEY)


@pytest.mark.parametrize(
    "headers",
    [
        pytest.param({}, id="no session"),
        pytest.param({AUTH_TIME_HEADER: ""}, id="no sign-in time"),
        pytest.param({AUTH_TIME_HEADER: "-60"}, id="a signed sign-in time"),
        pytest.param({"X-FL-Auth-Factor": "sms"}, id="a factor no session is made by"),
        pytest.param({"X-FL-Actor": ""}, id="no address"),
    ],
)
def test_a_request_naming_no_session_is_refused_before_the_grant_read(headers: Mapping[str, str]):
    """The real lookup and no database: a 503 here would mean the grants were asked before the session was read."""

    sent = {**ADMIN_KEY} if not headers else {**ADMIN_KEY, **actor_headers(ACTOR), **headers}
    response = TestClient(create_app(CONFIG), raise_server_exceptions=False).get(READ_PATH, headers=sent)

    assert answer(response) == (400, MISSING_ACTOR)


class TestTheAdministratorsSession:
    def test_a_passkey_session_holding_a_grant_reaches_the_database(self):
        """The control: every refusal below would pass on a guard that refuses everything."""

        assert answer(client().delete(WRITE_PATH, headers=SignedActor(ACTOR.upper(), ADMIN_KEY))) == (503, UNREACHED_DATABASE)

    @pytest.mark.parametrize(
        "headers",
        [
            pytest.param(signed_in_before(SESSION_AGE_S, factor="code"), id="a session by code"),
            pytest.param(signed_in_before(ADMIN_WINDOW_HOURS * 3600 + 60), id="a session past the administrator's window"),
        ],
    )
    def test_a_session_the_admin_tier_does_not_take_is_refused(self, headers: Mapping[str, str]):
        """A granted address, and still refused: a person's session sent to an admin route meets this, not the grant alone."""

        response = client().delete(WRITE_PATH, headers=headers)

        assert answer(response) == (401, ACTOR_TOKEN_REFUSED)
        assert response.headers["www-authenticate"] == ACTOR_TOKEN_CHALLENGE

    @pytest.mark.parametrize(("method", "path"), [("delete", WRITE_PATH), ("get", READ_PATH)], ids=("a write", "a read"))
    def test_an_address_off_the_list_is_refused(self, method: str, path: str):
        response = getattr(client(), method)(path, headers=SignedActor(NOT_AN_ADMINISTRATOR, ADMIN_KEY))

        assert answer(response) == (403, ACTOR_NOT_ADMIN)
        assert "www-authenticate" not in response.headers

    @pytest.mark.parametrize(
        ("granted_after_s", "expected"),
        [
            pytest.param(0.999, (503, UNREACHED_DATABASE), id="later inside the sign-in's second"),
            pytest.param(1, (401, ACTOR_TOKEN_REFUSED), id="the second after the sign-in"),
        ],
    )
    def test_a_session_signed_in_before_its_grant_is_refused_to_the_second(self, granted_after_s: float, expected: tuple[int, str]):
        """`auth_time` is a whole second, so a grant later inside it admits what the frontend's millisecond admitted."""

        auth_time = int(datetime.now(UTC).timestamp()) - SESSION_AGE_S
        seit = datetime.fromtimestamp(auth_time + granted_after_s, UTC)

        def granted() -> GrantLookup:
            async def grant_since(identifier: str) -> datetime | None:
                return seit if identifier == ACTOR else None

            return grant_since

        app = create_app(CONFIG)
        app.dependency_overrides[get_grant_lookup] = granted
        headers = {**ADMIN_KEY, **session_headers(ACTOR, auth_time=auth_time, factor=PASSKEY_FACTOR)}

        assert answer(TestClient(app, raise_server_exceptions=False).get(READ_PATH, headers=headers)) == expected


GRANT_ID = "6890a1b2c3d4e5f607910002"
# The writes held to the enrolment window.
GRANT_WRITES = [
    pytest.param("post", "/api/v0/berechtigungen", id="a grant"),
    pytest.param("delete", f"/api/v0/berechtigungen/{GRANT_ID}", id="a revoke"),
    pytest.param("patch", f"/api/v0/berechtigungen/{GRANT_ID}", id="a tier change"),
    pytest.param("post", f"/api/v0/adresswechsel/{GRANT_ID}/genehmigung", id="an approval of a grant's move"),
    pytest.param("post", f"/api/v0/berechtigungen/antraege/{GRANT_ID}/genehmigung", id="an approval of a grant or a promotion"),
]

# Every write the page steps up on every call: nothing reverses what it does, or it mints or voids a
# link to an address. Listed, and held to the declarations by the case below.
STEP_UP_WRITES = [
    pytest.param("post", "/api/v0/bewerbungen/{bewerbung_id}/annehmen", id="an acceptance"),
    pytest.param("post", "/api/v0/bewerbungen/{bewerbung_id}/ablehnen", id="a decline"),
    pytest.param("post", "/api/v0/bewerbungen/{bewerbung_id}/einwilligung/{seat}/erneut", id="a seat's re-send"),
    pytest.param("post", "/api/v0/bewerbungen/{bewerbung_id}/kontakte/{seat}/email", id="a seat's address correction"),
    pytest.param("post", "/api/v0/bewerbungen/{bewerbung_id}/kontakte/{seat}", id="a reseat"),
    pytest.param("post", "/api/v0/identitaet/erasure", id="an erasure on a mailed request"),
    pytest.param("post", "/api/v0/identitaet/abmeldung", id="an address's sign-out of every session"),
    pytest.param("post", "/api/v0/saisons", id="a season's creation"),
    pytest.param("post", "/api/v0/saisons/{saison_id}/activate", id="the rollover"),
    pytest.param("delete", "/api/v0/saisons/{saison_id}/spielplan", id="the undraw"),
    pytest.param("post", "/api/v0/saisons/{saison_id}/einladungen/versand", id="the season's invitation send"),
    pytest.param("post", "/api/v0/schiedsrichter", id="a referee's entry"),
    pytest.param("post", "/api/v0/schiedsrichter/{schiedsrichter_id}/bestaetigung/einladen", id="a referee's fresh link"),
    pytest.param("post", "/api/v0/sperrliste", id="a ban"),
    pytest.param("delete", "/api/v0/sperrliste/{sperrliste_id}", id="a ban's lift"),
    pytest.param("post", "/api/v0/spielbestaetigungen/{spielbestaetigung_id}/eintragen", id="a party's Zusage recorded for it"),
    pytest.param("post", "/api/v0/spielbestaetigungen/{spielbestaetigung_id}/verwerfen", id="a club's proposal discarded"),
    pytest.param("patch", "/api/v0/spielberichte/{spiel_id}", id="an administrator's write of a report"),
    pytest.param("post", "/api/v0/adresswechsel", id="an address change asked"),
    pytest.param("post", "/api/v0/adresswechsel/{adresswechsel_id}/einladen", id="an address change's fresh link"),
    pytest.param("delete", "/api/v0/adresswechsel/{adresswechsel_id}", id="an address change discarded"),
    pytest.param("delete", "/api/v0/berechtigungen/antraege/{antrag_id}", id="a request for a grant refused or withdrawn"),
    pytest.param("post", "/api/v0/teams/{team_id}/saisons", id="a club's entry into a season"),
    pytest.param("post", "/api/v0/teams/{team_id}/saisons/{saison_id}/kontakte/{seat}/bestaetigung/einladen", id="a contact seat's fresh link"),
    pytest.param("post", "/api/v0/teams/{team_id}/saisons/{saison_id}/replace", id="a club's replacement"),
    pytest.param("delete", "/api/v0/teams/{team_id}/saisons/{saison_id}/einladung", id="a club's link revoked"),
]
# What each path parameter is filled with: an id where the route converts one, the season or the seat otherwise.
PATH_VALUES = {"saison_id": "2026", "seat": "trainer"}
AN_OBJECT_ID = "6890a1b2c3d4e5f607910003"


def url_of(template: str) -> str:
    return re.sub(r"\{(\w+)\}", lambda match: PATH_VALUES.get(match[1], AN_OBJECT_ID), template)


def challenge(window_s: int) -> str:
    return f'{ACTOR_TOKEN_CHALLENGE} error="insufficient_user_authentication", max_age="{window_s}"'


class TestTheStepUp:
    """The grants' writes are held to the enrolment window and every other step-up write to the step-up window."""

    @pytest.mark.parametrize(("method", "path"), GRANT_WRITES)
    def test_a_grant_write_from_an_older_sign_in_is_refused(self, method: str, path: str):
        response = getattr(client(), method)(path, headers=signed_in_before(ENROLMENT_WINDOW_S + 1))

        assert answer(response) == (401, CONFIRMATION_REQUIRED)
        assert response.headers["www-authenticate"] == challenge(ENROLMENT_WINDOW_S)

    @pytest.mark.parametrize(("method", "path"), STEP_UP_WRITES)
    def test_a_step_up_write_from_an_older_sign_in_is_refused(self, method: str, path: str):
        response = getattr(client(), method)(url_of(path), headers=signed_in_before(STEP_UP_WINDOW_S + 1))

        assert answer(response) == (401, CONFIRMATION_REQUIRED)
        assert response.headers["www-authenticate"] == challenge(STEP_UP_WINDOW_S)

    @pytest.mark.parametrize(
        ("method", "path", "age_s"),
        [
            pytest.param("post", "/api/v0/berechtigungen", ENROLMENT_WINDOW_S - SESSION_AGE_S, id="a grant inside its window"),
            pytest.param("post", "/api/v0/sperrliste", STEP_UP_WINDOW_S - SESSION_AGE_S, id="a ban inside its window"),
            pytest.param("delete", WRITE_PATH, STEP_UP_WINDOW_S + 1, id="a write the page does not step up"),
        ],
    )
    def test_a_write_its_window_admits_passes_the_check(self, method: str, path: str, age_s: int):
        """The control: every refusal above would pass on a check refusing everything."""

        assert answer(getattr(client(), method)(path, headers=signed_in_before(age_s)))[1] in {UNREACHED_DATABASE, "REQ-VAL-001"}

    def test_every_route_declaring_the_step_up_is_one_listed_above(self):
        """A step-up write dropping its declaration fails here, where no request would."""

        declared = {
            operation
            for route in api_routes(application())
            if verify_step_up in set(dependency_calls(route.dependant))
            for operation in [(route.path_format, method.lower()) for method in route.methods or ()]
        }

        assert declared == {(param.values[1], param.values[0]) for param in STEP_UP_WRITES}


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


async def through(binder: AsyncIterator[Any]) -> tuple[Any, Bound, Bound]:
    """Driven as FastAPI's exit stack drives it, in one task, so what the binder sets and resets is visible here."""

    value = await anext(binder)
    during = (actor_var.get(), request_var.get())
    with contextlib.suppress(StopAsyncIteration):
        await anext(binder)

    return value, during, (actor_var.get(), request_var.get())


def test_the_administrator_is_bound_folded_under_the_route_s_template_for_the_request_alone():
    """Folded, so one administrator is one spelling in `aktionen`; the template, so the page reads one row per kind of action."""

    attribution = attribute_the_administrator(verified_actor(ACTOR.upper()), CONFIG)
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

PERSON_ROUTE = "/api/v0/teams/{team_id}/kader"
MIXED_CASE = "Anna@BeispielSchule.DE"

# Any one of the three: the cases below are about what every person binder does alike.
SPIELER: AktorFunktion = "spieler"


async def _unbarred(identifier: str) -> bool:
    return False


class _LogDouble:
    """The log's collection as `record_write` reaches it: the target's own database handle, and one insert."""

    def __init__(self) -> None:
        self.name = str(Collection.TEAMS)
        self.rows: list[Mapping[str, Any]] = []
        self.database = {Collection.AKTIONEN: self}

    async def insert_one(self, document: Mapping[str, Any], session: Any = None) -> None:
        self.rows.append(document)


PERSON_PROBE = "/api/v0/person-probe"
BARRED_PERSON = "gesperrt@beispielschule.de"


def _probe() -> dict[str, bool]:
    return {"erreicht": True}


def person_client(*, barred: frozenset[str] | None = frozenset({BARRED_PERSON})) -> TestClient:
    """The real application and one probe route declaring a person's binder, its handler reading no database.

    The ban read is answered from `barred`, or left real where it is `None`, which reaches the missing database.
    """

    app = create_app(CONFIG)
    app.add_api_route(PERSON_PROBE, _probe, methods=["GET"], dependencies=[Depends(PERSON_ACTOR_BINDERS[SPIELER])])
    if barred is not None:

        def answered_from_the_set() -> BanLookup:
            async def is_gesperrt(identifier: str) -> bool:
                return identifier in barred

            return is_gesperrt

        app.dependency_overrides[get_ban_lookup] = answered_from_the_set

    return TestClient(app, raise_server_exceptions=False)


def as_person(email: str = KNOWN_IDENTIFIER, *, age_s: int = SESSION_AGE_S, factor: Factor = "code") -> dict[str, str]:
    return actor_headers(email, signed_in_before_s=age_s, factor=factor)


class TestThePersonsSession:
    @pytest.mark.parametrize("funktion", get_args(AktorFunktion))
    def test_a_person_is_bound_under_the_funktion_its_router_declares(self, funktion: AktorFunktion):
        """Folded before it is hashed or handed on, so one mailbox's two spellings cannot hold two answers."""

        app = create_app(CONFIG)
        seen: list[tuple[str, Bound]] = []
        binder = PERSON_ACTOR_BINDERS[funktion]

        # The handler's identifier from its router's own binder, which FastAPI runs once a request.
        def probe(identifier: Annotated[str, Depends(binder)]) -> dict[str, bool]:
            seen.append((identifier, (actor_var.get(), request_var.get())))
            return {"erreicht": True}

        app.add_api_route(PERSON_PROBE, probe, methods=["GET"], dependencies=[Depends(binder)])
        app.dependency_overrides[get_ban_lookup] = lambda: _unbarred
        response = TestClient(app, raise_server_exceptions=False).get(PERSON_PROBE, headers=as_person(MIXED_CASE))

        pseudonym = akteur_pseudonym(KNOWN_IDENTIFIER, schluessel=CONFIG.sperrliste_schluessel)
        assert response.status_code == 200
        assert seen == [(KNOWN_IDENTIFIER, (PersonActor(pseudonym=pseudonym, funktion=funktion), ("GET", PERSON_PROBE)))]

    def test_the_log_row_carries_the_pseudonym_and_no_address(self):
        """A person's route records a pseudonym, never an address, and hands no administrator to a field storing one."""

        log = _LogDouble()
        app = create_app(CONFIG)
        asked: list[str] = []

        async def probe() -> dict[str, bool]:
            await record_write(collection=cast(AsyncCollection, log), operation="patch_one", document_id=TEAM_ID)
            with contextlib.suppress(LookupError):
                asked.append(get_actor_email())
            return {"erreicht": True}

        app.add_api_route(PERSON_PROBE, probe, methods=["PATCH"], dependencies=[Depends(PERSON_ACTOR_BINDERS[SPIELER])])
        app.dependency_overrides[get_ban_lookup] = lambda: _unbarred
        response = TestClient(app, raise_server_exceptions=False).patch(PERSON_PROBE, headers=as_person(MIXED_CASE))

        [row] = log.rows
        pseudonym = akteur_pseudonym(KNOWN_IDENTIFIER, schluessel=CONFIG.sperrliste_schluessel)
        # An equality, so an `email` beside the two is a failure rather than an extra key nobody reads.
        assert row["actor"] == {"kind": "person_session", "pseudonym": pseudonym, "funktion": SPIELER}
        assert "beispielschule" not in str(row).lower()
        assert (response.status_code, asked) == (200, [])

    def test_a_person_the_list_does_not_hold_is_served(self):
        """The control: every refusal below would pass on a check refusing everybody."""

        response = person_client().get(PERSON_PROBE, headers=as_person())

        assert (response.status_code, response.json()) == (200, {"erreicht": True})

    @pytest.mark.parametrize("email", [BARRED_PERSON, BARRED_PERSON.upper()], ids=("as stored", "in another case"))
    def test_a_barred_person_is_refused_before_the_route_runs(self, email: str):
        response = person_client().get(PERSON_PROBE, headers=as_person(email))

        assert answer(response) == (403, PERSON_BARRED)
        assert BARRED_PERSON not in response.text.lower()

    def test_a_session_past_the_person_s_window_is_refused(self):
        response = person_client().get(PERSON_PROBE, headers=as_person(age_s=PERSON_WINDOW_DAYS * 86400 + 60))

        assert answer(response) == (401, ACTOR_TOKEN_REFUSED)

    def test_a_request_naming_nobody_is_refused_before_the_ban_read_opens_the_database(self):
        """No database and the real read: a 503 here would mean the list was asked before the session was read."""

        assert answer(person_client(barred=None).get(PERSON_PROBE)) == (400, MISSING_ACTOR)


# The person's own address change, started or approved, held to the enrolment window by either factor.
ADDRESS_CHANGE_WRITES = [
    pytest.param("/api/v0/konto/adresswechsel", {"email": "neu.postfach@anderswo.example"}, id="a start"),
    pytest.param("/api/v0/konto/adresswechsel/freigabe", None, id="an approval"),
]


class TestTheAddressChangeAsksAFreshSignIn:
    @pytest.mark.parametrize(("path", "body"), ADDRESS_CHANGE_WRITES)
    def test_an_older_sign_in_is_refused(self, path: str, body: Any):
        response = person_client().post(path, json=body, headers={**ADMIN_KEY, **as_person(age_s=ENROLMENT_WINDOW_S + 1)})

        assert answer(response) == (401, CONFIRMATION_REQUIRED)
        assert response.headers["www-authenticate"] == challenge(ENROLMENT_WINDOW_S)

    @pytest.mark.parametrize("factor", ["code", PASSKEY_FACTOR])
    @pytest.mark.parametrize(("path", "body"), ADDRESS_CHANGE_WRITES)
    def test_either_factor_inside_the_window_passes_the_check(self, path: str, body: Any, factor: Factor):
        """The control: the code goes to the address on file, the confirmation OWASP's process asks of it."""

        response = person_client().post(path, json=body, headers={**ADMIN_KEY, **as_person(factor=factor)})

        assert answer(response)[1] == UNREACHED_DATABASE


class TestThePseudonym:
    def test_it_is_the_value_computed_outside_this_package(self):
        """The known answer: every other case compares the function with itself, so a construction swapped end for end passes them all."""
        assert akteur_pseudonym(KNOWN_IDENTIFIER, schluessel=KNOWN_MASTER) == KNOWN_PSEUDONYM

    def test_it_is_never_the_ban_rows_digest_of_the_same_address(self):
        """One label per purpose under one master: a shared one would let the log say who the ban list holds."""
        assert akteur_pseudonym(KNOWN_IDENTIFIER, schluessel=KNOWN_MASTER) != adresse_hash(KNOWN_IDENTIFIER, schluessel=KNOWN_MASTER)


# The journal's answer for `KNOWN_IDENTIFIER` under `KNOWN_MASTER`, computed as `KNOWN_PSEUDONYM` was, under "loeschung-v1".
KNOWN_JOURNAL_HASH = "4bfa0be6fffe4c90adfc3290ec83efeb21a9845508cf2d170b39d047266a84a1"


class TestTheJournalHash:
    def test_it_is_the_value_computed_outside_this_package(self):
        assert loeschung_journal_hash(KNOWN_IDENTIFIER, schluessel=KNOWN_MASTER) == KNOWN_JOURNAL_HASH

    def test_it_is_neither_the_pseudonym_nor_the_ban_rows_digest(self):
        """A shared label would let a journal line name the pseudonym an erasure removed, or the ban a person holds."""
        journal = loeschung_journal_hash(KNOWN_IDENTIFIER, schluessel=KNOWN_MASTER)

        assert journal not in {KNOWN_PSEUDONYM, adresse_hash(KNOWN_IDENTIFIER, schluessel=KNOWN_MASTER)}


# A stored spelling as a registration or a contact seat keeps one: case, and the spaces a form trims.
UNFOLDED_IDENTIFIER = f" {MIXED_CASE} "


@pytest.mark.parametrize(
    ("helper", "folded"),
    [(akteur_pseudonym, KNOWN_PSEUDONYM), (loeschung_journal_hash, KNOWN_JOURNAL_HASH)],
    ids=("the pseudonym", "the journal hash"),
)
def test_an_unfolded_spelling_hashes_as_its_fold(helper: Callable[..., str], folded: str):
    """A restore hashes every stored spelling against the journal, so a helper hashing the spelling as given matches nothing."""
    assert helper(UNFOLDED_IDENTIFIER, schluessel=KNOWN_MASTER) == folded
