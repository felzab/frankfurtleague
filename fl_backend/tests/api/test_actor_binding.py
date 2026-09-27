import asyncio
import contextlib
import logging
import time
from collections import Counter
from collections.abc import AsyncIterator, Callable, Mapping
from typing import Any, cast, get_args

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import SecretStr
from pymongo.asynchronous.collection import AsyncCollection
from starlette.requests import Request

from app.api.sperrliste.services import adresse_hash
from app.core.actor_token import ACTOR_TOKEN_MAX_LENGTH, Lane
from app.core.collections import Collection
from app.core.exceptions import ACTOR_TOKEN_CHALLENGE, NO_DATABASE_CLIENT, ActorTokenRefusedException, MalformedRequestException
from app.core.logging import FL_LOGGER_NAME
from app.core.recording import (
    PUBLIC_ACTOR,
    PUBLIC_ACTOR_EMAIL,
    SYSTEM_ACTOR,
    Actor,
    AktorFunktion,
    PersonActor,
    actor_var,
    record_write,
    request_var,
)
from app.core.security import (
    ACTOR_HEADER,
    ACTOR_NOT_ADMIN,
    ACTOR_TOKEN_REFUSED,
    MISSING_ACTOR,
    PERSON_ACTOR_BINDERS,
    SAFE_METHODS,
    akteur_pseudonym,
    bind_actor,
    bind_public_actor,
    bind_system_actor,
    get_actor_email,
    get_actor_token,
    verify_admin_actor,
    verify_person_actor,
)
from app.main import create_app
from tests.actor_tokens import FOREIGN_SIGNING_KEY, SignedActor, actor_claims, actor_token, protected_header, sign
from tests.config import ADMIN_KEY, build_test_config
from tests.core.app_source import api_routes
from tests.grants import admit

from .conftest import MINIMUM_EXPECTED_MUTATIONS

# Module level, as `tests/api/test_admin_guard.py` builds it: pytest resolves parametrisation during
# collection, before a fixture could run.
CONFIG = build_test_config()
# Its actor check answered from `tests/config.py :: ADMINISTRATORS`, so a case clearing it meets the
# missing database at the handler rather than at the check.
APP = admit(create_app(CONFIG))
# The key the application verifies with, for a case driving a binder without a served request.
KEY = APP.state.actor_token_key

TEAM_ID = "6890a1b2c3d4e5f607182930"
WRITE_PATH = f"/api/v0/teams/{TEAM_ID}"
ROUTE_TEMPLATE = "/api/v0/teams/{team_id}"

# An admin-guarded read on a router that also writes: refused naming nobody as a write is.
READ_PATH = "/api/v0/aktionen"

ACTOR = "admin@example.com"

# The one route the two exemptions below name, spelled once.
PUBLIC_WRITE_PATH = "/api/v0/bewerbungen"

# Named rather than compared with `!=`: a control asserting only "not 401" passes on any failure,
# the harness's own included.
UNREACHED_DATABASE = NO_DATABASE_CLIENT


def client() -> TestClient:
    """No lifespan, so nothing opens the database: a request clearing the actor guard then fails on `DB-CONN-001`, which is observable."""

    return TestClient(APP, raise_server_exceptions=False)


class _Route:
    """A route carrying nothing but its `path`, which is all the binder reads off one."""

    def __init__(self, path: str) -> None:
        self.path = path


def request_for(method: str, actor: str | None, *, url_path: str = WRITE_PATH, route_path: str = ROUTE_TEMPLATE) -> Request:
    headers = [] if actor is None else [(ACTOR_HEADER.lower().encode(), actor.encode())]

    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "server": ("testserver", 80),
            "path": url_path,
            "raw_path": url_path.encode(),
            "query_string": b"",
            "headers": headers,
            "route": _Route(route_path),
        }
    )


Bound = tuple[Actor | PersonActor, tuple[str, str] | None]


async def through_the_binder(request: Request) -> tuple[Bound, Bound]:
    """Driven as FastAPI's exit stack drives it -- one task, so what the dependency sets and resets is visible here.

    Returns what was bound while the request ran and what is bound once it has finished.
    """

    # The binder's own dependencies first, as FastAPI resolves them.
    binder = bind_actor(request, verify_admin_actor(get_actor_token(request), KEY))
    await anext(binder)
    during = (actor_var.get(), request_var.get())

    with contextlib.suppress(StopAsyncIteration):
        await anext(binder)

    return during, (actor_var.get(), request_var.get())


