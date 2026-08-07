"""
When a team may change group inside a season — `find_gruppe_move_refusal`, pure, default tier.

**The rule existed only in the browser until 2026-08-08.** `fl_frontend/src/app/admin/teams/[team_id]/page.tsx`
locked the group picker once the season was running and the team had fixtures, and the endpoint's own
docstring described that window — while `patch_saison_team` fed `find_entry_refusal` a hardcoded
`saison_status="future"`, so a direct request moved a team whose group fixtures were already drawn.

Why the fixtures are what matter: the group phase is a single round robin INSIDE each group (ADR-0065), so
a team's fixtures ARE its group. Moving it afterwards leaves every one of them played against the group it
left, and nothing rewrites them.

`REQ-ENTER-001` is a different rule and stays a different rule: it refuses ENTERING a season that is not
`future`. A move is not an entry, which is why a running season whose fixtures nobody has drawn still
permits one.
"""

import pytest

from app.api.teams.services import ENTRY_GRUPPE_LOCKED, find_gruppe_move_refusal


class TestTheWindowForAGroupChange:
    @pytest.mark.parametrize("drawn", [0, 8])
    def test_a_planned_season_always_permits_it(self, drawn):
        """
        `future` is the ordinary case, and the fixture count does not matter there.

        A season being set up may have its whole schedule drawn already and still be re-drawn, because
        nothing has been played — which is the half a status test alone would have got right.
        """

        assert find_gruppe_move_refusal(saison_status="future", fixtures_drawn=drawn) is None

    @pytest.mark.parametrize("status", ["active", "past"])
    def test_a_started_season_permits_it_while_no_fixture_exists(self, status):
        """
        The half a status test alone would have got wrong.

        A season can be running with a group whose fixtures nobody has entered, and moving a team between
        two such groups strands nothing at all.
        """

        assert find_gruppe_move_refusal(saison_status=status, fixtures_drawn=0) is None

    @pytest.mark.parametrize("status", ["active", "past"])
    def test_a_started_season_refuses_it_once_a_fixture_exists(self, status):
        refusal = find_gruppe_move_refusal(saison_status=status, fixtures_drawn=1)

        assert refusal is not None
        assert refusal[0] == ENTRY_GRUPPE_LOCKED

    def test_one_fixture_is_enough(self):
        """
        The round robin is per group, so a single fixture already names which group the team is in.

        There is no threshold to tune here: the first fixture is the one that makes the group a fact about
        what has been scheduled rather than a label.
        """

        assert find_gruppe_move_refusal(saison_status="active", fixtures_drawn=1) is not None

    def test_the_refusal_names_the_status_and_the_count(self):
        """Both are what an admin has to know: why it is closed, and how much is already drawn."""

        refusal = find_gruppe_move_refusal(saison_status="active", fixtures_drawn=6)

        assert refusal is not None
        assert "active" in refusal[1]
        assert "6" in refusal[1]
