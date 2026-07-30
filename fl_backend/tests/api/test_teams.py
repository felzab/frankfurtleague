"""
FLTeam, FLTeamStatistik and FLGruppen.

FLGruppen carries the only behavioural change of Wave 4's backend work, so it gets the most
attention here: it must always emit all four groups, and must refuse a team it cannot place.
"""

import pytest
from pydantic import ValidationError

from app.api.teams.schemas import FLGruppen, FLTeam, FLTeamCompact


def test_accepts_a_valid_team(team):
    parsed = FLTeam.model_validate(team())
    assert parsed.gruppe == "A"
    assert str(parsed.id) == "6890a1b2c3d4e5f607182930"


@pytest.mark.parametrize("field", ["name", "full_name"])
def test_rejects_an_empty_required_name(team, field):
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(**{field: ""}))


# description is the counterpart: genuinely optional prose, so "" is legal. This pair is
# audit row R3a-B1.3 -- the two fields used to disagree about emptiness.
def test_accepts_an_empty_description(team):
    assert FLTeam.model_validate(team(description="")).description == ""


@pytest.mark.parametrize("gruppe", ["X", "", "a", "AB", "1"])
def test_rejects_a_group_outside_a_to_d(team, gruppe):
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(gruppe=gruppe))


@pytest.mark.parametrize("gruppe", ["A", "B", "C", "D"])
def test_accepts_each_of_the_four_groups(team, gruppe):
    assert FLTeam.model_validate(team(gruppe=gruppe)).gruppe == gruppe


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,x", "ftp://example.com", "example.com"])
def test_rejects_a_website_url_that_is_not_http(team, url):
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(website_url=url))


@pytest.mark.parametrize(
    "field",
    ["anzahl_gespielte_spiele", "siege", "niederlagen", "unentschieden", "tore_geschossen", "tore_kassiert", "punkte"],
)
def test_rejects_negative_statistics(team, statistik, field):
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(statistik=statistik(**{field: -1})))


@pytest.mark.parametrize("shorthand", ["C", "CSS", ""])
def test_rejects_a_shorthand_that_is_not_two_characters(team, shorthand):
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(shorthand=shorthand))


def test_compact_team_shares_the_name_constraint(team):
    with pytest.raises(ValidationError):
        FLTeamCompact.model_validate(team(name=""))


class TestFLGruppen:
    """
    The frontend's FLGruppenSchema requires all four keys. Before Wave 4 this model built its map
    from the teams present, so a season with nobody in group D omitted "D" and the frontend parse
    failed -- taking down /dashboard/saisontabelle. It worked only because every season so far had
    teams in all four.
    """

    def test_always_emits_all_four_groups(self, team):
        grouped = FLGruppen.from_teams([FLTeam.model_validate(team(gruppe="A"))])

        assert sorted(grouped.root) == ["A", "B", "C", "D"]

    def test_leaves_unpopulated_groups_as_empty_lists(self, team):
        grouped = FLGruppen.from_teams([FLTeam.model_validate(team(gruppe="A"))])

        assert len(grouped.root["A"]) == 1
        assert grouped.root["B"] == grouped.root["C"] == grouped.root["D"] == []

    def test_returns_all_four_groups_for_no_teams_at_all(self):
        grouped = FLGruppen.from_teams([])

        assert sorted(grouped.root) == ["A", "B", "C", "D"]
        assert all(members == [] for members in grouped.root.values())

    def test_sorts_each_group_by_points_then_goal_difference(self, team, statistik):
        weak = FLTeam.model_validate(team(name="Weak", statistik=statistik(punkte=1)))
        strong = FLTeam.model_validate(team(name="Strong", statistik=statistik(punkte=9)))
        middling = FLTeam.model_validate(team(name="Middling", statistik=statistik(punkte=4)))

        grouped = FLGruppen.from_teams([weak, strong, middling])

        assert [t.name for t in grouped.root["A"]] == ["Strong", "Middling", "Weak"]

    def test_breaks_a_points_tie_on_goal_difference(self, team, statistik):
        worse = FLTeam.model_validate(team(name="Worse", statistik=statistik(punkte=3, tore_geschossen=2, tore_kassiert=2)))
        better = FLTeam.model_validate(team(name="Better", statistik=statistik(punkte=3, tore_geschossen=9, tore_kassiert=1)))

        grouped = FLGruppen.from_teams([worse, better])

        assert [t.name for t in grouped.root["A"]] == ["Better", "Worse"]

    # Validation already rejects a blank group, so reaching this guard requires model_construct,
    # which skips validation. Owner decision: fail loudly. Previously such a team went into an
    # "UNKNOWN" bucket that the frontend silently discarded, so it vanished from the league table
    # with no error anywhere.
    def test_refuses_a_team_it_cannot_place(self, team):
        unplaceable = FLTeam.model_construct(**{**team(), "gruppe": ""})

        with pytest.raises(ValueError, match="no gruppe"):
            FLGruppen.from_teams([unplaceable])