async def through_the_public_binder(request: Request) -> tuple[Bound, Bound]:
    """`through_the_binder` for the other binder, a second function rather than a parameter: the two dependencies are two objects."""

    binder = bind_public_actor(request)
    await anext(binder)
    during = (actor_var.get(), request_var.get())

    with contextlib.suppress(StopAsyncIteration):
        await anext(binder)

    return during, (actor_var.get(), request_var.get())


# Nothing shaped like a signed token: each names nobody, and none is a token that failed its checks.
MALFORMED_ACTORS = [
    pytest.param("", id="empty"),
    # What the header carried before it was signed: an address alone is no credential.
    pytest.param(ACTOR, id="a plain address"),
    pytest.param("aaa.bbb", id="two segments"),
    pytest.param("aaa.bbb.ccc.ddd", id="four segments"),
    pytest.param("aaa.b b.ccc", id="whitespace"),
    pytest.param(f"aaa.{'b' * ACTOR_TOKEN_MAX_LENGTH}.ccc", id="over the length bound"),
]

# One of each verb rather than the whole surface, which the inventory below covers instead.
WRITES = [
    pytest.param("delete", WRITE_PATH, id="DELETE"),
    pytest.param("patch", WRITE_PATH, id="PATCH"),
    pytest.param("post", f"{WRITE_PATH}/reactivate", id="POST"),
]


class TestTheGuardOverAServedRequest:
    @pytest.mark.parametrize(("method", "path"), WRITES)
    def test_a_write_with_no_actor_is_refused(self, method: str, path: str):
        """Fail closed: an unattributed write is the one thing a log complete by construction cannot allow."""
        response = getattr(client(), method)(path, headers=ADMIN_KEY)

        assert response.status_code == 400
        assert response.json()["error_code"] == MISSING_ACTOR
        # The key passed, so a challenge would name a credential that was valid.
        assert "www-authenticate" not in response.headers

    @pytest.mark.parametrize("actor", MALFORMED_ACTORS)
    def test_a_write_carrying_a_malformed_actor_is_refused(self, actor: str):
        """Refused ahead of the signature, at 400: nothing shaped like a credential arrived, which is a defect of the caller."""
        response = client().delete(WRITE_PATH, headers={**ADMIN_KEY, ACTOR_HEADER: actor})

        assert response.status_code == 400
        assert response.json()["error_code"] == MISSING_ACTOR

    def test_a_write_carrying_a_verified_actor_reaches_the_database(self):
        """The control: without it every case above would pass on a guard that refuses everything."""
        response = client().delete(WRITE_PATH, headers=SignedActor(ACTOR, ADMIN_KEY))

        assert response.status_code == 503
        assert response.json()["error_code"] == UNREACHED_DATABASE

    @pytest.mark.parametrize(("method", "path"), [*WRITES, pytest.param("get", READ_PATH, id="GET")])
    def test_a_token_signed_by_anyone_else_is_refused_with_a_challenge(self, method: str, path: str):
        """The admin key alone names nobody: a token not signed with the frontend's key is refused before anything is reached."""
        forged = sign(actor_claims(ACTOR), private_key=FOREIGN_SIGNING_KEY)
        response = getattr(client(), method)(path, headers={**ADMIN_KEY, ACTOR_HEADER: forged})

        assert response.status_code == 401
        assert response.json()["error_code"] == ACTOR_TOKEN_REFUSED
        # RFC 9110's 401 carries a challenge, and it names the actor's scheme rather than the key's, which passed.
        assert response.headers["www-authenticate"] == ACTOR_TOKEN_CHALLENGE

    @pytest.mark.parametrize(
        "lane_claims",
        [
            pytest.param({"lane": "person", "amr": ["code"]}, id="a person's token"),
            pytest.param({"amr": ["code"]}, id="an administrator signed in by code"),
        ],
    )
    def test_a_verified_token_the_admin_tier_does_not_take_is_refused(self, lane_claims: Mapping[str, Any]):
        """Signed by the frontend and holding a granted address, and still refused: the tier asks which guard minted it and by what factor."""
        token = sign({**actor_claims(ACTOR), **lane_claims})
        response = client().delete(WRITE_PATH, headers={**ADMIN_KEY, ACTOR_HEADER: token})

        assert response.status_code == 401
        assert response.json()["error_code"] == ACTOR_TOKEN_REFUSED

    def test_an_admin_read_with_no_actor_is_refused(self):
        """What an admin-tier read serves is authorised by who asks, so a read naming nobody is refused as a write is."""
        response = client().get(READ_PATH, headers=ADMIN_KEY)

        assert response.status_code == 400
        assert response.json()["error_code"] == MISSING_ACTOR


