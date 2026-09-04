import asyncio
import contextlib
from typing import Iterator

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.core.exceptions import RequestAuthorizationException
from app.core.recording import PUBLIC_ACTOR, PUBLIC_ACTOR_EMAIL, SYSTEM_ACTOR, Actor, actor_var, request_var
from app.core.security import (
    ACTOR_HEADER,
    ACTOR_MAX_LENGTH,
    MISSING_ACTOR,
    SAFE_METHODS,
    WELL_FORMED_ACTOR,
    bind_actor,
    bind_public_actor,
    bind_system_actor,
)
from app.main import create_app
from tests.config import build_test_config

# Module level, as `tests/api/test_admin_guard.py` builds it: pytest resolves parametrisation during
# collection, before a fixture could run.
APP = create_app(build_test_config())

ADMIN_AUTH = {"Authorization": "Bearer test-key-admin"}

TEAM_ID = "6890a1b2c3d4e5f607182930"
WRITE_PATH = f"/api/v0/teams/{TEAM_ID}"
ROUTE_TEMPLATE = "/api/v0/teams/{team_id}"

# Admin-guarded and read-only, which is the pair `SAFE_METHODS` exists for: an actor demanded of
# every method served by an admin router would refuse this read and the three beside it.
EXEMPT_READ_PATH = "/api/v0/aktionen"

ACTOR = "admin@example.com"

# The one route the two exemptions below name, spelled once.
PUBLIC_WRITE_PATH = "/api/v0/bewerbungen"

# Named rather than compared with `!=`: a control asserting only "not 401" passes on any failure,
# the harness's own included.
UNREACHED_DATABASE = "DB-CONN-001"


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


Bound = tuple[Actor, tuple[str, str] | None]


async def through_the_binder(request: Request) -> tuple[Bound, Bound]:
    """Driven as FastAPI's exit stack drives it -- one task, so what the dependency sets and resets is visible here.

    Returns what was bound while the request ran and what is bound once it has finished.
    """

    binder = bind_actor(request)
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


# The code POINTS, not the characters: a literal control byte in this file is a syntax error.
CONTROL_CODE_POINTS = [0x00, 0x01, 0x08, 0x0E, 0x1B]

