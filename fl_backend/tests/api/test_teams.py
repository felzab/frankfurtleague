"""
FLTeam, FLTeamStatistik and FLGruppen.

FLGruppen carries the only behavioural change of Wave 4's backend work, so it gets the most
attention here: it must always emit all four groups, and must refuse a team it cannot place.
"""

import pytest
from pydantic import ValidationError

from app.api.teams.schemas import FLGruppen, FLTeam, FLTeamCompact, FLTeamsGroupedResponse


def test_accepts_a_valid_team(team):
    """The positive baseline, and that the ObjectId round-trips as its 24-hex string."""
    parsed = FLTeam.model_validate(team())
    assert parsed.gruppe == "A"
    assert str(parsed.id) == "6890a1b2c3d4e5f607182930"


@pytest.mark.parametrize("field", ["name", "full_name"])
def test_rejects_an_empty_required_name(team, field):
    """`name` and `full_name` both need a value — a team with neither cannot be rendered anywhere."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(**{field: ""}))


# description is the counterpart: genuinely optional prose, so "" is legal. This pair is
# audit row R3a-B1.3 -- the two fields used to disagree about emptiness.
def test_accepts_an_empty_description(team):
    """The counterpart: `description` is genuinely optional prose, so "" is legal. The two used to disagree."""
    assert FLTeam.model_validate(team(description="")).description == ""


@pytest.mark.parametrize("gruppe", ["X", "", "a", "AB", "1"])
def test_rejects_a_group_outside_a_to_d(team, gruppe):
    """Unknown letter, empty, lowercase, two letters and a digit — the group is a closed set of four."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(gruppe=gruppe))


@pytest.mark.parametrize("gruppe", ["A", "B", "C", "D"])
def test_accepts_each_of_the_four_groups(team, gruppe):
    """All four accepted, so the rejection test above cannot be passing for the wrong reason."""
    assert FLTeam.model_validate(team(gruppe=gruppe)).gruppe == gruppe


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,x", "ftp://example.com", "example.com"])
def test_rejects_a_website_url_that_is_not_http(team, url):
    """A security constraint, not tidiness: this URL is rendered into an href on a public page."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(website_url=url))


@pytest.mark.parametrize(
    "field",
    ["anzahl_gespielte_spiele", "siege", "niederlagen", "unentschieden", "tore_geschossen", "tore_kassiert", "punkte"],
)
def test_rejects_negative_statistics(team, statistik, field):
    """Every one of the seven counters. They are maintained by `$inc` deltas, so a sign error surfaces here."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(statistik=statistik(**{field: -1})))


@pytest.mark.parametrize("shorthand", ["C", "CSS", ""])
def test_rejects_a_shorthand_that_is_not_two_characters(team, shorthand):
    """Exactly two, both bounds. The compact cards render this instead of the full name, so the width is fixed."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(shorthand=shorthand))


class TestFLTeamCompact:
    """
    The compact projection.

    It needs its own positive baseline: without one, the rejection test below would keep passing if
    the fixture stopped satisfying FLTeamCompact for some unrelated reason, and the constraint it
    names would go untested.
    """

    def test_accepts_the_team_fixture(self, team):
        """The projection's own positive baseline — the fixture must keep satisfying the compact model."""
        parsed = FLTeamCompact.model_validate(team())

        assert parsed.name == "Carl-Schurz"
        assert parsed.shorthand == "CS"

    def test_shares_the_name_constraint(self, team, assert_rejects):
        """The compact model inherits the same non-empty name rule rather than relaxing it."""
        assert_rejects(FLTeamCompact, team(name=""), "name")


