"""
TEAMS · aggregation pipeline

Builds the read pipeline for `GET /teams`. The shape exists because a team document is
SEASON-INDEPENDENT: name, shorthand, address and description live on `teams`, while everything scoped to
a season -- `gruppe`, `statistik`, `is_disqualified` -- lives on the `saison_teams` junction and is joined
here. `FLTeam` flattens the two back together, which is why the model looks like one document and is not.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • With a `saison_id` the join is STRICT (`preserveNullAndEmptyArrays: False`). A team with no junction
    row for that season disappears from results entirely rather than returning with unset `gruppe` and
    `statistik`, which would fail response validation.
  • The base `$match` runs BEFORE the `$lookup`, on purpose -- filtering after the join costs memory.
  • `compact` omits the heavy string fields. It is a projection choice, not a different entity.

 ⚠ KNOWN ISSUE -- CONFIRMED ───────────────────────────────────────────────────────────────────────────────

  `statistik` is READ here from the junction, but the admin result edit WRITES it to the base `teams`
  collection (`app/api/admin/services.py`). Nothing in this service copies between them, and nothing in
  this repository writes to `saison_teams` at all -- so editing a result does not move the league table.
  Confirmed against the live database on 2026-08-02. The junction's figures are accurate because they
  are maintained by hand, NOT because anything in the application writes them.

  The read side is correct and must not change; the write side is what moves. Full evidence:
  docs/roadmap/open-items.md, item F4.
"""

from typing import Any, Mapping

from app.api.teams.schemas import FLTeamsFilterParams

SAISON_TEAMS_COLLECTION_NAME = "saison_teams"
AS_NAME = "saison_data"


def build_team_pipeline(filters: FLTeamsFilterParams) -> list[Mapping[str, Any]]:
    pipeline: list[Mapping[str, Any]] = []

    # ==========================================
    # STAGE 1: PRE-LOOKUP FILTER (Base Collection)
    # ==========================================
    base_match = {}

    # Custom boolean logic for placeholders
    if not filters.include_placeholders:
        base_match["is_placeholder"] = False

    # If querying a specific team, filter the base collection's _id immediately
    if getattr(filters, "team_id", None):
        base_match["_id"] = filters.team_id

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
    # STAGE 3: FLATTENING & PROJECTION
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

    projection_stage = {
        "_id": 1,
        "name": 1,
        "shorthand": 1,
        "address": 1,
        "statistik": f"${AS_NAME}.statistik",
        "is_disqualified": f"${AS_NAME}.is_disqualified",
    }

    # Memory optimization: Only project heavy string fields if NOT compact
    if not getattr(filters, "compact", False):
        projection_stage.update(
            {
                "is_placeholder": 1,
                "description": 1,
                "full_name": 1,
                "website_url": 1,
                "saison_id": f"${AS_NAME}.saison_id",
                "gruppe": f"${AS_NAME}.gruppe",
            }
        )

    pipeline.append({"$project": projection_stage})

    # ==========================================
    # STAGE 4: SORTING & LIMITING
    # ==========================================
    pipeline.append({"$sort": {filters.sort_by: 1 if filters.order == "asc" else -1, "name": 1}})

    if getattr(filters, "limit", None) is not None:
        pipeline.append({"$limit": filters.limit})

    return pipeline