MALFORMED_ACTORS = [
    pytest.param("", id="empty"),
    pytest.param("admin", id="no domain"),
    pytest.param("admin@example", id="no dot in the domain"),
    pytest.param("admin@@example.com", id="two at signs"),
    pytest.param("admin @example.com", id="whitespace"),
    pytest.param(f"{'a' * ACTOR_MAX_LENGTH}@example.com", id="over the length bound"),
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
        response = getattr(client(), method)(path, headers=ADMIN_AUTH)

        assert response.status_code == 401
        assert response.json()["error_code"] == MISSING_ACTOR

    @pytest.mark.parametrize("actor", MALFORMED_ACTORS)
    def test_a_write_carrying_a_malformed_actor_is_refused(self, actor: str):
        """A shape check and a bound, not an address validation: the value was composed by the frontend from its own session."""
        response = client().delete(WRITE_PATH, headers={**ADMIN_AUTH, ACTOR_HEADER: actor})

        assert response.status_code == 401
        assert response.json()["error_code"] == MISSING_ACTOR

    def test_a_write_carrying_a_well_formed_actor_reaches_the_database(self):
        """The control: without it every case above would pass on a guard that refuses everything."""
        response = client().delete(WRITE_PATH, headers={**ADMIN_AUTH, ACTOR_HEADER: ACTOR})

        assert response.status_code == 503
        assert response.json()["error_code"] == UNREACHED_DATABASE

    def test_an_admin_read_with_no_actor_is_exempt(self):
        """This read and the three beside it are served by admin routers and record nothing, so demanding an actor would refuse them."""
        response = client().get(EXEMPT_READ_PATH, headers=ADMIN_AUTH)

        assert response.status_code == 503
        assert response.json()["error_code"] == UNREACHED_DATABASE


class TestTheGuardDecidesByMethodAlone:
    @pytest.mark.parametrize("method", sorted(SAFE_METHODS))
    def test_a_safe_method_passes_with_no_actor(self, method: str):
        """HEAD and OPTIONS reach no route of this application's own, and refusing them would answer a preflight with a 401."""
        during, _ = asyncio.run(through_the_binder(request_for(method, None)))

        assert during == (SYSTEM_ACTOR, None)

    @pytest.mark.parametrize("method", ["POST", "PATCH", "DELETE", "PUT"])
    def test_an_unsafe_method_with_no_actor_raises(self, method: str):
        """The decision is the METHOD's, not the route's: `PUT` is served nowhere and would still have to fail closed."""
        with pytest.raises(RequestAuthorizationException) as excinfo:
            asyncio.run(through_the_binder(request_for(method, None)))

        assert excinfo.value.status_code == 401
        assert excinfo.value.error_code == MISSING_ACTOR


class TestWhatTheBindingLeavesBehind:
    def test_a_well_formed_actor_is_bound_for_the_length_of_the_request(self):
        during, _ = asyncio.run(through_the_binder(request_for("PATCH", ACTOR)))

        assert during[0] == Actor(kind="admin_session", email=ACTOR)

    def test_the_bound_path_is_the_route_template_rather_than_the_url(self):
        """An id baked into the stored path makes one row per document where the page wants one per kind of action."""
        during, _ = asyncio.run(through_the_binder(request_for("PATCH", ACTOR)))

        assert during[1] == ("PATCH", ROUTE_TEMPLATE)

    def test_the_binding_is_cleared_once_the_request_has_finished(self):
        _, after = asyncio.run(through_the_binder(request_for("PATCH", ACTOR)))

        assert after == (SYSTEM_ACTOR, None)

    def test_the_next_request_does_not_inherit_the_previous_actor(self):
        """The hazard the reset exists for: the loop hands the next request the same context, and its writes would carry the wrong name."""

        async def _two_requests() -> Actor:
            await through_the_binder(request_for("PATCH", ACTOR))
            during, _ = await through_the_binder(request_for("GET", None))

            return during[0]

        assert asyncio.run(_two_requests()) is SYSTEM_ACTOR


def api_routes() -> Iterator[APIRoute]:
    """Every `APIRoute` the app serves, reached through the `_IncludedRouter` wrappers holding them."""
    for entry in APP.routes:
        original_router = getattr(entry, "original_router", None)
        candidates = original_router.routes if original_router is not None else [entry]

        for route in candidates:
            if isinstance(route, APIRoute):
                yield route


ROUTES_BY_OPERATION = {(route.path, method): route for route in api_routes() for method in (route.methods or ())}

# The writes NO administrator makes, which therefore bind no `X-FL-Actor`. Enumerated for
# `tests/api/test_admin_guard.py :: PUBLIC_WRITES`' reason, and derived from neither it nor a rule.

# No browser sends `X-FL-Actor`, so `bind_actor` would answer `REQ-AUTH-005` for every submission.
# `bind_public_actor` replaces it, and the write is recorded under an actor naming the public.
PUBLIC_WRITES = [
    ("/api/v0/bewerbungen", "POST"),
    ("/api/v0/bewerbungen/einwilligung/ansicht", "POST"),
    ("/api/v0/bewerbungen/einwilligung", "POST"),
]

# The retention sweep's writes, which the application makes to itself on the system key: no session
# exists to name an administrator, and `SYSTEM` is the truthful actor rather than a fallback.
SYSTEM_WRITES = [
    ("/api/v0/bewerbungen/sweep/{saison_id}", "POST"),
    ("/api/v0/bewerbungen/sweep/{saison_id}/angekuendigt", "POST"),
    ("/api/v0/bewerbungen/sweep/{saison_id}/loeschen", "POST"),
]

# Split by the constant the guard itself reads, so a method moved between the two tiers moves here too.
MUTATIONS = sorted(
    operation
    for operation in ROUTES_BY_OPERATION
    if operation[1] not in SAFE_METHODS and operation not in PUBLIC_WRITES and operation not in SYSTEM_WRITES
)

# A floor rather than the exact count: an endpoint added is covered by the parametrisation without
# editing this file, so pinning the number would ask for a bump and prove nothing.

# Seven under the inventory: fewer than either of the two largest routers holds, so one dropping out
# of it lands below the floor. `tests/api/test_admin_guard.py` floors the same operations reached
# through the published document, and the two move together.
MINIMUM_EXPECTED_MUTATIONS = 30


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
    pytest.param(ACTOR, id="the address a real admin session sends"),
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


@pytest.mark.parametrize("code_point", CONTROL_CODE_POINTS)
def test_an_actor_carrying_a_control_character_is_refused(code_point: int):
    r"""`\s` does not cover all of C0, so 23 controls reached `aktionen.actor.email` on the shape check alone.

    No address holds one, and this value is what an erasure is audited against.
    """

    forged = f"a{chr(code_point)}b@example.com"

    assert WELL_FORMED_ACTOR.fullmatch(forged) is None

    with pytest.raises(RequestAuthorizationException) as excinfo:
        asyncio.run(through_the_binder(request_for("PATCH", forged)))

    assert excinfo.value.error_code == MISSING_ACTOR


def test_an_ordinary_address_is_still_admitted():
    """The control: a class that excluded too much would refuse every administrator instead."""

    assert WELL_FORMED_ACTOR.fullmatch(ACTOR) is not None
