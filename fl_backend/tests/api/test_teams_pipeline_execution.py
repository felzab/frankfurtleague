from typing import Any

import pytest
from bson import ObjectId

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.schemas import (
    FLTeamListAdapter,
    FLTeamsFilterParams,
    FLTeamStatistik,
    FLTeamStatistikScope,
)
from app.api.teams.services import build_team_pipeline

from .conftest import AUSTRITT, SAISON, SeededLeague

pytestmark = pytest.mark.db

# Typed as the `Literal` list `FLSaisonRules` declares: a bare `list[str]` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

STANDARD_RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    qualifiers_per_group=2,
    number_of_groups=4,
    teams_per_group=4,
    tiebreak_order="tordifferenz",
    max_kadergroesse=18,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    erlaubte_stufen=STUFEN,
)


def rows(
    league: SeededLeague,
    *,
    scope: FLTeamStatistikScope | None = None,
    rules: FLSaisonRules = STANDARD_RULES,
    team_id: Any | None = None,
    **filters: Any,
) -> list[dict[str, Any]]:
    """`scope` is not defaulted — the model's default is itself the decision; `team_id` is a pipeline argument rather than a filter."""
    params = FLTeamsFilterParams(saison_id=SAISON, **filters)
    if scope is not None:
        params.statistik_scope = scope

    return list(league.database.teams.aggregate(build_team_pipeline(filters=params, rules=rules, team_id=team_id)))


def table(league: SeededLeague, **kwargs: Any) -> dict[str, dict[str, int]]:
    return {row["name"]: row["statistik"] for row in rows(league, **kwargs)}


# The scope


def test_the_default_scope_counts_only_the_gruppenphase(league: SeededLeague):
    """Helmholtz has played four matches and three of them are league matches."""
    assert table(league)["Helmholtz"]["anzahl_gespielte_spiele"] == 3


def test_the_gesamt_scope_adds_the_playoff_match(league: SeededLeague):
    """The divergence that keeps the default scope at `gruppenphase`."""
    assert table(league, scope="gesamt")["Helmholtz"]["anzahl_gespielte_spiele"] == 4


def test_the_playoff_win_moves_points_and_goals_too(league: SeededLeague):
    """A scope that counted the phase but dropped its goals would pass on the match count alone."""
    gruppenphase = table(league)["Helmholtz"]
    gesamt = table(league, scope="gesamt")["Helmholtz"]

    assert (gruppenphase["punkte"], gruppenphase["tore_geschossen"]) == (4, 5)
    assert (gesamt["punkte"], gesamt["tore_geschossen"]) == (7, 10)


def test_the_scopes_agree_for_a_team_with_no_playoff_match(league: SeededLeague):
    """Lessing played no Viertelfinale, so the scope must be invisible to it."""
    assert table(league)["Lessing"] == table(league, scope="gesamt")["Lessing"]


# Which matches count


def test_a_no_show_carrying_its_awarded_result_still_counts(league: SeededLeague):
    """Bock's only Gruppenphase win is a forfeit; a `sonderereignis` filter here would leave it on one match."""
    bock = table(league)["Bock"]

    assert bock["anzahl_gespielte_spiele"] == 2
    assert bock["siege"] == 1


def test_a_match_without_an_ergebnis_does_not_count(league: SeededLeague):
    """Bock has a third Gruppenphase fixture that has not been played."""
    assert table(league)["Bock"]["anzahl_gespielte_spiele"] == 2


def test_an_ergebnis_without_goal_counts_does_not_count(league: SeededLeague):
    """Without the goal-count filters this match groups as a 0:0 draw, giving Lessing a fourth match and Ohne its first."""
    figures = table(league)

    assert figures["Lessing"]["anzahl_gespielte_spiele"] == 3
    assert figures["Ohne"]["anzahl_gespielte_spiele"] == 0


def test_a_match_from_another_season_does_not_count(league: SeededLeague):
    """Helmholtz won 7:0 in 2025, so a pipeline missing its `saison_id` filter shows 12 goals rather than 5."""
    assert table(league)["Helmholtz"]["tore_geschossen"] == 5