class TestTheGuardExemptsNoMethod:
    @pytest.mark.parametrize("method", [*sorted(SAFE_METHODS), "POST", "PATCH", "DELETE", "PUT"])
    def test_every_method_with_no_actor_raises(self, method: str):
        """A read among them: the actor is what the grants judge, so a request naming nobody has nothing to be judged by."""
        with pytest.raises(MalformedRequestException) as excinfo:
            asyncio.run(through_the_binder(request_for(method, None)))

        assert excinfo.value.status_code == 400
        assert excinfo.value.error_code == MISSING_ACTOR


Refused = tuple[str, str, str | None]


def _expired() -> Refused:
    now = int(time.time())
    claims = {**actor_claims(ACTOR), "iat": now - 600, "exp": now - 540}
    return sign(claims), "expired", claims["jti"]


def _foreign() -> Refused:
    return sign(actor_claims(ACTOR), private_key=FOREIGN_SIGNING_KEY), "unknown kid", None


def _forged_under_our_kid() -> Refused:
    """Naming the configured key's `kid` and signed by another: its `jti` is a stranger's text, which no line may carry."""
    return sign(actor_claims(ACTOR), private_key=FOREIGN_SIGNING_KEY, header=protected_header()), "signature does not verify", None


@pytest.mark.parametrize("refused", [_expired, _foreign, _forged_under_our_kid], ids=("expired", "signed by another key", "forged"))
def test_a_refused_token_logs_its_reason_and_never_the_token(refused: Callable[[], Refused], caplog: pytest.LogCaptureFixture):
    """A signed value is a credential for the minute it lives, and PyJWT's own message is no phrase this module chose.

    Its `jti` stands beside the reason exactly where the configured key signed it.
    """
    token, reason, jti = refused()
    with caplog.at_level(logging.WARNING, logger=FL_LOGGER_NAME):
        client().delete(WRITE_PATH, headers={**ADMIN_KEY, ACTOR_HEADER: token})

    [line] = [record for record in caplog.records if record.getMessage().endswith(f"the actor token was refused: {reason}")]

    assert getattr(line, "jti", None) == jti
    # Each segment on its own, so a line carrying the payload alone is caught as well as the whole token.
    lines = [record.getMessage() for record in caplog.records]
    assert not any(segment in line for segment in token.split(".") for line in lines)
    assert not any("Signature has expired" in line for line in lines)


def test_an_actor_holding_no_grant_is_logged_by_the_token_s_jti(caplog: pytest.LogCaptureFixture):
    """Refused past a verified token, so the id on its line is always one the frontend minted."""
    claims = actor_claims("schueler@example.com")
    with caplog.at_level(logging.WARNING, logger=FL_LOGGER_NAME):
        response = client().delete(WRITE_PATH, headers={**ADMIN_KEY, ACTOR_HEADER: sign(claims)})

    assert response.json()["error_code"] == ACTOR_NOT_ADMIN
    assert [getattr(record, "jti", None) for record in caplog.records if getattr(record, "error_code", None) == ACTOR_NOT_ADMIN] == [
        claims["jti"]
    ]


