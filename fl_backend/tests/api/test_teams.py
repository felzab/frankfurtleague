"""
TEAMS · FLTeam, FLTeamStatistik and FLGruppen

FLGruppen carries the only behavioural change in this area, so it gets the most attention here:
it must always emit all four groups, and must refuse a team it cannot place.
"""

import pytest
from pydantic import ValidationError

from app.api.saisons.schemas import FLSaisonRules
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.schemas import FLTeam, FLTeamRecord, FLTeamsGroupedResponse, FLTeamStatistik
from app.api.teams.services import build_gruppen

# Ordinary scoring. Every case below is decided on points or goals, so the head-to-head criterion
# these rules also feed is exercised in `test_standings.py` rather than here.

# The levels the seeded season offers, typed as the Literal list `FLSaisonRules` declares -- a bare
# list of `str` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

RULES = FLSaisonRules(win_points=3, draw_points=1, qualifiers_per_group=2, number_of_groups=4, teams_per_group=4, erlaubte_stufen=STUFEN)

# 20 hex characters plus a four-digit suffix, so each club in a multi-team case gets its own valid
# 24-character ObjectId and a failing assertion names the club it came from.
TEAM_ID = "6890a1b2c3d4e5f60719{:04d}"


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


# `description` is the counterpart to the required fields above: genuinely optional prose, so "" is
# legal. Tested together because the two must not agree about emptiness -- a change aligning them
# silently breaks whichever side it moves.
def test_accepts_an_empty_description(team):
    """`description` is optional prose, so "" is legal -- unlike the required fields tested above."""
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


# Taken from the model rather than listed, for ZERO_STATISTIK's reason: a counter added to
# `FLTeamStatistik` without its `ge=0` would otherwise be the one nothing here asks about.
@pytest.mark.parametrize("field", list(FLTeamStatistik.model_fields))
def test_rejects_negative_statistics(team, statistik, field):
    """Every counter the model declares. They are computed by an aggregation, so an arithmetic error surfaces here."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(statistik=statistik(**{field: -1})))


@pytest.mark.parametrize("shorthand", ["C", "CSS", ""])
def test_rejects_a_shorthand_that_is_not_two_characters(team, shorthand):
    """Exactly two, both bounds. The narrow cards render this instead of the full name, so the width is fixed."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(shorthand=shorthand))


