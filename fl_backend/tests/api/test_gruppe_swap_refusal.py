"""
TEAMS · when two clubs may exchange groups inside a season

`find_gruppe_swap_refusal`, pure, default tier. A swap is the one mid-season group change that
keeps every group's size and every drawn fixture intact, which is why it exists beside the lock
`REQ-ENTER-004` applies to a MOVE rather than relaxing it (ADR-0062).

Four rules, and the order between them is asserted here as well as the rules themselves: a pair
that is not a swap is refused as one before anything about the season is consulted, and a season
that is over is refused as that before either of the two windows inside it.
"""

import pytest

from app.api.teams.services import (
    SWAP_GRUPPENPHASE_PLAYED,
    SWAP_KNOCKOUT_STARTED,
    SWAP_NOT_A_SWAP,
    SWAP_SAISON_FINISHED,
    find_gruppe_swap_refusal,
)


def swap(**overrides):
    """A legal swap — a running season, A against B, nothing played — with the field under test overridden."""

    payload = {
        "is_same_team": False,
        "team1_gruppe": "A",
        "team2_gruppe": "B",
        "saison_status": "active",
        "played_knockout_fixtures": 0,
        "played_gruppenphase_fixtures": 0,
    }
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

    def test_it_still_fires_where_no_group_fixture_has_been_played(self):
        """
        `REQ-SWAP-002` is not dominated by `REQ-SWAP-004`, and this is the state that proves it.

        Two clubs entered after the schedule was drawn hold junction rows and no fixture at all, so they
        reach the end of a played-out season having taken part in no round robin. The knockout window is
        the only thing left refusing them.
        """

        refusal = swap(played_knockout_fixtures=3, played_gruppenphase_fixtures=0)

        assert refusal is not None
        assert refusal[0] == SWAP_KNOCKOUT_STARTED


class TestAFinishedSeasonIsFrozen:
    """`REQ-SWAP-003`: a `past` season's groups are as frozen as the scoring rules `REQ-RULES-005` holds."""

    @pytest.mark.parametrize("saison_status", ["active", "future"])
    def test_a_season_that_is_not_over_permits_it(self, saison_status):
        """The two statuses a swap is for: one being set up, and one being played."""

        assert swap(saison_status=saison_status) is None

    def test_a_past_season_is_refused(self):
        """
        A finished season's table is derived from these groups on every read (ADR-0019).

        So exchanging them rewrites who won a competition that is over, with nothing anywhere recording
        what it used to say — the same harm `REQ-RULES-005` refuses over `win_points`.
        """

        refusal = swap(saison_status="past")

        assert refusal is not None
        assert refusal[0] == SWAP_SAISON_FINISHED

    def test_an_abandoned_past_season_is_refused_too(self):
        """
        The season nobody finished, and the one case where being `past` is the whole of the refusal.

        Nothing was played, so neither window inside the season closes — and the swap is refused anyway,
        because being over is a fact about the season rather than about what happened in it. A repair to
        an abandoned season is exactly the request this turns down (decided 2026-08-11).
        """

        refusal = swap(saison_status="past", played_knockout_fixtures=0, played_gruppenphase_fixtures=0)

        assert refusal is not None
        assert refusal[0] == SWAP_SAISON_FINISHED

    def test_being_over_is_answered_before_either_window_inside_it(self):
        """
        The ordering, asserted rather than assumed.

        A past season is refused whatever its bracket and its round robins hold, so naming one of those
        would send an admin to look at a bound that is not what is stopping them.
        """

        refusal = swap(saison_status="past", played_knockout_fixtures=6, played_gruppenphase_fixtures=12)

        assert refusal is not None
        assert refusal[0] == SWAP_SAISON_FINISHED


class TestTheRoundRobinClosesTheWindow:
    """`REQ-SWAP-004`: a club that has taken part in its group's round robin cannot leave it."""

    def test_two_clubs_with_nothing_played_permit_it(self):
        """The whole window: both clubs still to start, so both round robins are still only a schedule."""

        assert swap(played_gruppenphase_fixtures=0) is None

    def test_one_played_group_fixture_is_enough(self):
        """
        There is no threshold to tune, because the harm is structural rather than proportional.

        A group phase is a round robin — every club plays every other club of its group. One result
        inside it already means the club has results against a group it would be leaving, and that its
        new group would hold a member who has played nobody in it.
        """

        refusal = swap(played_gruppenphase_fixtures=1)

        assert refusal is not None
        assert refusal[0] == SWAP_GRUPPENPHASE_PLAYED

    def test_the_refusal_says_how_much_has_been_played(self):
        """The count is what tells an admin whether this is one result or a group phase most of the way through."""

        refusal = swap(played_gruppenphase_fixtures=5)

        assert refusal is not None
        assert "5" in refusal[1]

    def test_the_bracket_is_answered_before_the_round_robin(self):
        """
        The ordering, asserted rather than assumed.

        Both bounds are live in a season whose knockout has started, and the bracket is the further one:
        an admin told about the round robin would fix it and still be refused.
        """

        refusal = swap(played_knockout_fixtures=1, played_gruppenphase_fixtures=6)

        assert refusal is not None
        assert refusal[0] == SWAP_KNOCKOUT_STARTED
