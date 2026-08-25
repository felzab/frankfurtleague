from typing import Any, Literal, Mapping

import pytest

from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import (
    FROZEN_RULES_FIELDS,
    RULES_BRACKET_IMPOSSIBLE,
    RULES_CAPACITY_BELOW_USE,
    RULES_DRAW_OUTVALUES_WIN,
    RULES_FORFEIT_DRAWS_A_KNOCKOUT,
    RULES_GROUPS_IN_USE,
    RULES_KADER_BELOW_USE,
    RULES_MATCHDAY_OVER_ITS_PHASE,
    RULES_QUALIFIERS_ABOVE_GROUP,
    RULES_QUALIFIERS_BELOW_WIRING,
    RULES_SAISON_FINISHED,
    RULES_SHAPE_AFTER_DRAW,
    find_rules_refusal,
)
from app.api.spiele.schemas import FLSaisonPhase
from app.api.teams.schemas import FLGruppenNames
from app.core.exceptions import WriteRefusal


def rules_payload(
    *,
    groups: int = 4,
    per_group: int = 4,
    qualifiers: int = 2,
    win: int = 3,
    draw: int = 1,
    tiebreak: Literal["tordifferenz", "direkter_vergleich"] = "tordifferenz",
    kader: int = 18,
    forfeit: tuple[int, int] = (3, 0),
) -> dict[str, Any]:
    """A complete rules object: every key spelled out, so a key added to the model fails here rather than taking a default nobody picked."""

    return {
        "win_points": win,
        "draw_points": draw,
        "qualifiers_per_group": qualifiers,
        "number_of_groups": groups,
        "teams_per_group": per_group,
        "tiebreak_order": tiebreak,
        "max_kadergroesse": kader,
        "forfeit_ergebnis": {"sieger_tore": forfeit[0], "verlierer_tore": forfeit[1]},
        "erlaubte_stufen": ["E1", "E2", "Q1", "Q2"],
    }


def rules(**overrides: Any) -> FLSaisonRules:
    """The model of `rules_payload`. Forwarded rather than re-declared, so a key added there needs no second signature to reach a test."""

    return FLSaisonRules.model_validate(rules_payload(**overrides))


def judge(
    *,
    status: str = "active",
    stored: FLSaisonRules | None = None,
    proposed: FLSaisonRules | None = None,
    occupancy: dict[FLGruppenNames, int] | None = None,
    platz: int = 0,
    largest_squad: int = 0,
    attached: Mapping[FLSaisonPhase, int] | None = None,
    drawn: int = 0,
) -> WriteRefusal | None:
    return find_rules_refusal(
        saison_status=status,
        stored=rules() if stored is None else stored,
        proposed=rules() if proposed is None else proposed,
        occupancy_by_gruppe=occupancy or {},
        highest_wired_platz=platz,
        largest_squad=largest_squad,
        attached_by_phase=attached,
        drawn_fixtures=drawn,
    )


# Each frozen field, with the step that changes it.
FROZEN_CASES: tuple[tuple[str, dict[str, Any]], ...] = (
    ("win_points", {"win": 2}),
    ("draw_points", {"draw": 0}),
    ("qualifiers_per_group", {"qualifiers": 1}),
    ("tiebreak_order", {"tiebreak": "direkter_vergleich"}),
)

# A field added to the freeze and not to the cases above would otherwise go untested in silence.
assert tuple(field for field, _ in FROZEN_CASES) == FROZEN_RULES_FIELDS, "the frozen fields and the cases covering them have drifted apart"


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


class TestADrawIsNeverWorthMoreThanAWin:
    """Every table the league serves is derived from these two numbers, so a season rewarding a draw above a win scores itself incoherently."""

    def test_a_draw_worth_the_same_as_a_win_is_legal(self):
        """A competition may decline to reward winning. Only OUTVALUING it is refused."""

        assert judge(stored=rules(win=1, draw=1), proposed=rules(win=1, draw=1)) is None

    def test_a_draw_worth_more_than_a_win_is_refused(self):
        refusal = judge(proposed=rules(win=3, draw=4))

        assert refusal is not None
        assert refusal.error_code == RULES_DRAW_OUTVALUES_WIN

    def test_the_refusal_names_both_numbers(self):
        refusal = judge(proposed=rules(win=3, draw=4))

        assert refusal is not None
        assert "4" in refusal.message
        assert "3" in refusal.message

    def test_permits_resubmitting_an_existing_excess_unchanged(self):
        """`rules` is required on the patch, so a season stored this way would otherwise be unpatchable (`docs/backend/spec.md :: I44`)."""

        inverted = rules(win=1, draw=3)

        assert judge(stored=inverted, proposed=inverted) is None

    def test_permits_reducing_an_excess_that_still_violates(self):
        """The badness is the excess, so a step towards legality is a repair even where it does not arrive."""

        assert judge(stored=rules(win=1, draw=3), proposed=rules(win=1, draw=2)) is None

    def test_refuses_widening_an_excess_that_already_exists(self):
        """Worsening one is as much a step as introducing it, which is what stops the permission above covering both."""

        refusal = judge(stored=rules(win=1, draw=2), proposed=rules(win=1, draw=3))

        assert refusal is not None
        assert refusal.error_code == RULES_DRAW_OUTVALUES_WIN

    def test_it_applies_on_a_create(self):
        """`stored=None` is the create: with no earlier pair to compare against, an inverted one is always this step's doing."""

        refusal = find_rules_refusal(
            saison_status="future",
            stored=None,
            proposed=rules(win=3, draw=4),
            occupancy_by_gruppe={},
            highest_wired_platz=0,
        )

        assert refusal is not None
        assert refusal.error_code == RULES_DRAW_OUTVALUES_WIN


