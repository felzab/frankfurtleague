"""
TEAMS · when two clubs may exchange groups inside a season

`find_gruppe_swap_refusal`, pure, default tier. A swap is the one mid-season group change that
keeps every group's size and every drawn fixture intact, which is why it exists beside the lock
`REQ-ENTER-004` applies to a MOVE rather than relaxing it (ADR-0062).

Five rules, and the order between them is asserted here as well as the rules themselves: a pair
that is not a swap is refused as one before anything about the season is consulted, a season that
is over is refused as that before either of the two windows inside it, and the one bound an admin
can repair is named only once nothing terminal is refusing too.
"""

import pytest

from app.api.teams.services import (
    SWAP_GRUPPENPHASE_PLAYED,
    SWAP_KNOCKOUT_STARTED,
    SWAP_NOT_A_SWAP,
    SWAP_SAISON_FINISHED,
    SWAP_SPIELTAG_CLASH,
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
        "clashing_spieltage": 0,
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
        """Zero is every season up to the first knockout fixture taking place, which is the whole window."""

        assert swap(played_knockout_fixtures=0) is None

    def test_one_played_knockout_fixture_is_enough(self):
        """
        There is no threshold to tune: the first one seeds a slot from a standing these groups produced.

        Exchanging them afterwards leaves that slot naming a placing in a group its occupant was never in.
        """

        refusal = swap(played_knockout_fixtures=1)

        assert refusal is not None
        assert refusal[0] == SWAP_KNOCKOUT_STARTED

    def test_the_refusal_says_how_much_has_taken_place(self):
        """The count is what tells an admin whether this is the first fixture or a finished bracket."""

        refusal = swap(played_knockout_fixtures=4)

        assert refusal is not None
        assert "4" in refusal[1]

    def test_the_message_names_a_called_off_fixture_as_one_that_took_place(self):
        """
        The count covers both, so the wording has to as well.

        An admin whose bracket holds one cancelled fixture and no result would otherwise read that the
        knockout "carries a result", go looking for it, and find none.
        """

        refusal = swap(played_knockout_fixtures=1)

        assert refusal is not None
        assert "called off" in refusal[1]

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

        Two clubs entered while the season was still `future` but AFTER its fixtures were drawn hold
        junction rows and no fixture at all, so they reach a played-out bracket having taken part in no
        round robin. The knockout window is the only thing left refusing them, which is what keeps this
        from being a control that can never fire.
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


class TestASpieltagNeverHoldsAClubTwice:
    """`REQ-SWAP-005`: the exchange may not leave a club standing in two matches of one Spieltag (ADR-0042)."""

    def test_a_swap_that_doubles_nobody_passes(self):
        """Zero is the ordinary season, where the bracket has no manual pick sharing a Spieltag with a group fixture."""

        assert swap(clashing_spieltage=0) is None

    def test_one_clashing_spieltag_is_enough(self):
        """
        There is no threshold: a club playing two matches on one matchday is not a thing that can happen.

        The match write path refuses that state wherever a team is fielded, and this endpoint writes
        fixture documents without passing it — so a swap producing one would be the only route to it.
        """

        refusal = swap(clashing_spieltage=1)

        assert refusal is not None
        assert refusal[0] == SWAP_SPIELTAG_CLASH

    def test_the_refusal_says_how_many_spieltage_it_found(self):
        """The count is what tells an admin whether this is one fixture to move or a schedule to rethink."""

        refusal = swap(clashing_spieltage=3)

        assert refusal is not None
        assert "3" in refusal[1]

    @pytest.mark.parametrize(
        ("terminal", "code"),
        [
            ({"saison_status": "past"}, SWAP_SAISON_FINISHED),
            ({"played_knockout_fixtures": 1}, SWAP_KNOCKOUT_STARTED),
            ({"played_gruppenphase_fixtures": 1}, SWAP_GRUPPENPHASE_PLAYED),
        ],
    )
    def test_every_terminal_refusal_is_answered_first(self, terminal, code):
        """
        The ordering, and the reason it is this way round rather than assumed.

        `REQ-SWAP-005` is the only bound of the five an admin can repair — move one of the two fixtures,
        or clear the bracket side's manual pick. Naming it while a bound nothing reopens also applies
        would send somebody to rearrange a schedule and be refused again for the real reason.
        """

        refusal = swap(clashing_spieltage=2, **terminal)

        assert refusal is not None
        assert refusal[0] == code
