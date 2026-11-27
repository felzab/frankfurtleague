"""A judge's two kinds of refusal: a gate naming at most its subject, and one collecting call naming every fault."""

from http import HTTPStatus
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.codes import Code
from app.core.crud import refuse, refuse_faults
from app.core.exceptions import APIError, FieldCheck, FieldFault, Subject
from app.main import create_shell

AGE = FieldFault(path=("birth_date",), code=Code.CONFIRMATION_AGE, status=HTTPStatus.UNPROCESSABLE_CONTENT, bounds={"min": 18, "max": 99})
TAKEN = FieldFault(path=("email",), code=Code.KONTAKT_EMAIL_TAKEN, status=HTTPStatus.CONFLICT)
OWN = FieldFault(path=("email",), code=Code.OWN_ADDRESS, status=HTTPStatus.FORBIDDEN)
# One check naming two boxes, as a rule judging several entries answers.
REPEATED = tuple(
    FieldFault(path=("kontakte", "stellvertretung", box), code=Code.BEWERBUNG_KONTAKT_REPEATED, status=HTTPStatus.UNPROCESSABLE_CONTENT)
    for box in ("email", "phone")
)


def raised(*checks: FieldCheck) -> APIError | None:
    try:
        refuse_faults(*checks)
    except APIError as refusal:
        return refusal

    return None


class TestOneCollectingCall:
    def test_every_fault_of_every_check_is_named_in_the_order_the_checks_were_asked(self):
        """A fault dropped here is a box the person meets only on a later press."""

        refusal = raised(AGE, None, REPEATED, TAKEN)

        assert refusal is not None
        assert (refusal.error_code, refusal.faults) == (Code.CONFIRMATION_AGE, (AGE, *REPEATED, TAKEN))

    @pytest.mark.parametrize(
        ("faults", "status"),
        [
            pytest.param((AGE, TAKEN), HTTPStatus.CONFLICT, id="stored data after the payload"),
            pytest.param((AGE, TAKEN, OWN), HTTPStatus.FORBIDDEN, id="who asks last"),
        ],
    )
    def test_the_status_is_the_weightiest_faults_never_the_firsts(self, faults: tuple[FieldFault, ...], status: HTTPStatus):
        """A 422 promises an edit of the payload lifts the refusal, which a fault judging stored data or who asks breaks."""

        refusal = raised(*faults)

        assert refusal is not None and refusal.status_code == status


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
    ("path", "code", "fields"),
    [
        # The frontend words each box by its entry's kind and ctx: one code or one ctx for all would word every box alike.
        pytest.param(
            "/collected",
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
        pytest.param("/gate", Code.SAISON_PAST, [], id="a gate naming no field"),
    ],
)
def test_the_failure_body_names_each_entry_where_it_arrived(path: str, code: Code, fields: list[dict[str, Any]]):
    response = TestClient(ANSWERING_APP, raise_server_exceptions=False).post(path)
    body = response.json()

    assert (response.status_code, set(body), body["error_code"], body["fields"]) == (
        HTTPStatus.CONFLICT,
        {"error_code", "trace_id", "fields"},
        code,
        fields,
    )