class TestFLGruppen:
    """
    All four group keys, always.

    The frontend's FLGruppenSchema requires all four keys. This model once built its map from the
    teams present, so a season with nobody in group D omitted "D" and the frontend parse failed --
    taking down /dashboard/saisontabelle. It worked only because every season so far had teams in
    all four.
    """

    def test_always_emits_all_four_groups(self, team):
        """One team in group A still yields four keys — the bug that took down /dashboard/saisontabelle."""
        grouped = FLGruppen.from_teams([FLTeam.model_validate(team(gruppe="A"))])

        assert sorted(grouped.root) == ["A", "B", "C", "D"]

    def test_leaves_unpopulated_groups_as_empty_lists(self, team):
        """The three empty groups are `[]`, not absent and not null."""
        grouped = FLGruppen.from_teams([FLTeam.model_validate(team(gruppe="A"))])

        assert len(grouped.root["A"]) == 1
        assert grouped.root["B"] == grouped.root["C"] == grouped.root["D"] == []

    def test_returns_all_four_groups_for_no_teams_at_all(self):
        """The degenerate case: an empty season still produces a well-formed four-key response."""
        grouped = FLGruppen.from_teams([])

        assert sorted(grouped.root) == ["A", "B", "C", "D"]
        assert all(members == [] for members in grouped.root.values())

    # The tests above read `.root`. What actually broke /dashboard/saisontabelle was the SERIALISED
    # body -- the frontend's FLGruppenSchema parses the response, not the Python object -- so this
    # pins the wire shape end to end, through the response model the route really returns.
    def test_the_serialised_response_body_carries_all_four_groups(self, team):
        """The WIRE shape, not the Python object — the frontend parses the response, which is what broke."""
        response = FLTeamsGroupedResponse(gruppen=FLGruppen.from_teams([FLTeam.model_validate(team(gruppe="A"))]))

        body = response.model_dump()

        assert sorted(body["gruppen"]) == ["A", "B", "C", "D"]
        assert body["gruppen"]["B"] == []
        assert body["acknowledged"] == 1
        assert body["format"] == "grouped"

    def test_sorts_each_group_by_points_then_goal_difference(self, team, statistik):
        """Three distinct point totals order correctly, highest first."""
        weak = FLTeam.model_validate(team(name="Weak", statistik=statistik(punkte=1)))
        strong = FLTeam.model_validate(team(name="Strong", statistik=statistik(punkte=9)))
        middling = FLTeam.model_validate(team(name="Middling", statistik=statistik(punkte=4)))

        grouped = FLGruppen.from_teams([weak, strong, middling])

        assert [t.name for t in grouped.root["A"]] == ["Strong", "Middling", "Weak"]

    def test_breaks_a_points_tie_on_goal_difference(self, team, statistik):
        """Equal points, different goal difference — the second sort key, which a points-only sort would miss."""
        worse = FLTeam.model_validate(team(name="Worse", statistik=statistik(punkte=3, tore_geschossen=2, tore_kassiert=2)))
        better = FLTeam.model_validate(team(name="Better", statistik=statistik(punkte=3, tore_geschossen=9, tore_kassiert=1)))

        grouped = FLGruppen.from_teams([worse, better])

        assert [t.name for t in grouped.root["A"]] == ["Better", "Worse"]

    # Validation already rejects these, so reaching the guard requires model_construct, which skips
    # validation. Owner decision: fail loudly. Previously such a team went into an "UNKNOWN" bucket
    # that the frontend silently discarded, so it vanished from the league table with no error.
    #
    # "X" is the case that matters: the guard used to test `not team.gruppe`, which catches "" and
    # None but let any other value through to a bare KeyError -- an unhandled 500 rather than the
    # deliberate error. Parametrised so neither branch can regress unnoticed.
    @pytest.mark.parametrize("gruppe", ["", "X", "a", " ", "AB"])
    def test_refuses_a_team_it_cannot_place(self, team, gruppe):
        """Fails loudly rather than dropping the team. `"X"` is the case a falsy check let through to a bare KeyError."""
        unplaceable = FLTeam.model_construct(**{**team(), "gruppe": gruppe})

        with pytest.raises(ValueError, match="not one of A/B/C/D"):
            FLGruppen.from_teams([unplaceable])