class TestWhatTheBindingLeavesBehind:
    def test_a_verified_actor_is_bound_for_the_length_of_the_request(self):
        during, _ = asyncio.run(through_the_binder(request_for("PATCH", actor_token(ACTOR))))

        assert during[0] == Actor(kind="admin_session", email=ACTOR)

    def test_a_mixed_case_identity_is_bound_folded(self):
        """What every stored actor field copies, so one administrator is never two spellings in `aktionen` or a grant."""
        during, _ = asyncio.run(through_the_binder(request_for("PATCH", actor_token(ACTOR.upper()))))

        assert during[0] == Actor(kind="admin_session", email=ACTOR)

    def test_the_bound_path_is_the_route_template_rather_than_the_url(self):
        """An id baked into the stored path makes one row per document where the page wants one per kind of action."""
        during, _ = asyncio.run(through_the_binder(request_for("PATCH", actor_token(ACTOR))))

        assert during[1] == ("PATCH", ROUTE_TEMPLATE)

    def test_the_binding_is_cleared_once_the_request_has_finished(self):
        _, after = asyncio.run(through_the_binder(request_for("PATCH", actor_token(ACTOR))))

        assert after == (SYSTEM_ACTOR, None)


MOUNTED_OPERATIONS = [((route.path, method), route) for route in api_routes(APP) for method in (route.methods or ())]

ROUTES_BY_OPERATION = dict(MOUNTED_OPERATIONS)

OPERATION_COUNTS = Counter(operation for operation, _ in MOUNTED_OPERATIONS)

# A dict keeps the last route written, so a pair served twice drops the route that lost from
# `MUTATIONS` and from every sweep under it. Module level, so collection refuses every case at once.
assert len(ROUTES_BY_OPERATION) == len(MOUNTED_OPERATIONS), (
    f"more than one mounted route serves {sorted(operation for operation, count in OPERATION_COUNTS.items() if count > 1)}"
)

# The writes NO administrator makes, which therefore bind no `X-FL-Actor`. Enumerated for
# `tests/api/test_admin_guard.py :: PUBLIC_WRITES`' reason, and derived from neither it nor a rule.

# No browser sends `X-FL-Actor`, so `bind_actor` would answer `REQ-AUTH-005` for every submission.
# `bind_public_actor` replaces it, and the write is recorded under an actor naming the public.
PUBLIC_WRITES = [
    ("/api/v0/bewerbungen", "POST"),
    ("/api/v0/bewerbungen/einwilligung/ansicht", "POST"),
    ("/api/v0/bewerbungen/einwilligung", "POST"),
    # A referee answering their own link holds no session either, so both endpoints bind the public
    # actor and the confirmation's write is recorded under it.
    ("/api/v0/schiedsrichter/bestaetigung/ansicht", "POST"),
    ("/api/v0/schiedsrichter/bestaetigung", "POST"),
    # A pupil answering their own link holds no session either, so both endpoints bind the public
    # actor and the confirmation's write is recorded under it.
    ("/api/v0/registrierungen/bestaetigung/ansicht", "POST"),
    ("/api/v0/registrierungen/bestaetigung", "POST"),
    # The invite's read and the registration itself: a pupil opening a team's link sends no
    # `X-FL-Actor`, and the row this write stores is recorded under the public actor.
    ("/api/v0/registrierungen/einladung/ansicht", "POST"),
    ("/api/v0/registrierungen", "POST"),
]

# The writes the application makes to itself on the system key -- the retention sweep's, and the two
# a delivery report reaches: no session exists to name an administrator, and `SYSTEM` is the
# truthful actor rather than a fallback.
SYSTEM_WRITES = [
    ("/api/v0/bewerbungen/sweep/{saison_id}", "POST"),
    ("/api/v0/bewerbungen/sweep/{saison_id}/angekuendigt", "POST"),
    ("/api/v0/bewerbungen/sweep/{saison_id}/loeschen", "POST"),
    ("/api/v0/registrierungen/sweep/{saison_id}", "POST"),
    ("/api/v0/bewerbungen/zustellung", "POST"),
    ("/api/v0/bewerbungen/zustellung/angenommen", "POST"),
    ("/api/v0/zustellung", "POST"),
    ("/api/v0/zustellung/angenommen", "POST"),
    ("/api/v0/zustellung/abgewiesen", "POST"),
    # Reads rather than writes, and listed for the binder all the same: omitted, it is demanded the
    # administrator's `X-FL-Actor`, which the system key never sends.
    ("/api/v0/identitaet/subjekt", "POST"),
    # The grants' reconciliation: the read's reason above for the one, and the stamp is recorded
    # under `SYSTEM` because a change made in the database directly had no administrator.
    ("/api/v0/berechtigungen/abgleich", "POST"),
    ("/api/v0/berechtigungen/abgleich/angekuendigt", "POST"),
]

