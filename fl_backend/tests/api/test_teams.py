import pytest
from pydantic import ValidationError

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.schemas import FLTeam, FLTeamRecord, FLTeamsGroupedResponse, FLTeamStatistik
from app.api.teams.services import build_gruppen

# Typed as the `Literal` list `FLSaisonRules` declares: a bare `list[str]` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    qualifiers_per_group=2,
    number_of_groups=4,
    teams_per_group=4,
    tiebreak_order="tordifferenz",
    max_kadergroesse=50,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    erlaubte_stufen=STUFEN,
)


def test_accepts_a_valid_team(team):
    parsed = FLTeam.model_validate(team())
    assert parsed.gruppe == "A"
    assert str(parsed.id) == "6890a1b2c3d4e5f607182930"


@pytest.mark.parametrize("field", ["name", "full_name"])
def test_rejects_an_empty_required_name(team, field):
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(**{field: ""}))


def test_accepts_an_empty_description(team):
    """Optional prose, unlike the required names beside it: the two must not be aligned."""
    assert FLTeam.model_validate(team(description="")).description == ""


@pytest.mark.parametrize("gruppe", ["X", "", "a", "AB", "1"])
def test_rejects_a_group_outside_a_to_d(team, gruppe):
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(gruppe=gruppe))


@pytest.mark.parametrize("gruppe", ["A", "B", "C", "D"])
def test_accepts_each_of_the_four_groups(team, gruppe):
    """So the rejection test above cannot be passing for the wrong reason."""
    assert FLTeam.model_validate(team(gruppe=gruppe)).gruppe == gruppe


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,x", "ftp://example.com", "example.com"])
def test_rejects_a_website_url_that_is_not_http(team, url):
    """A security constraint, not tidiness: this URL is rendered into an href on a public page."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(website_url=url))


# Taken from the model rather than listed: a counter added without `ge=0` is the one nothing would ask about.
@pytest.mark.parametrize("field", list(FLTeamStatistik.model_fields))
def test_rejects_negative_statistics(team, statistik, field):
    """Computed by an aggregation, so an arithmetic error surfaces here."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(statistik=statistik(**{field: -1})))


@pytest.mark.parametrize("shorthand", ["C", "CSS", ""])
def test_rejects_a_shorthand_that_is_not_two_characters(team, shorthand):
    """The narrow cards render this instead of the full name, so the width is fixed."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(shorthand=shorthand))


class TestFLGruppen:
    """The frontend's `FLGruppenSchema` requires all four keys, so a map built from the teams present fails the parse."""

    def test_always_emits_all_four_groups(self, team):
        grouped = build_gruppen([FLTeam.model_validate(team(gruppe="A"))], spiele=[], rules=RULES)

        assert sorted(grouped.root) == ["A", "B", "C", "D"]

    def test_leaves_unpopulated_groups_as_empty_lists(self, team):
        """The empty groups are `[]`, not absent and not null."""
        grouped = build_gruppen([FLTeam.model_validate(team(gruppe="A"))], spiele=[], rules=RULES)

        assert len(grouped.root["A"]) == 1
        assert grouped.root["B"] == grouped.root["C"] == grouped.root["D"] == []

    def test_returns_all_four_groups_for_no_teams_at_all(self):
        grouped = build_gruppen([], spiele=[], rules=RULES)

        assert sorted(grouped.root) == ["A", "B", "C", "D"]
        assert all(members == [] for members in grouped.root.values())

    def test_the_serialised_response_body_carries_all_four_groups(self, team):
        """The wire shape, not the Python object: the frontend parses the response body."""
        response = FLTeamsGroupedResponse(
            gruppen=build_gruppen([FLTeam.model_validate(team(gruppe="A"))], spiele=[], rules=RULES),
            qualifiers_per_group=RULES.qualifiers_per_group,
        )

        body = response.model_dump()

        assert sorted(body["gruppen"]) == ["A", "B", "C", "D"]
        assert body["gruppen"]["B"] == []
        assert body["acknowledged"] == 1
        assert body["format"] == "grouped"
        # The cutoff rides with the table it applies to, so no page marks one season's standing with another's number.
        assert body["qualifiers_per_group"] == 2

    # Validation already rejects these, so reaching the guard needs `model_construct`. `X` is why it
    # cannot test `not team.gruppe`: that catches empty and None and lets anything else `KeyError`.
    @pytest.mark.parametrize("gruppe", ["", "X", "a", " ", "AB"])
    def test_refuses_a_team_it_cannot_place(self, team, gruppe):
        """Fails loudly rather than dropping the team, which the frontend would discard from the table."""
        unplaceable = FLTeam.model_construct(**{**team(), "gruppe": gruppe})

        with pytest.raises(ValueError, match="not one of A/B/C/D"):
            build_gruppen([unplaceable], spiele=[], rules=RULES)


class TestFLTeamRecord:
    """`FLTeam` cannot be echoed by a write: its season-scoped fields come from a junction row, and a club with none 404s there."""

    def test_accepts_a_stored_club_document(self, team):
        parsed = FLTeamRecord.model_validate(team())

        assert str(parsed.id) == "6890a1b2c3d4e5f607182930"
        assert parsed.inactive_since is None

    def test_accepts_a_document_carrying_none_of_the_season_scoped_fields(self, team, address):
        """The case the write path produces: the same document validated against `FLTeam` fails on all three fields."""
        stored = {key: value for key, value in team().items() if key not in {"gruppe", "austritt", "statistik"}}

        assert FLTeamRecord.model_validate(stored).name == "Carl-Schurz"

        with pytest.raises(ValidationError):
            FLTeam.model_validate(stored)

    def test_carries_the_retirement_date(self, team):
        """`inactive_since` is what a soft delete writes, so the model a delete echoes has to carry it."""
        assert FLTeamRecord.model_validate(team(inactive_since="2026-03-01")).inactive_since == "2026-03-01"

    def test_shares_the_name_constraint(self, team, assert_rejects):
        assert_rejects(FLTeamRecord, team(name=""), "name")
