from typing import Any, Iterator, Mapping

import pytest
from bson import ObjectId

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spiele.schemas import SONDEREREIGNIS_COUNTED_AS_ABSAGE, FLSpiel
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.schemas import FLTeamsFilterParams, FLTeamStatistik, FLTeamStatistikScope
from app.api.teams.services import (
    ABSAGE_AS_NAME,
    ABSAGE_COUNT_NAME,
    AS_NAME,
    STATISTIK_AS_NAME,
    _counted_goals,
    build_team_pipeline,
)

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
    team_id: Any | None = None,
    is_disqualified: bool | None = None,
) -> Pipeline:
    filters = FLTeamsFilterParams(saison_id=saison_id, is_disqualified=is_disqualified)
    if scope is not None:
        filters.statistik_scope = scope

    return build_team_pipeline(filters=filters, rules=rules, team_id=team_id)


def statistik_stage(pipeline: Pipeline) -> Mapping[str, Any]:
    return next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == STATISTIK_AS_NAME)


def absage_stage(pipeline: Pipeline) -> Mapping[str, Any]:
    return next(stage["$lookup"] for stage in pipeline if stage.get("$lookup", {}).get("as") == ABSAGE_AS_NAME)


def junction_match(pipeline: Pipeline) -> Mapping[str, Any] | None:
    """The sub-pipeline's first stage is always the `$expr` join, so a filter's contribution is the second."""
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
    match_stage = statistik_stage(build())["pipeline"][0]["$match"]

    assert match_stage["ergebnis"] == {"$ne": None}
    assert match_stage["saison_id"] == "2026"


def test_counts_only_the_gruppenphase_unless_asked_otherwise():
    """Both scopes return the same fields, so a caller who forgets the parameter gets a plausible table either way."""
    match_stage = statistik_stage(build())["pipeline"][0]["$match"]

    assert match_stage["saison_phase"] == "gruppenphase"


def test_the_gesamt_scope_filters_on_no_phase_at_all():
    """Absent, not negated: no stored `saison_phase` means 'any', so the key must not appear."""
    match_stage = statistik_stage(build(scope="gesamt"))["pipeline"][0]["$match"]

    assert "saison_phase" not in match_stage


def test_the_scope_narrows_the_matches_and_nothing_else():
    """A scope that changed the projection, the sort or the fallback would make the two tables two pipelines."""
    gruppenphase, gesamt = build(), build(scope="gesamt")

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
SCOPE_PHASES: list[tuple[FLTeamStatistikScope, str | None]] = [("gruppenphase", "gruppenphase"), ("gesamt", None)]


class TestTheAbsageLookup:
    """The one place `sonderereignis` is read, kept separate from the scoring so the event stays out of it."""

    def test_it_selects_on_the_event_and_nothing_else(self):
        """Narrowing to a null `ergebnis` reads like a correction and would drop every forfeit."""
        match_stage = absage_stage(build())["pipeline"][0]["$match"]

        assert match_stage["sonderereignis"] == {"$in": list(SONDEREREIGNIS_COUNTED_AS_ABSAGE)}
        assert "ergebnis" not in match_stage

    def test_it_counts_a_no_show_and_neither_an_abandonment_nor_an_annulment(self):
        """This figure's own question, which no other consumer asks: a club that never appeared was called off, and the other two were not."""
        selected = set(SONDEREREIGNIS_COUNTED_AS_ABSAGE)

        assert {"ausgefallen", "nichtantreten_team1", "nichtantreten_team2"} <= selected
        assert selected.isdisjoint({"abgebrochen", "annulliert"})

    def test_it_is_the_only_stage_reading_the_event(self):
        """A second reader would bring `sonderereignis` into the scoring."""
        readers = [stage for stage in build() if reads(stage, "sonderereignis")]

        assert [stage.get("$lookup", {}).get("as") for stage in readers] == [ABSAGE_AS_NAME]

    def test_it_counts_rather_than_carrying_the_documents_back(self):
        """A `$count` and not a `$size` over projected rows: the figure is the whole answer this lookup owes."""
        assert absage_stage(build())["pipeline"][-1] == {"$count": ABSAGE_COUNT_NAME}

    @pytest.mark.parametrize(("scope", "expected"), SCOPE_PHASES)
    def test_it_selects_the_same_matches_the_figures_are_derived_from(self, scope, expected):
        """Cancellations over every phase beside a match count over one would badge games the table never counted."""
        counting = statistik_stage(build(scope=scope))["pipeline"][0]["$match"]
        absage = absage_stage(build(scope=scope))["pipeline"][0]["$match"]

        assert counting.get("saison_phase") == expected
        assert absage.get("saison_phase") == expected
        assert absage["saison_id"] == counting["saison_id"]
        assert absage["$expr"] == counting["$expr"]


