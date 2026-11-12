import pytest
from pydantic import ValidationError

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.teams.schemas import (
    FLTabelleResponse,
    FLTeam,
)
from app.api.teams.services import build_tabelle
from app.shared.schemas.literals import FLSpielerStufe

# Typed as the `Literal` list `FLSaisonRules` declares: a bare `list[str]` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    loss_points=0,
    qualifiers_per_gruppe=2,
    number_of_gruppen=4,
    teams_per_gruppe=4,
    tiebreak_order="tordifferenz",
    max_kader_size=50,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    allowed_stufen=STUFEN,
)


def test_rejects_a_website_url_that_is_not_http(team):
    """A security constraint, not tidiness: this URL is rendered into an href on a public page.

    One URL proves the field runs the shared validator, whose own table holds what it refuses.
    """
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(website_url="javascript:alert(1)"))


class TestTheTabellesGroups:
    """Every group the season offers, a map built from the clubs present dropping a group nobody has entered yet."""

    def test_a_row_carries_the_standings_fields_and_no_club_detail(self, team):
        """A public CLIENT component renders this, so every field listed is serialised into the page -- and an address here is a school's."""
        response = FLTabelleResponse(
            gruppen=build_tabelle([FLTeam.model_validate(team(gruppe="A"))], spiele=[], rules=RULES),
            qualifiers_per_gruppe=RULES.qualifiers_per_gruppe,
        )

        assert sorted(response.model_dump()["gruppen"]["A"][0]) == [
            "austritt_type",
            "id",
            "name",
            "platz",
            "shorthand",
            "statistik",
        ]

    # Validation already rejects these, so reaching the guard needs `model_construct`. `X` is why it
    # cannot test `not team.gruppe`: that catches empty and None and lets anything else `KeyError`.
    @pytest.mark.parametrize("gruppe", ["", "X", "a", " ", "AB"])
    def test_refuses_a_team_it_cannot_place(self, team, gruppe):
        """Fails loudly rather than dropping the team, which the frontend would discard from the table."""
        unplaceable = FLTeam.model_construct(**{**team(), "gruppe": gruppe})

        with pytest.raises(ValueError, match="does not offer"):
            build_tabelle([unplaceable], spiele=[], rules=RULES)