# The writes a signed-in person makes on the admin key, binding one of `PERSON_ACTOR_BINDERS` in
# place of `bind_actor`: the header names a person, recorded under a pseudonym. Empty until a router
# serving a person is mounted.
PERSON_WRITES: list[tuple[str, str]] = []

# Split by the constant the guard itself reads, so a method moved between the two tiers moves here too.
MUTATIONS = sorted(
    operation
    for operation in ROUTES_BY_OPERATION
    if operation[1] not in SAFE_METHODS and operation not in PUBLIC_WRITES and operation not in SYSTEM_WRITES and operation not in PERSON_WRITES
)


def binds_an_actor(route: APIRoute) -> bool:
    """Compared by identity, as `tests/api/test_admin_guard.py` compares the slice guards: every router declares the same module object."""
    return any(dependency.call is bind_actor for dependency in route.dependant.dependencies)


@pytest.mark.parametrize(("path", "method"), MUTATIONS, ids=lambda value: value)
def test_every_mutation_binds_an_actor(path: str, method: str):
    """Declared at router level so a write added later cannot miss it; parametrised so a failure names the one that did."""
    assert binds_an_actor(ROUTES_BY_OPERATION[(path, method)]), f"{method} {path} binds no actor, so its writes would record as SYSTEM"


def test_the_mutation_inventory_clears_its_floor():
    """The partial loss `pyproject.toml :: empty_parameter_set_mark` cannot reach.

    That setting refuses an inventory that found NOTHING; one that found a third of the writes
    parametrises, and every case it runs passes.
    """
    assert len(MUTATIONS) >= MINIMUM_EXPECTED_MUTATIONS, (
        f"discovered only {len(MUTATIONS)} mutations across {len(ROUTES_BY_OPERATION)} operations. Did a router stop being included?"
    )


def binds_a_person(route: APIRoute) -> bool:
    """Compared by identity, as `binds_an_actor` compares: each Funktion's binder is one module-level object."""
    return any(dependency.call is binder for dependency in route.dependant.dependencies for binder in PERSON_ACTOR_BINDERS.values())


def test_every_person_write_binds_a_person_in_place_of_an_administrator():
    """What earns a write its place outside `MUTATIONS`.

    `tests/api/test_admin_guard.py :: PERSON_OPERATIONS` is held to the same routes, so the two lists
    agree. Not parametrised: the list is empty until a person's router is mounted.
    """
    unearned = [
        operation
        for operation in PERSON_WRITES
        if operation[1] in SAFE_METHODS or operation not in ROUTES_BY_OPERATION or not binds_a_person(ROUTES_BY_OPERATION[operation])
    ]

    assert unearned == [], f"{unearned} leaves `MUTATIONS` without being a mounted write that binds a person"


@pytest.mark.parametrize(("path", "method"), PUBLIC_WRITES, ids=lambda value: value)
def test_a_public_write_binds_the_public_actor(path: str, method: str):
    """What stands in for the binder the exemption drops: the route declares `bind_public_actor` instead.

    Compared by identity as `binds_an_actor` compares the other, so a route binding NOTHING -- which
    records as `SYSTEM` -- fails here.
    """

    assert (path, method) in ROUTES_BY_OPERATION, f"{method} {path} is not mounted -- PUBLIC_WRITES names a route that moved"

    dependencies = ROUTES_BY_OPERATION[(path, method)].dependant.dependencies

    assert any(dependency.call is bind_public_actor for dependency in dependencies), f"{method} {path} binds no actor at all"
    assert not any(dependency.call is bind_actor for dependency in dependencies), f"{method} {path} binds the admin actor too"


@pytest.mark.parametrize(("path", "method"), SYSTEM_WRITES, ids=lambda value: value)
def test_a_system_write_binds_the_system_actor(path: str, method: str):
    """Declared rather than defaulted: a route binding nothing also records as `SYSTEM`, and the two must not be told apart by luck."""

    assert (path, method) in ROUTES_BY_OPERATION, f"{method} {path} is not mounted -- SYSTEM_WRITES names a route that moved"

    dependencies = ROUTES_BY_OPERATION[(path, method)].dependant.dependencies

    assert any(dependency.call is bind_system_actor for dependency in dependencies), f"{method} {path} binds no actor at all"
    assert not any(dependency.call is bind_actor for dependency in dependencies), f"{method} {path} binds the admin actor too"


