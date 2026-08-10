"""
TEAMS · `build_team_pipeline` — the derived league table (ADR-0019)

What is pinned is the set of rules the pipeline encodes: which matches count, which phase they
come from, where the points come from, and what a team with no matches is served — the parts a
later edit can get wrong silently. Deliberately structural and without a database: locating each
stage by name rather than asserting the stage list keeps every harmless refactor green.

`test_teams_pipeline_execution.py` is the other half and does not replace this one: this file
fails when a rule is DELETED, that one when a rule is present but WRONG (ADR-0023).
"""

from typing import Any, Mapping

import pytest
from bson import ObjectId

from app.api.saisons.schemas import FLSaisonRules
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.schemas import FLTeamsFilterParams, FLTeamStatistik, FLTeamStatistikScope
from app.api.teams.services import AS_NAME, STATISTIK_AS_NAME, build_team_pipeline

# The levels the seeded season offers, typed as the Literal list `FLSaisonRules` declares -- a bare
# list of `str` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

STANDARD_RULES = FLSaisonRules(
    win_points=3, draw_points=1, qualifiers_per_group=2, number_of_groups=4, teams_per_group=4, erlaubte_stufen=STUFEN
)

Pipeline = list[Mapping[str, Any]]


# Keyword parameters rather than **kwargs forwarded into the model: the filters a test varies are a
# closed set of four, and spelling them out makes a typo a type error here instead of a silently
# ignored key inside Pydantic.


# `scope` is deliberately not defaulted. It has a default on the model, and that default is itself a
# decision (ADR-0022) -- restating it here would let the model's default change while every test
# kept passing.
def build(
    *,
    rules: FLSaisonRules = STANDARD_RULES,
    saison_id: str = "2026",
    scope: FLTeamStatistikScope | None = None,
    team_id: Any | None = None,
    is_disqualified: bool | None = None,
) -> Pipeline:
    """A pipeline for season 2026 under 3/1/0, unless a test says otherwise."""
    filters = FLTeamsFilterParams(saison_id=saison_id, is_disqualified=is_disqualified)
    if scope is not None:
        filters.statistik_scope = scope

    return build_team_pipeline(filters=filters, rules=rules, team_id=team_id)


def statistik_stage(pipeline: Pipeline) -> Mapping[str, Any]:
    """The `$lookup` into `spiele`, found by its `as` name rather than by position."""
    return next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == STATISTIK_AS_NAME)


def junction_match(pipeline: Pipeline) -> Mapping[str, Any] | None:
    """
    The filter applied INSIDE the junction lookup, or None when the lookup only joins on the team id.

    The first stage of that sub-pipeline is always the `$expr` join, so anything a filter contributes is
    the second — and its absence is itself the assertion in one case below.
    """
    junction = next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == AS_NAME)
    extra = junction["pipeline"][1:]

    return extra[0]["$match"] if extra else None


def projection(pipeline: Pipeline) -> Mapping[str, Any]:
    return next(stage["$project"] for stage in pipeline if "$project" in stage)


def test_requires_a_resolved_saison_id():
    """Statistics are per season, so an unresolved filter must raise rather than sum nothing."""
    with pytest.raises(ValueError, match="saison_id"):
        build_team_pipeline(filters=FLTeamsFilterParams(), rules=STANDARD_RULES)


def test_counts_a_match_exactly_when_it_carries_an_ergebnis():
    """The counting rule (ADR-0019), and that it is scoped to the requested season rather than all of them."""
    match_stage = statistik_stage(build())["pipeline"][0]["$match"]

    assert match_stage["ergebnis"] == {"$ne": None}
    assert match_stage["saison_id"] == "2026"


def test_counts_only_the_gruppenphase_unless_asked_otherwise():
    """
    The default scope, and it is the decision rather than a convenience (ADR-0022).

    Both scopes return the same seven fields, so a caller that forgets the parameter gets a plausible
    table either way — which is why the safe value has to be the one you get by saying nothing.
    """
    match_stage = statistik_stage(build())["pipeline"][0]["$match"]

    assert match_stage["saison_phase"] == "gruppenphase"


