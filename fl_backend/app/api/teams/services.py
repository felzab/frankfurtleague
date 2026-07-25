from typing import Any, Mapping

from app.api.teams.schemas import FLTeamsFilterParams

SAISON_SPECIFIC_TEAM_DATA_DB_NAME = "saison_teams"
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
                "from": SAISON_SPECIFIC_TEAM_DATA_DB_NAME,
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
