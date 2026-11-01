"""
CORE · a POST that writes nothing says so in the published contract, and no other POST does

The frontend sends an operation the document marks safe as a read (`fl_frontend/orval.config.ts :: transportOf`), so
a write marked safe clears no cached read and drains no mail, with nothing failing. The mark is the types' fact: a
marked operation is handed read-only collections alone (`app/core/readonly.py`), so pyright refuses a write in its
handler or in any helper it hands them to. This holds the mark to those types, read off FastAPI's dependant tree the
way FastAPI resolves it: each database handle the handler or a dependency of it declares, judged by the type it is
declared as.

The fixture save's dry run (`x-safe-when` on `PATCH /spiele/{spiel_id}`) writes on the arm that is not dry, so it is
handed writable collections and judged by no type; its execution tests hold the dry arm.
"""

from collections.abc import Iterator
from typing import Any, get_origin, get_type_hints

import pytest
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.core.readonly import ReadCollection
from app.core.routing import SAFE, SAFE_WHEN
from tests.core.app_source import api_routes, application

# A handle every write goes through: a collection, or a database or client handing one out.
WRITABLE = (AsyncCollection, AsyncDatabase, AsyncMongoClient)
# The handles writing nothing: a read-only collection, and the request's snapshot session.
READ_ONLY = (ReadCollection, AsyncClientSession)

(SAFE_KEY,) = SAFE
(SAFE_WHEN_KEY,) = SAFE_WHEN

DOCUMENT = application().openapi()

POST_ROUTES = sorted(
    (route for route in api_routes(application()) if route.include_in_schema and "POST" in (route.methods or ())),
    key=lambda route: route.path,
)


def _handle_kind(declared: Any) -> type | None:
    """The handle class a parameter is declared as, or `None` for anything else.

    By identity for the protocol, which `issubclass` refuses as a protocol no runtime check is declared for.
    """

    kind = get_origin(declared) or declared
    if kind in READ_ONLY:
        return kind
    if isinstance(kind, type) and issubclass(kind, WRITABLE):
        return kind
    return None


def handles(dependant: Dependant) -> Iterator[tuple[str, type]]:
    """Every database handle the tree declares, named by its consumer and parameter, with the class it is declared as.

    A handle's own provider is not opened: its consumer's annotation is what the handler is handed, and below it the
    provider holds the client a handle comes from. A router's dependency, which names no parameter, is opened as any.
    """

    # `Annotated` taken off, which leaves the type FastAPI hands the parameter.
    declared = get_type_hints(dependant.call) if dependant.call is not None else {}
    for sub in dependant.dependencies:
        kind = _handle_kind(declared.get(sub.name)) if sub.name is not None else None
        if kind is None:
            yield from handles(sub)
        else:
            yield f"{getattr(dependant.call, '__qualname__', dependant.call)}({sub.name})", kind


def _writable(route: APIRoute) -> list[str]:
    return sorted(where for where, kind in handles(route.dependant) if kind not in READ_ONLY)


def _marked(route: APIRoute) -> bool:
    return DOCUMENT["paths"][route.path_format]["post"].get(SAFE_KEY) is True


@pytest.mark.parametrize("route", POST_ROUTES, ids=lambda route: route.path)
def test_a_post_is_marked_safe_exactly_where_it_is_handed_no_writable_handle(route: APIRoute):
    """Both ways: a write marked safe misses the cache clear, and a read left unmarked clears it on every call."""

    writable = _writable(route)

    if _marked(route):
        assert writable == [], f"POST {route.path} is marked safe and is handed a writable handle: {writable}"
    else:
        assert writable != [], f"POST {route.path} is handed read-only handles alone, so the document must mark it `{SAFE_KEY}`"


def test_the_marks_stand_only_where_the_frontend_reads_them():
    """Each mark where the generated client can act on it.

    `x-safe` on a POST alone, since every other method's safety is its own, and `x-safe-when` naming a boolean query
    parameter the operation takes, which the client reads off the URL it sends.
    """

    for path, operations in DOCUMENT["paths"].items():
        for method, operation in operations.items():
            if SAFE_KEY in operation:
                assert (method, operation[SAFE_KEY]) == ("post", True), f"{method.upper()} {path} marks `{SAFE_KEY}`"
            if SAFE_WHEN_KEY in operation:
                parameter = operation[SAFE_WHEN_KEY]
                kinds = {(each["in"], each["schema"].get("type")) for each in operation.get("parameters", []) if each["name"] == parameter}
                assert kinds == {("query", "boolean")}, f"{method.upper()} {path} is safe when `{parameter}`, which is no boolean query"
