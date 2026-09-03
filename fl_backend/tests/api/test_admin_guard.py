import re
from typing import Any, Callable, Iterator

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.core.security import verify_access_admin, verify_access_base, verify_access_system
from app.main import create_app
from tests.config import build_test_config

# Module level because pytest resolves parametrisation during collection, before a fixture could run.
APP = create_app(build_test_config())

# The code `app/core/security.py :: get_token` answers a request carrying no bearer token at all.
MISSING_BEARER_TOKEN = "REQ-AUTH-001"

HTTP_METHODS = frozenset({"get", "post", "patch", "delete", "put", "head", "options", "trace"})

SLICE_GUARDS: set[Callable[..., Any]] = {verify_access_base, verify_access_admin, verify_access_system}

# `/` is FastAPI's own hello-world route and belongs to no slice. `/system/is_live` is the container
# healthcheck: one that needs a secret fails for the wrong reasons (`app/core/security.py`).
UNGUARDED_BY_DESIGN = frozenset({"/", "/api/v0/system/is_live"})

# FastAPI drops the convertor when it builds the document (`app/core/routing.py`), so
# `{spiel_id:objectid}` publishes as `{spiel_id}` and the two spellings need bringing together.
CONVERTOR_IN_PATH = re.compile(r"\{([^}:]+):[^}]+\}")


def strip_convertors(path: str) -> str:
    return CONVERTOR_IN_PATH.sub(r"{\1}", path)


def api_routes() -> Iterator[APIRoute]:
    """Every `APIRoute` the app serves, reached through the `_IncludedRouter` wrappers holding them."""
    for entry in APP.routes:
        original_router = getattr(entry, "original_router", None)
        candidates = original_router.routes if original_router is not None else [entry]

        for route in candidates:
            if isinstance(route, APIRoute):
                yield route


# `route.methods or ()` because Starlette types it optional: the fallback is unreachable, and
# writing it is cheaper than asserting a framework's internals.
ROUTES_BY_OPERATION = {
    (strip_convertors(route.path), method.lower()): route
    for route in api_routes()
    for method in (route.methods or ())
    if method.lower() in HTTP_METHODS
}

PUBLISHED_OPERATIONS = sorted(
    (path, method) for path, operations in APP.openapi()["paths"].items() for method in operations if method in HTTP_METHODS
)

# The writes a member of the public makes, which are therefore NOT admin-guarded. Enumerated rather
# than predicated, so a second public write cannot appear by inheriting a property of the first.

# `POST /bewerbungen` is the public application form, base-tier because an anonymous visitor holds
# no other key. The two cases below assert what takes the guard's place.
PUBLIC_WRITES = [
    ("/api/v0/bewerbungen", "post"),
]

MUTATIONS = [(path, method) for path, method in PUBLISHED_OPERATIONS if method != "get" and (path, method) not in PUBLIC_WRITES]

# A floor rather than the exact count: an endpoint added is covered by the parametrisation below
# without editing this file, so pinning the number would ask for a bump and prove nothing.

# Seven under the inventory: fewer than either of the two largest routers holds, so one dropping out
# of it lands below the floor. `tests/api/test_actor_binding.py` floors the same operations reached
# through the mounted routes, and the two move together.
MINIMUM_EXPECTED_MUTATIONS = 30

# Admin reads this inventory PINS, not every admin read the application serves -- nothing about a GET
# tells the inventory which tier it belongs to, so each is enumerated and parametrised below.

# What earns a place: a revert to `verify_access_base` here publishes something named -- a venue's
# rent, a referee's contact details (`READ-MONEY-001`, `READ-CONTACT-001`).

# The two `bewerbungen` reads serve three people's names, addresses, telephone numbers and dates of
# birth, and that prefix now carries a base-tier router too, so the guard is the only thing between.
ADMIN_READS = [
    ("/api/v0/spielorte", "get"),
    ("/api/v0/spielorte/{spielort_id}", "get"),
    ("/api/v0/schiedsrichter", "get"),
    ("/api/v0/schiedsrichter/{schiedsrichter_id}", "get"),
    ("/api/v0/bewerbungen", "get"),
    ("/api/v0/bewerbungen/{bewerbung_id}", "get"),
]


def guards_of(route: APIRoute) -> set[Callable[..., Any]]:
    """`set[Callable]` rather than `set[object]`: `set` is invariant, so the narrower element type is not assignable."""
    calls = {dependency.call for dependency in route.dependant.dependencies if dependency.call is not None}
    return calls & SLICE_GUARDS