def test_the_public_binder_names_the_public_and_clears_itself():
    """The behaviour the exemption rests on: a submission is attributed to nobody, by name.

    Both halves in one case because either alone is worthless -- an actor never reset bleeds onto
    the next request, and one never set records as `SYSTEM`.
    """

    during, after = asyncio.run(through_the_public_binder(request_for("POST", None, url_path=PUBLIC_WRITE_PATH, route_path=PUBLIC_WRITE_PATH)))

    assert during == (PUBLIC_ACTOR, ("POST", PUBLIC_WRITE_PATH))
    assert after == (SYSTEM_ACTOR, None)


def test_the_public_actor_is_not_the_system_one():
    """The distinction the whole exemption buys: the log tells a submission from a migration, which `SYSTEM` alone could not."""

    assert PUBLIC_ACTOR != SYSTEM_ACTOR
    assert PUBLIC_ACTOR.kind == "public"


def test_the_public_write_inventory_is_not_empty():
    """The two set comparisons below are true of an empty list, so the exemption is asserted non-empty before either runs."""

    assert PUBLIC_WRITES

    assert set(PUBLIC_WRITES) <= set(ROUTES_BY_OPERATION), f"{sorted(set(PUBLIC_WRITES) - set(ROUTES_BY_OPERATION))} is not mounted"

    assert set(PUBLIC_WRITES) & set(MUTATIONS) == set()


# What a visitor could put in the header, each of which the public binder must ignore. The last two
# are shaped like a real administrator, which is the whole point: nothing about them is malformed.
FORGED_ACTORS = [
    pytest.param("attacker@example.com", id="a well-formed address"),
    pytest.param(ACTOR, id="an administrator's address"),
    pytest.param(actor_token(ACTOR), id="the token a real admin session sends"),
    pytest.param("", id="an empty header"),
    pytest.param("not-an-address", id="a malformed value"),
]


@pytest.mark.parametrize("forged", FORGED_ACTORS)
def test_the_public_binder_ignores_a_forged_actor_header(forged: str):
    """Nothing a visitor sends may name the write. `bind_actor` READS this header; this binder must not.

    The two sit adjacent, so a later unification would put a chosen string into
    `aktionen.actor.email` with the gate green.
    """

    request = request_for("POST", forged, url_path=PUBLIC_WRITE_PATH, route_path=PUBLIC_WRITE_PATH)

    during, _ = asyncio.run(through_the_public_binder(request))

    assert during[0] == PUBLIC_ACTOR
    assert isinstance(during[0], Actor)
    assert during[0].email == PUBLIC_ACTOR_EMAIL


def test_the_public_binder_refuses_no_request_whatever_the_header_says():
    """The other half: `bind_actor` answers `REQ-AUTH-005` on a malformed value, and this one may not.

    A public form has no session to compose an actor from, so refusing here would make the header
    a way to turn every submission away.
    """

    request = request_for("POST", "not-an-address", url_path=PUBLIC_WRITE_PATH, route_path=PUBLIC_WRITE_PATH)

    during, after = asyncio.run(through_the_public_binder(request))

    assert during == (PUBLIC_ACTOR, ("POST", PUBLIC_WRITE_PATH))
    assert after == (SYSTEM_ACTOR, None)


# A second admin-tier read, on a router that writes nothing, so the check is shown to reach a router
# whose binder guards no write.
READ_ROUTER_PATH = "/api/v0/spielorte"

# Well-formed, and holding none of the grants `APP` answers from.
NOT_AN_ADMINISTRATOR = "schueler@example.com"


