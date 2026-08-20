import pytest

from app.api.spiele.schemas import FLSaisonPhase
from app.api.spieltage.services import (
    SPIELTAG_BELOW_IMPLIED_COUNT,
    SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY,
    SPIELTAG_HOLDS_PLAYED,
    SPIELTAG_KNOCKOUT_STARTED,
    SPIELTAG_MOVED_TO_UNPLAYED_PHASE,
    SPIELTAG_OVER_ITS_PHASE,
    SPIELTAG_PHASE_NOT_PLAYED,
    find_spieltag_boundary_refusal,
    find_spieltag_create_refusal,
    find_spieltag_phase_refusal,
    find_spieltag_retire_refusal,
    find_spieltag_unplayed_phase_refusal,
)

# One more live matchday than the rules imply, so `REQ-RETIRE-005` cannot be what refuses.
ABOVE_THE_FLOOR = {"live_in_phase": 4, "implied_in_phase": 3}

# A phase the rules produce, so `REQ-SPIELTAG-004` cannot be what refuses.
A_PLAYED_PHASE = {"implied_in_phase": 3, "saison_phase": "gruppenphase"}

# Annotated rather than inferred: a bare tuple of `str` would widen past `FLSaisonPhase`.
BOTH_WAYS_ACROSS_THE_BOUNDARY: tuple[tuple[FLSaisonPhase, FLSaisonPhase], ...] = (
    ("gruppenphase", "viertelfinale"),
    ("viertelfinale", "gruppenphase"),
)


class TestRetiringAMatchday:
    def test_an_unplayed_matchday_retires_freely(self):
        assert find_spieltag_retire_refusal(played_count=0, **ABOVE_THE_FLOOR) is None

    @pytest.mark.parametrize("played", [1, 8])
    def test_a_matchday_holding_a_result_is_refused(self, played):
        """One result is enough; the harm is a result dropping off the public Spielplan."""

        refusal = find_spieltag_retire_refusal(played_count=played, **ABOVE_THE_FLOOR)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_HOLDS_PLAYED

    def test_the_refusal_names_the_count(self):
        refusal = find_spieltag_retire_refusal(played_count=3, **ABOVE_THE_FLOOR)

        assert refusal is not None
        assert "3" in refusal.message


class TestAPhaseKeepsTheMatchdaysItsRulesImply:
    """`REQ-RETIRE-005`: the derived count is a floor, never a cap, and what crosses it is the step rather than the state."""

    def test_retiring_down_to_the_floor_is_allowed(self):
        assert find_spieltag_retire_refusal(played_count=0, live_in_phase=4, implied_in_phase=3) is None

    def test_retiring_below_the_floor_is_refused(self):
        refusal = find_spieltag_retire_refusal(played_count=0, live_in_phase=3, implied_in_phase=3)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_BELOW_IMPLIED_COUNT

    def test_a_phase_already_below_the_floor_retires_freely(self):
        """Refusing would lock the row in place without restoring the missing ones; the state comes of a create or a rules change."""

        assert find_spieltag_retire_refusal(played_count=0, live_in_phase=1, implied_in_phase=3) is None

    def test_a_split_round_stays_reducible_to_one(self):
        """A round split across two dates is two rows against a floor of one: consolidating is allowed, retiring the survivor is not."""

        assert find_spieltag_retire_refusal(played_count=0, live_in_phase=2, implied_in_phase=1) is None

        refusal = find_spieltag_retire_refusal(played_count=0, live_in_phase=1, implied_in_phase=1)
        assert refusal is not None
        assert refusal.error_code == SPIELTAG_BELOW_IMPLIED_COUNT

    def test_a_phase_the_bracket_never_reaches_retires_freely(self):
        assert find_spieltag_retire_refusal(played_count=0, live_in_phase=1, implied_in_phase=0) is None

    def test_a_played_matchday_is_refused_before_the_floor_is_consulted(self):
        """Precedence: entering or cancelling the results is the actionable advice."""

        # The floor arm must actually fire, or this asserts precedence over a branch never in the running.
        refusal = find_spieltag_retire_refusal(played_count=2, live_in_phase=3, implied_in_phase=3)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_HOLDS_PLAYED

    def test_the_refusal_names_both_numbers(self):
        refusal = find_spieltag_retire_refusal(played_count=0, live_in_phase=3, implied_in_phase=3)

        assert refusal is not None
        assert "3 live matchday(s)" in refusal.message
        assert "imply 3" in refusal.message


