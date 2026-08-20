import asyncio
import contextlib
from typing import Iterator

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.core.exceptions import RequestAuthorizationException
from app.core.recording import SYSTEM_ACTOR, Actor, actor_var, request_var
from app.core.security import ACTOR_HEADER, ACTOR_MAX_LENGTH, MISSING_ACTOR, SAFE_METHODS, bind_actor
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

# Split by the constant the guard itself reads, so a method moved between the two tiers moves here too.
MUTATIONS = sorted(operation for operation in ROUTES_BY_OPERATION if operation[1] not in SAFE_METHODS)

# A floor rather than the exact count: an endpoint added is covered by the parametrisation without
# editing this file, so pinning the number would ask for a bump and prove nothing.
MINIMUM_EXPECTED_MUTATIONS = 25


def binds_an_actor(route: APIRoute) -> bool:
    """Compared by identity, as `tests/api/test_admin_guard.py` compares the slice guards: every router declares the same module object."""
    return any(dependency.call is bind_actor for dependency in route.dependant.dependencies)


@pytest.mark.parametrize(("path", "method"), MUTATIONS, ids=lambda value: value)
def test_every_mutation_binds_an_actor(path: str, method: str):
    """Declared at router level so a write added later cannot miss it; parametrised so a failure names the one that did."""
    assert binds_an_actor(ROUTES_BY_OPERATION[(path, method)]), f"{method} {path} binds no actor, so its writes would record as SYSTEM"


def test_the_mutation_inventory_clears_its_floor():
    """`empty_parameter_set_mark` defaults to skip, so an inventory that found nothing would turn the coverage above into one silent skip."""
    assert len(MUTATIONS) >= MINIMUM_EXPECTED_MUTATIONS, (
        f"discovered only {len(MUTATIONS)} mutations across {len(ROUTES_BY_OPERATION)} operations. Did a router stop being included?"
    )