class TestTheGrantsOverAServedRequest:
    """An actor named on an admin-tier route must hold a grant in `berechtigungen`, whatever the method."""

    def test_a_granted_address_binds_on_a_write(self):
        """The control, reaching the database: every refusal below would pass on a check refusing everybody."""
        response = client().delete(WRITE_PATH, headers=SignedActor(ACTOR, ADMIN_KEY))

        assert response.status_code == 503
        assert response.json()["error_code"] == UNREACHED_DATABASE

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            pytest.param("delete", WRITE_PATH, id="a write"),
            pytest.param("get", READ_PATH, id="a read beside the writes"),
            pytest.param("get", READ_ROUTER_PATH, id="a read on a router that writes nothing"),
        ],
    )
    def test_an_address_off_the_list_is_refused_before_anything_is_reached(self, method: str, path: str):
        """The case that goes red the day the check is dropped, and nothing else would.

        403 where the control above answers 503: the database is the next thing reached, so nothing
        was read or written.
        """
        response = getattr(client(), method)(path, headers=SignedActor(NOT_AN_ADMINISTRATOR, ADMIN_KEY))

        assert response.status_code == 403
        assert response.json()["error_code"] == ACTOR_NOT_ADMIN
        assert NOT_AN_ADMINISTRATOR not in response.text
        # The key passed, so a challenge would name a credential that was valid.
        assert "www-authenticate" not in response.headers

    @pytest.mark.parametrize("path", [WRITE_PATH, READ_ROUTER_PATH])
    def test_a_granted_address_in_another_case_is_admitted(self, path: str):
        """Both sides folded, or a session spelled in capitals locks its administrator out of the panel."""
        method = "delete" if path == WRITE_PATH else "get"
        response = getattr(client(), method)(path, headers=SignedActor(ACTOR.upper(), ADMIN_KEY))

        assert response.status_code == 503
        assert response.json()["error_code"] == UNREACHED_DATABASE

    @pytest.mark.parametrize(
        "headers",
        [pytest.param({}, id="no actor"), pytest.param({ACTOR_HEADER: "not-an-address"}, id="a malformed actor")],
    )
    def test_a_read_naming_nobody_is_refused_on_a_router_that_writes_nothing(self, headers: Mapping[str, str]):
        """The read routers carry `bind_actor` for this alone, so an admin-tier read has no route around the grants."""
        response = client().get(READ_ROUTER_PATH, headers={**ADMIN_KEY, **headers})

        assert response.status_code == 400
        assert response.json()["error_code"] == MISSING_ACTOR


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


def person_binder(request: Request, funktion: AktorFunktion = SPIELER) -> AsyncIterator[str]:
    """A person's binder over the actor its dependencies verify, resolved first as FastAPI resolves them."""

    return PERSON_ACTOR_BINDERS[funktion](request, CONFIG, verify_person_actor(get_actor_token(request), KEY))


async def through_the_person_binder(request: Request, funktion: AktorFunktion = SPIELER) -> tuple[str, Bound, Bound]:
    """`through_the_binder` for a person's binder, which yields the folded identifier and reads the request's settings."""

    binder = person_binder(request, funktion)
    identifier = await anext(binder)
    during = (actor_var.get(), request_var.get())

    with contextlib.suppress(StopAsyncIteration):
        await anext(binder)

    return identifier, during, (actor_var.get(), request_var.get())


def person_request(method: str, email: str | None, *, lane: Lane = "person") -> Request:
    """A request to a person's route carrying `email`'s signed token, or no header at all."""

    return raw_person_request(method, None if email is None else actor_token(email, lane=lane))


def raw_person_request(method: str, header: str | None) -> Request:
    return request_for(method, header, url_path=PERSON_ROUTE.replace("{team_id}", TEAM_ID), route_path=PERSON_ROUTE)


class _LogDouble:
    """The log's collection as `record_write` reaches it: the target's own database handle, and one insert."""

    def __init__(self) -> None:
        self.name = str(Collection.TEAMS)
        self.rows: list[Mapping[str, Any]] = []
        self.database = {Collection.AKTIONEN: self}

    async def insert_one(self, document: Mapping[str, Any], session: Any = None) -> None:
        self.rows.append(document)


