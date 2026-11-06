from typing import get_args

import pytest

from app.api.saisons.schedule import (
    expected_matches,
    group_matchdays,
    group_matches_per_matchday,
    knockout_phases_for,
    schedule_for,
    total_group_matches,
)
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_rules_refusal, total_season_spiele, with_schedule
from app.api.spiele.schemas import KNOCKOUT_PHASES, MAX_QUALIFIERS, PHASE_ORDER
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from app.shared.schemas.literals import FLSaisonPhase
from tests.documents import rules_document


def rules(*, groups: int = 4, per_group: int = 4, qualifiers: int = 2) -> FLSaisonRules:
    return FLSaisonRules.model_validate(
        rules_document(
            qualifiers_per_gruppe=qualifiers, number_of_gruppen=groups, teams_per_gruppe=per_group, allowed_stufen=["E1", "E2", "Q1", "Q2"]
        )
    )


def ceiling(field: str) -> int:
    """The `le` a rules field states, read off the model so widening one moves the test below rather than leaving it under the old bound."""

    return next(constraint.le for constraint in FLSaisonRules.model_fields[field].metadata if hasattr(constraint, "le"))


def widest_legal_rules() -> FLSaisonRules:
    """The largest season the bounds admit: every ceiling at once, and the largest field the bracket holds."""

    groups = ceiling("number_of_gruppen")

    return rules(groups=groups, per_group=ceiling("teams_per_gruppe"), qualifiers=MAX_QUALIFIERS // groups)


def refusal_for(shape: FLSaisonRules) -> WriteRefusal | None:
    """A create's reading of one shape, which is also the draw's: `stored=None`, nothing entered, no bracket slot wired."""

    return find_rules_refusal(stored=None, proposed=shape, occupancy_by_gruppe={}, highest_wired_platz=0)


class TestThePhaseSet:
    def test_every_phase_of_the_literal_is_ordered(self):
        """A member added to the Literal and not to the order would sort and refuse unpredictably."""

        assert set(PHASE_ORDER) == set(get_args(FLSaisonPhase.__value__))

    def test_the_capacity_follows_from_the_phase_set(self):
        """The ceiling is what the phases can hold: adding a wider round raises it and nothing else changes."""

        assert MAX_QUALIFIERS == 2 ** len(KNOCKOUT_PHASES)


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

    @pytest.mark.parametrize("qualifiers", [0, 1, 2])
    def test_a_field_too_small_to_play_has_no_bracket(self, qualifiers):
        """Below the semi-finals there is no match for third place, and the podium needs four places."""

        assert knockout_phases_for(qualifiers) == ()


class TestTheMatchForThirdPlace:
    @pytest.mark.parametrize(("groups", "qualifiers", "finale"), [(2, 2, 2), (4, 2, 2), (4, 4, 2)])
    def test_the_finale_matchday_counts_it_beside_the_final(self, groups: int, qualifiers: int, finale: int):
        """Every other round keeps half the field that entered it."""

        assert expected_matches(rules(groups=groups, per_group=4, qualifiers=qualifiers), "finale") == finale

    @pytest.mark.parametrize(("groups", "qualifiers", "bracket"), [(2, 2, 4), (4, 2, 8), (4, 4, 16)])
    def test_the_season_total_counts_it(self, groups: int, qualifiers: int, bracket: int):
        """`bracket` is the knockout's matches by hand: `qualifiers - 1` played out, plus one for third place."""

        shape = rules(groups=groups, per_group=4, qualifiers=qualifiers)

        assert total_season_spiele(shape) == total_group_matches(groups, 4) + bracket


class TestTheWholeSeason:
    def test_it_reproduces_the_season_the_league_is_playing(self):
        """The one case with an independent answer: every number below is one the league's own matchdays carry by hand."""

        schedule = schedule_for(rules())

        assert [(entry.phase, entry.spieltage, entry.matches_per_spieltag) for entry in schedule] == [
            ("gruppenphase", 3, 8),
            ("viertelfinale", 1, 4),
            ("halbfinale", 1, 2),
            ("finale", 1, 2),
        ]

    def test_a_knockout_round_holds_half_the_field_that_entered_it(self):
        """The Finale's matchday holds the final and the match for third place."""

        schedule = schedule_for(rules(groups=4, per_group=6, qualifiers=4))

        assert [(entry.phase, entry.matches_per_spieltag) for entry in schedule] == [
            ("gruppenphase", 12),
            ("achtelfinale", 8),
            ("viertelfinale", 4),
            ("halbfinale", 2),
            ("finale", 2),
        ]

    def test_the_expected_count_answers_per_phase(self):
        """What the wire's `count_spiele` is."""

        rounds = rules()

        assert expected_matches(rounds, "gruppenphase") == 8
        assert expected_matches(rounds, "viertelfinale") == 4
        assert expected_matches(rounds, "finale") == 2


class TestTheLargestLegalSeasonFitsInOneRead:
    """Why `rules_spiele_over_one_read` refuses a shape the field bounds each accept.

    Past `LIST_LIMIT_DEFAULT` a season-scoped read is truncated, and every refusal `find_rules_refusal` computes over one would then be
    judging a partial season.
    """

    def test_the_widest_shape_the_field_bounds_admit_is_refused(self):
        """The bounds are per field and this fault is a product of three, so nothing narrower than the whole shape can see it."""

        refusal = refusal_for(widest_legal_rules())

        assert refusal is not None
        assert refusal.error_code == Code.RULES_SPIELE_OVER_ONE_READ

    def test_no_shape_the_rules_accept_plays_past_one_page(self):
        """Swept rather than argued: the count is quadratic in one bound and linear in another, so a widened bound fails here."""

        accepted = 0
        for groups in range(1, ceiling("number_of_gruppen") + 1):
            for per_group in range(2, ceiling("teams_per_gruppe") + 1):
                # `rules_qualifiers_above_gruppe` refuses every qualifier count over the group's size, so the sweep
                # stops there rather than at a bound `qualifiers_per_gruppe` does not carry.
                for qualifiers in range(1, per_group + 1):
                    shape = rules(groups=groups, per_group=per_group, qualifiers=qualifiers)
                    if refusal_for(shape) is None:
                        accepted += 1
                        assert total_season_spiele(shape) <= LIST_LIMIT_DEFAULT

        # A sweep refusing everything would satisfy the assertion above without proving anything.
        assert accepted > 0


class TestTheSeasonCarriesItsSchedule:
    """A matchday's `count_spiele` is read off the season it holds, so a path skipping the injection answers 500."""

    def test_the_injected_schedule_is_the_derivation(self, saison):
        """The wire shape and `schedule_for` are the same numbers; nothing recomputes them differently."""

        injected = with_schedule(saison())["schedule"]

        assert [(entry["phase"], entry["spieltage"], entry["matches_per_spieltag"]) for entry in injected] == [
            (entry.phase, entry.spieltage, entry.matches_per_spieltag) for entry in schedule_for(rules())
        ]

    def test_an_odd_group_keeps_the_bye_round(self, saison):
        """The case a hand-written TypeScript copy would most plausibly get wrong; serving the number keeps one answer."""

        odd = saison(rules={**saison()["rules"], "teams_per_gruppe": 5})

        assert with_schedule(odd)["schedule"][0] == {"phase": "gruppenphase", "spieltage": 5, "matches_per_spieltag": 8}