def test_goals_are_oriented_towards_each_team(league: SeededLeague):
    """Both teams are embedded in one document, so reading the wrong side swaps scored and conceded — invisible in a match count."""
    figures = table(league)

    assert (figures["Helmholtz"]["tore_geschossen"], figures["Helmholtz"]["tore_kassiert"]) == (5, 7)
    assert (figures["Bock"]["tore_geschossen"], figures["Bock"]["tore_kassiert"]) == (2, 3)


class TestACalledOffFixture:
    """The two counts are deliberately not a partition: a forfeit is in this figure and in `anzahl_gespielte_spiele` both."""

    def test_it_is_counted_for_both_teams(self, league: SeededLeague):
        """The `$expr` reaches either side: Ohne holds slot two of Spiel 10 and slot one of Spiel 13, so a one-slot match leaves it on 1."""
        figures = table(league)

        assert figures["Helmholtz"]["anzahl_abgesagte_spiele"] == 1
        assert figures["Ohne"]["anzahl_abgesagte_spiele"] == 2

    def test_an_abandoned_fixture_is_counted_as_played_and_not_as_an_absage(self, league: SeededLeague):
        """The distinction one flag could not draw: Spiel 14 was abandoned with a score, so it reaches one figure and not the other."""
        komplett = table(league)["Komplett"]

        assert komplett["anzahl_gespielte_spiele"] == 2
        assert komplett["siege"] == 2
        assert komplett["anzahl_abgesagte_spiele"] == 0

    def test_an_annulled_fixture_is_an_absage_and_never_a_match_played(self, league: SeededLeague):
        """Spiel 13 did not take place, so it joins the absage Ohne's Spiel 10 earns while the played figure stays where it was."""
        ohne = table(league)["Ohne"]

        assert ohne["anzahl_gespielte_spiele"] == 0
        assert ohne["anzahl_abgesagte_spiele"] == 2

    def test_it_moves_none_of_the_figures_the_table_is_built_from(self, league: SeededLeague):
        """An accumulator admitting a cancellation lands it in `unentschieden`, since `$eq: [null, null]` is true."""
        helmholtz = table(league)["Helmholtz"]

        assert {field: helmholtz[field] for field in FLTeamStatistik.model_fields if field != "anzahl_abgesagte_spiele"} == {
            "anzahl_gespielte_spiele": 3,
            "siege": 1,
            "unentschieden": 1,
            "niederlagen": 1,
            "tore_geschossen": 5,
            "tore_kassiert": 7,
            "punkte": 4,
        }

    def test_a_forfeit_is_counted_here_and_as_played_both(self, league: SeededLeague):
        """Both figures together: a filter excluding the forfeit from this count leaves the match tally right."""
        bock = table(league)["Bock"]

        assert bock["anzahl_gespielte_spiele"] == 2
        assert bock["anzahl_abgesagte_spiele"] == 1

    def test_the_scope_narrows_it_like_every_figure_beside_it(self, league: SeededLeague):
        """Helmholtz's second cancellation is a Halbfinale, so the league table must not count it and a team's own page must."""
        assert table(league)["Helmholtz"]["anzahl_abgesagte_spiele"] == 1
        assert table(league, scope="gesamt")["Helmholtz"]["anzahl_abgesagte_spiele"] == 2

    def test_a_team_with_no_cancellation_reads_zero(self, league: SeededLeague):
        """Komplett rather than a team with no match: only a team `$group` produced a document for proves the `$ifNull`."""
        assert table(league)["Komplett"]["anzahl_abgesagte_spiele"] == 0


def test_wins_draws_and_losses_partition_the_matches(league: SeededLeague):
    for name, figures in table(league, scope="gesamt").items():
        total = figures["siege"] + figures["unentschieden"] + figures["niederlagen"]
        assert total == figures["anzahl_gespielte_spiele"], f"{name} does not add up"


def test_points_come_from_the_seasons_own_rules(league: SeededLeague):
    """Helmholtz's win, draw and loss is worth 4 points under the standard rules and 2 under these."""
    unusual = STANDARD_RULES.model_copy(update={"win_points": 2, "draw_points": 0})

    assert table(league, rules=unusual)["Helmholtz"]["punkte"] == 2


def test_a_defeat_is_worth_nothing(league: SeededLeague):
    """Bock's win and loss together are worth exactly one win."""
    assert table(league)["Bock"]["punkte"] == STANDARD_RULES.win_points


