from collections.abc import Mapping
from typing import Any, Literal

import pytest

from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_rules_freeze_refusal, find_rules_refusal, find_undraw_refusal
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.schemas.literals import FLGruppenNames, FLSaisonPhase


def rules_payload(
    *,
    groups: int = 4,
    per_group: int = 4,
    qualifiers: int = 2,
    win: int = 3,
    draw: int = 1,
    loss: int = 0,
    tiebreak: Literal["tordifferenz", "direkter_vergleich"] = "tordifferenz",
    kader: int = 18,
    forfeit: tuple[int, int] = (3, 0),
) -> dict[str, Any]:
    """A complete rules object: every key spelled out, so a key added to the model fails here rather than taking a default nobody picked."""

    return {
        "win_points": win,
        "draw_points": draw,
        "loss_points": loss,
        "qualifiers_per_gruppe": qualifiers,
        "number_of_gruppen": groups,
        "teams_per_gruppe": per_group,
        "tiebreak_order": tiebreak,
        "max_kader_size": kader,
        "forfeit_ergebnis": {"sieger_tore": forfeit[0], "verlierer_tore": forfeit[1]},
        "allowed_stufen": ["E1", "E2", "Q1", "Q2"],
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
    started: bool = False,
) -> WriteRefusal | None:
    """Both judgements in the order `patch_saison` asks them: the freeze, then the rules."""

    stored = rules() if stored is None else stored
    proposed = rules() if proposed is None else proposed
    frozen = find_rules_freeze_refusal(saison_status=status, started=started, stored=stored, proposed=proposed)
    if frozen is not None:
        return frozen

    return find_rules_refusal(
        stored=stored,
        proposed=proposed,
        occupancy_by_gruppe=occupancy or {},
        highest_wired_platz=platz,
        largest_squad=largest_squad,
        attached_by_phase=attached,
        drawn_spiele=drawn,
    )


# Each frozen field, with the step that changes it.
FROZEN_CASES: tuple[tuple[str, dict[str, Any]], ...] = (
    ("win_points", {"win": 2}),
    ("draw_points", {"draw": 0}),
    ("loss_points", {"loss": 1}),
    ("qualifiers_per_gruppe", {"qualifiers": 1}),
    ("tiebreak_order", {"tiebreak": "direkter_vergleich"}),
)


class TestTheBracketMustHaveAShape:
    @pytest.mark.parametrize(
        ("groups", "qualifiers"),
        [
            (4, 3),
            (3, 1),
            (2, 3),
            (4, 5),
            pytest.param(4, 8, id="past MAX_QUALIFIERS, which no phase set reaches"),
            pytest.param(2, 1, id="a final alone, with no semi-finals for the podium's four places"),
        ],
    )
    def test_refuses_a_field_that_cannot_be_paired_down(self, groups, qualifiers):
        """`per_group=8` so every case reaches this rule: `rules_qualifiers_above_gruppe` runs first and would answer `(4, 5)`."""

        refusal = judge(proposed=rules(groups=groups, qualifiers=qualifiers, per_group=8))

        assert refusal is not None
        assert refusal.error_code == Code.RULES_BRACKET_IMPOSSIBLE

    def test_refuses_moving_from_one_illegal_product_to_another(self):
        """Legality is boolean, so the permission to resubmit reaches an identical product alone: 12 to 20 is still a step."""

        refusal = judge(stored=rules(groups=4, qualifiers=3, per_group=8), proposed=rules(groups=4, qualifiers=5, per_group=8))

        assert refusal is not None
        assert refusal.error_code == Code.RULES_BRACKET_IMPOSSIBLE


class TestADrawIsNeverWorthMoreThanAWin:
    """Every table the league serves is derived from these two numbers, so a season rewarding a draw above a win scores itself incoherently."""

    def test_refuses_widening_an_excess_that_already_exists(self):
        """Worsening an excess is as much a step as introducing it, which is what stops the permission to repair one covering both."""

        refusal = judge(stored=rules(win=1, draw=2), proposed=rules(win=1, draw=3))

        assert refusal is not None
        assert refusal.error_code == Code.RULES_UNENTSCHIEDEN_OUTVALUES_WIN


