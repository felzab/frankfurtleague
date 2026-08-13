"""
SPIELTAGE · what a matchday write refuses

Pure functions, so all of it runs in the default tier. The retire and phase rules exist because a
matchday is a container whose contents it does not know about: `REQ-RETIRE-002` refuses retiring one
that holds a played match — the public Spielplan joins fixtures onto the matchdays it received, so
the results would go with the container — and `REQ-SPIELTAG-002` refuses a move into a phase
accounting for fewer matches than the matchday already holds (ADR-0052). `REQ-SPIELTAG-003` is the
create rule: a season whose knockout is under way takes no new matchday.

Asserted on the code, never the message: the code is the contract the form reads.
"""

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

# A phase holding one more live matchday than its rules imply, so `REQ-RETIRE-005` passes and the rule
# under test is the only thing that can refuse.
ABOVE_THE_FLOOR = {"live_in_phase": 4, "implied_in_phase": 3}

# A phase the season's rules do produce, so `REQ-SPIELTAG-004` passes and the window rule is what the
# create tests exercise.
A_PLAYED_PHASE = {"implied_in_phase": 3, "saison_phase": "gruppenphase"}


class TestRetiringAMatchday:
    def test_an_unplayed_matchday_retires_freely(self):
        """The matchday somebody created by mistake, which is what the control is mostly for."""

        assert find_spieltag_retire_refusal(played_count=0, **ABOVE_THE_FLOOR) is None

    @pytest.mark.parametrize("played", [1, 8])
    def test_a_matchday_holding_a_result_is_refused(self, played):
        """
        One result is enough, because the harm is not proportional to the count.

        What goes wrong is that a result the league produced stops appearing on the public Spielplan,
        and that happens at the first one.
        """

        refusal = find_spieltag_retire_refusal(played_count=played, **ABOVE_THE_FLOOR)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_HOLDS_PLAYED

    def test_the_refusal_names_the_count(self):
        """
        The count is the actionable part.

        It tells an admin how much sits behind the matchday they are about to hide, which is the
        difference between a mis-created row and a round that was played.
        """

        refusal = find_spieltag_retire_refusal(played_count=3, **ABOVE_THE_FLOOR)

        assert refusal is not None
        assert "3" in refusal[1]


class TestAPhaseKeepsTheMatchdaysItsRulesImply:
    """
    `REQ-RETIRE-005`. The derived count is a FLOOR, never a ceiling, and what crosses it is a STEP.

    Until this existed a season could be emptied of a phase it still had to play, one unplayed
    matchday at a time, with nothing refusing a single step. Two things it must NOT do. Cap the count:
    a round split across two dates is two matchday rows for one phase, which ADR-0051 ratified and
    composes `Viertelfinale (1)` / `Viertelfinale (2)` for. And refuse a phase that is already short,
    which is the state every season starts in and which no retirement produced. All three directions
    are asserted below, because a rule failing either of the last two passes every rejection test here.
    """

    def test_retiring_down_to_the_floor_is_allowed(self):
        """4 live against a floor of 3: the step lands exactly on the floor, so it is permitted."""

        assert find_spieltag_retire_refusal(played_count=0, live_in_phase=4, implied_in_phase=3) is None

    def test_retiring_below_the_floor_is_refused(self):
        """3 live against a floor of 3 — the boundary an off-by-one would put on the wrong side."""

        refusal = find_spieltag_retire_refusal(played_count=0, live_in_phase=3, implied_in_phase=3)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_BELOW_IMPLIED_COUNT

    def test_a_phase_already_below_the_floor_retires_freely(self):
        """
        1 live against a floor of 3 — a season part-way through setup, or one whose rules widened after.

        Refusing here would lock the row in place without restoring either of the two that are missing,
        and the state is reachable only by a create or a rules change. The emptying this rule exists to
        stop is refused at its first step, which `test_retiring_below_the_floor_is_refused` asserts.
        """

        assert find_spieltag_retire_refusal(played_count=0, live_in_phase=1, implied_in_phase=3) is None

    def test_a_split_round_stays_reducible_to_one(self):
        """
        The capability this rule must not take away (ADR-0051).

        A quarter-final split across two dates is 2 live rows against a floor of 1. Retiring one of
        them is a schedule being consolidated rather than a gap, so it passes; retiring the survivor
        does not.
        """

        assert find_spieltag_retire_refusal(played_count=0, live_in_phase=2, implied_in_phase=1) is None

        refusal = find_spieltag_retire_refusal(played_count=0, live_in_phase=1, implied_in_phase=1)
        assert refusal is not None
        assert refusal[0] == SPIELTAG_BELOW_IMPLIED_COUNT

    def test_a_phase_the_bracket_never_reaches_retires_freely(self):
        """Floor 0, so a row for a round nobody plays can always be cleaned up."""

        assert find_spieltag_retire_refusal(played_count=0, live_in_phase=1, implied_in_phase=0) is None

    def test_a_played_matchday_is_refused_before_the_floor_is_consulted(self):
        """Order matters: both apply here, and "enter or cancel the results" is the actionable advice."""

        # 3 against a floor of 3 rather than 1 against 3 — the floor arm has to actually fire, or this
        # asserts precedence over a branch that was never in the running.
        refusal = find_spieltag_retire_refusal(played_count=2, live_in_phase=3, implied_in_phase=3)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_HOLDS_PLAYED

    def test_the_refusal_names_both_numbers(self):
        refusal = find_spieltag_retire_refusal(played_count=0, live_in_phase=3, implied_in_phase=3)

        assert refusal is not None
        assert "3 live matchday(s)" in refusal[1]
        assert "imply 3" in refusal[1]


