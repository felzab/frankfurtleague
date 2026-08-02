"""
`build_team_pipeline` — the derived league table (ADR-0026).

The arithmetic itself runs inside MongoDB and this suite has no database, so what is pinned here is
the set of RULES the pipeline encodes: which matches count, where the points come from, and what a
team with no matches is served. Those are the parts a later edit can get wrong silently — the
aggregation would still run, and the table would just be a different table.

Deliberately structural. A test asserting the exact stage list would fail on every harmless
refactor; these locate the stage they care about by name and assert only the rule.
"""

from typing import Any, Mapping

import pytest

from app.api.saisons.schemas import FLSaisonRules
from app.api.teams.schemas import FLTeamsFilterParams, FLTeamStatistik
from app.api.teams.services import STATISTIK_AS_NAME, build_team_pipeline

STANDARD_RULES = FLSaisonRules(win_points=3, draw_points=1)

Pipeline = list[Mapping[str, Any]]


# Keyword parameters rather than **kwargs forwarded into the model: the filters a test varies are a
# closed set of three, and spelling them out is what lets a typo be a type error here instead of a
# silently ignored key inside Pydantic.
def build(*, rules: FLSaisonRules = STANDARD_RULES, saison_id: str = "2026", compact: bool = False) -> Pipeline:
    """A pipeline for season 2026 under 3/1/0, unless a test says otherwise."""
    return build_team_pipeline(filters=FLTeamsFilterParams(saison_id=saison_id, compact=compact), rules=rules)


def statistik_stage(pipeline: Pipeline) -> Mapping[str, Any]:
    """The `$lookup` into `spiele`, found by its `as` name rather than by position."""
    return next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == STATISTIK_AS_NAME)


def projection(pipeline: Pipeline) -> Mapping[str, Any]:
    return next(stage["$project"] for stage in pipeline if "$project" in stage)


def test_requires_a_resolved_saison_id():
    """Statistics are per season, so an unresolved filter must raise rather than sum nothing."""
    with pytest.raises(ValueError, match="saison_id"):
        build_team_pipeline(filters=FLTeamsFilterParams(), rules=STANDARD_RULES)


def test_counts_a_match_exactly_when_it_carries_an_ergebnis():
    """The counting rule (ADR-0026), and that it is scoped to the requested season rather than all of them."""
    match_stage = statistik_stage(build())["pipeline"][0]["$match"]

    assert match_stage["ergebnis"] == {"$ne": None}
    assert match_stage["saison_id"] == "2026"


def test_never_consults_is_canceled():
    """
    The forfeit rule, and the one worth a whole test: a cancelled match WITH a result still counts.

    Three matches in season 2026 are in that state. Adding an `is_canceled` filter looks like an
    obvious correction and would silently remove them from the table, so this asserts over the entire
    serialised pipeline rather than one stage — the field must appear nowhere.
    """
    assert "is_canceled" not in repr(build())


def test_scores_with_the_seasons_own_points_rather_than_a_constant():
    """A 2/0/0 season, which shares no number with the 3/1/0 default — a hardcoded scheme cannot pass both."""
    unusual = FLSaisonRules(win_points=2, draw_points=0)

    punkte = statistik_stage(build(rules=unusual))["pipeline"][-1]["$project"]["punkte"]

    assert punkte == {"$add": [{"$multiply": ["$siege", 2]}, {"$multiply": ["$unentschieden", 0]}]}


def test_a_defeat_scores_nothing_because_the_rules_carry_no_loss_points():
    """`punkte` is built from wins and draws only — a third term could not be sourced from FLSaisonRules."""
    punkte = statistik_stage(build())["pipeline"][-1]["$project"]["punkte"]

    assert [term["$multiply"][0] for term in punkte["$add"]] == ["$siege", "$unentschieden"]


def test_serves_a_zeroed_statistik_to_a_team_with_no_counting_match():
    """`$group` emits nothing for an empty input, so the fallback must carry all seven fields or the response fails validation."""
    fallback = projection(build())["statistik"]["$ifNull"][1]

    assert set(fallback) == set(FLTeamStatistik.model_fields)
    assert set(fallback.values()) == {0}


def test_reads_statistik_from_no_stored_copy():
    """The junction still supplies gruppe and disqualification; `statistik` no longer comes from it, or from anywhere."""
    projected = projection(build())

    assert projected["statistik"] == {"$ifNull": [{"$first": f"${STATISTIK_AS_NAME}"}, {field: 0 for field in FLTeamStatistik.model_fields}]}
    assert "$saison_data.statistik" not in repr(projected)
    assert projected["gruppe"] == "$saison_data.gruppe"
    assert projected["is_disqualified"] == "$saison_data.is_disqualified"


def test_the_compact_shape_still_carries_statistik():
    """`compact` drops the heavy prose fields, never the table — the Saisontabelle is a compact caller."""
    projected = projection(build(compact=True))

    assert "statistik" in projected
    assert "description" not in projected


def test_derives_the_statistics_after_the_strict_junction_join():
    """Ordering, not style: summing matches before the join would do the work for teams the join then drops."""
    pipeline = build()
    stage_names = [next(iter(stage)) for stage in pipeline]
    statistik_index = next(i for i, stage in enumerate(pipeline) if stage.get("$lookup", {}).get("as") == STATISTIK_AS_NAME)

    assert stage_names.index("$unwind") < statistik_index
