from typing import Mapping

import pytest

from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import (
    RULES_BRACKET_IMPOSSIBLE,
    RULES_CAPACITY_BELOW_USE,
    RULES_GROUPS_IN_USE,
    RULES_MATCHDAY_OVER_ITS_PHASE,
    RULES_QUALIFIERS_ABOVE_GROUP,
    RULES_QUALIFIERS_BELOW_WIRING,
    RULES_SAISON_FINISHED,
    find_rules_refusal,
)
from app.api.spiele.schemas import FLSaisonPhase
from app.api.teams.schemas import FLGruppenNames
from app.core.exceptions import WriteRefusal


def rules(*, groups: int = 4, per_group: int = 4, qualifiers: int = 2, win: int = 3, draw: int = 1) -> FLSaisonRules:
    return FLSaisonRules.model_validate(
        {
            "win_points": win,
            "draw_points": draw,
            "qualifiers_per_group": qualifiers,
            "number_of_groups": groups,
            "teams_per_group": per_group,
            "erlaubte_stufen": ["E1", "E2", "Q1", "Q2"],
        }
    )


def judge(
    *,
    status: str = "active",
    stored: FLSaisonRules | None = None,
    proposed: FLSaisonRules | None = None,
    occupancy: dict[FLGruppenNames, int] | None = None,
    platz: int = 0,
    attached: Mapping[FLSaisonPhase, int] | None = None,
) -> WriteRefusal | None:
    return find_rules_refusal(
        saison_status=status,
        stored=rules() if stored is None else stored,
        proposed=rules() if proposed is None else proposed,
        occupancy_by_gruppe=occupancy or {},
        highest_wired_platz=platz,
        attached_by_phase=attached,
    )


class TestTheBracketMustHaveAShape:
    def test_accepts_a_power_of_two_field(self):
        """4 groups x 2 qualifiers is 8: quarter-final, semi-final, final."""

        assert judge(proposed=rules(groups=4, qualifiers=2)) is None

    @pytest.mark.parametrize(("groups", "qualifiers"), [(4, 3), (3, 1), (2, 3), (4, 5)])
    def test_refuses_a_field_that_cannot_be_paired_down(self, groups, qualifiers):
        """`per_group=8` so every case reaches this rule: `REQ-RULES-007` runs first and would answer `(4, 5)`."""

        refusal = judge(proposed=rules(groups=groups, qualifiers=qualifiers, per_group=8))

        assert refusal is not None
        assert refusal.error_code == RULES_BRACKET_IMPOSSIBLE

    def test_refuses_a_field_larger_than_the_phase_set_can_hold(self):
        """The message names `MAX_QUALIFIERS` rather than a constant, so adding a phase moves the bound and the wording together."""

        refusal = judge(proposed=rules(groups=4, per_group=8, qualifiers=8))

        assert refusal is not None
        assert refusal.error_code == RULES_BRACKET_IMPOSSIBLE

    def test_permits_resubmitting_an_illegal_product_unchanged(self):
        """`rules` is required on the patch, so a season stored with 4 x 3 would otherwise be unpatchable, dates included."""

        illegal = rules(groups=4, qualifiers=3, per_group=8)

        assert judge(stored=illegal, proposed=illegal) is None

    def test_refuses_moving_from_one_illegal_product_to_another(self):
        """Legality is boolean, so the permission above reaches an identical product alone: 12 to 20 is still a step."""

        refusal = judge(stored=rules(groups=4, qualifiers=3, per_group=8), proposed=rules(groups=4, qualifiers=5, per_group=8))

        assert refusal is not None
        assert refusal.error_code == RULES_BRACKET_IMPOSSIBLE

    def test_applies_on_a_create_where_there_is_nothing_to_strand(self):
        """`stored=None` is the create: with no earlier product to match, an illegal one is always this step's doing."""

        refusal = find_rules_refusal(
            saison_status="future",
            stored=None,
            proposed=rules(groups=4, qualifiers=3),
            occupancy_by_gruppe={},
            highest_wired_platz=0,
        )

        assert refusal is not None
        assert refusal.error_code == RULES_BRACKET_IMPOSSIBLE

    def test_a_create_is_refused_by_nothing_else(self):
        assert (
            find_rules_refusal(
                saison_status="future",
                stored=None,
                proposed=rules(),
                occupancy_by_gruppe={},
                highest_wired_platz=0,
            )
            is None
        )


