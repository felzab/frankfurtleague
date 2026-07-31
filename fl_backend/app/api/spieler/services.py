from typing import Any, Mapping

from app.api.spieler.schemas import FLSpielerFilterParams

SAISON_SPIELER_COLLECTION_NAME = "saison_spieler"
AS_NAME = "saison_data"


def build_spieler_pipeline(filters: FLSpielerFilterParams) -> list[Mapping[str, Any]]:

    pipeline: list[Mapping[str, Any]] = []

    # Dump the filters model, excluding null and sorting/pagination fields while keeping oids as oids
    active_filters = filters.model_dump(
        exclude_none=True,
        exclude={"limit", "sort_by", "order"},
        context={"keep_oid": True},
    )

    # Build the Sub-Pipeline for early filtering
    lookup_pipeline: list[Mapping[str, Any]] = [
        # Always match the foreign key to the base player first
        # spieler_id from saison_spieler matches to _id from spieler
        {"$match": {"$expr": {"$eq": ["$spieler_id", "$$base_spieler_id"]}}}
    ]

    # Inject season-specific filters directly into the join.
    # No 'saison_data.' prefix is needed because we are querying the season collection directly.
    if active_filters:
        lookup_pipeline.append({"$match": active_filters})

    # The Expressive Join
    # 1. Looks at current spieler document
    # 2. Searches the 'from' collection (saison_spieler) where spieler._id == saison_spieler.spieler_id
    # 3. Appends all matches into the 'as' array (saison_data) in every spieler document
    pipeline.append(
        {
            "$lookup": {
                "from": SAISON_SPIELER_COLLECTION_NAME,
                "let": {"base_spieler_id": "$_id"},  # Pass the base player's _id into the sub-pipeline
                "pipeline": lookup_pipeline,
                "as": AS_NAME,
            }
        }
    )

    # Array flattening:
    # 1. Takes every item from the saison_data array
    # 2. Duplicates the base spieler document as many times as there are entries
    # 3. Assigns each duplicated document one of the saison_data arrays entries
    strict_join = bool(filters.saison_id or filters.team_id)
    pipeline.append(
        {
            "$unwind": {
                "path": f"${AS_NAME}",  # The array that should be flattened (saison_data)
                "preserveNullAndEmptyArrays": not strict_join,  # Excludes spieler documents without season specific data
            }
        }
    )

    # Projection:
    # Project expected data
    pipeline.append(
        {
            "$project": {
                "_id": 1,
                "vorname": 1,
                "nachname": 1,
                "saison_id": f"${AS_NAME}.saison_id",
                "team_id": f"${AS_NAME}.team_id",
                "is_nachgetragen": f"${AS_NAME}.is_nachgetragen",
                "stufe": f"${AS_NAME}.stufe",
                "position": f"${AS_NAME}.position",
                "nummer": f"${AS_NAME}.nummer",
            }
        }
    )

    # Sorting:
    # Now that the fields are all at the root, we can sort with just the string field name
    pipeline.append(
        {
            "$sort": {
                filters.sort_by: 1 if filters.order == "asc" else -1,
                "vorname": 1,
                "nachname": 1,
            }
        }
    )

    # Limiting:
    # Limit the number of documents returned
    if getattr(filters, "limit", None) is not None:
        pipeline.append({"$limit": filters.limit})

    return pipeline