def test_a_team_with_no_counting_match_is_served_zeroes(league: SeededLeague):
    """`$group` emits nothing for an empty input, so this is the `$ifNull` fallback; one missing key fails response validation."""
    ohne = table(league)["Ohne"]

    assert set(ohne) == set(FLTeamStatistik.model_fields)
    assert set(value for field, value in ohne.items() if field != "anzahl_abgesagte_spiele") == {0}


def test_a_team_with_no_junction_row_disappears(league: SeededLeague):
    """Fremd exists in `teams` and plays a 2026 match, so only the missing junction row can drop it."""
    assert "Fremd" not in table(league)


def test_the_junction_supplies_gruppe_and_disqualification(league: SeededLeague):
    by_name = {row["name"]: row for row in rows(league)}

    assert by_name["Ohne"]["gruppe"] == "B"
    # The whole record travels, not a flag: a projection flattening it to a boolean would pass a presence check.
    assert by_name["Lessing"]["austritt"] == AUSTRITT
    assert by_name["Helmholtz"]["austritt"] is None


class TestTheSeasonsOwnIdentity:
    """`name` and `shorthand` come from the junction, so a rename after the season leaves its table alone.

    Helmholtz's club document carries the later name; every other assertion in this file keys on the
    row's, which is what makes them evidence at all.
    """

    def test_the_name_is_the_rows_and_not_the_clubs(self, league: SeededLeague):
        club = league.database.teams.find_one({"_id": league.team_oids["Helmholtz"]})

        assert club is not None and club["name"] == "Helmholtz-Gymnasium"
        assert "Helmholtz" in table(league)
        assert "Helmholtz-Gymnasium" not in table(league)

    def test_the_shorthand_comes_from_the_same_row(self, league: SeededLeague):
        """Both halves of the identity or neither: a card showing the season's name under today's shorthand is the same defect twice."""

        club = league.database.teams.find_one({"_id": league.team_oids["Helmholtz"]})
        projected = {row["name"]: row for row in rows(league)}

        assert club is not None and club["shorthand"] == "HG"
        assert projected["Helmholtz"]["shorthand"] == "HE"

    def test_a_club_never_renamed_reads_the_same_either_way(self, league: SeededLeague):
        """So the two assertions above cannot be passing because the projection lost the field entirely."""

        club = league.database.teams.find_one({"_id": league.team_oids["Bock"]})
        projected = {row["name"]: row for row in rows(league)}

        assert club is not None and (club["name"], club["shorthand"]) == ("Bock", "BO")
        assert projected["Bock"]["shorthand"] == "BO"


def test_a_stored_statistik_on_the_junction_is_ignored(league: SeededLeague):
    """Helmholtz's junction row carries a `statistik` of 99s, so a read of the stored copy shows those."""
    assert table(league)["Helmholtz"]["punkte"] == 4
    assert 99 not in table(league)["Helmholtz"].values()


def test_the_result_validates_as_the_response_model(league: SeededLeague):
    """Validating through the adapter proves the projection carries every field `FLTeam` requires, Ohne's fallback included."""
    teams = FLTeamListAdapter.validate_python(rows(league))

    assert {team.name for team in teams} == {"Helmholtz", "Bock", "Lessing", "Ohne", "Komplett"}
    assert next(team for team in teams if team.name == "Ohne").statistik.punkte == 0


def test_a_single_team_query_returns_only_that_team(league: SeededLeague):
    """`GET /teams/{team_id}` narrows the base collection before either lookup, so it must still join correctly."""
    only = rows(league, team_id=league.team_oids["Bock"])

    assert [row["name"] for row in only] == ["Bock"]
    assert only[0]["statistik"]["anzahl_gespielte_spiele"] == 2


def test_the_table_comes_back_sorted_by_name(league: SeededLeague):
    """The `$sort` is the last stage before `$limit`, so it orders the derived rows rather than the raw teams."""
    assert [row["name"] for row in rows(league)] == ["Bock", "Helmholtz", "Komplett", "Lessing", "Ohne"]


def test_the_id_is_the_teams_own_id_not_the_junctions(league: SeededLeague):
    """A `$lookup` plus `$unwind` makes it easy to project the joined document's `_id` by accident."""
    by_name = {row["name"]: row for row in rows(league)}

    assert by_name["Bock"]["_id"] == league.team_oids["Bock"]
    assert isinstance(by_name["Bock"]["_id"], ObjectId)
