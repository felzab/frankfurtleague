import pytest

from app.api.teams.services import ENTRY_GRUPPE_LOCKED, find_gruppe_move_refusal


class TestTheWindowForAGroupChange:
    """A picker lock alone is no rule: the group phase is a round robin, so moving a team after its fixtures are drawn strands every one."""

    @pytest.mark.parametrize("drawn", [0, 8])
    def test_a_planned_season_always_permits_it(self, drawn):
        """A season being set up may have its whole schedule drawn and still be re-drawn: nothing has been played."""

        assert find_gruppe_move_refusal(saison_status="future", fixtures_drawn=drawn) is None

    @pytest.mark.parametrize("status", ["active", "past"])
    def test_a_started_season_permits_it_while_no_fixture_exists(self, status):
        """A running season can hold groups nobody has entered fixtures for, and a move between two strands nothing."""

        assert find_gruppe_move_refusal(saison_status=status, fixtures_drawn=0) is None

    @pytest.mark.parametrize("status", ["active", "past"])
    def test_a_started_season_refuses_it_once_a_fixture_exists(self, status):
        refusal = find_gruppe_move_refusal(saison_status=status, fixtures_drawn=1)

        assert refusal is not None
        assert refusal.error_code == ENTRY_GRUPPE_LOCKED

    def test_one_fixture_is_enough(self):
        """No threshold to tune: the first fixture makes the group a fact about the schedule rather than a label."""

        assert find_gruppe_move_refusal(saison_status="active", fixtures_drawn=1) is not None

    def test_the_refusal_names_the_status_and_the_count(self):
        refusal = find_gruppe_move_refusal(saison_status="active", fixtures_drawn=6)

        assert refusal is not None
        assert "active" in refusal.message
        assert "6" in refusal.message
