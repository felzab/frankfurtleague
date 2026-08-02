"""
TEAMS · aggregation pipeline

Builds the read pipeline for `GET /teams`. The shape exists because a team document is
SEASON-INDEPENDENT: name, shorthand, address and description live on `teams`, while `gruppe` and
`is_disqualified` are scoped to a season and live on the `saison_teams` junction, joined here.
`statistik` is season-scoped too and is joined from nowhere -- it is DERIVED from that season's
`spiele` documents by a second lookup. `FLTeam` flattens all of it back together, which is why the
model looks like one document and is not.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `statistik` is COMPUTED on every read and stored nowhere. There is no second copy to drift, which
    is the whole point -- see the DECISIONS note below before reaching for a cache.
  • A match counts towards the table exactly when it carries an `ergebnis`. `is_canceled` is
    deliberately NOT consulted: a cancelled match with a recorded result is a FORFEIT, and a forfeit
    counts. Three matches in season 2026 are in that state.
  • WHICH matches are in scope is `filters.statistik_scope`, and it defaults to the Gruppenphase. The
    league table is a group standing, so a playoff result must not move it; `"gesamt"` is the same
    pipeline without the phase filter, and is what a team's own page asks for.
  • Points come from the season's own `rules`, so the pipeline cannot be built from the filters
    alone -- it takes an `FLSaisonRules` as well.
  • A resolved `saison_id` is REQUIRED. The statistics are per season, so building without one would
    silently return every team's table as zeros rather than raise.
  • With a `saison_id` the junction join is STRICT (`preserveNullAndEmptyArrays: False`). A team with
    no junction row for that season disappears from results entirely rather than returning with unset
    `gruppe`, which would fail response validation.
  • The base `$match` runs BEFORE both lookups, on purpose -- filtering after a join costs memory.

 DECISIONS ────────────────────────────────────────────────────────────────────────────────────────────────

  ADR-0026  team statistics are derived from `spiele`, never stored -- so caching or storing the
            table here is that decision reversed, not an optimisation
  ADR-0029  the league table counts the Gruppenphase, and that is the default scope

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/_decisions/0026-team-statistics-are-derived-from-spiele.md -- the decision, and what it rejected
  docs/_decisions/0029-the-league-table-counts-the-gruppenphase.md -- the scope, and why it defaults
  docs/glossary.md -- "Statistik", the same counting rules in domain terms
"""

from typing import Any, Mapping

from app.api.saisons.schemas import FLSaisonRules
from app.api.teams.schemas import FLTeamsFilterParams, FLTeamStatistik, FLTeamStatistikScope

SAISON_TEAMS_COLLECTION_NAME = "saison_teams"
SPIELE_COLLECTION_NAME = "spiele"
AS_NAME = "saison_data"
STATISTIK_AS_NAME = "statistik_data"

# What a team whose season holds no counting match gets. Derived from the model rather than written
# out, so a field added to FLTeamStatistik cannot be forgotten here and fail response validation.
ZERO_STATISTIK: Mapping[str, int] = {field_name: 0 for field_name in FLTeamStatistik.model_fields}


def build_statistik_lookup_stage(saison_id: str, rules: FLSaisonRules, scope: FLTeamStatistikScope) -> Mapping[str, Any]:
    """
    The `$lookup` deriving one team's seven statistics from the season's matches (ADR-0026).

    A match counts exactly when it carries an `ergebnis`. `is_canceled` is deliberately not consulted:
    a cancelled match with a result is a forfeit, and a forfeit counts.

    `scope` decides which matches are in scope at all (ADR-0029): `"gruppenphase"` is the league table
    and narrows to that phase, `"gesamt"` is every phase and is what a team's own page shows.
    """

    is_this_team_in_slot_one = {"$eq": ["$team1.team_id", "$$team_oid"]}

    phase_match: Mapping[str, Any] = {"saison_phase": "gruppenphase"} if scope == "gruppenphase" else {}

    return {
        "$lookup": {
            "from": SPIELE_COLLECTION_NAME,
            "let": {"team_oid": "$_id"},
            "pipeline": [
                {
                    "$match": {
                        "saison_id": saison_id,
                        # The phase rule (ADR-0029), and the only difference between the two tables.
                        # Absent entirely under "gesamt" rather than negated -- there is no
                        # `saison_phase` value meaning "any", and an `$in` over all four would have to
                        # be widened by hand the day a fifth phase is added.
                        **phase_match,
                        # The counting rule, in one place. Note what is absent: `is_canceled` (ADR-0026).
                        "ergebnis": {"$ne": None},
                        # `ergebnis` is derived from these two by the admin write path, so this restates
                        # the line above rather than adding a rule. It is restated because a document
                        # edited by hand is the one place the two can disagree, and a null goal count
                        # would then group as a 0:0 draw instead of dropping out.
                        "team1.tore": {"$ne": None},
                        "team2.tore": {"$ne": None},
                        "$expr": {"$or": [is_this_team_in_slot_one, {"$eq": ["$team2.team_id", "$$team_oid"]}]},
                    }
                },
                {
                    # Both teams are embedded in the one match document, so each match is first turned
                    # around to face THIS team before anything is counted.
                    "$project": {
                        "_id": 0,
                        "tore_self": {"$cond": [is_this_team_in_slot_one, "$team1.tore", "$team2.tore"]},
                        "tore_opponent": {"$cond": [is_this_team_in_slot_one, "$team2.tore", "$team1.tore"]},
                    }
                },
                {
                    "$group": {
                        "_id": None,
                        "anzahl_gespielte_spiele": {"$sum": 1},
                        "siege": {"$sum": {"$cond": [{"$gt": ["$tore_self", "$tore_opponent"]}, 1, 0]}},
                        "unentschieden": {"$sum": {"$cond": [{"$eq": ["$tore_self", "$tore_opponent"]}, 1, 0]}},
                        "niederlagen": {"$sum": {"$cond": [{"$lt": ["$tore_self", "$tore_opponent"]}, 1, 0]}},
                        "tore_geschossen": {"$sum": "$tore_self"},
                        "tore_kassiert": {"$sum": "$tore_opponent"},
                    }
                },
                {
                    # Points come last, from the season's own rules. A defeat adds nothing because
                    # FLSaisonRules carries no loss_points -- that is the model's statement, not a
                    # third constant chosen here.
                    "$project": {
                        "_id": 0,
                        "anzahl_gespielte_spiele": 1,
                        "siege": 1,
                        "unentschieden": 1,
                        "niederlagen": 1,
                        "tore_geschossen": 1,
                        "tore_kassiert": 1,
                        "punkte": {
                            "$add": [
                                {"$multiply": ["$siege", rules.win_points]},
                                {"$multiply": ["$unentschieden", rules.draw_points]},
                            ]
                        },
                    }
                },
            ],
            "as": STATISTIK_AS_NAME,
        }
    }


