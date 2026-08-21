import pytest

from app.api.teams.services import ENTRY_GRUPPE_LOCKED, find_gruppe_move_refusal


class TestTheWindowForAGroupChange:
    """A picker lock alone is no rule: the group phase is a round robin, so moving a team after its fixtures are drawn strands every one."""

    def test_a_season_with_no_fixtures_permits_it(self):
        """With nothing drawn there is no round robin for a move to strand, whatever the season's status."""

        assert find_gruppe_move_refusal(fixtures_drawn=0) is None

    @pytest.mark.parametrize("drawn", [1, 8])
    def test_a_drawn_season_refuses_it(self, drawn):
        """Including a `future` one, which is the case the draw made ordinary rather than impossible."""

        refusal = find_gruppe_move_refusal(fixtures_drawn=drawn)

        assert refusal is not None
        assert refusal.error_code == ENTRY_GRUPPE_LOCKED

    def test_one_fixture_is_enough(self):
        """No threshold to tune: the first fixture makes the group a fact about the schedule rather than a label."""

        refusal = find_gruppe_move_refusal(fixtures_drawn=1)

        assert refusal is not None
        assert refusal.error_code == ENTRY_GRUPPE_LOCKED

    def test_the_refusal_names_the_count_and_the_route_out(self):
        refusal = find_gruppe_move_refusal(fixtures_drawn=6)

        assert refusal is not None
        assert "6" in refusal.message
        assert "swap" in refusal.message
