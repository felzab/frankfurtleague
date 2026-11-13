from typing import get_args

import pytest

from app.api.saisons.schedule import schedule_for
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.services import find_rules_refusal, total_season_spiele
from app.api.spiele.schemas import MAX_QUALIFIERS, PHASE_ORDER
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


class TestTheMatchForThirdPlace:
    @pytest.mark.parametrize(("groups", "qualifiers", "bracket"), [(2, 2, 4)])
    def test_the_season_total_counts_it(self, groups: int, qualifiers: int, bracket: int):
        """`bracket` is the knockout's matches by hand: `qualifiers - 1` played out, plus one for third place."""

        shape = rules(groups=groups, per_group=4, qualifiers=qualifiers)

        # Six matches in each group of four, `C(4, 2)`.
        assert total_season_spiele(shape) == groups * 6 + bracket


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