def build_team_pipeline(filters: FLTeamsFilterParams, rules: FLSaisonRules, team_id: Any | None = None) -> list[Mapping[str, Any]]:
    # Not a filter that may be omitted: the statistics below are per season, so without one this would
    # match no match at all and hand back a table of zeros that looks like a real answer. The router
    # resolves it (ADR-0002) before calling.
    if filters.saison_id is None:
        raise ValueError("build_team_pipeline requires a resolved saison_id -- statistics are derived per season (ADR-0026).")

    pipeline: list[Mapping[str, Any]] = []

    # ==========================================
    # STAGE 1: PRE-LOOKUP FILTER (Base Collection)
    # ==========================================
    base_match: dict[str, Any] = {}

    # Custom boolean logic for placeholders
    if not filters.include_placeholders:
        base_match["is_placeholder"] = False

    # Clubs that have left the league (ADR-0032). Not the same as a team disqualified FOR a season --
    # that is `is_disqualified` on the junction, filtered inside the lookup below, and a disqualified
    # team stays in the table.
    if not filters.include_inactive:
        base_match["inactive_since"] = None

    # An argument rather than a filter field: `GET /teams/{team_id}` addresses one document, and the
    # difference between "this team" and "teams matching" is the difference between a path and a query.
    if team_id is not None:
        base_match["_id"] = team_id

    # Apply the base match BEFORE the lookup to save memory
    if base_match:
        pipeline.append({"$match": base_match})

    # ==========================================
    # STAGE 2: IN-LOOKUP FILTER (Junction Collection)
    # ==========================================
    # Use Pydantic's model_dump with your specific includes for the season data
    lookup_filters = filters.model_dump(
        include={"saison_id", "gruppe", "is_disqualified"},
        exclude_none=True,
        context={"keep_oid": True},
    )

    lookup_pipeline: list[Mapping[str, Any]] = [{"$match": {"$expr": {"$eq": ["$team_id", "$$base_team_id"]}}}]

    if lookup_filters:
        lookup_pipeline.append({"$match": lookup_filters})

    pipeline.append(
        {
            "$lookup": {
                "from": SAISON_TEAMS_COLLECTION_NAME,
                "let": {"base_team_id": "$_id"},
                "pipeline": lookup_pipeline,
                "as": AS_NAME,
            }
        }
    )

    # ==========================================
    # STAGE 3: FLATTENING
    # ==========================================
    strict_join = bool(getattr(filters, "saison_id", None))
    pipeline.append(
        {
            "$unwind": {
                "path": f"${AS_NAME}",
                "preserveNullAndEmptyArrays": not strict_join,
            }
        }
    )

    # ==========================================
    # STAGE 4: DERIVED STATISTICS
    # ==========================================
    # After the strict unwind, so the matches are only summed for teams that survive the join.
    pipeline.append(build_statistik_lookup_stage(saison_id=filters.saison_id, rules=rules, scope=filters.statistik_scope))

    # ==========================================
    # STAGE 5: PROJECTION
    # ==========================================
    # One projection, because there is one team shape. Never branch a reduced variant off it: measured
    # 2026-08-02, the trim is 26 KiB across all 17 teams and no query work at all -- both lookups above
    # run either way -- in exchange for a second hand-mirrored model pair (ADR-0034).
    pipeline.append(
        {
            "$project": {
                "_id": 1,
                "name": 1,
                "shorthand": 1,
                "address": 1,
                "is_placeholder": 1,
                "description": 1,
                "full_name": 1,
                "website_url": 1,
                "inactive_since": 1,
                # The lookup yields one grouped document, or none at all for a team with no counting
                # match -- `$group` emits nothing for an empty input rather than a row of zeros.
                "statistik": {"$ifNull": [{"$first": f"${STATISTIK_AS_NAME}"}, ZERO_STATISTIK]},
                "saison_id": f"${AS_NAME}.saison_id",
                "gruppe": f"${AS_NAME}.gruppe",
                "is_disqualified": f"${AS_NAME}.is_disqualified",
            }
        }
    )

    # ==========================================
    # STAGE 6: SORTING & LIMITING
    # ==========================================
    pipeline.append({"$sort": {filters.sort_by: 1 if filters.order == "asc" else -1, "name": 1}})

    if getattr(filters, "limit", None) is not None:
        pipeline.append({"$limit": filters.limit})

    return pipeline