def test_scores_with_the_seasons_own_points_rather_than_a_constant():
    """A 2/0/0 season shares no number with the default scheme, so a hardcoded one cannot pass both."""
    unusual = STANDARD_RULES.model_copy(update={"win_points": 2, "draw_points": 0})

    punkte = statistik_stage(build(rules=unusual))["pipeline"][-1]["$project"]["punkte"]

    assert punkte == {"$add": [{"$multiply": ["$siege", 2]}, {"$multiply": ["$unentschieden", 0]}]}


def test_a_defeat_scores_nothing_because_the_rules_carry_no_loss_points():
    """`punkte` is built from wins and draws only — a third term could not be sourced from `FLSaisonRules`."""
    punkte = statistik_stage(build())["pipeline"][-1]["$project"]["punkte"]

    assert [term["$multiply"][0] for term in punkte["$add"]] == ["$siege", "$unentschieden"]


def test_serves_a_zeroed_statistik_to_a_team_with_no_counting_match():
    """`$group` emits nothing for an empty input, so the fallback must carry every field or the response fails validation."""
    fallback = projection(build())["statistik"]["$mergeObjects"][0]["$ifNull"][1]

    assert set(fallback) == set(FLTeamStatistik.model_fields)
    assert set(fallback.values()) == {0}


def test_the_cancellation_count_survives_the_zeroed_fallback():
    """Merged over the figures rather than into them: a team with no counting match can still have had fixtures called off."""
    merged = projection(build())["statistik"]["$mergeObjects"]

    assert merged[-1] == {"anzahl_abgesagte_spiele": {"$ifNull": [{"$first": f"${ABSAGE_AS_NAME}.{ABSAGE_COUNT_NAME}"}, 0]}}


def test_reads_statistik_from_no_stored_copy():
    projected = projection(build())

    assert projected["statistik"]["$mergeObjects"][0] == {
        "$ifNull": [{"$first": f"${STATISTIK_AS_NAME}"}, {field: 0 for field in FLTeamStatistik.model_fields}]
    }
    assert not reads(projected, AS_NAME, "statistik")
    assert projected["gruppe"] == "$saison_data.gruppe"
    assert projected["austritt"] == "$saison_data.austritt"


class TestTheDisqualifiedFilterIsTranslated:
    """The junction stores no boolean, so a dumped `True` would match nothing — silently, as an empty group rather than an error."""

    def test_true_selects_the_rows_holding_a_record(self):
        assert junction_match(build(is_disqualified=True)) == {"saison_id": "2026", "austritt": {"$ne": None}}

    def test_false_selects_the_rows_holding_none(self):
        """An explicit null, which also excludes a row missing the key — the state the seed removes."""
        assert junction_match(build(is_disqualified=False)) == {"saison_id": "2026", "austritt": None}

    def test_an_omitted_filter_asks_nothing_about_disqualification(self):
        """A disqualified team stays in the table, so the default read must not narrow on the field."""
        assert junction_match(build()) == {"saison_id": "2026"}


def test_there_is_exactly_one_team_shape():
    """Asserted as the full key set: a spot check for `statistik` would keep passing while a caller silently lost `gruppe`."""
    projected = projection(build())

    assert set(projected) == set(projection(build(team_id=ObjectId())))
    assert {"statistik", "gruppe", "description", "full_name", "website_url"} <= set(projected)


def test_derives_the_statistics_after_the_strict_junction_join():
    """Ordering, not style: summing matches before the join would do the work for teams the join then drops."""
    pipeline = build()
    stage_names = [next(iter(stage)) for stage in pipeline]
    match_lookups = {STATISTIK_AS_NAME, ABSAGE_AS_NAME}
    first_index = next(i for i, stage in enumerate(pipeline) if stage.get("$lookup", {}).get("as") in match_lookups)

    assert stage_names.index("$unwind") < first_index
