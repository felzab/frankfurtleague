"""A judge's two kinds of refusal: a gate naming at most its subject, and one collecting call naming every fault."""

from http import HTTPStatus
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.codes import Code
from app.core.crud import refuse, refuse_faults
from app.core.exceptions import APIError, FieldFault, Subject
from app.main import create_shell

AGE = FieldFault(path=("birth_date",), code=Code.CONFIRMATION_AGE, status=HTTPStatus.UNPROCESSABLE_CONTENT, bounds={"min": 18, "max": 99})
TAKEN = FieldFault(path=("email",), code=Code.KONTAKT_EMAIL_TAKEN, status=HTTPStatus.CONFLICT)

SUBJECT = Subject(path=("schiedsrichter_id",), location="path", bounds={"spiel_nrs": [3, 8], "count": 2})

ANSWERING_APP = create_shell()


@ANSWERING_APP.post("/collected")
async def collect() -> None:
    refuse_faults(AGE, TAKEN)


@ANSWERING_APP.post("/subject")
async def refuse_at_the_subject() -> None:
    refuse(APIError(HTTPStatus.CONFLICT, Code.SCHIEDSRICHTER_STILL_ASSIGNED, subject=SUBJECT))


@ANSWERING_APP.post("/gate")
async def refuse_the_write() -> None:
    refuse(APIError(HTTPStatus.CONFLICT, Code.SAISON_PAST))


@pytest.mark.parametrize(
    ("path", "status", "code", "fields"),
    [
        # The frontend words each box by its entry's kind and ctx: one code or one ctx for all would word every box alike.
        # The status is the first fault's, as the code is.
        pytest.param(
            "/collected",
            HTTPStatus.UNPROCESSABLE_CONTENT,
            Code.CONFIRMATION_AGE,
            [
                {"in": "body", "path": ["birth_date"], "kind": Code.CONFIRMATION_AGE, "ctx": {"min": 18, "max": 99}},
                {"in": "body", "path": ["email"], "kind": Code.KONTAKT_EMAIL_TAKEN, "ctx": {}},
            ],
            id="each fault its own entry",
        ),
        # A retirement's sentence names the fixtures that block it from these bounds, read off the path's entry.
        pytest.param(
            "/subject",
            HTTPStatus.CONFLICT,
            Code.SCHIEDSRICHTER_STILL_ASSIGNED,
            [
                {
                    "in": "path",
                    "path": ["schiedsrichter_id"],
                    "kind": Code.SCHIEDSRICHTER_STILL_ASSIGNED,
                    "ctx": {"spiel_nrs": [3, 8], "count": 2},
                }
            ],
            id="a gate at its subject",
        ),
        pytest.param("/gate", HTTPStatus.CONFLICT, Code.SAISON_PAST, [], id="a gate naming no field"),
    ],
)
def test_the_failure_body_names_each_entry_where_it_arrived(path: str, status: HTTPStatus, code: Code, fields: list[dict[str, Any]]):
    response = TestClient(ANSWERING_APP, raise_server_exceptions=False).post(path)
    body = response.json()

    assert (response.status_code, set(body), body["error_code"], body["fields"]) == (
        status,
        {"error_code", "trace_id", "fields"},
        code,
        fields,
    )
