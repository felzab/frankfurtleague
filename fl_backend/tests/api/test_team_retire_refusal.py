import pytest

from app.api.teams.services import find_retire_refusal
from app.core.codes import Code


class TestRetiringAClub:
    @pytest.mark.parametrize("statuses", [["past", "active"], ["future"]], ids=["a running season", "a planned season"])
    def test_a_club_standing_in_the_league_s_programme_is_refused_by_its_code(self, statuses: list[str]):
        """The code travels with the refusal: a copy at the call site is one nothing compares against, and the client reads the code."""

        refusal = find_retire_refusal(statuses)

        assert refusal is not None
        assert refusal.error_code == Code.RETIRE_BLOCKED
