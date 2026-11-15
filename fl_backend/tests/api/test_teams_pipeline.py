from collections.abc import Iterator, Mapping
from typing import Any

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spiele.schemas import FLSpiel
from app.api.teams.services import (
    AS_NAME,
    CANCELLED_AS_NAME,
    STATISTIK_AS_NAME,
    _counted_goals,
    build_statistik_by_team,
    build_team_pipeline,
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


def _paths(node: Any) -> Iterator[tuple[str, ...]]:
    """Every key and string value in a pipeline fragment, split on `.` with a field path's `$` prefix dropped."""

    if isinstance(node, Mapping):
        for key, value in node.items():
            yield tuple(key.split("."))
            yield from _paths(value)
    elif isinstance(node, (list, tuple)):
        for item in node:
            yield from _paths(item)
    elif isinstance(node, str):
        yield tuple(node.lstrip("$").split("."))


def reads(node: Any, *path: str) -> bool:
    """Whether a fragment names `path`, as a match key or as part of a field path.

    Walked rather than matched against a `repr`, which turns on key insertion order, on quoting, and
    on any unrelated identifier that merely spells the name.
    """

    width = len(path)

    return any(candidate[index : index + width] == path for candidate in _paths(node) for index in range(len(candidate) - width + 1))


# Keyword rather than `**kwargs`: a typo becomes a type error.
def build(*, rules: FLSaisonRules = STANDARD_RULES, saison_id: str = "2026") -> Pipeline:
    return build_team_pipeline(saison_id=saison_id, rules=rules)


def statistik_stage(pipeline: Pipeline) -> Mapping[str, Any]:
    return next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == STATISTIK_AS_NAME)


def junction_match(pipeline: Pipeline) -> Mapping[str, Any] | None:
    """The sub-pipeline's first stage is always the `$expr` join, so a filter's contribution is the second."""
    junction = next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == AS_NAME)
    extra = junction["pipeline"][1:]

    return extra[0]["$match"] if extra else None


def test_counts_a_match_exactly_when_it_carries_an_ergebnis():
    match_stage = statistik_stage(build())["pipeline"][0]["$match"]

    assert match_stage["ergebnis"] == {"$ne": None}
    assert match_stage["saison_id"] == "2026"


def test_no_stage_reads_the_shoot_out():
    """A shoot-out decides the bracket and never the table, so a stage able to see it would part the two on every knockout tie."""
    assert not reads(build(), "elfmeterschiessen")


def test_a_shoot_out_leaves_the_goals_it_was_played_over_alone(spiel, spiel_team_field):
    """The same rule restated in Python.

    `_counted_goals` is imported private because the standings are handed the group phase alone, so
    no public entry point reaches a knockout tie.
    """
    level = FLSpiel.model_validate(
        spiel(saison_phase="halbfinale", team1=spiel_team_field(tore=1), ergebnis="1:1", elfmeterschiessen={"team1": 4, "team2": 3})
    )

    counted = _counted_goals(level)

    assert counted is not None
    _, tore1, _, tore2 = counted

    assert (tore1, tore2) == (1, 1)
    # A draw for each side, whoever won the kicks after it.
    figures = build_statistik_by_team([level], STANDARD_RULES)
    assert [(row.siege, row.unentschieden, row.niederlagen) for row in figures.values()] == [(0, 1, 0)] * 2


class TestTheCancelledLookup:
    """The one place `sonderereignis` is read, kept separate from the scoring so the event stays out of it."""

    def test_it_is_the_only_stage_reading_the_event(self):
        """A second reader would bring `sonderereignis` into the scoring."""
        readers = [stage for stage in build() if reads(stage, "sonderereignis")]

        assert [stage.get("$lookup", {}).get("as") for stage in readers] == [CANCELLED_AS_NAME]


def test_a_team_that_has_left_stays_in_the_table():
    """The join narrows on the season alone, so an Austritt takes no club out of its group."""
    assert junction_match(build()) == {"saison_id": "2026"}
