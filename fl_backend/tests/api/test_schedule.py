from app.api.saisons.schedule import schedule_for
from app.api.saisons.schemas import FLSaisonRules
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
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


class TestTheWholeSeason:
    def test_it_reproduces_the_season_the_league_is_playing(self):
        """The one case with an independent answer: every number below is one the league's own matchdays carry by hand."""

        schedule = schedule_for(rules())

        assert [(entry.phase, entry.spieltage, entry.spiele_per_spieltag) for entry in schedule] == [
            ("gruppenphase", 3, 8),
            ("viertelfinale", 1, 4),
            ("halbfinale", 1, 2),
            ("finale", 1, 2),
        ]

    def test_a_knockout_round_holds_half_the_field_that_entered_it(self):
        """The Finale's matchday holds the final and the match for third place."""

        schedule = schedule_for(rules(groups=4, per_group=6, qualifiers=4))

        assert [(entry.phase, entry.spiele_per_spieltag) for entry in schedule] == [
            ("gruppenphase", 12),
            ("achtelfinale", 8),
            ("viertelfinale", 4),
            ("halbfinale", 2),
            ("finale", 2),
        ]


class TestTheWidestSeasonFitsInOneRead:
    def test_no_shape_the_field_bounds_admit_plays_past_one_page(self):
        """Past `LIST_LIMIT_DEFAULT` a season-scoped read truncates, and every refusal computed over one judges a partial season.

        Swept over the field bounds alone, no refusal asked, so a widened bound fails here: the count is quadratic in the
        group's size and linear in the number of groups. The qualifiers stop at the group's size, past which
        `rules_qualifiers_above_gruppe` refuses them, and the bracket is capped by its phases whatever they are.
        """

        widest = max(
            sum(
                entry.spieltage * entry.spiele_per_spieltag
                for entry in schedule_for(rules(groups=groups, per_group=per_group, qualifiers=qualifiers))
            )
            for groups in range(1, ceiling("number_of_gruppen") + 1)
            for per_group in range(2, ceiling("teams_per_gruppe") + 1)
            for qualifiers in range(1, per_group + 1)
        )

        assert widest <= LIST_LIMIT_DEFAULT
