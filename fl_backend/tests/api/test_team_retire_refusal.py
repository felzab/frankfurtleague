"""
The rule guarding `DELETE /teams/{team_id}`.

Owner's rule, 2026-08-07: a club retires only once every season it is entered in is `past`. Pure, so
the default tier covers it without a container.
"""

from app.api.teams.services import find_retire_refusal


class TestRetiringAClub:
    def test_a_club_in_no_season_may_be_retired(self):
        assert find_retire_refusal([]) is None

    def test_a_club_whose_seasons_are_all_past_may_be_retired(self):
        assert find_retire_refusal(["past", "past"]) is None

    def test_a_club_in_the_active_season_is_refused(self):
        refusal = find_retire_refusal(["past", "active"])
        assert refusal is not None
        assert "active" in refusal

    def test_a_club_in_a_planned_season_is_refused(self):
        refusal = find_retire_refusal(["future"])
        assert refusal is not None
        assert "future" in refusal

    def test_both_blocking_statuses_are_named_once_each(self):
        refusal = find_retire_refusal(["active", "future", "active"])
        assert refusal is not None
        assert "active/future" in refusal