class TestFLGruppen:
    """
    All four group keys, always.

    The frontend's FLGruppenSchema requires all four keys. The construction once built its map from the
    teams present, so a season with nobody in group D omitted "D" and the frontend parse failed --
    taking down /dashboard/saisontabelle. It worked only because every season so far had teams in
    all four.

    Every case here passes `spiele=[]`, which exercises the chain down to goals scored and no further.
    Head-to-head needs matches and is `test_standings.py`'s.
    """

    def test_always_emits_all_four_groups(self, team):
        """One team in group A still yields four keys — the bug that took down /dashboard/saisontabelle."""
        grouped = build_gruppen([FLTeam.model_validate(team(gruppe="A"))], spiele=[], rules=RULES)

        assert sorted(grouped.root) == ["A", "B", "C", "D"]

    def test_leaves_unpopulated_groups_as_empty_lists(self, team):
        """The three empty groups are `[]`, not absent and not null."""
        grouped = build_gruppen([FLTeam.model_validate(team(gruppe="A"))], spiele=[], rules=RULES)

        assert len(grouped.root["A"]) == 1
        assert grouped.root["B"] == grouped.root["C"] == grouped.root["D"] == []

    def test_returns_all_four_groups_for_no_teams_at_all(self):
        """The degenerate case: an empty season still produces a well-formed four-key response."""
        grouped = build_gruppen([], spiele=[], rules=RULES)

        assert sorted(grouped.root) == ["A", "B", "C", "D"]
        assert all(members == [] for members in grouped.root.values())

    # The tests above read `.root`. The frontend's FLGruppenSchema parses the response body, not the
    # Python object, so this pins the wire shape end to end, through the response model the route
    # returns.
    def test_the_serialised_response_body_carries_all_four_groups(self, team):
        """The WIRE shape, not the Python object — the frontend parses the response, which is what broke."""
        response = FLTeamsGroupedResponse(
            gruppen=build_gruppen([FLTeam.model_validate(team(gruppe="A"))], spiele=[], rules=RULES),
            qualifiers_per_group=RULES.qualifiers_per_group,
        )

        body = response.model_dump()

        assert sorted(body["gruppen"]) == ["A", "B", "C", "D"]
        assert body["gruppen"]["B"] == []
        assert body["acknowledged"] == 1
        assert body["format"] == "grouped"
        # The cutoff rides with the table it applies to, so a page cannot mark a prefix of one season's
        # standing using another season's number.
        assert body["qualifiers_per_group"] == 2

    # Distinct ids, because these are distinct clubs. `uniq_saison_id_team_id` gives a team one
    # junction row per season, so the standing addresses clubs by id -- three "different" teams
    # sharing one is a state the database cannot hold.
    def test_sorts_each_group_by_points_then_goal_difference(self, team, statistik):
        """Three distinct point totals order correctly, highest first."""
        weak = FLTeam.model_validate(team(_id=TEAM_ID.format(1), name="Weak", statistik=statistik(punkte=1)))
        strong = FLTeam.model_validate(team(_id=TEAM_ID.format(2), name="Strong", statistik=statistik(punkte=9)))
        middling = FLTeam.model_validate(team(_id=TEAM_ID.format(3), name="Middling", statistik=statistik(punkte=4)))

        grouped = build_gruppen([weak, strong, middling], spiele=[], rules=RULES)

        assert [t.name for t in grouped.root["A"]] == ["Strong", "Middling", "Weak"]

    def test_breaks_a_points_tie_on_goal_difference(self, team, statistik):
        """Equal points, different goal difference — the second criterion, which a points-only sort would miss."""
        worse = FLTeam.model_validate(
            team(_id=TEAM_ID.format(1), name="Worse", statistik=statistik(punkte=3, tore_geschossen=2, tore_kassiert=2))
        )
        better = FLTeam.model_validate(
            team(_id=TEAM_ID.format(2), name="Better", statistik=statistik(punkte=3, tore_geschossen=9, tore_kassiert=1))
        )

        grouped = build_gruppen([worse, better], spiele=[], rules=RULES)

        assert [t.name for t in grouped.root["A"]] == ["Better", "Worse"]

    # Validation already rejects these, so reaching the guard needs `model_construct`. The guard must
    # fail loudly: an unrecognised group routed into a catch-all is discarded by the frontend, and the
    # team vanishes from the league table.

    # "X" is why the guard must not test `not team.gruppe`: that catches "" and None but lets any
    # other value through to a bare KeyError -- an unhandled 500 rather than the deliberate error.
    # Parametrised so neither branch can regress unnoticed.
    @pytest.mark.parametrize("gruppe", ["", "X", "a", " ", "AB"])
    def test_refuses_a_team_it_cannot_place(self, team, gruppe):
        """Fails loudly rather than dropping the team. `"X"` is the case a falsy check let through to a bare KeyError."""
        unplaceable = FLTeam.model_construct(**{**team(), "gruppe": gruppe})

        with pytest.raises(ValueError, match="not one of A/B/C/D"):
            build_gruppen([unplaceable], spiele=[], rules=RULES)


class TestFLTeamRecord:
    """
    The STORED club document, which is what every write endpoint echoes.

    It exists because `FLTeam` cannot be echoed by a write: `gruppe`, `disqualifikation` and `statistik`
    come from a junction row and a derived lookup, and re-reading a club through that pipeline 404s
    when it has no `saison_teams` row for the current season -- the normal state for a club being
    created, retired or reactivated.
    """

    def test_accepts_a_stored_club_document(self, team):
        """The positive baseline. The shared fixture is a superset, so this also pins that `_id` still round-trips."""
        parsed = FLTeamRecord.model_validate(team())

        assert str(parsed.id) == "6890a1b2c3d4e5f607182930"
        assert parsed.inactive_since is None

    def test_accepts_a_document_carrying_none_of_the_season_scoped_fields(self, team, address):
        """
        The case the write path actually produces, and the whole reason this model exists.

        A club with no junction row for the current season has no `gruppe`, no `disqualifikation` and no
        `statistik` anywhere -- validating it against `FLTeam` would fail on all three.
        """
        stored = {key: value for key, value in team().items() if key not in {"gruppe", "disqualifikation", "statistik"}}

        assert FLTeamRecord.model_validate(stored).name == "Carl-Schurz"

        with pytest.raises(ValidationError):
            FLTeam.model_validate(stored)

    def test_carries_the_retirement_date(self, team):
        """`inactive_since` is what a soft delete writes, so the model a delete echoes has to carry it."""
        assert FLTeamRecord.model_validate(team(inactive_since="2026-03-01")).inactive_since == "2026-03-01"

    def test_shares_the_name_constraint(self, team, assert_rejects):
        """The stored shape inherits the same non-empty name rule rather than relaxing it."""
        assert_rejects(FLTeamRecord, team(name=""), "name")