def test_the_published_surface_and_the_mounted_routes_are_the_same_set():
    """A route mounted but unpublished is a live endpoint no case below sees; one published with no route is a 404 clients are told to call."""
    assert set(PUBLISHED_OPERATIONS) == set(ROUTES_BY_OPERATION)


@pytest.mark.parametrize(("path", "method"), MUTATIONS, ids=lambda value: value)
def test_every_mutation_is_admin_guarded(path: str, method: str):
    """Parametrised rather than looped, so a failure names the method and path it broke on."""
    assert verify_access_admin in guards_of(ROUTES_BY_OPERATION[(path, method)]), f"{method.upper()} {path} is not admin-guarded"


@pytest.mark.parametrize(("path", "method"), ADMIN_READS, ids=lambda value: value)
def test_the_pinned_reads_are_admin_guarded(path: str, method: str):
    """Money, contact details and three people's own data ride on these, so a guard reverted to `verify_access_base` publishes them."""
    assert (path, method) in ROUTES_BY_OPERATION, f"{method.upper()} {path} is not mounted -- this list names a route that moved"

    assert guards_of(ROUTES_BY_OPERATION[(path, method)]) == {verify_access_admin}, f"{method.upper()} {path} is not admin-guarded"


@pytest.mark.parametrize(("path", "method"), PUBLISHED_OPERATIONS, ids=lambda value: value)
def test_every_operation_carries_exactly_one_guard(path: str, method: str):
    """Two guards is not stricter than one: FastAPI runs both, and no single key satisfies two."""
    guards = guards_of(ROUTES_BY_OPERATION[(path, method)])

    if path in UNGUARDED_BY_DESIGN:
        assert guards == set(), f"{method.upper()} {path} is documented as unguarded and carries {guards}"
        return

    assert len(guards) == 1, f"{method.upper()} {path} carries {len(guards)} guards: {guards}"


def test_the_mutation_inventory_clears_its_floor():
    """The partial loss `pyproject.toml :: empty_parameter_set_mark` cannot reach.

    That setting refuses an inventory that found NOTHING; one that found a third of the writes
    parametrises, and every case it runs passes.
    """
    assert len(MUTATIONS) >= MINIMUM_EXPECTED_MUTATIONS, (
        f"discovered only {len(MUTATIONS)} mutations across {len(PUBLISHED_OPERATIONS)} published operations; "
        f"expected at least {MINIMUM_EXPECTED_MUTATIONS}. Did a router stop being included?"
    )


@pytest.mark.parametrize(("path", "method"), PUBLIC_WRITES, ids=lambda value: value)
def test_a_public_write_is_base_tier(path: str, method: str):
    """What stands in for the guard the exemption drops: the operation carries the BASE one and no other.

    An equality rather than a membership, so a route that lost its guard -- or gained the system
    one -- fails rather than passing as "not admin".
    """

    assert (path, method) in ROUTES_BY_OPERATION, f"{method.upper()} {path} is not mounted -- PUBLIC_WRITES names a route that moved"

    assert guards_of(ROUTES_BY_OPERATION[(path, method)]) == {verify_access_base}, f"{method.upper()} {path} is not base-tier"


@pytest.mark.parametrize(("path", "method"), PUBLIC_WRITES, ids=lambda value: value)
def test_a_public_write_is_unreachable_without_the_base_key(path: str, method: str):
    """Public here means no SESSION, never no key: the edge reaches this application through the frontend.

    A request carrying no bearer token answers `REQ-AUTH-001` before the body is parsed.
    """

    response = TestClient(APP, raise_server_exceptions=False).request(method, path, json={})

    assert response.status_code == 401
    assert response.json()["error_code"] == MISSING_BEARER_TOKEN


def test_the_public_writes_are_published_and_exempt_from_nothing_else():
    """The anti-vacuity floor: a stale entry would shrink `MUTATIONS` while proving nothing.

    Both directions -- every exempt operation is published, and each really left the inventory
    above rather than naming a path never in it.
    """

    assert PUBLIC_WRITES, "the exemption is empty, so the two comparisons below hold of nothing"

    assert set(PUBLIC_WRITES) <= set(PUBLISHED_OPERATIONS), f"{sorted(set(PUBLIC_WRITES) - set(PUBLISHED_OPERATIONS))} is not published"

    assert set(PUBLIC_WRITES) & set(MUTATIONS) == set()
