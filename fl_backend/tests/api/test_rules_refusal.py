"""
SAISONS · what a season's rules edit refuses

`find_rules_refusal`, pure and therefore default tier. Seven rules in three kinds: four are
narrowings that would strand data entered legally under the wider value; two are properties of
the proposed rules alone; and one is the freeze on a finished season, where nothing is stranded
and the result would be rewritten instead.

The order the checks run in is asserted too, because it is the order an admin can act on:
telling somebody their group count strands a team is noise when the edit is refused for being on
a past season.
"""

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
    occupancy: dict[str, int] | None = None,
    platz: int = 0,
    attached: dict[str, int] | None = None,
) -> WriteRefusal | None:
    return find_rules_refusal(
        saison_status=status,
        stored=rules() if stored is None else stored,
        proposed=rules() if proposed is None else proposed,
        occupancy_by_gruppe=occupancy or {},  # type: ignore[arg-type]
        highest_wired_platz=platz,
        attached_by_phase=attached,  # type: ignore[arg-type]
    )


class TestTheBracketMustHaveAShape:
    def test_accepts_a_power_of_two_field(self):
        """4 groups x 2 qualifiers is 8: quarter-final, semi-final, final."""

        assert judge(proposed=rules(groups=4, qualifiers=2)) is None

    @pytest.mark.parametrize(("groups", "qualifiers"), [(4, 3), (3, 1), (2, 3), (4, 5)])
    def test_refuses_a_field_that_cannot_be_paired_down(self, groups, qualifiers):
        """
        Each round halves, so twelve qualifiers cannot be paired down to one final.

        `per_group=8` so every case reaches this rule: `REQ-RULES-007` runs first and would answer the
        `(4, 5)` case instead, because five qualifiers out of a group of four is the narrower fault.
        """

        refusal = judge(proposed=rules(groups=groups, qualifiers=qualifiers, per_group=8))

        assert refusal is not None
        assert refusal.error_code == RULES_BRACKET_IMPOSSIBLE

    def test_refuses_a_field_larger_than_the_phase_set_can_hold(self):
        """
        32 is a power of two and still has nowhere to play until a fifth knockout phase exists.

        The message names `MAX_QUALIFIERS` rather than a hardcoded 16, so adding a phase changes the bound
        and the wording together (ADR-0052).
        """

        refusal = judge(proposed=rules(groups=4, per_group=8, qualifiers=8))

        assert refusal is not None
        assert refusal.error_code == RULES_BRACKET_IMPOSSIBLE

    def test_applies_on_a_create_where_there_is_nothing_to_strand(self):
        """`stored=None` is the create. The bracket rule is a property of the proposed rules alone."""

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
        """Nothing exists yet to strand, and nothing is frozen, so a legal bracket is the whole test."""

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
        """
        The state this rule exists for: four teams sitting in a group the season no longer runs.

        `REQ-ENTER-002` refuses ENTERING a group the season does not offer, so without this rule the same
        incoherence is unreachable from one direction and wide open from the other.
        """

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
        """
        The caller counts every junction row including disqualified ones, and this pins that reading.

        A team never leaves a season (ADR-0026), so its place stays taken — the same rule `REQ-ENTER-003`
        applies when refusing an entry into a full group.
        """

        # 4x2 and 2x4 are both 8 qualifiers, so the bracket rule passes and the narrowing is what is
        # under test. A combination like 3x2 would be refused for having no bracket at all first.
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
        """
        A slot naming `2. der Gruppe A` in a season that now qualifies one per group.

        The resolution CONTAINS that state and reports it as a bracket fault (ADR-0039) rather than
        emptying the slot — but it reports it to whoever opens the triage list, not to whoever caused it.
        """

        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=4, qualifiers=1), platz=2)

        assert refusal is not None
        assert refusal.error_code == RULES_QUALIFIERS_BELOW_WIRING

    def test_permits_a_count_that_still_covers_the_wiring(self):
        assert judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=4, qualifiers=2), platz=2) is None

    def test_permits_narrowing_a_season_with_no_group_seeded_slot(self):
        """`highest_wired_platz=0` is a season whose bracket is not drawn yet."""

        assert judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=4, qualifiers=1), platz=0) is None


