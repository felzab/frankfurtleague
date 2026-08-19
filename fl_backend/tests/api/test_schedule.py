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
        """The group phase feeds the bracket rather than halving it."""

        assert KNOCKOUT_PHASES == PHASE_ORDER[1:]
        assert "gruppenphase" not in KNOCKOUT_PHASES

    def test_the_capacity_follows_from_the_phase_set(self):
        """The ceiling is what the phases can hold: adding a wider round raises it and nothing else changes."""

        assert MAX_QUALIFIERS == 2 ** len(KNOCKOUT_PHASES)
        assert MAX_QUALIFIERS == 16


class TestTheGroupPhase:
    @pytest.mark.parametrize(("teams", "expected"), [(2, 1), (4, 3), (6, 5), (8, 7)])
    def test_an_even_group_takes_one_round_fewer_than_it_has_teams(self, teams, expected):
        """Every team plays every round, so `n - 1` rounds give each of them their `n - 1` opponents."""

        assert group_matchdays(teams) == expected

    @pytest.mark.parametrize(("teams", "expected"), [(3, 3), (5, 5), (7, 7)])
    def test_an_odd_group_takes_as_many_rounds_as_it_has_teams(self, teams, expected):
        """The bye: with an odd n one team sits out each round, so the schedule needs an extra one."""

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

    def test_the_total_agrees_with_the_schedule_at_every_group_size(self):
        """An odd group's extra round offsets its smaller rounds exactly, so the bye never reaches the product."""

        assert total_group_matches(4, 4) == 24
        assert total_group_matches(1, 5) == 10
        assert total_group_matches(1, 6) == 15

        # The equality is what lets the schedule report a per-matchday figure at all.
        for teams in range(1, 13):
            assert total_group_matches(3, teams) == 3 * group_matchdays(teams) * group_matches_per_matchday(1, teams)


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
        """Reading from the end lets a wider round be added without renaming a round anybody plays."""

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
        """The one case with an independent answer: every number below is one the league's own matchdays carry by hand."""

        schedule = schedule_for(rules())

        assert [(entry.phase, entry.matchdays, entry.matches_per_matchday) for entry in schedule] == [
            ("gruppenphase", 3, 8),
            ("viertelfinale", 1, 4),
            ("halbfinale", 1, 2),
            ("finale", 1, 1),
        ]

    def test_a_knockout_round_holds_half_the_field_that_entered_it(self):
        schedule = schedule_for(rules(groups=4, per_group=6, qualifiers=4))

        assert [(entry.phase, entry.matches_per_matchday) for entry in schedule] == [
            ("gruppenphase", 12),
            ("achtelfinale", 8),
            ("viertelfinale", 4),
            ("halbfinale", 2),
            ("finale", 1),
        ]

    def test_a_season_with_no_bracket_still_describes_its_group_phase(self):
        """Total rather than raising: the write path refuses these rules, but a season saved before it is still readable."""

        schedule = schedule_for(rules(groups=4, qualifiers=3))

        assert [entry.phase for entry in schedule] == ["gruppenphase"]

    def test_the_expected_count_answers_per_phase(self):
        """What the wire's `anzahl_spiele` is."""

        rounds = rules()

        assert expected_matches(rounds, "gruppenphase") == 8
        assert expected_matches(rounds, "viertelfinale") == 4
        assert expected_matches(rounds, "finale") == 1

    def test_a_phase_this_season_does_not_reach_expects_nothing(self):
        """Zero is the honest answer, not an error."""

        assert expected_matches(rules(), "achtelfinale") == 0


class TestTheSeasonCarriesItsSchedule:
    """The matchday editor reads `REQ-SPIELTAG-002`'s counts off the season it holds, so a path skipping the injection answers 500."""

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
        """The case a hand-written TypeScript copy would most plausibly get wrong; serving the number keeps one answer."""

        odd = saison(rules={**saison()["rules"], "teams_per_group": 5})

        assert with_schedule(odd)["schedule"][0] == {"phase": "gruppenphase", "matchdays": 5, "matches_per_matchday": 8}

    def test_a_season_with_no_bracket_still_carries_its_group_phase(self, saison):
        """No knockout phase rather than raising, so a season the editor refuses still reads back."""

        no_bracket = saison(rules={**saison()["rules"], "qualifiers_per_group": 3})

        assert [entry["phase"] for entry in with_schedule(no_bracket)["schedule"]] == ["gruppenphase"]
