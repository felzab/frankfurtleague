"""
SPIELER · aggregation pipeline

Builds the read pipeline for `GET /spieler`. Players follow the same two-document shape as teams:
`spieler` holds what does not change between seasons, the `saison_spieler` junction what does;
the pipeline joins them and flattens the result into `FLSpieler`.

Invariants:
- Season filters are injected inside the `$lookup` sub-pipeline, never applied after the join.
- Filter values keep their ObjectId type via `model_dump(context={"keep_oid": True})`.
- `build_spieler_pipeline` flattens and `build_spieler_memberships_pipeline` does not (ADR-0034).
"""

from typing import Any, Iterable, Mapping

from app.api.spieler.schemas import FLSpielerFilterParams
from app.core.collections import Collection

AS_NAME = "saison_data"


def build_spieler_pipeline(filters: FLSpielerFilterParams) -> list[Mapping[str, Any]]:

    pipeline: list[Mapping[str, Any]] = []

    # Dump the filters model, excluding null and sorting/pagination fields while keeping oids as oids.
    # `include_inactive` is excluded too: it is a switch whose False means "add a filter", so dumping
    # it by value would write `include_inactive: False` into the query as a field to match on.
    active_filters = filters.model_dump(
        exclude_none=True,
        exclude={"limit", "sort_by", "order", "include_inactive"},
        context={"keep_oid": True},
    )

    # Retired PEOPLE, filtered on the base collection before the join (ADR-0032).
    if not filters.include_inactive:
        pipeline.append({"$match": {"inactive_since": None}})

    # Build the Sub-Pipeline for early filtering
    lookup_pipeline: list[Mapping[str, Any]] = [
        # Always match the foreign key to the base player first
        # spieler_id from saison_spieler matches to _id from spieler
        {"$match": {"$expr": {"$eq": ["$spieler_id", "$$base_spieler_id"]}}}
    ]

    # Retired SQUAD ROWS, which is a different fact from a retired person: a player who left one
    # team's squad still plays. Filtered inside the join, so it narrows before anything is unwound.
    if not filters.include_inactive:
        lookup_pipeline.append({"$match": {"inactive_since": None}})

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
                "from": Collection.SAISON_SPIELER,
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
                # The PERSON's retirement, not the squad row's. The row's own `inactive_since` is a
                # filter above and is deliberately not surfaced: a returned row is always a live one.
                "inactive_since": 1,
                "saison_id": f"${AS_NAME}.saison_id",
                "team_id": f"${AS_NAME}.team_id",
                "is_nachgetragen": f"${AS_NAME}.is_nachgetragen",
                "is_captain": f"${AS_NAME}.is_captain",
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


def build_spieler_memberships_pipeline() -> list[Mapping[str, Any]]:
    """
    Every player with every squad row they hold, for the admin list (`GET /spieler/memberships`).

    Deliberately UNLIKE `build_spieler_pipeline`: no filters, no `$unwind`, no strict join. The admin
    surface asks a player-centric question, so retired people stay in, retired squad rows stay in --
    the list badges them and offers the reactivate -- and a player with no squad row at all comes
    back with an empty list rather than disappearing or failing to validate.

    Sorted by FORENAME then surname (decided 2026-08-07), which is how the admin list reads and how
    the other admin lists are ordered. `nachname` is nullable and MongoDB sorts null before every
    string, so two players sharing a forename put the surnameless one first rather than scattering.
    """

    return [
        {
            "$lookup": {
                "from": Collection.SAISON_SPIELER,
                "localField": "_id",
                "foreignField": "spieler_id",
                "pipeline": [
                    {
                        "$project": {
                            "_id": 0,
                            "saison_id": 1,
                            "team_id": 1,
                            "nummer": 1,
                            "position": 1,
                            "stufe": 1,
                            "is_nachgetragen": 1,
                            "is_captain": 1,
                            "inactive_since": 1,
                        }
                    }
                ],
                "as": "memberships",
            }
        },
        {"$sort": {"vorname": 1, "nachname": 1}},
    ]


# =====================================================================================================
# WHAT A SQUAD WRITE REFUSES
# =====================================================================================================

# The squad row names a team holding no `saison_teams` row for that season (decided 2026-08-08). A player
# listed for a club that is not in the competition, which is the same dangling reference
# `REQ-ELIGIBILITY-002` refuses on the match side -- and it was open here while closed there.
SQUAD_TEAM_NOT_IN_SAISON = "REQ-SQUAD-001"

# Two players in one team and one season wearing the same number. Refused only where the write INTRODUCES
# the collision (decided 2026-08-08): a row nobody touches keeps whatever number it holds, so existing data
# is never made uneditable, and the same clause shape `find_eligibility_refusal` uses for a newly fielded
# team applies here for a newly taken number.
SQUAD_NUMMER_TAKEN = "REQ-SQUAD-002"


def normalised_nummer(nummer: str | None) -> str | None:
    """
    A squad number as the uniqueness rule compares it, or `None` where there is nothing to compare.

    `nummer` is a nullable free-text STRING because numbers are worn rather than counted, so "7" and " 7 "
    are one number and an empty string is no number at all. Leading zeros are NOT stripped: "07" is a shirt
    somebody had printed, and deciding it is the same shirt as "7" is a judgement this rule does not make.
    """

    if nummer is None:
        return None

    stripped = nummer.strip()

    return stripped or None


def find_squad_refusal(
    *,
    team_in_saison: bool,
    proposed_nummer: str | None,
    stored_nummer: str | None,
    taken_nummern: Iterable[str | None],
) -> tuple[str, str] | None:
    """
    Why this squad row must be refused, as `(error_code, detail)` -- or `None`.

    `team_in_saison` is whether the named team holds a junction row for the season, read by the caller.
    `taken_nummern` is every OTHER row's number in the same team and season; `stored_nummer` is what this
    row holds today, and `None` on a create.

    **The number rule fires only on a number this write introduces.** Resubmitting the stored value passes
    even where it duplicates -- which is what keeps an existing duplicate editable, including by the edit
    that would resolve it. A row with no number is never a collision: several players may have no shirt
    assigned yet, and that is the ordinary state of a squad being filled in.
    """

    if not team_in_saison:
        return (
            SQUAD_TEAM_NOT_IN_SAISON,
            "the named team holds no saison_teams row for this season; a squad entry needs the club to be entered first",
        )

    proposed = normalised_nummer(proposed_nummer)
    if proposed is None or proposed == normalised_nummer(stored_nummer):
        return None

    if proposed in {normalised_nummer(taken) for taken in taken_nummern}:
        return (SQUAD_NUMMER_TAKEN, f"number {proposed} is already worn in this squad; two players cannot share one")

    return None