class TestNarrowingTheGroupCount:
    def test_refuses_dropping_a_group_that_still_holds_teams(self):
        """`REQ-ENTER-002` refuses entering a group the season does not offer; this closes the other direction."""

        refusal = judge(
            stored=rules(groups=4, qualifiers=2),
            proposed=rules(groups=2, qualifiers=4),
            occupancy={"A": 4, "B": 4, "C": 4, "D": 4},
        )

        assert refusal is not None
        assert refusal.error_code == RULES_GROUPS_IN_USE
        assert "C, D" in refusal.message

    def test_permits_dropping_a_group_nobody_is_in(self):
        """A season being set up narrows freely — the guard is about stranding, not about the number."""

        assert judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), occupancy={"A": 3, "B": 2}) is None

    def test_permits_widening(self):
        """Adding a group strands nothing. Only the narrowing direction is checked."""

        assert judge(stored=rules(groups=2, qualifiers=4), proposed=rules(groups=4, qualifiers=2), occupancy={"A": 4, "B": 4}) is None

    def test_a_disqualified_team_still_holds_its_place(self):
        """A team never leaves a season, so its place stays taken — the reading `REQ-ENTER-003` also applies."""

        # 4x2 and 2x4 are both 8 qualifiers, so the bracket rule passes and the narrowing is what is under test.
        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), occupancy={"D": 1})

        assert refusal is not None
        assert refusal.error_code == RULES_GROUPS_IN_USE


class TestNarrowingTheCapacity:
    def test_refuses_a_capacity_below_the_fullest_group(self):
        """Otherwise a group sits over a bound no entry was ever refused against."""

        refusal = judge(stored=rules(per_group=6), proposed=rules(per_group=4), occupancy={"A": 6, "B": 2})

        assert refusal is not None
        assert refusal.error_code == RULES_CAPACITY_BELOW_USE
        assert "6" in refusal.message

    def test_permits_a_capacity_that_still_fits(self):
        assert judge(stored=rules(per_group=6), proposed=rules(per_group=4), occupancy={"A": 4, "B": 2}) is None

    def test_permits_widening_the_capacity(self):
        assert judge(stored=rules(per_group=4), proposed=rules(per_group=6), occupancy={"A": 4}) is None


class TestNarrowingTheQualifiers:
    def test_refuses_a_count_below_a_placing_already_wired(self):
        """The resolution contains that state and reports it to whoever opens the triage list, not to whoever caused it."""

        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=4, qualifiers=1), platz=2)

        assert refusal is not None
        assert refusal.error_code == RULES_QUALIFIERS_BELOW_WIRING

    def test_permits_a_count_that_still_covers_the_wiring(self):
        assert judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=4, qualifiers=2), platz=2) is None

    def test_permits_narrowing_a_season_with_no_group_seeded_slot(self):
        """`highest_wired_platz=0` is a season whose bracket is not drawn yet."""

        assert judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=4, qualifiers=1), platz=0) is None

    def test_permits_resubmitting_a_count_already_below_the_wiring(self):
        """`rules` is required on the patch, and a dates-only edit is not the step that put the wiring above the count."""

        assert judge(stored=rules(groups=4, qualifiers=1), proposed=rules(groups=4, qualifiers=1), platz=2) is None

    def test_permits_raising_a_count_that_is_still_below_the_wiring(self):
        """Half a repair is still a repair, and refusing it would make the only way out one jump to the wired placing."""

        assert judge(stored=rules(groups=4, qualifiers=1), proposed=rules(groups=4, qualifiers=2), platz=3) is None


class TestAFinishedSeasonFreezes:
    @pytest.mark.parametrize(
        ("field", "changed"),
        [("win_points", {"win": 2}), ("draw_points", {"draw": 0}), ("qualifiers_per_group", {"qualifiers": 1})],
    )
    def test_refuses_a_change_to_any_of_the_three_frozen_fields(self, field, changed):
        """The league table is derived, so editing a finished season's points rewrites who won it on the next read."""

        refusal = judge(status="past", stored=rules(), proposed=rules(**changed))

        assert refusal is not None
        assert refusal.error_code == RULES_SAISON_FINISHED
        assert field in refusal.message

    @pytest.mark.parametrize("status", ["active", "future"])
    def test_permits_the_same_change_on_a_season_that_is_not_over(self, status):
        assert judge(status=status, stored=rules(), proposed=rules(win=2)) is None

    def test_permits_an_unchanged_rules_object_on_a_past_season(self):
        """The payload carries the whole `rules` object, so a date-only edit resubmits identical rules and the freeze compares values."""

        assert judge(status="past", stored=rules(), proposed=rules()) is None

    def test_permits_narrowing_erlaubte_stufen_on_a_past_season(self):
        """It bounds what a form offers, never what a stored squad row holds."""

        narrowed = FLSaisonRules.model_validate({**rules().model_dump(), "erlaubte_stufen": ["Q1"]})

        assert judge(status="past", stored=rules(), proposed=narrowed) is None

    def test_the_freeze_is_reported_before_a_narrowing(self):
        """Otherwise: told a group count strands a team, fixing it, then told the season is closed anyway."""

        refusal = judge(
            status="past",
            stored=rules(groups=4, qualifiers=2),
            proposed=rules(groups=2, qualifiers=1),
            occupancy={"C": 4, "D": 4},
        )

        assert refusal is not None
        assert refusal.error_code == RULES_SAISON_FINISHED


