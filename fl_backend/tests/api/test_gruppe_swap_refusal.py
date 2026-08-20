import pytest

from app.api.teams.services import (
    SWAP_FIELDS_DISQUALIFIED,
    SWAP_GRUPPENPHASE_PLAYED,
    SWAP_KNOCKOUT_STARTED,
    SWAP_NOT_A_SWAP,
    SWAP_SAISON_FINISHED,
    SWAP_SPIELTAG_CLASH,
    find_gruppe_swap_refusal,
    fixtures_newly_fielding_a_departed_club,
)


def swap(**overrides):
    """A legal swap, with the field under test overridden."""

    payload = {
        "is_same_team": False,
        "team1_gruppe": "A",
        "team2_gruppe": "B",
        "saison_status": "active",
        "played_knockout_fixtures": 0,
        "played_gruppenphase_fixtures": 0,
        "clashing_spieltage": 0,
        "departed_fixtures": 0,
    }
    payload.update(overrides)

    return find_gruppe_swap_refusal(**payload)


class TestWhatCountsAsASwap:
    def test_two_clubs_in_two_groups_pass(self):
        assert swap() is None

    def test_the_direction_does_not_matter(self):
        assert swap(team1_gruppe="B", team2_gruppe="A") is None

    def test_one_club_named_twice_is_refused(self):
        """The ids say so, not the groups, which agree either way."""

        refusal = swap(is_same_team=True, team2_gruppe="A")

        assert refusal is not None
        assert refusal.error_code == SWAP_NOT_A_SWAP

    @pytest.mark.parametrize(
        ("team1_gruppe", "team2_gruppe", "named"),
        [("A", None, "team2"), (None, "B", "team1"), (None, None, "team1 and team2")],
    )
    def test_a_club_outside_the_season_is_refused_and_named(self, team1_gruppe, team2_gruppe, named):
        """A club with no junction row is in no group; the cases span which side is missing, and the message names it."""

        refusal = swap(team1_gruppe=team1_gruppe, team2_gruppe=team2_gruppe)

        assert refusal is not None
        assert refusal.error_code == SWAP_NOT_A_SWAP
        assert named in refusal.message

    @pytest.mark.parametrize("gruppe", ["A", "D"])
    def test_two_clubs_of_one_group_are_refused(self, gruppe):
        """Exchanging within one group is a no-op with a toast."""

        refusal = swap(team1_gruppe=gruppe, team2_gruppe=gruppe)

        assert refusal is not None
        assert refusal.error_code == SWAP_NOT_A_SWAP
        assert gruppe in refusal.message


class TestTheKnockoutClosesTheWindow:
    def test_a_season_still_in_its_group_phase_permits_it(self):
        assert swap(played_knockout_fixtures=0) is None

    def test_one_played_knockout_fixture_is_enough(self):
        """No threshold: exchanging after the first fixture leaves a slot naming a placing in a group its occupant was never in."""

        refusal = swap(played_knockout_fixtures=1)

        assert refusal is not None
        assert refusal.error_code == SWAP_KNOCKOUT_STARTED

    def test_the_refusal_says_how_much_has_taken_place(self):
        refusal = swap(played_knockout_fixtures=4)

        assert refusal is not None
        assert "4" in refusal.message

    def test_the_message_admits_a_fixture_with_no_scoreline_to_look_up(self):
        """A no-show is in the count and carries no scoreline anybody entered, so the wording cannot promise one."""

        refusal = swap(played_knockout_fixtures=1)

        assert refusal is not None
        assert "left a record" in refusal.message

    def test_a_pair_that_is_not_a_swap_is_refused_as_that_first(self):
        """Answering the bracket would send the admin to a payload that describes no swap."""

        refusal = swap(is_same_team=True, team2_gruppe="A", played_knockout_fixtures=6)

        assert refusal is not None
        assert refusal.error_code == SWAP_NOT_A_SWAP

    def test_it_still_fires_where_no_group_fixture_has_been_played(self):
        """`REQ-SWAP-002` is not dominated by `REQ-SWAP-004`: a club entered after the draw holds a junction row and no fixture."""

        refusal = swap(played_knockout_fixtures=3, played_gruppenphase_fixtures=0)

        assert refusal is not None
        assert refusal.error_code == SWAP_KNOCKOUT_STARTED


