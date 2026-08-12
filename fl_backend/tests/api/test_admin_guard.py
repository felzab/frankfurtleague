"""
API · every mutation is admin-guarded, checked against the published surface

ADR-0027 puts the guard on the router, so an endpoint reaches the wrong authorization only by
being written in the wrong file — this suite is the net under that. The inventory of record is
`app.openapi()["paths"]`: `include_router` mounts each router as a `_IncludedRouter` wrapper
rather than flattening it, so filtering `app.routes` for `APIRoute` finds only `GET /`.

Invariants:
- Every non-GET operation carries `verify_access_admin`.
- No operation carries more than one guard (`test_every_operation_carries_exactly_one_guard`).
- A GET need not be base-guarded: `GET /spiele/action_required` is admin on purpose (ADR-0009).
"""

import re
from typing import Any, Callable, Iterator

import pytest
from fastapi.routing import APIRoute

from app.core.security import verify_access_admin, verify_access_base, verify_access_system
from app.main import create_app
from tests.config import build_test_config

# Built at module level, and it has to be: the cases below are parametrised over the operations this
# app publishes, and pytest resolves parametrisation during collection, before a fixture could run.
APP = create_app(build_test_config())

HTTP_METHODS = frozenset({"get", "post", "patch", "delete", "put", "head", "options", "trace"})

SLICE_GUARDS: set[Callable[..., Any]] = {verify_access_base, verify_access_admin, verify_access_system}

# `/` is FastAPI's own hello-world route and belongs to no slice. `/system/is_live` is the container
# healthcheck and is deliberately unguarded -- one that needs a secret fails for the wrong reasons
# (`app/core/security.py`). Both are GETs.
UNGUARDED_BY_DESIGN = frozenset({"/", "/api/v0/system/is_live"})

# `{spiel_id:objectid}` as OpenAPI publishes it, which is `{spiel_id}` -- FastAPI drops the convertor
# when it builds the document (`app/core/routing.py`), so the two spellings need bringing together
# before a route can be matched to an operation.
CONVERTOR_IN_PATH = re.compile(r"\{([^}:]+):[^}]+\}")


def strip_convertors(path: str) -> str:
    return CONVERTOR_IN_PATH.sub(r"{\1}", path)


def api_routes() -> Iterator[APIRoute]:
    """Every APIRoute the app serves, reached through the `_IncludedRouter` wrappers that hold them."""
    for entry in APP.routes:
        original_router = getattr(entry, "original_router", None)
        candidates = original_router.routes if original_router is not None else [entry]

        for route in candidates:
            if isinstance(route, APIRoute):
                yield route


# `route.methods or ()` because Starlette types it `set[str] | None`. FastAPI always populates it, so
# the fallback is unreachable -- but writing it is cheaper than asserting a framework's internals.
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


def guards_of(route: APIRoute) -> set[Callable[..., Any]]:
    """
    The slice guards reaching a route, router-level ones included — collections and the like dropped.

    `set[Callable]` rather than `set[object]`: `set` is invariant, so the narrower element type is not
    assignable to the wider one, and `object` was a wrong answer that happened to read as a safe one.
    `dependency.call` is optional on Starlette's model and the `None` is dropped rather than carried.
    """
    calls = {dependency.call for dependency in route.dependant.dependencies if dependency.call is not None}
    return calls & SLICE_GUARDS


def test_the_published_surface_and_the_mounted_routes_are_the_same_set():
    """
    Neither inventory may contain an operation the other lacks.

    This is what makes every other assertion here trustworthy. A route mounted but unpublished would
    be a live endpoint no test below ever sees; a path published with no route behind it would be a
    404 that clients are told to call.
    """
    assert set(PUBLISHED_OPERATIONS) == set(ROUTES_BY_OPERATION)


@pytest.mark.parametrize(("path", "method"), MUTATIONS, ids=lambda value: value)
def test_every_mutation_is_admin_guarded(path: str, method: str):
    """
    The rule this suite exists for, one case per published mutation.

    Parametrised rather than looped, so a failure names the method and path instead of stopping at
    whichever one happened to break first.
    """
    assert verify_access_admin in guards_of(ROUTES_BY_OPERATION[(path, method)]), f"{method.upper()} {path} is not admin-guarded"


@pytest.mark.parametrize(("path", "method"), PUBLISHED_OPERATIONS, ids=lambda value: value)
def test_every_operation_carries_exactly_one_guard(path: str, method: str):
    """
    One guard, never two and never none — the two ways an endpoint's authorization goes wrong quietly.

    Two guards is not stricter than one: FastAPI runs both, so the route needs a request bearing a
    token that satisfies each, and no single key does. It is unreachable rather than doubly safe.
    """
    guards = guards_of(ROUTES_BY_OPERATION[(path, method)])

    if path in UNGUARDED_BY_DESIGN:
        assert guards == set(), f"{method.upper()} {path} is documented as unguarded and carries {guards}"
        return

    assert len(guards) == 1, f"{method.upper()} {path} carries {len(guards)} guards: {guards}"


def test_the_mutation_inventory_is_the_size_the_write_path_built():
    """
    A guard-coverage suite that finds no mutations passes vacuously, which is its own failure mode.

    Pinned to the count rather than to `> 0`: the inventory shrinking is exactly as interesting as it
    growing, and both should be a deliberate edit to this line (ADR-0027 built 30 across seven slices,
    and ADR-0062's group swap is the 31st).
    """
    assert len(MUTATIONS) == 31
