"""
TEAMS · the rule guarding `DELETE /teams/{team_id}`

Decided 2026-08-07: a club retires only once every season it is entered in is `past`. Pure, so
the default tier covers it without a container.
"""

from app.api.teams.services import RETIRE_BLOCKED, find_retire_refusal


class TestRetiringAClub:
    def test_a_club_in_no_season_may_be_retired(self):
        assert find_retire_refusal([]) is None

    def test_a_club_whose_seasons_are_all_past_may_be_retired(self):
        assert find_retire_refusal(["past", "past"]) is None

    def test_a_club_in_the_active_season_is_refused(self):
        refusal = find_retire_refusal(["past", "active"])
        assert refusal is not None
        assert "active" in refusal.message

    def test_a_club_in_a_planned_season_is_refused(self):
        refusal = find_retire_refusal(["future"])
        assert refusal is not None
        assert "future" in refusal.message

    def test_both_blocking_statuses_are_named_once_each(self):
        refusal = find_retire_refusal(["active", "future", "active"])
        assert refusal is not None
        assert "active/future" in refusal.message

    def test_the_refusal_carries_its_own_code(self):
        """
        The code travels with the refusal rather than being named by `retire_team`.

        A code supplied at the call site is a copy of the rule's own that nothing compares against it, and
        the client reads the code and never the message
        (`app/core/exception_handlers.py :: error_response`) — so a stale copy is invisible from the
        outside.
        """

        refusal = find_retire_refusal(["active"])

        assert refusal is not None
        assert refusal.error_code == RETIRE_BLOCKED
