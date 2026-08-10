"""
TEAMS · `build_team_pipeline` executed by a real MongoDB (ADR-0023)

The sibling `test_teams_pipeline.py` asserts what the pipeline SAYS; this asserts what MongoDB
COMPUTES from it — a `$cond` picking the wrong side, a `$sum` over the wrong field, a scope
filtering on a phase no document carries. The two are complementary and neither replaces the
other.

Every test is marked `db` and deselected by default (`fl_backend/tests/README.md`).
The corpus and the expected figures are documented in `conftest.py`; this module asserts against
them and does not restate the derivation.
"""

from typing import Any

import pytest
from bson import ObjectId

from app.api.saisons.schemas import FLSaisonRules
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.schemas import (
    FLTeamListAdapter,
    FLTeamsFilterParams,
    FLTeamStatistik,
    FLTeamStatistikScope,
)
from app.api.teams.services import build_team_pipeline

from .conftest import DISQUALIFIKATION, SAISON, SeededLeague

pytestmark = pytest.mark.db

# The levels the seeded season offers, typed as the Literal list `FLSaisonRules` declares -- a bare
# list of `str` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

STANDARD_RULES = FLSaisonRules(
    win_points=3, draw_points=1, qualifiers_per_group=2, number_of_groups=4, teams_per_group=4, erlaubte_stufen=STUFEN
)


def rows(
    league: SeededLeague,
    *,
    scope: FLTeamStatistikScope | None = None,
    rules: FLSaisonRules = STANDARD_RULES,
    team_id: Any | None = None,
    **filters: Any,
) -> list[dict[str, Any]]:
    """
    Run the real pipeline and return the documents, in pipeline order.

    `scope` is not defaulted, for the same reason the structural suite does not default it: the
    default lives on the model and is itself the decision (ADR-0022). A test that wants the default
    must get it from the model.

    `team_id` is a separate parameter rather than one of `**filters` because that is what it is on the
    pipeline: `GET /teams/{team_id}` passes it as an argument, not as a filter field (ADR-0027).
    """
    params = FLTeamsFilterParams(saison_id=SAISON, **filters)
    if scope is not None:
        params.statistik_scope = scope

    return list(league.database.teams.aggregate(build_team_pipeline(filters=params, rules=rules, team_id=team_id)))


def table(league: SeededLeague, **kwargs: Any) -> dict[str, dict[str, int]]:
    """The derived statistics per team name, which is what nearly every assertion here is about."""
    return {row["name"]: row["statistik"] for row in rows(league, **kwargs)}


# The scope (ADR-0022)


def test_the_default_scope_counts_only_the_gruppenphase(league: SeededLeague):
    """Helmholtz has played four matches and three of them are league matches."""
    assert table(league)["Helmholtz"]["anzahl_gespielte_spiele"] == 3


def test_the_gesamt_scope_adds_the_playoff_match(league: SeededLeague):
    """
    The same team, the same pipeline, one parameter apart.

    This is the divergence ADR-0022 measured against the live database, reproduced from a fixture --
    and the single assertion that would fail if the scope filtered on the wrong phase.
    """
    assert table(league, scope="gesamt")["Helmholtz"]["anzahl_gespielte_spiele"] == 4


def test_the_playoff_win_moves_points_and_goals_too(league: SeededLeague):
    """Not just the match count: a scope that counted the phase but dropped its goals would pass the test above."""
    gruppenphase = table(league)["Helmholtz"]
    gesamt = table(league, scope="gesamt")["Helmholtz"]

    assert (gruppenphase["punkte"], gruppenphase["tore_geschossen"]) == (4, 5)
    assert (gesamt["punkte"], gesamt["tore_geschossen"]) == (7, 10)


def test_the_scopes_agree_for_a_team_with_no_playoff_match(league: SeededLeague):
    """Lessing played no Viertelfinale, so the scope must be invisible to it."""
    assert table(league)["Lessing"] == table(league, scope="gesamt")["Lessing"]


# Which matches count (ADR-0019)


def test_a_cancelled_match_carrying_a_result_still_counts(league: SeededLeague):
    """
    The forfeit rule, executed.

    Bock's only Gruppenphase win is a cancelled match with a recorded result. An `is_canceled` filter
    would leave Bock on one match and nothing else in this file would notice.
    """
    bock = table(league)["Bock"]

    assert bock["anzahl_gespielte_spiele"] == 2
    assert bock["siege"] == 1