class TestADrawnForfeitCannotDecideAKnockout:
    """A knockout round has to produce a winner, and a level award composes a draw the bracket cannot advance out of.

    A composed forfeit discards any shoot-out (`app/api/spiele/services.py :: apply_payload_to_spiel`), so nothing breaks that tie.
    """

    def test_drawing_a_bracket_over_a_level_award_is_the_step(self):
        """The PAIRING is refused, so whichever half arrives last carries it -- here the bracket, over an award the season already held."""

        refusal = judge(stored=rules(groups=3, qualifiers=1, forfeit=(0, 0)), proposed=rules(groups=4, qualifiers=2, forfeit=(0, 0)))

        assert refusal is not None
        assert refusal.error_code == Code.RULES_FORFEIT_UNENTSCHIEDEN_IN_A_KNOCKOUT


class TestEachRefusalNamesItsBound:
    """A bound computed wrong words the field's line with a figure the next save is refused for again, and nothing else checks it."""

    @pytest.mark.parametrize(
        ("judged", "code", "field", "bounds"),
        [
            pytest.param(
                {"stored": rules(groups=4, qualifiers=2), "proposed": rules(groups=2, qualifiers=4), "occupancy": {"A": 1, "C": 1}},
                Code.RULES_GRUPPEN_IN_USE,
                ("rules", "number_of_gruppen"),
                {"min": 3},
                id="the groups in use run to the last occupied one",
            ),
            pytest.param(
                {"stored": rules(per_group=6), "proposed": rules(per_group=4), "occupancy": {"A": 6, "B": 2}},
                Code.RULES_CAPACITY_BELOW_USE,
                ("rules", "teams_per_gruppe"),
                {"min": 6},
                id="the capacity holds the fullest group",
            ),
            pytest.param(
                {"stored": rules(qualifiers=2), "proposed": rules(qualifiers=1), "platz": 2},
                Code.RULES_QUALIFIERS_BELOW_WIRING,
                ("rules", "qualifiers_per_gruppe"),
                {"min": 2},
                id="the qualifiers reach the highest wired place",
            ),
            pytest.param(
                {"proposed": rules(qualifiers=5, per_group=4)},
                Code.RULES_QUALIFIERS_ABOVE_GRUPPE,
                ("rules", "qualifiers_per_gruppe"),
                {"max": 4},
                id="the qualifiers stay within a group",
            ),
            pytest.param(
                {"proposed": rules(win=3, draw=4)},
                Code.RULES_UNENTSCHIEDEN_OUTVALUES_WIN,
                ("rules", "draw_points"),
                {"max": 3},
                id="a draw is worth at most a win",
            ),
            pytest.param(
                {"proposed": rules(win=3, draw=1, loss=2)},
                Code.RULES_NIEDERLAGE_OUTVALUES_UNENTSCHIEDEN,
                ("rules", "loss_points"),
                {"max": 1},
                id="a loss is worth at most a draw",
            ),
            pytest.param(
                {"stored": rules(kader=18), "proposed": rules(kader=10), "largest_squad": 12},
                Code.RULES_KADER_BELOW_USE,
                ("rules", "max_kader_size"),
                {"min": 12},
                id="the squad cap holds the largest squad",
            ),
            pytest.param(
                {"proposed": rules(forfeit=(2, 2))},
                Code.RULES_FORFEIT_UNENTSCHIEDEN_IN_A_KNOCKOUT,
                ("rules", "forfeit_ergebnis", "sieger_tore"),
                {"min": 3},
                id="a forfeit's winner scores one more than its loser",
            ),
        ],
    )
    def test_the_rule_names_its_field_and_the_figure_it_holds_it_to(
        self, judged: dict[str, Any], code: Code, field: tuple[str, ...], bounds: dict[str, int]
    ):
        refusal = judge(**judged)

        assert refusal is not None
        assert (refusal.error_code, refusal.fields, dict(refusal.bounds)) == (code, (field,), bounds)


