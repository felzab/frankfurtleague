import pytest

from app.api.registrierungen.services import link_is_over

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"


class TestTheLinksLastDay:
    @pytest.mark.parametrize(
        ("deadline", "over"), [pytest.param(TODAY, False, id="the day the mail names"), pytest.param(YESTERDAY, True, id="the day after")]
    )
    def test_the_link_answers_through_the_day_the_mail_names(self, deadline: str, over: bool):
        """A link dying at the midnight before that day locks a pupil out on the day they were told they had."""

        assert link_is_over(confirmation={"deadline": deadline}, status="submitted", departed=False, today=TODAY) is over
