"""
TEAMS · when two clubs may exchange groups inside a season

`find_gruppe_swap_refusal`, pure, default tier. A swap is the one mid-season group change that
keeps every group's size and every drawn fixture intact, which is why it exists beside the lock
`REQ-ENTER-004` applies to a MOVE rather than relaxing it (ADR-0062).

Two rules, and the order between them is asserted here as well as the rules themselves: a pair
that is not a swap is refused as one before the knockout window is ever consulted.
"""

import pytest

from app.api.teams.services import SWAP_KNOCKOUT_STARTED, SWAP_NOT_A_SWAP, find_gruppe_swap_refusal


def swap(**overrides):
    """A legal swap — A against B, no knockout result — with the one field under test overridden."""

    payload = {"is_same_team": False, "team1_gruppe": "A", "team2_gruppe": "B", "played_knockout_fixtures": 0}
    payload.update(overrides)

    return find_gruppe_swap_refusal(**payload)


class TestWhatCountsAsASwap:
    def test_two_clubs_in_two_groups_pass(self):
        """The ordinary case, and the one a rule this shape is easiest to get wrong in the other direction."""

        assert swap() is None

    def test_the_direction_does_not_matter(self):
        """Neither side is the one being moved, so B against A is the same request as A against B."""

        assert swap(team1_gruppe="B", team2_gruppe="A") is None

    def test_one_club_named_twice_is_refused(self):
        """A club cannot exchange groups with itself, and the ids are what say so — the groups agree either way."""

        refusal = swap(is_same_team=True, team2_gruppe="A")

        assert refusal is not None
        assert refusal[0] == SWAP_NOT_A_SWAP

    @pytest.mark.parametrize(
        ("team1_gruppe", "team2_gruppe", "named"),
        [("A", None, "team2"), (None, "B", "team1"), (None, None, "team1 and team2")],
    )
    def test_a_club_outside_the_season_is_refused_and_named(self, team1_gruppe, team2_gruppe, named):
        """
        A club with no junction row is in no group at all, so there is nothing to exchange.

        The detail names WHICH club, because that is the half a log line cannot re-derive: both ids are
        already in the request, and which of them has no row is the whole answer.
        """

        refusal = swap(team1_gruppe=team1_gruppe, team2_gruppe=team2_gruppe)

        assert refusal is not None
        assert refusal[0] == SWAP_NOT_A_SWAP
        assert named in refusal[1]

    @pytest.mark.parametrize("gruppe", ["A", "D"])
    def test_two_clubs_of_one_group_are_refused(self, gruppe):
        """Exchanging within one group writes each club the group it already holds, which is a no-op with a toast."""

        refusal = swap(team1_gruppe=gruppe, team2_gruppe=gruppe)

        assert refusal is not None
        assert refusal[0] == SWAP_NOT_A_SWAP
        assert gruppe in refusal[1]


class TestTheKnockoutClosesTheWindow:
    def test_a_season_still_in_its_group_phase_permits_it(self):
        """Zero played knockout fixtures is every season up to the first bracket result, which is the whole window."""

        assert swap(played_knockout_fixtures=0) is None

    def test_one_played_knockout_fixture_is_enough(self):
        """
        There is no threshold to tune: the first result seeds a slot from a standing these groups produced.

        Exchanging them afterwards leaves that slot naming a placing in a group its occupant was never in.
        """

        refusal = swap(played_knockout_fixtures=1)

        assert refusal is not None
        assert refusal[0] == SWAP_KNOCKOUT_STARTED

    def test_the_refusal_says_how_much_has_been_played(self):
        """The count is what tells an admin whether this is the first result or a finished bracket."""

        refusal = swap(played_knockout_fixtures=4)

        assert refusal is not None
        assert "4" in refusal[1]

    def test_a_pair_that_is_not_a_swap_is_refused_as_that_first(self):
        """
        The ordering, asserted rather than assumed.

        Answering `REQ-SWAP-002` to a request naming one club twice would send the admin to look at the
        bracket over a payload that describes no swap at any point in the season.
        """

        refusal = swap(is_same_team=True, team2_gruppe="A", played_knockout_fixtures=6)

        assert refusal is not None
        assert refusal[0] == SWAP_NOT_A_SWAP