class TestAFinishedSeasonIsFrozen:
    """`REQ-SWAP-003`: a `past` season's groups are as frozen as the scoring rules `REQ-RULES-005` holds."""

    @pytest.mark.parametrize("saison_status", ["active", "future"])
    def test_a_season_that_is_not_over_permits_it(self, saison_status):
        assert swap(saison_status=saison_status) is None

    def test_a_past_season_is_refused(self):
        """The table is derived from these groups on every read, so exchanging them rewrites who won."""

        refusal = swap(saison_status="past")

        assert refusal is not None
        assert refusal.error_code == SWAP_SAISON_FINISHED

    def test_an_abandoned_past_season_is_refused_too(self):
        """Nothing was played, so neither inner window closes: being over is a fact about the season, not about what happened in it."""

        refusal = swap(saison_status="past", played_knockout_fixtures=0, played_gruppenphase_fixtures=0)

        assert refusal is not None
        assert refusal.error_code == SWAP_SAISON_FINISHED

    def test_being_over_is_answered_before_either_window_inside_it(self):
        """Naming a window would point at the wrong bound."""

        refusal = swap(saison_status="past", played_knockout_fixtures=6, played_gruppenphase_fixtures=12)

        assert refusal is not None
        assert refusal.error_code == SWAP_SAISON_FINISHED


class TestTheRoundRobinClosesTheWindow:
    """`REQ-SWAP-004`: a club that has taken part in its group's round robin cannot leave it."""

    def test_two_clubs_with_nothing_played_permit_it(self):
        assert swap(played_gruppenphase_fixtures=0) is None

    def test_one_played_group_fixture_is_enough(self):
        """No threshold: one result leaves the club with results against a group it is leaving, and a new group it has played nobody in."""

        refusal = swap(played_gruppenphase_fixtures=1)

        assert refusal is not None
        assert refusal.error_code == SWAP_GRUPPENPHASE_PLAYED

    def test_the_refusal_says_how_much_has_been_played(self):
        refusal = swap(played_gruppenphase_fixtures=5)

        assert refusal is not None
        assert "5" in refusal.message

    def test_the_bracket_is_answered_before_the_round_robin(self):
        """The bracket is the further bound: fixing the round robin would still leave the swap refused."""

        refusal = swap(played_knockout_fixtures=1, played_gruppenphase_fixtures=6)

        assert refusal is not None
        assert refusal.error_code == SWAP_KNOCKOUT_STARTED


class TestASpieltagNeverHoldsAClubTwice:
    """`REQ-SWAP-005`: the exchange may not leave a club standing in two matches of one Spieltag."""

    def test_a_swap_that_doubles_nobody_passes(self):
        assert swap(clashing_spieltage=0) is None

    def test_one_clashing_spieltag_is_enough(self):
        """The match write path refuses this wherever a team is fielded, and this endpoint writes fixtures without passing it."""

        refusal = swap(clashing_spieltage=1)

        assert refusal is not None
        assert refusal.error_code == SWAP_SPIELTAG_CLASH

    def test_the_refusal_says_how_many_spieltage_it_found(self):
        refusal = swap(clashing_spieltage=3)

        assert refusal is not None
        assert "3" in refusal.message

    @pytest.mark.parametrize(
        ("terminal", "code"),
        [
            ({"saison_status": "past"}, SWAP_SAISON_FINISHED),
            ({"played_knockout_fixtures": 1}, SWAP_KNOCKOUT_STARTED),
            ({"played_gruppenphase_fixtures": 1}, SWAP_GRUPPENPHASE_PLAYED),
        ],
    )
    def test_every_terminal_refusal_is_answered_first(self, terminal, code):
        """`REQ-SWAP-005` is the only repairable bound: naming it under a terminal one sends somebody to rearrange a schedule for nothing."""

        refusal = swap(clashing_spieltage=2, **terminal)

        assert refusal is not None
        assert refusal.error_code == code


# The shape `pull_many_from_db` hands the handler.
HOME, AWAY, OTHER = "home", "away", "other"


def fixture(team1, team2, datum: str | None = "2026-05-01"):
    return {"datum": datum, "team1": {"team_id": team1}, "team2": {"team_id": team2}}


