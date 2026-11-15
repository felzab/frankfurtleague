import asyncio
from collections.abc import Mapping
from typing import Annotated, Any, cast

import pymongo
import pytest
from bson import ObjectId
from fastapi.dependencies.models import Dependant
from httpx2 import Response
from pydantic import TypeAdapter

from app.core.codes import Code
from app.core.routing import ObjectIdConvertor
from tests.app_client import app_client
from tests.config import BASE_AUTH, UNANSWERED_DEADLINE_S, UNANSWERED_URI
from tests.core.app_source import api_routes, application

HEX_ID = "6890a1b2c3d4e5f607182930"

# `ObjectId` tests length before it decodes hex, so query validation refuses this one on its
# characters rather than on its length.
NON_HEX_ID = "z" * 24


def answered(path: str, *, params: Mapping[str, Any] | None = None) -> Response:
    """The response, never the client: the driver binds a client to the loop it first ran on."""

    async def _answered() -> Response:
        async with app_client(UNANSWERED_URI) as http:
            with pymongo.timeout(UNANSWERED_DEADLINE_S):
                return await http.get(path, params=params, headers=BASE_AUTH)

    return asyncio.run(_answered())


MALFORMED_IDS = [NON_HEX_ID, HEX_ID[:-1], f"{HEX_ID}0"]


# No `db` marker: every refusal is decided before a query, and each control is answered by an
# unreachable database rather than by what it holds.
@pytest.mark.parametrize("spiel_id", MALFORMED_IDS)
def test_a_malformed_path_id_is_a_404(spiel_id: str):
    """A path identifies, so an id naming nothing is a 404 — decided by the `objectid` convertor before a handler runs."""
    response = answered(f"/api/v0/spiele/{spiel_id}")

    assert (response.status_code, response.json()["error_code"]) == (404, Code.NO_ROUTE)


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