class TestADrawnForfeitCannotDecideAKnockout:
    """A knockout round has to produce a winner, and a level award composes a draw the bracket cannot advance out of.

    A composed forfeit discards any shoot-out (`app/api/spiele/services.py :: apply_payload_to_spiel`), so nothing breaks that tie.
    """

    def test_a_decided_award_is_accepted(self):
        """The season the rest of this file uses: 4 x 2 qualifiers, awarded 3:0."""

        assert judge(proposed=rules(forfeit=(3, 0))) is None

    def test_a_level_award_is_refused_where_the_rules_play_a_knockout(self):
        """4 x 2 is 8 qualifiers, which is a quarter-final, a semi-final and a final."""

        refusal = judge(proposed=rules(forfeit=(0, 0)))

        assert refusal is not None
        assert refusal.error_code == RULES_FORFEIT_DRAWS_A_KNOCKOUT

    def test_the_refusal_names_the_award(self):
        """Any level pair, not 0:0 alone: what strands the bracket is the two numbers matching."""

        refusal = judge(proposed=rules(forfeit=(2, 2)))

        assert refusal is not None
        assert refusal.error_code == RULES_FORFEIT_DRAWS_A_KNOCKOUT
        assert "2:2" in refusal.message

    def test_a_season_playing_no_knockout_round_may_regulate_a_level_award(self):
        """3 x 1 reaches no bracket, so no round is left without a winner; `REQ-RULES-001` passes the product because it did not change."""

        assert judge(stored=rules(groups=3, qualifiers=1), proposed=rules(groups=3, qualifiers=1, forfeit=(0, 0))) is None

    def test_drawing_a_bracket_over_a_level_award_is_the_step(self):
        """The PAIRING is refused, so whichever half arrives last carries it -- here the bracket, over an award the season already held."""

        refusal = judge(stored=rules(groups=3, qualifiers=1, forfeit=(0, 0)), proposed=rules(groups=4, qualifiers=2, forfeit=(0, 0)))

        assert refusal is not None
        assert refusal.error_code == RULES_FORFEIT_DRAWS_A_KNOCKOUT

    def test_permits_resubmitting_a_stored_pairing_unchanged(self):
        """`rules` is required on the patch, so refusing this would leave a season stored that way unpatchable (`docs/backend/spec.md :: I44`).

        The one arm this rule cannot judge by the proposal: `_forfeit_draws_a_knockout` is read on both sides for it.
        """

        drawn = rules(forfeit=(0, 0))

        assert judge(stored=drawn, proposed=drawn) is None

    def test_permits_separating_the_award(self):
        """The repair, and the only one a season with a bracket has: the pairing is broken by the award, never by the rounds."""

        assert judge(stored=rules(forfeit=(0, 0)), proposed=rules(forfeit=(3, 0))) is None

    def test_it_applies_on_a_create(self):
        """`stored=None` is the create: with nothing stored to compare against, the pairing is always this step's doing."""

        refusal = find_rules_refusal(
            saison_status="future",
            stored=None,
            proposed=rules(forfeit=(0, 0)),
            occupancy_by_gruppe={},
            highest_wired_platz=0,
        )

        assert refusal is not None
        assert refusal.error_code == RULES_FORFEIT_DRAWS_A_KNOCKOUT


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


