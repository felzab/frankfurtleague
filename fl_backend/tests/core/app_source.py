"""
CORE · the application as it mounts its routes, for the sweeps holding a convention across every operation

Invariants:
- Nothing edits `application()`'s app -- an override, a route, an exception handler, a middleware,
  its `state`, the document `app.openapi()` hands out -- or every module reading it later in the
  process meets the edit.
"""

from collections.abc import Callable, Iterator
from typing import Any

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, iter_route_contexts
from starlette.routing import Host, Mount

from tests.app_client import app_under_test


def application() -> FastAPI:
    """The app every suite serves its shared corpus through (`tests/app_client.py :: app_under_test`), read for what it mounts.

    The one build a process makes of the suite's settings: a second, built for the sweeps alone, would cost each xdist
    worker another at collection and mount nothing the first does not.
    """

    return app_under_test()


def dependency_calls(dependant: Dependant) -> Iterator[Callable[..., Any]]:
    """Every dependency an operation runs, a dependency's own among them."""

    for dependency in dependant.dependencies:
        if dependency.call is not None:
            yield dependency.call
        yield from dependency_calls(dependency)


def api_routes(app: FastAPI) -> Iterator[APIRoute]:
    """Every route the application serves, nested includes opened.

    Read and never edited: each is the object its module-level router holds, which every `create_app`
    in a process shares.
    """

    for context in iter_route_contexts(app.routes):
        # A mounted application's routes are opened by nothing here, so every sweep reading this would
        # pass over them: refused rather than skipped.
        if isinstance(context.original_route, (Mount, Host)):
            raise AssertionError(f"{context.original_route!r} mounts routes no sweep reading `api_routes` sees")
        if isinstance(context.original_route, APIRoute):
            yield context.original_route