class TestASwapNeverFieldsADisqualifiedClub:
    """`REQ-SWAP-006`: `_rewrite_gruppenphase_sides` writes fixtures without `patch_spiel_data`, so `REQ-ELIGIBILITY-001` has a back door."""

    def test_nothing_disqualified_counts_nothing(self):
        """The baseline: without it every count below could pass on a broken fixture list."""

        assert (
            fixtures_newly_fielding_a_departed_club(
                team1_id=HOME,
                team2_id=AWAY,
                departed_since={},
                gruppenphase_spiele=[fixture(HOME, OTHER), fixture(AWAY, OTHER)],
            )
            == 0
        )

    def test_a_fixture_after_the_disqualification_counts(self):
        assert (
            fixtures_newly_fielding_a_departed_club(
                team1_id=HOME,
                team2_id=AWAY,
                departed_since={HOME: "2026-04-01"},
                gruppenphase_spiele=[fixture(AWAY, OTHER, datum="2026-05-01")],
            )
            == 1
        )

    def test_a_fixture_before_the_disqualification_does_not(self):
        """Where enforcement stops: forwards only, or this is a blanket refusal."""

        assert (
            fixtures_newly_fielding_a_departed_club(
                team1_id=HOME,
                team2_id=AWAY,
                departed_since={HOME: "2026-04-01"},
                gruppenphase_spiele=[fixture(AWAY, OTHER, datum="2026-03-01")],
            )
            == 0
        )

    def test_the_effective_day_itself_counts(self):
        """Inclusive, matching `find_eligibility_refusal`'s on-or-after boundary."""

        assert (
            fixtures_newly_fielding_a_departed_club(
                team1_id=HOME,
                team2_id=AWAY,
                departed_since={HOME: "2026-04-01"},
                gruppenphase_spiele=[fixture(AWAY, OTHER, datum="2026-04-01")],
            )
            == 1
        )

    def test_an_undated_fixture_counts(self):
        """It can still be dated after the disqualification, and the swap is what puts the club there."""

        assert (
            fixtures_newly_fielding_a_departed_club(
                team1_id=HOME,
                team2_id=AWAY,
                departed_since={HOME: "2026-04-01"},
                gruppenphase_spiele=[fixture(AWAY, OTHER, datum=None)],
            )
            == 1
        )

    def test_a_club_staying_on_its_own_fixture_is_not_newly_fielded(self):
        """The swap moves HOME nowhere new; refusing would make a disqualified club unswappable for a reason the swap did not create."""

        assert (
            fixtures_newly_fielding_a_departed_club(
                team1_id=HOME,
                team2_id=AWAY,
                departed_since={HOME: "2026-04-01"},
                gruppenphase_spiele=[fixture(HOME, OTHER, datum="2026-05-01")],
            )
            == 0
        )

    def test_a_fixture_holding_neither_club_is_ignored(self):
        assert (
            fixtures_newly_fielding_a_departed_club(
                team1_id=HOME,
                team2_id=AWAY,
                departed_since={HOME: "2026-04-01"},
                gruppenphase_spiele=[fixture(OTHER, "fourth", datum="2026-05-01")],
            )
            == 0
        )

    def test_the_refusal_fires_and_names_the_repair(self):
        refusal = swap(departed_fixtures=2)

        assert refusal is not None
        assert refusal.error_code == SWAP_FIELDS_DISQUALIFIED
        # The two-step escape is what makes a guard with an override acceptable.
        assert "lift the austritt" in refusal.message

    def test_every_terminal_refusal_is_answered_first(self):
        """The more expensive repair of the two an admin can act on, so it is named last."""

        for terminal, expected in (
            ({"saison_status": "past"}, SWAP_SAISON_FINISHED),
            ({"played_knockout_fixtures": 1}, SWAP_KNOCKOUT_STARTED),
            ({"played_gruppenphase_fixtures": 1}, SWAP_GRUPPENPHASE_PLAYED),
            ({"clashing_spieltage": 1}, SWAP_SPIELTAG_CLASH),
        ):
            refusal = swap(departed_fixtures=1, **terminal)

            assert refusal is not None
            assert refusal.error_code == expected