class TestNarrowingTheSquadCap:
    """A cap under a squad the season already fields leaves that team over a bound no entry was ever measured by.

    `max_kadergroesse` is what `REQ-SQUAD-003` refuses a squad write against, and `largest_squad` counts the season's LIVE rows alone.
    """

    def test_a_cap_the_largest_squad_still_fits_under_is_accepted(self):
        """Equality fits: `find_squad_capacity_refusal` refuses the entry that would EXCEED it, so a squad standing at the cap is legal."""

        assert judge(stored=rules(kader=25), proposed=rules(kader=18), largest_squad=18) is None

    def test_a_cap_below_the_largest_squad_is_refused(self):
        refusal = judge(stored=rules(kader=25), proposed=rules(kader=15), largest_squad=20)

        assert refusal is not None
        assert refusal.error_code == RULES_KADER_BELOW_USE
        assert "20" in refusal.message

    def test_permits_widening_the_cap(self):
        assert judge(stored=rules(kader=18), proposed=rules(kader=25), largest_squad=18) is None

    def test_permits_resubmitting_a_cap_the_season_already_exceeds(self):
        """Without this the trap closes on a season whose squads outgrew their cap.

        `rules` is required on the patch, so refusing an unchanged resubmission would leave those
        rules refusing every edit that could undo them (`docs/backend/spec.md :: I44`).
        """

        assert judge(stored=rules(kader=15), proposed=rules(kader=15), largest_squad=20) is None

    def test_permits_raising_a_cap_that_is_still_below_the_largest_squad(self):
        """Half a repair is still a repair, and refusing it would make the only way out one jump to the largest squad the season holds."""

        assert judge(stored=rules(kader=15), proposed=rules(kader=18), largest_squad=20) is None

    def test_a_create_is_judged_on_the_proposal_alone(self):
        """`stored=None` returns before this rule, and rightly: a season nobody has entered a player into holds no squad to sit under a cap."""

        refusal = find_rules_refusal(
            saison_status="future",
            stored=None,
            proposed=rules(kader=1),
            occupancy_by_gruppe={},
            highest_wired_platz=0,
            largest_squad=99,
        )

        assert refusal is None


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
    @pytest.mark.parametrize(("field", "changed"), FROZEN_CASES, ids=[field for field, _ in FROZEN_CASES])
    def test_refuses_a_change_to_any_frozen_field(self, field: str, changed: dict[str, Any]):
        """The league table is derived, so editing a finished season's scoring rewrites who won it on the next read."""

        refusal = judge(status="past", stored=rules(), proposed=rules(**changed))

        assert refusal is not None
        assert refusal.error_code == RULES_SAISON_FINISHED
        assert field in refusal.message

    @pytest.mark.parametrize(
        ("label", "changed"),
        [("max_kadergroesse", {"kader": 25}), ("forfeit_ergebnis", {"forfeit": (2, 0)})],
        ids=["max_kadergroesse", "forfeit_ergebnis"],
    )
    def test_permits_a_change_the_table_does_not_read(self, label: str, changed: dict[str, Any]):
        """Neither reaches a stored row: the cap bounds what a squad write accepts, and the forfeit result is composed as a fixture is saved."""

        assert judge(status="past", stored=rules(), proposed=rules(**changed)) is None

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


# The season the class below patches, as its fixtures were drawn: 4 groups of 4 over 3 matchdays.
DRAWN_FIXTURES = 24