class TestAFinishedSeasonFreezes:
    @pytest.mark.parametrize(
        ("field", "changed"),
        [("win_points", {"win": 2}), ("draw_points", {"draw": 0}), ("qualifiers_per_group", {"qualifiers": 1})],
    )
    def test_refuses_a_change_to_any_of_the_three_frozen_fields(self, field, changed):
        """
        The reason is that the league table is DERIVED (ADR-0019).

        Editing the points of a finished season rewrites who won it, on the next read, with nothing
        anywhere recording what it said before.
        """

        refusal = judge(status="past", stored=rules(), proposed=rules(**changed))

        assert refusal is not None
        assert refusal.error_code == RULES_SAISON_FINISHED
        assert field in refusal.message

    @pytest.mark.parametrize("status", ["active", "future"])
    def test_permits_the_same_change_on_a_season_that_is_not_over(self, status):
        """A running season's points are still a decision somebody is entitled to change."""

        assert judge(status=status, stored=rules(), proposed=rules(win=2)) is None

    def test_permits_an_unchanged_rules_object_on_a_past_season(self):
        """
        Which is what lets the DATES of a finished season be corrected.

        The payload carries the whole `rules` object, so a date-only edit resubmits identical rules — and
        the freeze compares values rather than refusing the endpoint outright, precisely so that repair
        stays possible (decided 2026-08-07).
        """

        assert judge(status="past", stored=rules(), proposed=rules()) is None

    def test_permits_narrowing_erlaubte_stufen_on_a_past_season(self):
        """
        Not frozen, because it bounds what a FORM offers and never what a stored squad row holds.

        A row's level is held to the league's own closed set (ADR-0048), so narrowing a finished season
        cannot retroactively invalidate the squads it was played with.
        """

        narrowed = FLSaisonRules.model_validate({**rules().model_dump(), "erlaubte_stufen": ["Q1"]})

        assert judge(status="past", stored=rules(), proposed=narrowed) is None

    def test_the_freeze_is_reported_before_a_narrowing(self):
        """
        Both apply; the frozen answer is the one the admin can act on.

        Order matters because the alternative reads as a puzzle: being told a group count strands a team,
        fixing that, and then being told the season is closed anyway.
        """

        refusal = judge(
            status="past",
            stored=rules(groups=4, qualifiers=2),
            proposed=rules(groups=2, qualifiers=1),
            occupancy={"C": 4, "D": 4},
        )

        assert refusal is not None
        assert refusal.error_code == RULES_SAISON_FINISHED


