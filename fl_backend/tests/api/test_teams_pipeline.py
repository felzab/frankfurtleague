from collections.abc import Mapping
from typing import Any

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spiele.schemas import FLSpiel
from app.api.teams.services import (
    AS_NAME,
    build_statistik_by_team,
    build_team_pipeline,
    counted_goals,
)
from app.shared.schemas.literals import FLSpielerStufe

# Typed as the `Literal` list `FLSaisonRules` declares: a bare `list[str]` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

STANDARD_RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    loss_points=0,
    qualifiers_per_gruppe=2,
    number_of_gruppen=4,
    teams_per_gruppe=4,
    tiebreak_order="tordifferenz",
    max_kader_size=18,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    allowed_stufen=STUFEN,
)

Pipeline = list[Mapping[str, Any]]


def junction_match(pipeline: Pipeline) -> Mapping[str, Any] | None:
    """The sub-pipeline's first stage is always the `$expr` join, so a filter's contribution is the second."""
    junction = next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == AS_NAME)
    extra = junction["pipeline"][1:]

    return extra[0]["$match"] if extra else None


def test_a_shoot_out_leaves_the_goals_it_was_played_over_alone(spiel, spiel_team_field):
    """A shoot-out decides the bracket and never the table.

    `counted_goals` is asked directly because the standings are handed the group phase alone, so
    no standing reaches a knockout tie.
    """
    level = FLSpiel.model_validate(
        spiel(saison_phase="halbfinale", team1=spiel_team_field(tore=1), ergebnis="1:1", elfmeterschiessen={"team1": 4, "team2": 3})
    )

    counted = counted_goals(level)

    assert counted is not None
    _, tore1, _, tore2 = counted

    assert (tore1, tore2) == (1, 1)
    # A draw for each side, whoever won the kicks after it.
    figures = build_statistik_by_team([level], STANDARD_RULES)
    assert [(row.siege, row.unentschieden, row.niederlagen) for row in figures.values()] == [(0, 1, 0)] * 2


def test_a_team_that_has_left_stays_in_the_table():
    """The join narrows on the season alone, so an Austritt takes no club out of its group."""
    assert junction_match(build_team_pipeline(saison_id="2026")) == {"saison_id": "2026"}