class TestThePersonBinder:
    @pytest.mark.parametrize("funktion", get_args(AktorFunktion))
    def test_the_actor_bound_is_a_person_under_the_funktion_its_router_declares(self, funktion: AktorFunktion):
        """Every Funktion has its binder, so a router serving one cannot record its writes under another."""
        _, during, _ = asyncio.run(through_the_person_binder(person_request("PATCH", KNOWN_IDENTIFIER), funktion))

        pseudonym = akteur_pseudonym(KNOWN_IDENTIFIER, schluessel=CONFIG.sperrliste_schluessel)
        assert during == (PersonActor(pseudonym=pseudonym, funktion=funktion), ("PATCH", PERSON_ROUTE))

    @pytest.mark.parametrize("method", sorted(SAFE_METHODS))
    def test_a_read_with_no_actor_is_refused(self, method: str):
        """The sentence that separates this binder from `bind_actor`: a person's route serves nothing anonymous, so a read is no exemption."""
        with pytest.raises(MalformedRequestException) as excinfo:
            asyncio.run(through_the_person_binder(person_request(method, None)))

        assert excinfo.value.error_code == MISSING_ACTOR

    @pytest.mark.parametrize("actor", MALFORMED_ACTORS)
    def test_a_malformed_actor_is_refused_on_a_read(self, actor: str):
        with pytest.raises(MalformedRequestException) as excinfo:
            asyncio.run(through_the_person_binder(raw_person_request("GET", actor)))

        assert excinfo.value.error_code == MISSING_ACTOR

    def test_an_administrator_s_token_is_refused(self):
        """Which guard minted it: a person's route believes only the person lane's token, whatever address it names."""
        with pytest.raises(ActorTokenRefusedException) as excinfo:
            asyncio.run(through_the_person_binder(person_request("GET", KNOWN_IDENTIFIER, lane="admin")))

        assert excinfo.value.error_code == ACTOR_TOKEN_REFUSED

    def test_a_mixed_case_header_authorises_as_the_folded_string(self):
        """What the handler is handed, so a Funktion check cannot name two spellings of one mailbox."""
        identifier, during, _ = asyncio.run(through_the_person_binder(person_request("GET", MIXED_CASE)))
        lower, lower_during, _ = asyncio.run(through_the_person_binder(person_request("GET", KNOWN_IDENTIFIER)))

        assert identifier == KNOWN_IDENTIFIER == lower
        assert during[0] == lower_during[0]

    def test_the_log_row_carries_the_pseudonym_and_no_address(self):
        """Driven through the variable the binder sets and the recorder reads, since no route declares the binder yet."""
        log = _LogDouble()

        async def _one_write() -> None:
            binder = person_binder(person_request("PATCH", MIXED_CASE))
            await anext(binder)
            await record_write(collection=cast(AsyncCollection, log), operation="patch_one", document_id=TEAM_ID)
            with contextlib.suppress(StopAsyncIteration):
                await anext(binder)

        asyncio.run(_one_write())

        [row] = log.rows
        pseudonym = akteur_pseudonym(KNOWN_IDENTIFIER, schluessel=CONFIG.sperrliste_schluessel)
        # An equality, so an `email` beside the two is a failure rather than an extra key nobody reads.
        assert row["actor"] == {"kind": "person_session", "pseudonym": pseudonym, "funktion": SPIELER}
        assert row["request"] == {"method": "PATCH", "path": PERSON_ROUTE}
        assert "@" not in str(row)
        assert "beispielschule" not in str(row).lower()

    def test_a_person_s_route_hands_no_administrator_to_a_field_storing_one(self):
        """A handler asking for the administrator there has named the wrong field, and the pseudonym would read as an address."""

        async def _asked() -> None:
            binder = person_binder(person_request("PATCH", KNOWN_IDENTIFIER))
            await anext(binder)
            try:
                get_actor_email()
            finally:
                with contextlib.suppress(StopAsyncIteration):
                    await anext(binder)

        with pytest.raises(LookupError):
            asyncio.run(_asked())

    def test_the_binding_is_cleared_once_the_request_has_finished(self):
        _, _, after = asyncio.run(through_the_person_binder(person_request("PATCH", KNOWN_IDENTIFIER)))

        assert after == (SYSTEM_ACTOR, None)


class TestThePseudonym:
    def test_it_is_the_value_computed_outside_this_package(self):
        """The known answer: every other case compares the function with itself, so a construction swapped end for end passes them all."""
        assert akteur_pseudonym(KNOWN_IDENTIFIER, schluessel=KNOWN_MASTER) == KNOWN_PSEUDONYM

    def test_it_is_never_the_ban_rows_digest_of_the_same_address(self):
        """One label per purpose under one master: a shared one would let the log say who the ban list holds."""
        assert akteur_pseudonym(KNOWN_IDENTIFIER, schluessel=KNOWN_MASTER) != adresse_hash(KNOWN_IDENTIFIER, schluessel=KNOWN_MASTER)
