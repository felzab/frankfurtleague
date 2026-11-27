"""A judge's two kinds of refusal: a gate naming at most its subject, and one collecting call naming every fault."""

from http import HTTPStatus
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.codes import Code
from app.core.crud import refuse, refuse_faults
from app.core.exceptions import APIError, FieldCheck, FieldFault, Subject, as_judged_on_stored_state
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
    def test_checks_finding_nothing_raise_nothing(self):
        assert raised(None, (), None) is None

    def test_every_fault_of_every_check_is_named_in_the_order_the_checks_were_asked(self):
        """A fault dropped here is a box the person meets only on a later press."""

        refusal = raised(AGE, None, REPEATED, TAKEN)

        assert refusal is not None
        assert (refusal.error_code, refusal.faults) == (Code.CONFIRMATION_AGE, (AGE, *REPEATED, TAKEN))

    @pytest.mark.parametrize(
        ("faults", "status"),
        [
            pytest.param((AGE,), HTTPStatus.UNPROCESSABLE_CONTENT, id="the payload alone"),
            pytest.param((AGE, TAKEN), HTTPStatus.CONFLICT, id="stored data after the payload"),
            pytest.param((TAKEN, AGE), HTTPStatus.CONFLICT, id="stored data before the payload"),
            pytest.param((AGE, TAKEN, OWN), HTTPStatus.FORBIDDEN, id="who asks last"),
            pytest.param((OWN, AGE), HTTPStatus.FORBIDDEN, id="who asks first"),
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


def answered(path: str) -> tuple[int, str, list[dict[str, Any]]]:
    response = TestClient(ANSWERING_APP, raise_server_exceptions=False).post(path)
    body = response.json()

    assert set(body) == {"error_code", "trace_id", "fields"}
    return response.status_code, body["error_code"], body["fields"]


class TestTheFailureBody:
    def test_each_fault_is_its_own_entry_with_its_own_kind_and_bounds(self):
        """The frontend words each box by its entry's kind and ctx: one code or one ctx for all would word every box alike."""

        assert answered("/collected") == (
            HTTPStatus.CONFLICT,
            Code.CONFIRMATION_AGE,
            [
                {"in": "body", "path": ["birth_date"], "kind": Code.CONFIRMATION_AGE, "ctx": {"min": 18, "max": 99}},
                {"in": "body", "path": ["email"], "kind": Code.KONTAKT_EMAIL_TAKEN, "ctx": {}},
            ],
        )

    def test_a_gate_names_its_subject_under_its_own_code_where_the_subject_arrived(self):
        """A retirement's sentence names the fixtures that block it from these bounds, read off the path's entry."""

        assert answered("/subject") == (
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
        )

    def test_a_gate_with_no_subject_names_no_field(self):
        assert answered("/gate") == (HTTPStatus.CONFLICT, Code.SAISON_PAST, [])


class TestAWriteCarryingNoBody:
    def test_its_faults_answer_as_one_gate_naming_no_box(self):
        """A path the write's request has no body for would mark a box of a form that never sent it."""

        refusal = as_judged_on_stored_state((AGE, TAKEN))

        assert refusal is not None
        assert (refusal.status_code, refusal.error_code, refusal.faults, refusal.subject) == (
            HTTPStatus.CONFLICT,
            Code.CONFIRMATION_AGE,
            (),
            None,
        )
        assert as_judged_on_stored_state(()) is None
