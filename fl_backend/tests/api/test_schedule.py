from app.api.saisons.schedule import schedule_for
from app.api.saisons.schemas import FLSaisonRules
from tests.documents import rules_document


def rules(*, groups: int = 4, per_group: int = 4, qualifiers: int = 2) -> FLSaisonRules:
    return FLSaisonRules.model_validate(
        rules_document(
            qualifiers_per_gruppe=qualifiers, number_of_gruppen=groups, teams_per_gruppe=per_group, allowed_stufen=["E1", "E2", "Q1", "Q2"]
        )
    )


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
