"""
The schedule a season's rules imply — pure arithmetic, so it fits the default tier's no-I/O boundary.

These are the numbers `spieltage.anzahl_spiele` reports (ADR-0065). The season the league is actually
playing is the fixture this file keeps returning to, because it is the one case where the answer is known
independently of the arithmetic: 4 groups of 4 play 3 group matchdays of 8 matches, then 4, 2 and 1.
"""

from typing import get_args

import pytest

from app.api.saisons.schedule import (
    expected_matches,
    group_matchdays,
    group_matches_per_matchday,
    knockout_phases_for,
    qualifier_count,
    schedule_for,
    total_group_matches,
)
from app.api.saisons.schemas import FLSaison, FLSaisonRules
from app.api.saisons.services import with_schedule
from app.api.spiele.schemas import KNOCKOUT_PHASES, MAX_QUALIFIERS, PHASE_ORDER, PHASE_RANK, FLSaisonPhase


def rules(*, groups: int = 4, per_group: int = 4, qualifiers: int = 2) -> FLSaisonRules:
    return FLSaisonRules.model_validate(
        {
            "win_points": 3,
            "draw_points": 1,
            "qualifiers_per_group": qualifiers,
            "number_of_groups": groups,
            "teams_per_group": per_group,
            "erlaubte_stufen": ["E1", "E2", "Q1", "Q2"],
        }
    )


class TestThePhaseSet:
    def test_the_rank_is_built_from_the_order(self):
        """One declaration, so a phase cannot be ranked and unordered or the reverse."""

        assert tuple(PHASE_RANK) == PHASE_ORDER
        assert list(PHASE_RANK.values()) == list(range(len(PHASE_ORDER)))

    def test_every_phase_of_the_literal_is_ordered(self):
        """A member added to the Literal and not to the order would sort and refuse unpredictably."""

        assert set(PHASE_ORDER) == set(get_args(FLSaisonPhase))

    def test_the_knockout_rounds_are_every_phase_but_the_group_phase(self):
        """The group phase is not a round: it has many matchdays and feeds the bracket rather than halving it."""

        assert KNOCKOUT_PHASES == PHASE_ORDER[1:]
        assert "gruppenphase" not in KNOCKOUT_PHASES

    def test_the_capacity_follows_from_the_phase_set(self):
        """
        The ceiling is what the phases can hold, never a number chosen by hand.

        This is the test that makes a further round one edit: adding `sechzehntelfinale` to the Literal and
        the order raises this to 32 and nothing else has to be found and changed.
        """

        assert MAX_QUALIFIERS == 2 ** len(KNOCKOUT_PHASES)
        assert MAX_QUALIFIERS == 16


class TestTheGroupPhase:
    @pytest.mark.parametrize(("teams", "expected"), [(2, 1), (4, 3), (6, 5), (8, 7)])
    def test_an_even_group_takes_one_round_fewer_than_it_has_teams(self, teams, expected):
        """Every team plays every round, so `n - 1` rounds give each of them their `n - 1` opponents."""

        assert group_matchdays(teams) == expected

    @pytest.mark.parametrize(("teams", "expected"), [(3, 3), (5, 5), (7, 7)])
    def test_an_odd_group_takes_as_many_rounds_as_it_has_teams(self, teams, expected):
        """
        The bye, and the reason this is not a division.

        With an odd n no round can pair everybody: one team sits out, so a round delivers `(n-1)/2` matches
        instead of `n/2` and the schedule needs one extra round to cover all `n-1` opponents each. Refusing
        an odd group was the alternative and the owner rejected it (2026-08-07): a group goes odd when a
        club withdraws after the draw, and blocking that blocks the season rather than the withdrawal.
        """

        assert group_matchdays(teams) == expected

    def test_a_group_of_one_or_none_has_no_matchdays(self):
        """A group that cannot produce a pair produces no matchday, rather than a negative count."""

        assert group_matchdays(1) == 0
        assert group_matchdays(0) == 0

    def test_all_groups_play_on_the_same_matchday(self):
        """Which is what makes the per-matchday count multiply by the number of groups."""

        assert group_matches_per_matchday(4, 4) == 8
        assert group_matches_per_matchday(2, 4) == 4

    def test_an_odd_group_leaves_one_team_out_of_each_matchday(self):
        """Three groups of five pair two apiece and rest one apiece."""

        assert group_matches_per_matchday(3, 5) == 6

    def test_the_total_is_the_round_robin_and_not_matchdays_times_matches(self):
        """
        The two agree for an even group and must not be assumed to for an odd one.

        Five teams: C(5,2) = 10 matches, but 5 matchdays x 2 matches = 10 as well — so take six teams to
        see it, where the schedule is 5 x 3 = 15 and C(6,2) = 15. The case that actually diverges is a group
        whose last round is short, which is why the total is stated from the combination rather than
        multiplied out.
        """

        assert total_group_matches(4, 4) == 24
        assert total_group_matches(1, 5) == 10
        assert total_group_matches(1, 6) == 15