def test_a_match_without_an_ergebnis_does_not_count(league: SeededLeague):
    """Bock has a third Gruppenphase fixture that has not been played."""
    assert table(league)["Bock"]["anzahl_gespielte_spiele"] == 2


def test_an_ergebnis_without_goal_counts_does_not_count(league: SeededLeague):
    """
    The hand-edited shape: `ergebnis` set, `tore` still null.

    Without the goal-count filters this match would group as a 0:0 draw, giving Lessing a fourth
    match and Ohne its first -- so both halves of that are asserted.
    """
    figures = table(league)

    assert figures["Lessing"]["anzahl_gespielte_spiele"] == 3
    assert figures["Ohne"]["anzahl_gespielte_spiele"] == 0


def test_a_match_from_another_season_does_not_count(league: SeededLeague):
    """Helmholtz won 7:0 in 2025. A pipeline missing its `saison_id` filter would show 12 goals, not 5."""
    assert table(league)["Helmholtz"]["tore_geschossen"] == 5


def test_goals_are_oriented_towards_each_team(league: SeededLeague):
    """
    Both teams are embedded in one match document, so every figure depends on a `$cond` picking a side.

    Helmholtz and Bock met in match 1 (3:1). Reading the wrong side would swap scored and conceded,
    which is invisible in a match count and obvious here.
    """
    figures = table(league)

    assert (figures["Helmholtz"]["tore_geschossen"], figures["Helmholtz"]["tore_kassiert"]) == (5, 7)
    assert (figures["Bock"]["tore_geschossen"], figures["Bock"]["tore_kassiert"]) == (2, 3)


class TestACancellationThatWasNeverPlayed:
    """
    The count that explains a short match tally, executed — and what it must leave alone.

    Every case here is about a fixture with `is_canceled` set and no `ergebnis`. Bock's cancelled
    match carries a result and belongs to the forfeit rule above; these do not, and the two must not
    reach the same figure.
    """

    def test_it_is_counted_for_both_teams(self, league: SeededLeague):
        """The `$expr` reaches either side, exactly as the counting lookup's does — a slot-one-only match would show 1 and 0."""
        figures = table(league)

        assert figures["Helmholtz"]["anzahl_ausgefallene_spiele"] == 1
        assert figures["Ohne"]["anzahl_ausgefallene_spiele"] == 1

    def test_it_moves_none_of_the_figures_the_table_is_built_from(self, league: SeededLeague):
        """
        ADR-0019 unreversed, made observable: the figures read what they did before the cancellations existed.

        Asserted as the whole set rather than on `anzahl_gespielte_spiele` alone. A cancellation has no
        goal counts, so an accumulator that admitted it would land in `unentschieden` — `$eq: [null,
        null]` is true — and the match count would stay right while the standing quietly moved.
        """
        helmholtz = table(league)["Helmholtz"]

        assert {field: helmholtz[field] for field in FLTeamStatistik.model_fields if field != "anzahl_ausgefallene_spiele"} == {
            "anzahl_gespielte_spiele": 3,
            "siege": 1,
            "unentschieden": 1,
            "niederlagen": 1,
            "tore_geschossen": 5,
            "tore_kassiert": 7,
            "punkte": 4,
        }

    def test_a_forfeit_is_not_one_of_them(self, league: SeededLeague):
        """Bock's cancelled match carries a result, so it counts as played and this figure must not see it."""
        bock = table(league)["Bock"]

        assert bock["anzahl_gespielte_spiele"] == 2
        assert bock["anzahl_ausgefallene_spiele"] == 0

    def test_the_scope_narrows_it_like_every_figure_beside_it(self, league: SeededLeague):
        """Helmholtz's second cancellation is a Halbfinale, so the league table must not count it and a team's own page must."""
        assert table(league)["Helmholtz"]["anzahl_ausgefallene_spiele"] == 1
        assert table(league, scope="gesamt")["Helmholtz"]["anzahl_ausgefallene_spiele"] == 2

    def test_a_team_with_no_cancellation_reads_zero(self, league: SeededLeague):
        """The absence has to be a number rather than a missing key, or the badge's own guard never fires."""
        assert table(league)["Lessing"]["anzahl_ausgefallene_spiele"] == 0


def test_wins_draws_and_losses_partition_the_matches(league: SeededLeague):
    """Every counted match lands in exactly one of the three buckets, for every team."""
    for name, figures in table(league, scope="gesamt").items():
        total = figures["siege"] + figures["unentschieden"] + figures["niederlagen"]
        assert total == figures["anzahl_gespielte_spiele"], f"{name} does not add up"


