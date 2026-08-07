"""
What a season's rules edit refuses — `find_rules_refusal`, pure and therefore in the default tier.

Five rules, and each guards a state that no other layer refuses. Four of the five are NARROWINGS: the
rules decide the shape of the competition, so lowering one below what already exists strands data that
was entered legally under the wider value. The fifth is the freeze on a finished season, which is a
different kind of protection — nothing is stranded, the result is rewritten.

The order the checks run in is asserted here too, because it is the order an admin can act on: telling
somebody their group count strands a team is noise when the whole edit is refused for being on a past
season.
"""

import pytest

from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import (
    RULES_BRACKET_IMPOSSIBLE,
    RULES_CAPACITY_BELOW_USE,
    RULES_GROUPS_IN_USE,
    RULES_QUALIFIERS_BELOW_WIRING,
    RULES_SAISON_FINISHED,
    find_rules_refusal,
)


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
) -> tuple[str, str] | None:
    return find_rules_refusal(
        saison_status=status,
        stored=rules() if stored is None else stored,
        proposed=rules() if proposed is None else proposed,
        occupancy_by_gruppe=occupancy or {},  # type: ignore[arg-type]
        highest_wired_platz=platz,
    )


class TestTheBracketMustHaveAShape:
    def test_accepts_a_power_of_two_field(self):
        """4 groups x 2 qualifiers is 8: quarter-final, semi-final, final."""

        assert judge(proposed=rules(groups=4, qualifiers=2)) is None

    @pytest.mark.parametrize(("groups", "qualifiers"), [(4, 3), (3, 1), (2, 3), (4, 5)])
    def test_refuses_a_field_that_cannot_be_paired_down(self, groups, qualifiers):
        """Each round halves, so twelve qualifiers cannot be paired down to one final."""

        refusal = judge(proposed=rules(groups=groups, qualifiers=qualifiers))

        assert refusal is not None
        assert refusal[0] == RULES_BRACKET_IMPOSSIBLE

    def test_refuses_a_field_larger_than_the_phase_set_can_hold(self):
        """
        32 is a power of two and still has nowhere to play until a fifth knockout phase exists.

        The message names `MAX_QUALIFIERS` rather than a hardcoded 16, so adding a phase changes the bound
        and the wording together (ADR-0065).
        """

        refusal = judge(proposed=rules(groups=4, per_group=8, qualifiers=8))

        assert refusal is not None
        assert refusal[0] == RULES_BRACKET_IMPOSSIBLE

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
        assert refusal[0] == RULES_BRACKET_IMPOSSIBLE

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
        assert refusal[0] == RULES_GROUPS_IN_USE
        assert "C, D" in refusal[1]

    def test_permits_dropping_a_group_nobody_is_in(self):
        """A season being set up narrows freely — the guard is about stranding, not about the number."""

        assert judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), occupancy={"A": 3, "B": 2}) is None

    def test_permits_widening(self):
        """Adding a group strands nothing. Only the narrowing direction is checked."""

        assert judge(stored=rules(groups=2, qualifiers=4), proposed=rules(groups=4, qualifiers=2), occupancy={"A": 4, "B": 4}) is None

    def test_a_disqualified_team_still_holds_its_place(self):
        """
        The caller counts every junction row including disqualified ones, and this pins that reading.

        A team never leaves a season (ADR-0033), so its place stays taken — the same rule `REQ-ENTER-003`
        applies when refusing an entry into a full group.
        """

        # 4x2 and 2x4 are both 8 qualifiers, so the bracket rule passes and the narrowing is what is
        # under test. A combination like 3x2 would be refused for having no bracket at all first.
        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), occupancy={"D": 1})

        assert refusal is not None
        assert refusal[0] == RULES_GROUPS_IN_USE


class TestNarrowingTheCapacity:
    def test_refuses_a_capacity_below_the_fullest_group(self):
        """Otherwise a group sits over a bound no entry was ever refused against."""

        refusal = judge(stored=rules(per_group=6), proposed=rules(per_group=4), occupancy={"A": 6, "B": 2})

        assert refusal is not None
        assert refusal[0] == RULES_CAPACITY_BELOW_USE
        assert "6" in refusal[1]

    def test_permits_a_capacity_that_still_fits(self):
        assert judge(stored=rules(per_group=6), proposed=rules(per_group=4), occupancy={"A": 4, "B": 2}) is None

    def test_permits_widening_the_capacity(self):
        assert judge(stored=rules(per_group=4), proposed=rules(per_group=6), occupancy={"A": 4}) is None


class TestNarrowingTheQualifiers:
    def test_refuses_a_count_below_a_placing_already_wired(self):
        """
        A slot naming `2. der Gruppe A` in a season that now qualifies one per group.

        The resolution CONTAINS that state and reports it as a bracket fault (ADR-0047) rather than
        emptying the slot — but it reports it to whoever opens the triage list, not to whoever caused it.
        """

        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=4, qualifiers=1), platz=2)

        assert refusal is not None
        assert refusal[0] == RULES_QUALIFIERS_BELOW_WIRING

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
        The reason is that the league table is DERIVED (ADR-0026).

        Editing the points of a finished season rewrites who won it, on the next read, with nothing
        anywhere recording what it said before.
        """

        refusal = judge(status="past", stored=rules(), proposed=rules(**changed))

        assert refusal is not None
        assert refusal[0] == RULES_SAISON_FINISHED
        assert field in refusal[1]

    @pytest.mark.parametrize("status", ["active", "future"])
    def test_permits_the_same_change_on_a_season_that_is_not_over(self, status):
        """A running season's points are still a decision somebody is entitled to change."""

        assert judge(status=status, stored=rules(), proposed=rules(win=2)) is None

    def test_permits_an_unchanged_rules_object_on_a_past_season(self):
        """
        Which is what lets the DATES of a finished season be corrected.

        The payload carries the whole `rules` object, so a date-only edit resubmits identical rules — and
        the freeze compares values rather than refusing the endpoint outright, precisely so that repair
        stays possible (owner, 2026-08-07).
        """

        assert judge(status="past", stored=rules(), proposed=rules()) is None

    def test_permits_narrowing_erlaubte_stufen_on_a_past_season(self):
        """
        Not frozen, because it bounds what a FORM offers and never what a stored squad row holds.

        A row's level is held to the league's own closed set (ADR-0061), so narrowing a finished season
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
        assert refusal[0] == RULES_SAISON_FINISHED