class TestADrawnSeasonKeepsTheShapeItWasDrawnFrom:
    """The three numbers a season's fixture list is generated from.

    A RAISE is the case nothing else reaches: `REQ-RULES-006` refuses a narrowing alone, and a
    wider group leaves every matchday under the count `anzahl_spiele` then implies.
    """

    @pytest.mark.parametrize(
        ("label", "changed"),
        [
            ("number_of_groups", {"groups": 2, "qualifiers": 4}),
            ("teams_per_group", {"per_group": 6}),
            ("qualifiers_per_group", {"qualifiers": 4}),
        ],
        ids=["number_of_groups", "teams_per_group", "qualifiers_per_group"],
    )
    def test_a_change_to_any_of_them_is_refused(self, label: str, changed: dict[str, Any]):
        """Each case leaves the bracket legal, so nothing but this rule can be answering."""

        refusal = judge(stored=rules(), proposed=rules(**changed), drawn=DRAWN_FIXTURES)

        assert refusal is not None
        assert refusal.error_code == RULES_SHAPE_AFTER_DRAW
        assert label in refusal.message

    def test_widening_a_group_is_refused_though_no_bound_is_crossed(self):
        """The hole this closes: `anzahl_spiele` is derived, so a wider group leaves every matchday short of matches nobody drew."""

        refusal = judge(stored=rules(per_group=4), proposed=rules(per_group=6), drawn=DRAWN_FIXTURES)

        assert refusal is not None
        assert refusal.error_code == RULES_SHAPE_AFTER_DRAW

    @pytest.mark.parametrize(
        ("label", "changed"),
        [
            ("win_points", {"win": 2}),
            ("draw_points", {"draw": 0}),
            ("tiebreak_order", {"tiebreak": "direkter_vergleich"}),
            ("max_kadergroesse", {"kader": 25}),
            ("forfeit_ergebnis", {"forfeit": (2, 0)}),
        ],
        ids=["win_points", "draw_points", "tiebreak_order", "max_kadergroesse", "forfeit_ergebnis"],
    )
    def test_the_rest_of_the_rules_stay_editable(self, label: str, changed: dict[str, Any]):
        """None of them shaped the fixture list, and a typo in `win_points` found in week two stays correctable without losing the season."""

        assert judge(stored=rules(), proposed=rules(**changed), drawn=DRAWN_FIXTURES) is None

    def test_the_shape_is_editable_while_nothing_is_drawn(self):
        """A season being set up: `REQ-RULES-002`, `REQ-RULES-003` and `REQ-RULES-004` are what bound it there."""

        assert judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), drawn=0) is None

    @pytest.mark.parametrize("status", ["future", "active", "past"])
    def test_the_freeze_holds_whatever_the_season_is_doing(self, status: str):
        """`future` is the one to watch: a season nobody has played is where a carve-out for repairs would sit.

        The repair is the draw, which takes these three on its own payload
        (`app/api/saisons/schemas.py :: FLSpielplanShape`).
        """

        refusal = judge(status=status, stored=rules(), proposed=rules(per_group=6), drawn=DRAWN_FIXTURES)

        assert refusal is not None
        assert refusal.error_code == RULES_SHAPE_AFTER_DRAW

    def test_the_refusal_names_drawing_the_season_again(self):
        """The message an admin reads: naming the shape as unchangeable would send them looking for an edit that does not exist."""

        refusal = judge(stored=rules(), proposed=rules(per_group=6), drawn=DRAWN_FIXTURES)

        assert refusal is not None
        assert "draw the Spielplan again" in refusal.message

    def test_permits_resubmitting_the_drawn_shape_unchanged(self):
        """`rules` is required on the patch, so a dates-only edit resubmits all three unchanged (`docs/backend/spec.md :: I44`)."""

        assert judge(stored=rules(), proposed=rules(), drawn=DRAWN_FIXTURES) is None

    def test_a_create_holds_no_fixtures_to_have_been_drawn(self):
        """`stored=None` is the create, and there is no earlier shape for a drawn fixture to have come out of."""

        refusal = find_rules_refusal(
            saison_status="future",
            stored=None,
            proposed=rules(groups=2, qualifiers=4),
            occupancy_by_gruppe={},
            highest_wired_platz=0,
            drawn_fixtures=DRAWN_FIXTURES,
        )

        assert refusal is None

    def test_the_refusal_names_how_many_fixtures_stand_on_the_shape(self):
        """The message is the log line, and the count is what says whether a redraw is one matchday's work or the season's."""

        refusal = judge(stored=rules(), proposed=rules(per_group=6), drawn=DRAWN_FIXTURES)

        assert refusal is not None
        assert str(DRAWN_FIXTURES) in refusal.message

    def test_it_is_reported_before_a_bound_on_the_same_field(self):
        """`REQ-RULES-004` would name a placing to raise the count back over; here the count may not move at all."""

        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=4, qualifiers=1), platz=2, drawn=DRAWN_FIXTURES)

        assert refusal is not None
        assert refusal.error_code == RULES_SHAPE_AFTER_DRAW

    def test_a_finished_season_is_reported_as_finished_first(self):
        """Both freezes cover `qualifiers_per_group`, and `REQ-RULES-005` also explains why the points beside it will not move."""

        refusal = judge(status="past", stored=rules(), proposed=rules(qualifiers=1), drawn=DRAWN_FIXTURES)

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


# What a bound refuses, as against a key that is absent or of the wrong type.
RANGE_REFUSALS = frozenset({"greater_than_equal", "less_than_equal"})


class TestAGroupHoldsBetweenTwoAndSixteenTeams:
    """`teams_per_group` is bounded by the model, not by `find_rules_refusal`, so its range is pinned where it is stated.

    Why each end sits where it does is `app/api/saisons/schemas.py :: FLSaisonRules`.
    """

    @pytest.mark.parametrize("per_group", [2, 16], ids=["the floor", "the ceiling"])
    def test_both_ends_of_the_range_are_accepted(self, per_group: int):
        """Inclusive at both ends, which is what makes the two refusals below the first values outside it."""

        assert FLSaisonRules.model_validate(rules_payload(per_group=per_group)).teams_per_group == per_group

    @pytest.mark.parametrize("per_group", [1, 17], ids=["one under", "one over"])
    def test_a_size_outside_the_range_is_refused(self, per_group: int, assert_rejects):
        """The refusal has to be about the RANGE: every other key of the payload is present and valid, so nothing else can answer for it."""

        error = assert_rejects(FLSaisonRules, rules_payload(per_group=per_group), "teams_per_group")

        refused_for = {entry["type"] for entry in error.errors() if entry["loc"] and entry["loc"][-1] == "teams_per_group"}

        assert refused_for & RANGE_REFUSALS, f"teams_per_group refused {per_group} for {sorted(refused_for)} rather than its range"