class TestAMatchdayBelongsToAPhaseTheSeasonPlays:
    """
    `REQ-SPIELTAG-004`. The one count question with an exact answer rather than a floor.

    A season sending eight teams into the bracket plays no round of sixteen, so `schedule_for` lists
    no `achtelfinale` for it — and a round nobody plays cannot be split across dates either, which is
    why refusing here contradicts nothing ADR-0051 ratified.
    """

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
        """
        The row this refusal exists for: an `achtelfinale` matchday whose `anzahl_spiele` reads 0.

        `app/api/saisons/schedule.py :: schedule_for` lists no `achtelfinale` for an eight-qualifier
        season, so `expected_matches` answers 0 and the matchday reports a round with no matches in it.
        """

        refusal = find_spieltag_create_refusal(
            implied_in_phase=0,
            saison_phase="achtelfinale",
            earliest_knockout_beginn=None,
            today=self.TODAY,
        )

        assert refusal is not None
        assert refusal[0] == SPIELTAG_PHASE_NOT_PLAYED
        assert "achtelfinale" in refusal[1]

    def test_it_is_judged_before_the_window(self):
        """
        A phase nobody plays is wrong whatever the calendar says.

        Both rules fire here, and naming the rules rather than a date is what an admin can act on:
        moving the bracket's start date would not make the round exist.
        """

        refusal = find_spieltag_create_refusal(
            implied_in_phase=0,
            saison_phase="achtelfinale",
            earliest_knockout_beginn="2026-06-12",
            today=self.TODAY,
        )

        assert refusal is not None
        assert refusal[0] == SPIELTAG_PHASE_NOT_PLAYED

    def test_the_implied_count_is_not_treated_as_a_quota(self):
        """
        The rule this one must not become (ADR-0051).

        Nothing is passed here about how many rows the phase already holds, and that is the design: a
        create is refused on WHICH phase and never on how many of that phase there are.
        """

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
    """
    `REQ-SPIELTAG-005` and `REQ-SPIELTAG-006` — the transition matrix (ADR-0075).

    ADR-0052 kept `saison_phase` editable because which matchday is the quarter-final is a scheduling
    decision, and correcting a mislabelled row is the ordinary case. It never asked whether EVERY
    transition should be reachable. Two are not: a move into a round the season's rules never produce,
    and a move that carries a matchday across the gruppenphase/knockout boundary away from the fixtures
    it holds.

    Both grade the STEP. The permits below matter as much as the refusals, because a rule reading the
    row's state instead would pass every rejection test here and still trap a row nothing can repair —
    the mistake `REQ-SPIELTAG-002` and `REQ-RETIRE-005` each had to have corrected out of them.
    """

    # A season whose bracket does reach the proposed round, so `REQ-SPIELTAG-005` passes and the boundary
    # rule is the only thing that can refuse.
    A_ROUND_THE_SEASON_PLAYS = {"implied_in_proposed": 1}

    def test_a_dates_only_patch_is_never_judged_on_the_phase(self):
        """
        The payload repeats the phase the matchday holds, which is what a dates-only edit looks like.

        Judged before either rule and with the worst numbers available — a round the rules do not
        produce, holding fixtures on the far side of the boundary — because a row in that state still has
        to be able to have its dates corrected.
        """

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
        """The hole this closes: `REQ-SPIELTAG-004` refuses creating that row and the patch produced one."""

        refusal = find_spieltag_unplayed_phase_refusal(stored_phase="viertelfinale", proposed_phase="achtelfinale", implied_in_proposed=0)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_MOVED_TO_UNPLAYED_PHASE
        assert "achtelfinale" in refusal[1]

    def test_a_move_out_of_an_unplayed_round_is_the_repair_and_is_allowed(self):
        """
        The direction that must stay open, and the reason the rule reads the PROPOSED phase alone.

        A row stranded in a round the bracket never reaches — created before the rules narrowed — is
        exactly the one an admin has to be able to move somewhere real.
        """

        assert find_spieltag_unplayed_phase_refusal(stored_phase="achtelfinale", proposed_phase="viertelfinale", implied_in_proposed=1) is None

    @pytest.mark.parametrize(("stored", "proposed"), [("viertelfinale", "gruppenphase"), ("gruppenphase", "viertelfinale")])
    def test_a_matchday_carrying_fixtures_may_not_cross_the_boundary(self, stored, proposed):
        """
        The reported case and its mirror, refused in both directions for one reason.

        `/dashboard/playoffs` selects its rounds by the MATCHDAY's phase and its fixtures by the
        FIXTURE's, and no endpoint writes `spiele.saison_phase` (ADR-0037) — so after this move the four
        fixtures sit on the far side of the join from their own matchday, with nothing able to bring
        them across.
        """

        refusal = find_spieltag_boundary_refusal(
            stored_phase=stored,
            proposed_phase=proposed,
            fixtures_on_stored_side=4,
            fixtures_on_proposed_side=0,
        )

        assert refusal is not None
        assert refusal[0] == SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY
        assert "4" in refusal[1]

    @pytest.mark.parametrize(("stored", "proposed"), [("viertelfinale", "gruppenphase"), ("gruppenphase", "halbfinale")])
    def test_an_empty_matchday_crosses_freely(self, stored, proposed):
        """
        The capability this rule must not take away (ADR-0052).

        A matchday created before its fixtures are drawn and given the wrong phase is the ordinary
        setup mistake, and correcting it is the scheduling decision ADR-0052 deliberately kept editable.
        Nothing is stranded, because there is nothing on the row to strand.
        """

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
        """
        The half that keeps the rule from reading the state instead of the step.

        A `gruppenphase` matchday holding four knockout fixtures is already broken — the bracket shows
        those fixtures under no round at all. Moving it to `viertelfinale` is what fixes that, so the
        rule has to let the move it would otherwise refuse through when it runs the other way.
        """

        assert (
            find_spieltag_boundary_refusal(
                stored_phase="gruppenphase",
                proposed_phase="viertelfinale",
                fixtures_on_stored_side=0,
                fixtures_on_proposed_side=4,
            )
            is None
        )

    def test_a_matchday_holding_both_kinds_is_left_alone_in_either_direction(self):
        """
        A row nothing can improve, so nothing is refused over it.

        With fixtures on both sides every move strands something, and refusing would freeze the row's
        phase permanently over a state no edit on this endpoint produced.
        """

        # Annotated rather than inferred: a bare tuple of `str` would widen past `FLSaisonPhase`, and
        # `[tool.pyright]` covers `tests`.
        both_ways: tuple[tuple[FLSaisonPhase, FLSaisonPhase], ...] = (
            ("gruppenphase", "viertelfinale"),
            ("viertelfinale", "gruppenphase"),
        )
        for stored, proposed in both_ways:
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
        """
        The cell ADR-0052's argument rests on, asserted so a later rule cannot quietly close it.

        Which matchday is the quarter-final is a scheduling decision, and a knockout matchday keeps its
        fixtures on the same side of the boundary whichever round it is called — so the count rule
        (`REQ-SPIELTAG-002`) is the only thing that has anything to say about this move.
        """

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
        """
        Eight group fixtures moved into a round the season never plays: both rules answer.

        Which of the two an admin is told is the ENDPOINT's ordering, asserted at
        `tests/api/test_spieltage_write_execution.py :: TestWhichPhaseChangesAreLegitimate`. What this
        pins is that the ordering has something to order — a rule that quietly stopped firing here would
        make that assertion pass while proving nothing.
        """

        unplayed = find_spieltag_unplayed_phase_refusal(stored_phase="gruppenphase", proposed_phase="achtelfinale", implied_in_proposed=0)
        boundary = find_spieltag_boundary_refusal(
            stored_phase="gruppenphase",
            proposed_phase="achtelfinale",
            fixtures_on_stored_side=8,
            fixtures_on_proposed_side=0,
        )

        assert unplayed is not None
        assert unplayed[0] == SPIELTAG_MOVED_TO_UNPLAYED_PHASE
        assert boundary is not None
        assert boundary[0] == SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY

    def test_the_two_codes_are_distinct(self):
        """Different advice — change the season's rules, against move the fixtures — so different codes."""

        assert SPIELTAG_MOVED_TO_UNPLAYED_PHASE != SPIELTAG_CROSSES_THE_BRACKET_BOUNDARY