def test_the_gesamt_scope_filters_on_no_phase_at_all():
    """Absent, not negated: there is no stored `saison_phase` meaning "any", so the key must not appear."""
    match_stage = statistik_stage(build(scope="gesamt"))["pipeline"][0]["$match"]

    assert "saison_phase" not in match_stage


def test_the_scope_narrows_the_matches_and_nothing_else():
    """
    The two tables are one pipeline.

    A scope that changed the projection, the sort or the fallback would make them two, which is the
    arrangement ADR-0019 exists to avoid.
    """
    gruppenphase, gesamt = build(), build(scope="gesamt")

    assert projection(gruppenphase) == projection(gesamt)
    assert len(gruppenphase) == len(gesamt)


def test_never_consults_is_canceled():
    """
    The forfeit rule, and the one worth a whole test: a cancelled match WITH a result still counts.

    The live season holds matches in that state (seen 2026-08-09). Adding an `is_canceled` filter looks
    like an obvious correction and would silently remove them from the table, so this asserts over the
    entire serialised pipeline rather than one stage — the field must appear nowhere.
    """
    assert "is_canceled" not in repr(build())


def test_scores_with_the_seasons_own_points_rather_than_a_constant():
    """A 2/0/0 season, which shares no number with the 3/1/0 default — a hardcoded scheme cannot pass both."""
    unusual = FLSaisonRules(win_points=2, draw_points=0, qualifiers_per_group=2, number_of_groups=4, teams_per_group=4, erlaubte_stufen=STUFEN)

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
    """The junction supplies gruppe and disqualification; `statistik` comes from no stored copy (ADR-0019)."""
    projected = projection(build())

    assert projected["statistik"] == {"$ifNull": [{"$first": f"${STATISTIK_AS_NAME}"}, {field: 0 for field in FLTeamStatistik.model_fields}]}
    assert "$saison_data.statistik" not in repr(projected)
    assert projected["gruppe"] == "$saison_data.gruppe"
    assert projected["disqualifikation"] == "$saison_data.disqualifikation"


class TestTheDisqualifiedFilterIsTranslated:
    """
    `is_disqualified` is a QUESTION and the junction stores no boolean to answer it with (ADR-0047).

    Three cases because the translation has three outcomes and two of them are easy to get wrong: a
    dumped `True` would match nothing at all, and a dumped `False` would match nothing either — both
    silently, as an empty group rather than an error.
    """

    def test_true_selects_the_rows_holding_a_record(self):
        assert junction_match(build(is_disqualified=True)) == {"saison_id": "2026", "disqualifikation": {"$ne": None}}

    def test_false_selects_the_rows_holding_none(self):
        """An explicit null, which also excludes a row missing the key — the state the seed removes."""
        assert junction_match(build(is_disqualified=False)) == {"saison_id": "2026", "disqualifikation": None}

    def test_an_omitted_filter_asks_nothing_about_disqualification(self):
        """A disqualified team stays in the table, so the default read must not narrow on the field."""
        assert junction_match(build()) == {"saison_id": "2026"}


def test_there_is_exactly_one_team_shape():
    """
    One projection, whatever the caller asked for (ADR-0027).

    Asserted as the FULL key set rather than a spot check: a reduced variant would be added by
    branching here, and a test that only looked for `statistik` would keep passing while a caller
    silently lost `gruppe` — which is the bug the reduced shape actually had.
    """
    projected = projection(build())

    assert set(projected) == set(projection(build(team_id=ObjectId())))
    assert {"statistik", "gruppe", "description", "full_name", "website_url"} <= set(projected)


def test_derives_the_statistics_after_the_strict_junction_join():
    """Ordering, not style: summing matches before the join would do the work for teams the join then drops."""
    pipeline = build()
    stage_names = [next(iter(stage)) for stage in pipeline]
    statistik_index = next(i for i, stage in enumerate(pipeline) if stage.get("$lookup", {}).get("as") == STATISTIK_AS_NAME)

    assert stage_names.index("$unwind") < statistik_index
