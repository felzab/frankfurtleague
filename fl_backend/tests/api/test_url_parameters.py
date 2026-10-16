from collections.abc import Iterator
from typing import Annotated, Any, Final

from fastapi import FastAPI, Query

from app.shared.schemas.custom import OBJECT_ID_REGEX
from tests.openapi_document import build_document

# Every parameter a URL carries published as a string nothing closes, by where it sits and what it carries: an
# id, code or facet value, never typed text, which a request line hands every access log
# (`docs/frontend/spec.md :: I680`).
OPEN_STRING_PARAMETERS: Final = {
    "query": {
        "collection": "the collections a facet picked on the change log",
        "document_id": "a record's id, from a link a change log row opens",
        "herkunft": "the actor origins a facet picked on the change log",
        "operation": "the write kinds a facet picked on the change log",
        "saison_id": "a season's id",
        "saisonbezug": "the season relations a facet picked on the application queue",
        "status": "the states a facet picked on the application queue",
        "trace_id": "a request's trace id, from a link a change log row opens",
    },
    "path": {
        "saison_id": "a season's id",
        "seat": "a contact seat's name",
        "shorthand": "a club's two-letter code, checked as the application form's box is left, and no person's",
        "text_version": "a consent text's version",
    },
}

# What closes a string: a set of values, or the record id every `CustomObjectId` publishes, in a path, a query or a body alike.
OBJECT_ID_PATTERN: Final = f"^{OBJECT_ID_REGEX}$"


def _members(schema: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """The schema itself, or each member of its union, `Optional` publishing the string inside an `anyOf`.

    An array is read through its `items`, where a list-typed parameter publishes its strings.
    """
    for member in schema.get("anyOf", [schema]):
        if member.get("type") == "array":
            yield from _members(member.get("items", {}))
        else:
            yield member


def _is_open_string(schema: dict[str, Any]) -> bool:
    return any(
        member.get("type") == "string" and "enum" not in member and "const" not in member and member.get("pattern") != OBJECT_ID_PATTERN
        for member in _members(schema)
    )


def test_every_open_string_parameter_in_a_url_carries_no_typed_text():
    """A server action building its backend request with typed text passes the frontend's lint and page sweep.

    Both read the browser's own URLs, so a name outside the set fails here until entered with what it carries.
    """
    published: dict[str, set[str]] = {location: set() for location in OPEN_STRING_PARAMETERS}
    for operations in build_document()["paths"].values():
        for operation in operations.values():
            if not isinstance(operation, dict):
                continue
            for parameter in operation.get("parameters", []):
                if parameter["in"] in published and _is_open_string(parameter["schema"]):
                    published[parameter["in"]].add(parameter["name"])

    # Named, each parameter published and not entered, or entered and not published.
    assert [(location, name) for location, names in published.items() for name in sorted(names ^ OPEN_STRING_PARAMETERS[location].keys())] == []


def _list_typed_query_schemas() -> list[dict[str, Any]]:
    """What FastAPI publishes for a list-typed query parameter, required and optional, built rather than spelled."""
    probe = FastAPI()

    @probe.get("/required")
    def required(q: Annotated[list[str], Query()]) -> None:
        return None

    @probe.get("/optional")
    def optional(q: Annotated[list[str] | None, Query()] = None) -> None:
        return None

    paths = probe.openapi()["paths"]

    return [paths[path]["get"]["parameters"][0]["schema"] for path in ("/required", "/optional")]


def test_a_list_typed_parameter_is_read_through_its_items():
    """No URL parameter is list-typed today, so the sweep above would pass one over unread were its items skipped."""

    assert [_is_open_string(schema) for schema in _list_typed_query_schemas()] == [True, True]