class TestNarrowingBelowAMatchdaysFixtures:
    """A matchday's expected count derives from these rules; the input is the largest count one matchday holds."""

    def test_the_rules_the_season_already_plays_are_accepted(self):
        """4 groups of 4 gives 8 group matches a matchday."""

        assert judge(stored=rules(), proposed=rules(), attached={"gruppenphase": 8}) is None

    def test_narrowing_the_group_count_below_an_existing_matchday_is_refused(self):
        """Nothing else refuses it: the groups are empty for `REQ-RULES-002`, and 2 x 4 is a legal bracket for `REQ-RULES-001`."""

        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), attached={"gruppenphase": 8})

        assert refusal is not None
        assert refusal.error_code == RULES_MATCHDAY_OVER_ITS_PHASE

    def test_shortening_the_ladder_strands_a_knockout_matchday(self):
        """4 groups by 1 qualifier leaves a Viertelfinale matchday in a phase expecting 0, which is why every phase is checked."""

        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=4, qualifiers=1), attached={"viertelfinale": 4})

        assert refusal is not None
        assert refusal.error_code == RULES_MATCHDAY_OVER_ITS_PHASE

    def test_widening_is_always_accepted(self):
        """More matches expected than are attached is a season still being set up, which is legal."""

        assert judge(stored=rules(groups=2, qualifiers=4), proposed=rules(groups=4, qualifiers=2), attached={"gruppenphase": 4}) is None

    def test_a_season_with_no_matchdays_yet_is_unaffected(self):
        """An empty mapping, which is also what a create passes."""

        assert judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), attached={}) is None

    def test_permits_resubmitting_rules_a_matchday_already_overruns(self):
        """A matchday over its count got there by fixtures added, never by rules a dates-only edit resubmits unchanged."""

        assert judge(stored=rules(groups=2, qualifiers=4), proposed=rules(groups=2, qualifiers=4), attached={"gruppenphase": 8}) is None

    def test_the_refusal_names_the_phase_and_both_counts(self):
        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), attached={"gruppenphase": 8})

        assert refusal is not None
        assert "gruppenphase" in refusal.message
        assert "8" in refusal.message
        assert "4" in refusal.message

    def test_a_stranding_narrowing_is_reported_before_this_one(self):
        """`REQ-RULES-002` names a group and its teams; this rule names an arithmetic consequence of the same edit."""

        refusal = judge(
            stored=rules(groups=4, qualifiers=2),
            proposed=rules(groups=2, qualifiers=4),
            occupancy={"C": 4},
            attached={"gruppenphase": 8},
        )

        assert refusal is not None
        assert refusal.error_code == RULES_GROUPS_IN_USE


class TestAGroupCannotQualifyMoreThanItHolds:
    """More qualifiers than teams asks each group for a placing no standing will ever hold; a browser warning alone lets the save through."""

    def test_equal_is_legal(self):
        """A group where every team advances. Unusual, not incoherent."""

        assert judge(stored=rules(qualifiers=4, per_group=4), proposed=rules(qualifiers=4, per_group=4)) is None

    def test_fewer_qualifiers_than_teams_is_legal(self):
        assert judge(proposed=rules(qualifiers=2, per_group=4)) is None

    def test_more_qualifiers_than_teams_is_refused(self):
        refusal = judge(proposed=rules(qualifiers=8, per_group=4))

        assert refusal is not None
        assert refusal.error_code == RULES_QUALIFIERS_ABOVE_GROUP

    def test_permits_resubmitting_an_existing_excess_unchanged(self):
        """`rules` is required on the patch, so a stored excess comes back with a dates-only edit and must not refuse it."""

        excessive = rules(groups=2, qualifiers=8, per_group=4)

        assert judge(stored=excessive, proposed=excessive) is None

    def test_permits_reducing_an_excess_that_still_violates(self):
        """The badness is the excess, so a step towards legality is a repair even where it does not arrive."""

        assert judge(stored=rules(groups=2, qualifiers=8, per_group=2), proposed=rules(groups=2, qualifiers=4, per_group=2)) is None

    def test_refuses_widening_an_excess_that_already_exists(self):
        """Worsening one is as much a step as introducing it, which is what stops the permission above covering both."""

        refusal = judge(stored=rules(groups=2, qualifiers=4, per_group=2), proposed=rules(groups=2, qualifiers=8, per_group=2))

        assert refusal is not None
        assert refusal.error_code == RULES_QUALIFIERS_ABOVE_GROUP

    def test_it_applies_on_a_create(self):
        refusal = find_rules_refusal(
            saison_status="future",
            stored=None,
            proposed=rules(qualifiers=8, per_group=4),
            occupancy_by_gruppe={},
            highest_wired_platz=0,
        )

        assert refusal is not None
        assert refusal.error_code == RULES_QUALIFIERS_ABOVE_GROUP

    def test_it_is_reported_before_the_bracket_rule(self):
        """This one names two fields the admin typed; the bracket rule's answer is a property of their product."""

        refusal = judge(proposed=rules(groups=4, qualifiers=5, per_group=4))

        assert refusal is not None
        assert refusal.error_code == RULES_QUALIFIERS_ABOVE_GROUP

    def test_the_refusal_names_both_numbers(self):
        refusal = judge(proposed=rules(qualifiers=8, per_group=4))

        assert refusal is not None
        assert "8" in refusal.message
        assert "4" in refusal.message