class TestTheBracket:
    @pytest.mark.parametrize(
        ("qualifiers", "expected"),
        [
            (2, ("finale",)),
            (4, ("halbfinale", "finale")),
            (8, ("viertelfinale", "halbfinale", "finale")),
            (16, ("achtelfinale", "viertelfinale", "halbfinale", "finale")),
        ],
    )
    def test_the_rounds_are_read_from_the_END_of_the_phase_set(self, qualifiers, expected):
        """
        Eight qualifiers play quarter-final, semi-final, final — never the round of sixteen.

        Reading from the end is what lets a wider round be added without renaming a round anybody plays: a
        season of eight keeps exactly these three whatever is added above them.
        """

        assert knockout_phases_for(qualifiers) == expected

    @pytest.mark.parametrize("qualifiers", [3, 5, 6, 7, 12, 24])
    def test_a_field_that_is_not_a_power_of_two_has_no_bracket(self, qualifiers):
        """Each round halves, so anything else cannot resolve to one final. `find_rules_refusal` refuses it."""

        assert knockout_phases_for(qualifiers) == ()

    def test_a_field_larger_than_the_phase_set_has_no_bracket(self):
        """32 is a power of two and has no round to be played in until a fifth knockout phase exists."""

        assert knockout_phases_for(32) == ()

    @pytest.mark.parametrize("qualifiers", [0, 1])
    def test_a_field_too_small_to_play_has_no_bracket(self, qualifiers):
        """One qualifier is a champion by walkover, which is not a knockout round."""

        assert knockout_phases_for(qualifiers) == ()

    def test_the_qualifier_count_is_per_group_times_groups(self):
        assert qualifier_count(rules(groups=4, qualifiers=2)) == 8


class TestTheWholeSeason:
    def test_it_reproduces_the_season_the_league_is_playing(self):
        """
        The one case with an independent answer: 4 groups of 4, two qualifying from each.

        Read off `/admin/spieltage` on 2026-08-07 — three group matchdays of 8, then 4, 2 and 1. Every
        number below was entered by hand into `anzahl_spiele` and every one of them agrees with the rules,
        which is the evidence that the field was derivable all along (ADR-0065).
        """

        schedule = schedule_for(rules())

        assert [(entry.phase, entry.matchdays, entry.matches_per_matchday) for entry in schedule] == [
            ("gruppenphase", 3, 8),
            ("viertelfinale", 1, 4),
            ("halbfinale", 1, 2),
            ("finale", 1, 1),
        ]

    def test_a_knockout_round_holds_half_the_field_that_entered_it(self):
        """Sixteen qualifiers: 8, 4, 2, 1."""

        schedule = schedule_for(rules(groups=4, per_group=6, qualifiers=4))

        assert [(entry.phase, entry.matches_per_matchday) for entry in schedule] == [
            ("gruppenphase", 12),
            ("achtelfinale", 8),
            ("viertelfinale", 4),
            ("halbfinale", 2),
            ("finale", 1),
        ]

    def test_a_season_with_no_bracket_still_describes_its_group_phase(self):
        """
        Total rather than raising, because a season saved before the refusal existed is still readable.

        The write path refuses these rules now; this module is also read by the surfaces that describe a
        season somebody already has.
        """

        schedule = schedule_for(rules(groups=4, qualifiers=3))

        assert [entry.phase for entry in schedule] == ["gruppenphase"]

    def test_the_expected_count_answers_per_phase(self):
        """What the wire's `anzahl_spiele` is."""

        rounds = rules()

        assert expected_matches(rounds, "gruppenphase") == 8
        assert expected_matches(rounds, "viertelfinale") == 4
        assert expected_matches(rounds, "finale") == 1

    def test_a_phase_this_season_does_not_reach_expects_nothing(self):
        """
        Zero, and it is the honest answer rather than a gap.

        A season sending eight into the bracket plays no round of sixteen, so a matchday claiming to be one
        is a matchday in a phase the season does not run — and the admin list showing `0 / n` is exactly the
        report that says so.
        """

        assert expected_matches(rules(), "achtelfinale") == 0


class TestTheSeasonCarriesItsSchedule:
    """
    What puts the arithmetic above on the wire.

    Every season response goes through `with_schedule`, because the matchday editor refuses
    `REQ-SPIELTAG-002` in the browser by reading the counts off the season it already holds — so a path
    that skipped the injection would answer 500 rather than degrade.
    """

    def test_the_injected_schedule_is_the_derivation(self, saison):
        """The wire shape and `schedule_for` are the same numbers; nothing recomputes them differently."""

        injected = with_schedule(saison())["schedule"]

        assert [(entry["phase"], entry["matchdays"], entry["matches_per_matchday"]) for entry in injected] == [
            (entry.phase, entry.matchdays, entry.matches_per_matchday) for entry in schedule_for(rules())
        ]

    def test_the_model_accepts_what_the_helper_produces(self, saison):
        """The pair that matters: a raw document plus this helper validates, and a raw document alone does not."""

        assert FLSaison.model_validate(with_schedule(saison())).schedule[0].matches_per_matchday == 8

    def test_an_odd_group_keeps_the_bye_round(self, saison):
        """
        Five teams per group give five matchdays, not four.

        The case a hand-written TypeScript copy of this arithmetic would most plausibly get wrong: with an
        odd group no round pairs everybody, so the schedule needs an extra round to give each team its
        `n - 1` opponents. Serving the number is what keeps one answer to it.
        """

        odd = saison(rules={**saison()["rules"], "teams_per_group": 5})

        assert with_schedule(odd)["schedule"][0] == {"phase": "gruppenphase", "matchdays": 5, "matches_per_matchday": 8}

    def test_a_season_with_no_bracket_still_carries_its_group_phase(self, saison):
        """
        A rules set the editor refuses is still readable, because documents predate the refusal.

        `schedule_for` contributes no knockout phases rather than raising, so the season reads back with
        one entry and the matchday editor offers no knockout phase any fixture could fit.
        """

        no_bracket = saison(rules={**saison()["rules"], "qualifiers_per_group": 3})

        assert [entry["phase"] for entry in with_schedule(no_bracket)["schedule"]] == ["gruppenphase"]