class TestAMatchdayBelongsToAPhaseTheSeasonPlays:
    """`REQ-SPIELTAG-004`: a round the bracket never reaches cannot be split across dates either, so refusing contradicts nothing."""

    TODAY = "2026-08-08"

    def test_a_phase_the_rules_produce_is_allowed(self):
        assert (
            find_spieltag_create_refusal(
                implied_in_phase=1,
                saison_phase="viertelfinale",
                earliest_knockout_beginn=None,
                today=self.TODAY,
            )
            is None
        )

    def test_a_phase_the_bracket_never_reaches_is_refused(self):
        refusal = find_spieltag_create_refusal(
            implied_in_phase=0,
            saison_phase="achtelfinale",
            earliest_knockout_beginn=None,
            today=self.TODAY,
        )

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_PHASE_NOT_PLAYED
        assert "achtelfinale" in refusal.message

    def test_it_is_judged_before_the_window(self):
        """Moving the bracket's start would not make the round exist."""

        refusal = find_spieltag_create_refusal(
            implied_in_phase=0,
            saison_phase="achtelfinale",
            earliest_knockout_beginn="2026-06-12",
            today=self.TODAY,
        )

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_PHASE_NOT_PLAYED

    def test_the_implied_count_is_not_treated_as_a_quota(self):
        for floor in (1, 3, 5):
            assert (
                find_spieltag_create_refusal(
                    implied_in_phase=floor,
                    saison_phase="gruppenphase",
                    earliest_knockout_beginn=None,
                    today=self.TODAY,
                )
                is None
            )


class TestWhichPhaseChangesAreLegitimate:
    """`REQ-SPIELTAG-005` and `-006` grade the step: a rule reading the state passes every rejection here and traps an unrepairable row."""

    # A round the season plays, so `REQ-SPIELTAG-005` cannot be what refuses.
    A_ROUND_THE_SEASON_PLAYS = {"implied_in_proposed": 1}

    def test_a_dates_only_patch_is_never_judged_on_the_phase(self):
        """Judged with the worst numbers available: a row in that state still has to have its dates correctable."""

        assert find_spieltag_unplayed_phase_refusal(stored_phase="achtelfinale", proposed_phase="achtelfinale", implied_in_proposed=0) is None
        assert (
            find_spieltag_boundary_refusal(
                stored_phase="gruppenphase",
                proposed_phase="gruppenphase",
                fixtures_on_stored_side=8,
                fixtures_on_proposed_side=0,
            )
            is None
        )

    def test_a_move_into_a_round_the_season_never_plays_is_refused(self):
        """The hole this closes: `REQ-SPIELTAG-004` refuses creating that row, and a patch could produce one."""

        refusal = find_spieltag_unplayed_phase_refusal(stored_phase="viertelfinale", proposed_phase="achtelfinale", implied_in_proposed=0)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_MOVED_TO_UNPLAYED_PHASE
        assert "achtelfinale" in refusal.message

    def test_a_move_out_of_an_unplayed_round_is_the_repair_and_is_allowed(self):
        """Why the rule reads the proposed phase alone: a stranded row has to be movable."""

        assert find_spieltag_unplayed_phase_refusal(stored_phase="achtelfinale", proposed_phase="viertelfinale", implied_in_proposed=1) is None

    @pytest.mark.parametrize(("stored", "proposed"), [("viertelfinale", "gruppenphase"), ("gruppenphase", "viertelfinale")])
    def test_a_matchday_carrying_fixtures_may_not_cross_the_boundary(self, stored, proposed):
        """No endpoint writes `spiele.saison_phase`, so fixtures selected by the matchday's phase would strand across the join."""

        refusal = find_spieltag_boundary_refusal(
            stored_phase=stored,
            proposed_phase=proposed,
            fixtures_on_stored_side=4,
            fixtures_on_proposed_side=0,
        )

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY
        assert "4" in refusal.message

    @pytest.mark.parametrize(("stored", "proposed"), [("viertelfinale", "gruppenphase"), ("gruppenphase", "halbfinale")])
    def test_an_empty_matchday_crosses_freely(self, stored, proposed):
        assert (
            find_spieltag_boundary_refusal(
                stored_phase=stored,
                proposed_phase=proposed,
                fixtures_on_stored_side=0,
                fixtures_on_proposed_side=0,
            )
            is None
        )

    def test_a_move_towards_the_fixtures_is_the_repair_and_is_allowed(self):
        """A matchday holding the other phase's fixtures is already broken, and moving it to them is the repair."""

        assert (
            find_spieltag_boundary_refusal(
                stored_phase="gruppenphase",
                proposed_phase="viertelfinale",
                fixtures_on_stored_side=0,
                fixtures_on_proposed_side=4,
            )
            is None
        )

    @pytest.mark.parametrize(("stored", "proposed"), BOTH_WAYS_ACROSS_THE_BOUNDARY)
    def test_a_matchday_holding_both_kinds_is_left_alone_in_either_direction(self, stored, proposed):
        """Every move strands something; refusing would freeze the phase over a state no edit here produced."""

        assert (
            find_spieltag_boundary_refusal(
                stored_phase=stored,
                proposed_phase=proposed,
                fixtures_on_stored_side=3,
                fixtures_on_proposed_side=2,
            )
            is None
        )

    def test_relabelling_one_knockout_round_as_another_stays_open(self):
        assert (
            find_spieltag_boundary_refusal(
                stored_phase="halbfinale",
                proposed_phase="viertelfinale",
                fixtures_on_stored_side=2,
                fixtures_on_proposed_side=2,
            )
            is None
        )

    def test_one_move_can_trip_both_rules(self):
        """Pins that the endpoint's ordering has something to order: a rule that quietly stopped firing would prove nothing."""

        unplayed = find_spieltag_unplayed_phase_refusal(stored_phase="gruppenphase", proposed_phase="achtelfinale", implied_in_proposed=0)
        boundary = find_spieltag_boundary_refusal(
            stored_phase="gruppenphase",
            proposed_phase="achtelfinale",
            fixtures_on_stored_side=8,
            fixtures_on_proposed_side=0,
        )

        assert unplayed is not None
        assert unplayed.error_code == SPIELTAG_MOVED_TO_UNPLAYED_PHASE
        assert boundary is not None
        assert boundary.error_code == SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY

    def test_the_two_codes_are_distinct(self):
        """Different advice — change the rules, against move the fixtures — so different codes."""

        assert SPIELTAG_MOVED_TO_UNPLAYED_PHASE != SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY


