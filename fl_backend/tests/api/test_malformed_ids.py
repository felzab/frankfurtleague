import asyncio
import re
from collections.abc import Mapping
from typing import Annotated, Any, cast

import pymongo
import pytest
from bson import ObjectId
from fastapi.dependencies.models import Dependant
from httpx2 import Response
from pydantic import TypeAdapter

from app.core.codes import Code
from app.core.routing import CONVERTOR_NAME, OBJECT_ID_REGEX, ObjectIdConvertor
from app.main import create_app
from app.openapi_document import build_document
from tests.app_client import app_client
from tests.config import BASE_AUTH, UNANSWERED_DEADLINE_S, UNANSWERED_URI, build_test_config
from tests.core.app_source import api_routes, application

HEX_ID = "6890a1b2c3d4e5f607182930"

# `ObjectId` tests length before it decodes hex, so query validation refuses this one on its
# characters rather than on its length.
NON_HEX_ID = "z" * 24

# Named rather than compared with `!=`: a control asserting only "not 404" passes on any failure,
# the harness's own included.
UNREACHED_DATABASE = Code.DATABASE_FAILED


def answered(path: str, *, params: Mapping[str, Any] | None = None) -> Response:
    """The response, never the client: the driver binds a client to the loop it first ran on."""

    async def _answered() -> Response:
        async with app_client(UNANSWERED_URI) as http:
            with pymongo.timeout(UNANSWERED_DEADLINE_S):
                return await http.get(path, params=params, headers=BASE_AUTH)

    return asyncio.run(_answered())


MALFORMED_IDS = ["not-an-id", NON_HEX_ID, HEX_ID[:-1], f"{HEX_ID}0"]


@pytest.mark.parametrize("spiel_id", MALFORMED_IDS)
def test_a_malformed_path_id_is_a_404(spiel_id: str):
    """A path identifies, so an id naming nothing is a 404 — decided by the `objectid` convertor before a handler runs."""
    response = answered(f"/api/v0/spiele/{spiel_id}")

    assert (response.status_code, response.json()["error_code"]) == (404, Code.NO_ROUTE)


def test_a_well_formed_path_id_reaches_the_database():
    """The control: a well-formed id matches the route, so the failure moves off routing and onto the database."""
    response = answered(f"/api/v0/spiele/{HEX_ID}")

    assert response.status_code == 500
    assert response.json()["error_code"] == UNREACHED_DATABASE


# No `db` marker: every refusal is decided before a query, and each control is answered by an
# unreachable database rather than by what it holds.
@pytest.mark.parametrize("team_id", MALFORMED_IDS)
def test_a_malformed_query_id_is_a_422(team_id: str):
    """A query validates, so a malformed id is a 422 — decided while FastAPI is still assembling the call."""
    response = answered("/api/v0/spieler", params={"team_id": team_id})

    assert response.status_code == 422
    assert response.json()["error_code"] == Code.PAYLOAD_REFUSED


def test_a_well_formed_query_id_reaches_the_database():
    """The control: the same parameter carrying a real id is validated, and fails at the database instead."""
    response = answered("/api/v0/spieler", params={"team_id": HEX_ID})

    assert response.status_code == 500
    assert response.json()["error_code"] == UNREACHED_DATABASE


def test_every_objectid_path_parameter_publishes_the_pattern_its_convertor_matches():
    """Read off each route's own path, so a malformed id is visibly no id this operation serves, and no other parameter claims one."""

    document = build_document()
    convertor_named = {
        (route.path_format, method.lower(), name)
        for route in api_routes(create_app(build_test_config()))
        for method in route.methods or ()
        for name in re.findall(rf"{{(\w+):{CONVERTOR_NAME}}}", route.path)
    }
    published = {
        (path, method, parameter["name"])
        for path, operations in document["paths"].items()
        for method, operation in operations.items()
        for parameter in operation.get("parameters", [])
        if parameter["in"] == "path" and parameter["schema"].get("pattern") == f"^{OBJECT_ID_REGEX}$"
    }

    assert convertor_named and published == convertor_named
    assert not any(re.fullmatch(OBJECT_ID_REGEX, malformed) for malformed in MALFORMED_IDS)


def _path_fields(dependant: Dependant) -> dict[str, Any]:
    """Every path parameter an operation reads, its dependencies' among them, by name."""

    fields = {field.name: field for field in dependant.path_params}
    for dependency in dependant.dependencies:
        fields.update(_path_fields(dependency))

    return fields


def test_every_objectid_path_parameter_reaches_its_handler_as_an_object_id():
    """The case above passes a `str` there, its pattern published off the convertor, and every lookup by that id then misses."""

    reached: list[tuple[str, str, type]] = []
    for route in api_routes(application()):
        fields = _path_fields(route.dependant)
        for name, convertor in route.param_convertors.items():
            if isinstance(convertor, ObjectIdConvertor):
                info = fields[name].field_info
                # A field's type read at run time, which no type expression spells, so the checker takes it as `Any`.
                annotation = cast(Any, Annotated[info.annotation, *info.metadata] if info.metadata else info.annotation)
                reached.append((route.path_format, name, type(TypeAdapter(annotation).validate_python(HEX_ID))))

    assert reached and [(path, name) for path, name, handed in reached if handed is not ObjectId] == []
