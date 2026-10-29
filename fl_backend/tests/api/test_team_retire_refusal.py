from app.api.teams.services import find_retire_refusal
from app.core.codes import Code


class TestRetiringAClub:
    def test_a_club_in_no_season_may_be_retired(self):
        assert find_retire_refusal([]) is None

    def test_a_club_whose_seasons_are_all_past_may_be_retired(self):
        assert find_retire_refusal(["past", "past"]) is None

    def test_a_club_in_the_active_season_is_refused(self):
        refusal = find_retire_refusal(["past", "active"])
        assert refusal is not None

    def test_a_club_in_a_planned_season_is_refused(self):
        refusal = find_retire_refusal(["future"])
        assert refusal is not None

    def test_the_refusal_carries_its_own_code(self):
        """The code travels with the refusal: a copy at the call site is one nothing compares against, and the client reads the code."""

        refusal = find_retire_refusal(["active"])

        assert refusal is not None
        assert refusal.error_code == Code.RETIRE_BLOCKED