class TestChangingThePhase:
    """`REQ-SPIELTAG-002` refuses the move, never the state: judging the state would cost a row its dates over a mismatch it cannot repair."""

    def test_a_matchday_matching_its_phase_is_legal(self):
        assert find_spieltag_phase_refusal(attached_count=8, expected_count=8, expected_in_stored_phase=8) is None

    def test_a_matchday_still_being_filled_in_is_legal(self):
        """A season being set up holds fewer fixtures than its rules imply."""

        assert find_spieltag_phase_refusal(attached_count=0, expected_count=8, expected_in_stored_phase=8) is None
        assert find_spieltag_phase_refusal(attached_count=7, expected_count=8, expected_in_stored_phase=8) is None

    def test_one_fixture_too_many_is_refused(self):
        """A single round robin per group fixes the number exactly, so there is no slack to allow."""

        # Two fixtures out of a Halbfinale and into the Finale, which accounts for one.
        refusal = find_spieltag_phase_refusal(attached_count=2, expected_count=1, expected_in_stored_phase=2)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_OVER_ITS_PHASE

    def test_a_narrowing_the_fixtures_still_fit_is_legal(self):
        """The move is refused on the fixtures, not on the narrowing: one fixture fits a Finale."""

        assert find_spieltag_phase_refusal(attached_count=1, expected_count=1, expected_in_stored_phase=8) is None

    def test_a_phase_this_season_does_not_reach_accounts_for_nothing(self):
        """`expected_matches` answers 0 for an unreached round, so the refusal needs no special case."""

        refusal = find_spieltag_phase_refusal(attached_count=2, expected_count=0, expected_in_stored_phase=1)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_OVER_ITS_PHASE

    def test_an_empty_matchday_in_an_unreached_phase_is_legal(self):
        assert find_spieltag_phase_refusal(attached_count=0, expected_count=0, expected_in_stored_phase=0) is None

    def test_a_matchday_already_over_its_phase_keeps_the_phase_it_has(self):
        """A dates-only edit: refusing would leave the span uncorrectable."""

        assert find_spieltag_phase_refusal(attached_count=9, expected_count=8, expected_in_stored_phase=8) is None

    def test_a_matchday_already_over_its_phase_may_not_move_to_a_smaller_one(self):
        """A bad state is not a licence: the step that makes the mismatch worse is refused from there too."""

        refusal = find_spieltag_phase_refusal(attached_count=9, expected_count=1, expected_in_stored_phase=8)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_OVER_ITS_PHASE

    def test_the_two_refusals_are_distinct(self):
        """Different advice — cancel or enter results, against move fixtures — so different codes."""

        assert SPIELTAG_HOLDS_PLAYED != SPIELTAG_OVER_ITS_PHASE


class TestCreatingAMatchday:
    """Under way is a date, not a result: the earliest non-group matchday begins today or began earlier."""

    TODAY = "2026-08-08"

    def test_a_season_with_no_knockout_matchday_permits_it(self):
        assert find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn=None, today=self.TODAY) is None

    def test_a_knockout_phase_still_in_the_future_permits_it(self):
        assert find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn="2026-09-01", today=self.TODAY) is None

    def test_today_counts_as_under_way(self):
        """Inclusive is the safer boundary: waiting until tomorrow permits a matchday for a round already being played."""

        refusal = find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn=self.TODAY, today=self.TODAY)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_KNOCKOUT_STARTED

    def test_a_knockout_phase_in_the_past_is_refused(self):
        refusal = find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn="2026-06-12", today=self.TODAY)

        assert refusal is not None
        assert refusal.error_code == SPIELTAG_KNOCKOUT_STARTED

    def test_the_refusal_names_both_dates(self):
        refusal = find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn="2026-06-12", today=self.TODAY)

        assert refusal is not None
        assert "2026-06-12" in refusal.message
        assert self.TODAY in refusal.message

    def test_the_comparison_is_lexicographic_across_a_month_boundary(self):
        """`YYYY-MM-DD` sorts as a string; a broken comparison can still be right within one month, hence both directions."""

        assert find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn="2026-09-01", today="2026-08-31") is None
        assert find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn="2026-08-31", today="2026-09-01") is not None
