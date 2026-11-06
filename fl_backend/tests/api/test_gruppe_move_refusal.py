import pytest

from app.api.teams.services import find_gruppe_move_refusal
from app.core.codes import Code


class TestTheWindowForAGroupChange:
    """A picker lock alone is no rule: the group phase is a round robin, so moving a team after its fixtures are drawn strands every one."""

    @pytest.mark.parametrize("drawn", [1, 8])
    def test_a_drawn_season_refuses_it(self, drawn):
        """Including a `future` one, which is the case the draw made ordinary rather than impossible."""

        refusal = find_gruppe_move_refusal(spiele_drawn=drawn)

        assert refusal is not None
        assert refusal.error_code == Code.ENTRY_GRUPPE_LOCKED
