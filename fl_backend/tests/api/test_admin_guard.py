import re
from typing import Any, Callable, Iterator

import pytest
from fastapi.routing import APIRoute

from app.core.security import verify_access_admin, verify_access_base, verify_access_system
from app.main import create_app
from tests.config import build_test_config

# Module level because pytest resolves parametrisation during collection, before a fixture could run.
APP = create_app(build_test_config())

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

MUTATIONS = [(path, method) for path, method in PUBLISHED_OPERATIONS if method != "get"]

# A floor rather than the exact count: an endpoint added is covered by the parametrisation below
# without editing this file, so pinning the number would ask for a bump and prove nothing.
MINIMUM_EXPECTED_MUTATIONS = 25

# The reads that are NOT base-tier. Enumerated because nothing about a GET tells the inventory which
# tier it belongs to, and parametrised below so a revert of one of the four names that one.
ADMIN_READS = [
    ("/api/v0/spielorte", "get"),
    ("/api/v0/spielorte/{spielort_id}", "get"),
    ("/api/v0/schiedsrichter", "get"),
    ("/api/v0/schiedsrichter/{schiedsrichter_id}", "get"),
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
def test_the_reference_reads_are_admin_guarded(path: str, method: str):
    """A venue's rent and a referee's contact details ride on these four, so a guard reverted to `verify_access_base` publishes them."""
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
    """`empty_parameter_set_mark` defaults to skip, so an inventory that found nothing would turn the coverage above into one silent skip."""
    assert len(MUTATIONS) >= MINIMUM_EXPECTED_MUTATIONS, (
        f"discovered only {len(MUTATIONS)} mutations across {len(PUBLISHED_OPERATIONS)} published operations; "
        f"expected at least {MINIMUM_EXPECTED_MUTATIONS}. Did a router stop being included?"
    )
