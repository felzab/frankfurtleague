from collections.abc import Iterator, Mapping
from typing import Any

import pytest

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spiele.schemas import FLSpiel
from app.api.teams.schemas import FLTeamsFilterParams, FLTeamStatistikScope
from app.api.teams.services import (
    AS_NAME,
    CANCELLED_AS_NAME,
    STATISTIK_AS_NAME,
    _counted_goals,
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


# Keyword rather than `**kwargs`: a typo becomes a type error. `scope` is undefaulted, or the model's default could drift.
def build(
    *,
    rules: FLSaisonRules = STANDARD_RULES,
    saison_id: str = "2026",
    scope: FLTeamStatistikScope | None = None,
) -> Pipeline:
    filters = FLTeamsFilterParams(saison_id=saison_id)
    if scope is not None:
        filters.statistik_scope = scope

    return build_team_pipeline(filters=filters, rules=rules)


def statistik_stage(pipeline: Pipeline) -> Mapping[str, Any]:
    return next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == STATISTIK_AS_NAME)


def cancelled_stage(pipeline: Pipeline) -> Mapping[str, Any]:
    return next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == CANCELLED_AS_NAME)


def junction_match(pipeline: Pipeline) -> Mapping[str, Any] | None:
    """The sub-pipeline's first stage is always the `$expr` join, so a filter's contribution is the second."""
    junction = next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == AS_NAME)
    extra = junction["pipeline"][1:]

    return extra[0]["$match"] if extra else None


def projection(pipeline: Pipeline) -> Mapping[str, Any]:
    return next(stage["$project"] for stage in pipeline if "$project" in stage)


def test_counts_a_match_exactly_when_it_carries_an_ergebnis():
    match_stage = statistik_stage(build())["pipeline"][0]["$match"]

    assert match_stage["ergebnis"] == {"$ne": None}
    assert match_stage["saison_id"] == "2026"


def test_the_scope_narrows_the_matches_and_nothing_else():
    """A scope that changed the projection, the sort or the fallback would make the two tables two pipelines."""
    gruppenphase, gesamt = build(), build(scope="total")

    assert projection(gruppenphase) == projection(gesamt)
    assert len(gruppenphase) == len(gesamt)


def test_the_counting_lookup_never_consults_the_sonderereignis():
    """The forfeit rule: adding a `sonderereignis` filter looks like a correction, so the assertion is over the whole lookup."""
    assert not reads(statistik_stage(build()), "sonderereignis")


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


# Annotated rather than inferred: a bare tuple of `str` would widen past `FLTeamStatistikScope`.
SCOPE_PHASES: list[tuple[FLTeamStatistikScope, str | None]] = [("gruppenphase", "gruppenphase"), ("total", None)]


class TestTheCancelledLookup:
    """The one place `sonderereignis` is read, kept separate from the scoring so the event stays out of it."""

    def test_it_is_the_only_stage_reading_the_event(self):
        """A second reader would bring `sonderereignis` into the scoring."""
        readers = [stage for stage in build() if reads(stage, "sonderereignis")]

        assert [stage.get("$lookup", {}).get("as") for stage in readers] == [CANCELLED_AS_NAME]

    @pytest.mark.parametrize(("scope", "expected"), SCOPE_PHASES)
    def test_it_selects_the_same_matches_the_figures_are_derived_from(self, scope, expected):
        """Cancellations over every phase beside a match count over one would badge games the table never counted."""
        counting = statistik_stage(build(scope=scope))["pipeline"][0]["$match"]
        cancelled = cancelled_stage(build(scope=scope))["pipeline"][0]["$match"]

        assert counting.get("saison_phase") == expected
        assert cancelled.get("saison_phase") == expected
        assert cancelled["saison_id"] == counting["saison_id"]
        assert cancelled["$expr"] == counting["$expr"]


class TestTheAustrittFilterIsTranslated:
    """The junction stores no boolean, so a dumped `True` would match nothing — silently, as an empty group rather than an error."""

    def test_an_omitted_filter_asks_nothing_about_leaving(self):
        """A team that has left stays in the table, so the default read must not narrow on the field."""
        assert junction_match(build()) == {"saison_id": "2026"}


def inner_projection(pipeline: Pipeline) -> Mapping[str, Any]:
    """The allow-list the junction join ends on, which is everything it carries out of the row."""

    lookup = next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == AS_NAME)

    return lookup["pipeline"][-1]["$project"]


def junction_fields_the_projection_reads(pipeline: Pipeline) -> set[str]:
    return {value.split(".", 1)[1] for value in projection(pipeline).values() if isinstance(value, str) and value.startswith(f"${AS_NAME}.")}


class TestTheJunctionJoinWithholdsTheRestOfTheRow:
    """Both endpoints running this pipeline are BASE-TIER, and the junction row carries three people's contact records."""

    def test_the_join_carries_back_exactly_what_the_projection_reads(self):
        """An allow-list at the JOIN rather than downstream: a stage edited below it cannot then put a withheld field on a public response."""

        pipeline = build()

        assert set(inner_projection(pipeline)) - {"_id"} == junction_fields_the_projection_reads(pipeline)
