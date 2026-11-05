from http import HTTPStatus

import pytest

from app.api.spielbestaetigungen.services import ADOPTION_TWINS
from app.core.codes import Code
from app.core.exceptions import FieldPath, WriteRefusal, as_judged_on_stored_state


def refused(code: Code, *paths: FieldPath, status: HTTPStatus = HTTPStatus.CONFLICT) -> WriteRefusal:
    return WriteRefusal(error_code=code, status=status, fields=paths, bounds={"max": 1} if paths else {})


class TestARefusalJudgedOnStoredState:
    """The harm: a write carrying no body, the adoption among them, answering a code or a path the page cannot word."""

    @pytest.mark.parametrize(
        ("refusal", "twin"),
        [
            pytest.param(refused(Code.ANSETZUNG_VORSCHLAG_PAST, ("datum",)), Code.ANSETZUNG_VORSCHLAG_PAST_AS_STORED, id="one twin"),
            pytest.param(
                refused(Code.SPIEL_DOUBLE_BOOKED, ("ort", "spielort_id")), Code.SPIEL_DOUBLE_BOOKED_SPIELORT_AS_STORED, id="the ground"
            ),
            pytest.param(
                refused(Code.SPIEL_DOUBLE_BOOKED, ("schiedsrichter", "schiedsrichter_id")),
                Code.SPIEL_DOUBLE_BOOKED_SCHIEDSRICHTER_AS_STORED,
                id="the referee",
            ),
            pytest.param(
                refused(Code.ELIGIBILITY_DISQUALIFIED, ("team1", "team_id")), Code.ELIGIBILITY_DISQUALIFIED_TEAM1_AS_STORED, id="team1"
            ),
            pytest.param(
                refused(Code.ELIGIBILITY_DISQUALIFIED, ("team2", "team_id")), Code.ELIGIBILITY_DISQUALIFIED_TEAM2_AS_STORED, id="team2"
            ),
        ],
    )
    def test_a_code_the_payload_write_shares_answers_its_twin_for_the_path_it_names(self, refusal: WriteRefusal, twin: Code):
        """Each twin a 409 naming no field, so the page words which booking or side refused by the code alone."""

        assert as_judged_on_stored_state(refusal, twins=ADOPTION_TWINS) == WriteRefusal(error_code=twin, status=HTTPStatus.CONFLICT)

    @pytest.mark.parametrize(
        "refusal",
        [
            pytest.param(refused(Code.SPIEL_DOUBLE_BOOKED, ("datum",)), id="a path no twin names"),
            pytest.param(refused(Code.ELIGIBILITY_DISQUALIFIED), id="no path at all"),
            pytest.param(refused(Code.SAISON_PAST, ("team1", "team_id")), id="a code with no twin"),
        ],
    )
    def test_any_other_refusal_keeps_its_code_and_status_and_names_no_field(self, refusal: WriteRefusal):
        """A field's path would name a box of a body the request has not got."""

        assert as_judged_on_stored_state(refusal, twins=ADOPTION_TWINS) == WriteRefusal(
            error_code=refusal.error_code, status=refusal.status, location=refusal.location
        )

    def test_no_refusal_stays_none(self):
        assert as_judged_on_stored_state(None, twins=ADOPTION_TWINS) is None