def test_points_come_from_the_seasons_own_rules(league: SeededLeague):
    """A 2/0/0 season. Helmholtz's 1 win, 1 draw and 1 loss is 4 points under 3/1/0 and 2 under this."""
    unusual = FLSaisonRules(win_points=2, draw_points=0, qualifiers_per_group=2, number_of_groups=4, teams_per_group=4, erlaubte_stufen=STUFEN)

    assert table(league, rules=unusual)["Helmholtz"]["punkte"] == 2


def test_a_defeat_is_worth_nothing(league: SeededLeague):
    """Bock's 1 win and 1 loss is exactly one win's worth of points."""
    assert table(league)["Bock"]["punkte"] == STANDARD_RULES.win_points


def test_a_team_with_no_counting_match_is_served_zeroes(league: SeededLeague):
    """
    `$group` emits nothing at all for an empty input, so this is the `$ifNull` fallback and not a sum.

    Asserted field by field against the model: a fallback missing one key fails response validation
    rather than returning a wrong number, which is a much less obvious failure. Ohne's cancellation is
    the exception and is checked above — it is merged over the fallback rather than grouped with it.
    """
    ohne = table(league)["Ohne"]

    assert set(ohne) == set(FLTeamStatistik.model_fields)
    assert set(value for field, value in ohne.items() if field != "anzahl_ausgefallene_spiele") == {0}


def test_a_team_with_no_junction_row_disappears(league: SeededLeague):
    """The strict join. Fremd exists in `teams` and has no row for this season, so it is not a result."""
    assert "Fremd" not in table(league)


def test_the_junction_supplies_gruppe_and_disqualification(league: SeededLeague):
    """Season-scoped fields come from the junction, which is the reason the join exists at all."""
    by_name = {row["name"]: row for row in rows(league)}

    assert by_name["Ohne"]["gruppe"] == "B"
    # The whole record travels, not a flag derived from it: the reason and the date are what FE-3's note
    # renders, and a projection that flattened this to a boolean would pass a presence check (ADR-0047).
    assert by_name["Lessing"]["disqualifikation"] == DISQUALIFIKATION
    assert by_name["Helmholtz"]["disqualifikation"] is None


def test_a_stored_statistik_on_the_junction_is_ignored(league: SeededLeague):
    """
    ADR-0019's whole point, made observable.

    Helmholtz's junction row carries a `statistik` of 99s. If any part of the pipeline read a stored
    copy -- or fell back to one -- these figures would be 99s instead of the derived numbers.
    """
    assert table(league)["Helmholtz"]["punkte"] == 4
    assert 99 not in table(league)["Helmholtz"].values()


def test_the_result_validates_as_the_response_model(league: SeededLeague):
    """
    The end-to-end claim: what the pipeline returns is what `GET /teams` may serve.

    Validating through the adapter is what proves the projection carries every field `FLTeam`
    requires -- including for Ohne, whose statistics come from the fallback rather than a `$group`.
    """
    teams = FLTeamListAdapter.validate_python(rows(league))

    assert {team.name for team in teams} == {"Helmholtz", "Bock", "Lessing", "Ohne"}
    assert next(team for team in teams if team.name == "Ohne").statistik.punkte == 0


def test_a_single_team_query_returns_only_that_team(league: SeededLeague):
    """`GET /teams/{team_id}` narrows the BASE collection before either lookup, so it must still join correctly."""
    only = rows(league, team_id=league.team_oids["Bock"])

    assert [row["name"] for row in only] == ["Bock"]
    assert only[0]["statistik"]["anzahl_gespielte_spiele"] == 2


def test_the_table_comes_back_sorted_by_name(league: SeededLeague):
    """The `$sort` is the last stage before `$limit`, so it orders the derived rows rather than the raw teams."""
    assert [row["name"] for row in rows(league)] == ["Bock", "Helmholtz", "Lessing", "Ohne"]


def test_the_id_is_the_teams_own_id_not_the_junctions(league: SeededLeague):
    """A `$lookup` plus `$unwind` makes it easy to project the joined document's `_id` by accident."""
    by_name = {row["name"]: row for row in rows(league)}

    assert by_name["Bock"]["_id"] == league.team_oids["Bock"]
    assert isinstance(by_name["Bock"]["_id"], ObjectId)