class TestAStartedSeasonFreezes:
    @pytest.mark.parametrize(("field", "changed"), FROZEN_CASES, ids=[field for field, _ in FROZEN_CASES])
    def test_refuses_a_change_to_any_frozen_field(self, field: str, changed: dict[str, Any]):
        """The league table is derived, so editing a running season's scoring rewrites the standings on the next read."""

        refusal = judge(status="active", started=True, stored=rules(), proposed=rules(**changed))

        assert refusal is not None
        assert refusal.error_code == Code.RULES_SAISON_STARTED

    # One field: the status is judged once ahead of the field comparison, which the case above walks field by field.
    @pytest.mark.parametrize(("field", "changed"), FROZEN_CASES[:1], ids=[field for field, _ in FROZEN_CASES[:1]])
    def test_a_finished_season_stays_frozen_whatever_its_dates(self, field: str, changed: dict[str, Any]):
        """`past` freezes too, so a finished season none of whose group fixtures carries a date is not reopened."""

        refusal = judge(status="past", stored=rules(), proposed=rules(**changed))

        assert refusal is not None
        assert refusal.error_code == Code.RULES_SAISON_STARTED


# The season the class below patches, as its fixtures were drawn: 4 groups of 4 over 3 matchdays.
DRAWN_SPIELE = 24


class TestADrawnSeasonKeepsTheShapeItWasDrawnFrom:
    """The three numbers a season's fixture list is generated from."""

    @pytest.mark.parametrize(
        ("label", "changed"),
        [
            ("number_of_gruppen", {"groups": 2, "qualifiers": 4}),
            ("teams_per_gruppe", {"per_group": 6}),
            ("qualifiers_per_gruppe", {"qualifiers": 4}),
        ],
        ids=["number_of_gruppen", "teams_per_gruppe", "qualifiers_per_gruppe"],
    )
    def test_a_change_to_any_of_them_is_refused(self, label: str, changed: dict[str, Any]):
        """Each case leaves the bracket legal, so nothing but this rule can be answering."""

        refusal = judge(stored=rules(), proposed=rules(**changed), drawn=DRAWN_SPIELE)

        assert refusal is not None
        assert refusal.error_code == Code.RULES_SHAPE_AFTER_SPIELPLAN


# Every state of the window, and whether the undraw runs in it.
UNDRAW_WINDOW_CASES: tuple[tuple[str, int, bool], ...] = (
    ("future", 0, True),
    ("future", 2, False),
    ("active", 0, False),
    ("past", 0, False),
)

# In case order: a row added above without one here fails `parametrize` rather than mislabelling a case.
WINDOW_IDS: tuple[str, ...] = ("planned and untouched", "planned but carrying a record", "running", "finished")


class TestTheUndrawWindow:
    """`spielplan_undraw_outside_its_window`: a planned season with nothing recorded against it, and no other."""

    @pytest.mark.parametrize(("status", "recorded", "undraw_runs"), UNDRAW_WINDOW_CASES, ids=WINDOW_IDS)
    def test_the_undraw_runs_only_inside_the_window(self, status: str, recorded: int, undraw_runs: bool):
        assert (find_undraw_refusal(saison_status=status, recorded_spiele=recorded) is None) is undraw_runs


class TestNarrowingBelowAMatchdaysSpiele:
    """A matchday's expected count derives from these rules; the input is the largest count one matchday holds."""

    def test_narrowing_the_group_count_below_an_existing_matchday_is_refused(self):
        """Nothing else refuses it: the groups are empty for `rules_gruppen_in_use`, and 2 x 4 is a bracket `rules_bracket_impossible` takes."""

        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=2, qualifiers=4), attached={"gruppenphase": 8})

        assert refusal is not None
        assert refusal.error_code == Code.RULES_SPIELTAG_OVER_ITS_PHASE

    def test_shortening_the_ladder_strands_a_knockout_matchday(self):
        """4 groups by 1 qualifier leaves a Viertelfinale matchday in a phase expecting 0, which is why every phase is checked."""

        refusal = judge(stored=rules(groups=4, qualifiers=2), proposed=rules(groups=4, qualifiers=1), attached={"viertelfinale": 4})

        assert refusal is not None
        assert refusal.error_code == Code.RULES_SPIELTAG_OVER_ITS_PHASE


class TestAGroupCannotQualifyMoreThanItHolds:
    """More qualifiers than teams asks each group for a placing no standing will ever hold; a browser warning alone lets the save through."""

    def test_refuses_widening_an_excess_that_already_exists(self):
        """Worsening an excess is as much a step as introducing it, which is what stops the permission to repair one covering both."""

        refusal = judge(stored=rules(groups=2, qualifiers=4, per_group=2), proposed=rules(groups=2, qualifiers=8, per_group=2))

        assert refusal is not None
        assert refusal.error_code == Code.RULES_QUALIFIERS_ABOVE_GRUPPE