class TestNarrowingBelowAMatchdaysFixtures:
    """
    The sixth rule, and the one that reaches furthest (decided 2026-08-08).

    A matchday's expected match count is derived from these rules (ADR-0052), so lowering
    `number_of_groups` or `teams_per_group` lowers it for every group-phase matchday of the season at
    once, and lowering `qualifiers_per_group` shortens the knockout ladder. Either can leave a matchday
    holding more fixtures than its own phase accounts for — which is the direction no season setup passes
    through, unlike holding fewer.

    The input is the LARGEST count any single matchday of each phase holds, because the expected number is
    per matchday rather than per season.
    """

    def test_the_rules_the_season_already_plays_are_accepted(self):
        """4 groups of 4 gives 8 group matches per matchday, which is what the live season holds."""

        assert judge(stored=rules(), proposed=rules(), attached={"gruppenphase": 8}) is None

    def test_narrowing_the_group_count_below_an_existing_matchday_is_refused(self):
        """
        2 groups of 4 accounts for 4 matches a matchday, and this season's matchdays hold 8.

        Nothing else refuses this: the groups are empty, so `REQ-RULES-002` passes, and 2 x 4 is a legal
        bracket, so `REQ-RULES-001` passes too. Without this rule the season saves and every matchday is
        then over its own count.
        """

        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), attached={"gruppenphase": 8})

        assert refusal is not None
        assert refusal.error_code == RULES_MATCHDAY_OVER_ITS_PHASE

    def test_shortening_the_ladder_strands_a_knockout_matchday(self):
        """
        4 groups x 1 qualifier is 4 teams: a semi-final and a final, and no Viertelfinale at all.

        So a Viertelfinale matchday still holding fixtures is left in a phase this season does not reach,
        where the expected count is 0 — the case that shows the rule has to check every phase rather than
        only the group phase.
        """

        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=4, qualifiers=1), attached={"viertelfinale": 4})

        assert refusal is not None
        assert refusal.error_code == RULES_MATCHDAY_OVER_ITS_PHASE

    def test_widening_is_always_accepted(self):
        """More matches expected than are attached is a season still being set up, which is legal."""

        assert judge(stored=rules(groups=2, qualifiers=4), proposed=rules(groups=4, qualifiers=2), attached={"gruppenphase": 4}) is None

    def test_a_season_with_no_matchdays_yet_is_unaffected(self):
        """An empty mapping, which is also what a create passes."""

        assert judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), attached={}) is None

    def test_the_refusal_names_the_phase_and_both_counts(self):
        """All three are what an admin needs: which matchday to look at, and by how much it is over."""

        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), attached={"gruppenphase": 8})

        assert refusal is not None
        assert "gruppenphase" in refusal.message
        assert "8" in refusal.message
        assert "4" in refusal.message

    def test_a_stranding_narrowing_is_reported_before_this_one(self):
        """
        Both apply; the group that still holds teams is the more concrete answer.

        `REQ-RULES-002` names a group and its teams, which is a thing an admin can look at. This rule
        names an arithmetic consequence of the same edit, so reporting it first would describe the
        symptom while the cause sat one screen away.
        """

        refusal = judge(
            stored=rules(groups=4, qualifiers=2),
            proposed=rules(groups=2, qualifiers=4),
            occupancy={"C": 4},
            attached={"gruppenphase": 8},
        )

        assert refusal is not None
        assert refusal.error_code == RULES_GROUPS_IN_USE


class TestAGroupCannotQualifyMoreThanItHolds:
    """
    `REQ-RULES-007` (decided 2026-08-08): a browser warning alone lets the save through.

    `qualifiers_per_group` above `teams_per_group` asks each group for more placings than it has teams,
    so the seeding walk requests a placing no standing will ever hold — the same incoherence
    `REQ-RULES-004` refuses from the wiring side, reachable here through the rules themselves.
    """

    def test_equal_is_legal(self):
        """A group where every team advances. Unusual, not incoherent."""

        assert judge(stored=rules(qualifiers=4, per_group=4), proposed=rules(qualifiers=4, per_group=4)) is None

    def test_fewer_qualifiers_than_teams_is_legal(self):
        assert judge(proposed=rules(qualifiers=2, per_group=4)) is None

    def test_more_qualifiers_than_teams_is_refused(self):
        refusal = judge(proposed=rules(qualifiers=8, per_group=4))

        assert refusal is not None
        assert refusal.error_code == RULES_QUALIFIERS_ABOVE_GROUP

    def test_it_applies_on_a_create(self):
        """A property of the proposed rules alone, so it needs nothing stored — like the bracket rule."""

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
        """
        Both apply to 4 groups of 4 qualifying 5, and this one names two fields to compare.

        The bracket rule's answer is a property of their product, which is a step further from anything
        the admin typed — so the narrower statement goes first.
        """

        refusal = judge(proposed=rules(groups=4, qualifiers=5, per_group=4))

        assert refusal is not None
        assert refusal.error_code == RULES_QUALIFIERS_ABOVE_GROUP

    def test_the_refusal_names_both_numbers(self):
        refusal = judge(proposed=rules(qualifiers=8, per_group=4))

        assert refusal is not None
        assert "8" in refusal.message
        assert "4" in refusal.message