class TestChangingThePhase:
    """
    `REQ-SPIELTAG-002`. What it refuses is the MOVE into a phase too small, never the state of one.

    A matchday can only be over its phase's count from data the API never wrote — no payload carries
    `spieltag_id` and `/spiele` has no POST (ADR-0037) — so a refusal on the state would cost that
    matchday its DATES as well, over a mismatch nothing on this endpoint can repair. Both directions are
    asserted below, because a rule reading the state alone passes every rejection test here.
    """

    def test_a_matchday_matching_its_phase_is_legal(self):
        assert find_spieltag_phase_refusal(attached_count=8, expected_count=8, expected_in_stored_phase=8) is None

    def test_a_matchday_still_being_filled_in_is_legal(self):
        """
        The direction that stays permitted, deliberately.

        A season being set up holds fewer fixtures than its rules imply at every point on the way to
        holding all of them (ADR-0052), so refusing here would refuse the setup rather than a mistake.
        """

        assert find_spieltag_phase_refusal(attached_count=0, expected_count=8, expected_in_stored_phase=8) is None
        assert find_spieltag_phase_refusal(attached_count=7, expected_count=8, expected_in_stored_phase=8) is None

    def test_one_fixture_too_many_is_refused(self):
        """A single round robin per group fixes the number exactly, so there is no slack to allow."""

        # Two fixtures out of a Halbfinale and into the Finale, which accounts for one.
        refusal = find_spieltag_phase_refusal(attached_count=2, expected_count=1, expected_in_stored_phase=2)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_OVER_ITS_PHASE

    def test_a_narrowing_the_fixtures_still_fit_is_legal(self):
        """The move is refused on the fixtures, not on the narrowing: one fixture fits a Finale."""

        assert find_spieltag_phase_refusal(attached_count=1, expected_count=1, expected_in_stored_phase=8) is None

    def test_a_phase_this_season_does_not_reach_accounts_for_nothing(self):
        """
        `expected_matches` answers 0 for a knockout round the bracket never gets to.

        The refusal then follows from the ordinary comparison rather than from a special case: those
        fixtures have nowhere to be played.
        """

        refusal = find_spieltag_phase_refusal(attached_count=2, expected_count=0, expected_in_stored_phase=1)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_OVER_ITS_PHASE

    def test_an_empty_matchday_in_an_unreached_phase_is_legal(self):
        """
        Both counts zero, which contradicts nothing.

        A season that plans a round of sixteen it will not reach has a matchday with no fixtures, and
        the admin list reporting `0 / 0` says exactly that.
        """

        assert find_spieltag_phase_refusal(attached_count=0, expected_count=0, expected_in_stored_phase=0) is None

    def test_a_matchday_already_over_its_phase_keeps_the_phase_it_has(self):
        """
        Nine group fixtures against a Gruppenphase of eight, with the payload repeating that phase.

        This is a dates-only edit — the two figures are the same phase's — and refusing it would leave
        the matchday's span uncorrectable while its nine fixtures stayed exactly where they are.
        """

        assert find_spieltag_phase_refusal(attached_count=9, expected_count=8, expected_in_stored_phase=8) is None

    def test_a_matchday_already_over_its_phase_may_not_move_to_a_smaller_one(self):
        """
        The half that keeps the case above from being a blanket excuse.

        A bad state is not a licence: those nine fixtures fit a Finale even less than they fit the
        Gruppenphase, so the step that makes the mismatch worse is refused from there too.
        """

        refusal = find_spieltag_phase_refusal(attached_count=9, expected_count=1, expected_in_stored_phase=8)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_OVER_ITS_PHASE

    def test_the_two_refusals_are_distinct(self):
        """Different advice — cancel or enter results, against move fixtures — so different codes."""

        assert SPIELTAG_HOLDS_PLAYED != SPIELTAG_OVER_ITS_PHASE


