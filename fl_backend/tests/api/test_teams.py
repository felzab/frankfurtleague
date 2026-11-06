import pytest
from pydantic import ValidationError

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.teams.schemas import (
    FLPatchSaisonTeamKontaktePayload,
    FLPatchSaisonTeamPayload,
    FLPatchTeamPayload,
    FLPostTeamPayload,
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


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,x", "ftp://example.com", "example.com"])
def test_rejects_a_website_url_that_is_not_http(team, url):
    """A security constraint, not tidiness: this URL is rendered into an href on a public page."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(website_url=url))


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

    def test_a_row_names_only_the_type_of_an_austritt(self, team):
        """`exit_reason` is free text written for publication, and the club's own page is where it is published."""
        austritt = {"type": "rueckzug", "exit_reason": "Zu wenige Spieler", "date": "2026-03-14"}
        rows = build_tabelle([FLTeam.model_validate(team(gruppe="A", austritt=austritt))], spiele=[], rules=RULES).root["A"]

        assert rows[0].austritt_type == "rueckzug"

    # Validation already rejects these, so reaching the guard needs `model_construct`. `X` is why it
    # cannot test `not team.gruppe`: that catches empty and None and lets anything else `KeyError`.
    @pytest.mark.parametrize("gruppe", ["", "X", "a", " ", "AB"])
    def test_refuses_a_team_it_cannot_place(self, team, gruppe):
        """Fails loudly rather than dropping the team, which the frontend would discard from the table."""
        unplaceable = FLTeam.model_construct(**{**team(), "gruppe": gruppe})

        with pytest.raises(ValueError, match="does not offer"):
            build_tabelle([unplaceable], spiele=[], rules=RULES)


class TestTheClubsSchulform:
    @pytest.mark.parametrize("payload", [FLPostTeamPayload, FLPatchTeamPayload])
    def test_the_payloads_refuse_to_default_it(self, team, payload):
        """The club PATCH replaces wholesale too, so a defaulted key here would clear a school form and fan the clearing out as an edit."""

        body = {key: value for key, value in team().items() if key in payload.model_fields}
        del body["schulform"]

        with pytest.raises(ValidationError) as failure:
            payload.model_validate(body)

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["schulform"]


class TestTheJunctionPatchPayload:
    """It replaces every field it takes wholesale, so what it DEFAULTS is what a client can drop by accident."""

    @pytest.mark.parametrize("field", ["gruppe", "austritt", "trikot_farbe"])
    def test_every_writable_field_is_required(self, field):
        """An omitted key defaulting to `None` would reinstate a disqualified club or clear a colour nobody touched."""

        body = {"gruppe": "A", "austritt": None, "trikot_farbe": None}
        del body[field]

        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonTeamPayload.model_validate(body)

        assert [entry["loc"][-1] for entry in failure.value.errors()] == [field]


class TestTheContactsPatchPayload:
    """The block's own endpoint, which is where every rule about the three people now lives."""

    def test_a_contact_block_missing_one_of_the_three_people_is_refused(self):
        """The block is written whole or not at all, so a partial one is a form half filled in rather than a smaller truth."""

        with pytest.raises(ValidationError):
            FLPatchSaisonTeamKontaktePayload.model_validate({"kontakte": {"trainer_is_also": None}})

    def test_the_block_is_required_so_a_null_clears_it_deliberately(self):
        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonTeamKontaktePayload.model_validate({})

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["kontakte", "kontakte_stand"]