class TestCreatingAMatchday:
    """
    A season whose knockout phase is already under way takes no new matchdays (decided 2026-08-08).

    **"Under way" is a DATE, not a result** (decided 2026-08-08): the earliest non-group matchday of the
    season begins today or began earlier. That is deliberately a different question from the one
    `unplayed_spiel_nrs` and `REQ-RETIRE-002` ask -- those ask whether a MATCH has been played, and this
    asks whether the PHASE has begun. A bracket that kicked off this morning with nothing entered has
    begun; one drawn for next month has not, however complete it looks.

    The schedule is settled before the bracket runs: a group matchday created afterwards belongs to a phase
    nobody can still play, and the group table is by then being read as final.
    """

    TODAY = "2026-08-08"

    def test_a_season_with_no_knockout_matchday_permits_it(self):
        """A season still in its group phase, or one whose bracket is not drawn. Nothing has begun."""

        assert find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn=None, today=self.TODAY) is None

    def test_a_knockout_phase_still_in_the_future_permits_it(self):
        """
        The case the date reading keeps open, and the reason it is not a result check.

        A season with its whole bracket drawn for next month is still being prepared -- which is exactly
        when a matchday is most likely to be missing.
        """

        assert find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn="2026-09-01", today=self.TODAY) is None

    def test_today_counts_as_under_way(self):
        """
        The inclusive boundary, and the safer one.

        A bracket beginning this morning is under way, so a rule that waited until tomorrow would permit a
        matchday for a round already being played.
        """

        refusal = find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn=self.TODAY, today=self.TODAY)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_KNOCKOUT_STARTED

    def test_a_knockout_phase_in_the_past_is_refused(self):
        refusal = find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn="2026-06-12", today=self.TODAY)

        assert refusal is not None
        assert refusal[0] == SPIELTAG_KNOCKOUT_STARTED

    def test_the_refusal_names_both_dates(self):
        """Which date closed the window and what today is -- the comparison, stated so it can be checked."""

        refusal = find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn="2026-06-12", today=self.TODAY)

        assert refusal is not None
        assert "2026-06-12" in refusal[1]
        assert self.TODAY in refusal[1]

    def test_the_comparison_is_lexicographic_across_a_month_boundary(self):
        """
        `YYYY-MM-DD` sorts as a string, which is the property this whole service depends on.

        The one place a broken comparison would go unnoticed is one that happens to be right for a single
        month's data, so both directions are asserted across a month boundary.
        """

        assert find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn="2026-09-01", today="2026-08-31") is None
        assert find_spieltag_create_refusal(**A_PLAYED_PHASE, earliest_knockout_beginn="2026-08-31", today="2026-09-01") is not None
