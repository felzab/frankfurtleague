from typing import Any, Mapping

from app.api.spieler.schemas import FLSpielerFilterParams
from app.core.collections import Collection
from app.core.exceptions import WriteRefusal

AS_NAME = "saison_data"


def build_spieler_pipeline(filters: FLSpielerFilterParams) -> list[Mapping[str, Any]]:

    pipeline: list[Mapping[str, Any]] = []

    # `include_inactive` is excluded: a switch whose False means "add a filter", so dumping it by
    # value would write it into the query as a field to match on.
    active_filters = filters.model_dump(
        exclude_none=True,
        exclude={"limit", "sort_by", "order", "include_inactive"},
        context={"keep_oid": True},
    )

    # Retired PEOPLE, filtered on the base collection before the join.
    if not filters.include_inactive:
        pipeline.append({"$match": {"inactive_since": None}})

    # A sub-pipeline, not a post-join `$match`: these narrow the junction BEFORE the rows attach, so
    # the join never carries a season this request did not ask for.
    lookup_pipeline: list[Mapping[str, Any]] = [{"$match": {"$expr": {"$eq": ["$spieler_id", "$$base_spieler_id"]}}}]

    # Retired SQUAD ROWS, a different fact from a retired person, filtered before the unwind.
    if not filters.include_inactive:
        lookup_pipeline.append({"$match": {"inactive_since": None}})

    # No `saison_data.` prefix: inside the sub-pipeline the junction document IS the root.
    if active_filters:
        lookup_pipeline.append({"$match": active_filters})

    pipeline.append(
        {
            "$lookup": {
                "from": Collection.SAISON_SPIELER,
                "let": {"base_spieler_id": "$_id"},
                "pipeline": lookup_pipeline,
                "as": AS_NAME,
            }
        }
    )

    # One row per membership, so a player in two seasons is two documents.
    strict_join = bool(filters.saison_id or filters.team_id)
    pipeline.append(
        {
            "$unwind": {
                "path": f"${AS_NAME}",
                # Preserved unless a season or team filter is set: without one, a player with no
                # squad row is still a player.
                "preserveNullAndEmptyArrays": not strict_join,
            }
        }
    )

    pipeline.append(
        {
            "$project": {
                "_id": 1,
                "vorname": 1,
                "nachname": 1,
                # The PERSON's retirement, not the squad row's, which is filtered above.
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

    # After the projection, so a bare field name reaches the root copy rather than the nested one.
    pipeline.append(
        {
            "$sort": {
                filters.sort_by: 1 if filters.order == "asc" else -1,
                "vorname": 1,
                "nachname": 1,
            }
        }
    )

    if getattr(filters, "limit", None) is not None:
        pipeline.append({"$limit": filters.limit})

    return pipeline


def build_spieler_memberships_pipeline() -> list[Mapping[str, Any]]:
    """Every player with every squad row they hold.

    UNLIKE `build_spieler_pipeline`: no filters, no `$unwind`, no strict join. Sorted by FORENAME
    then surname, and MongoDB sorts a null `nachname` first.
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


# The same dangling reference `REQ-ELIGIBILITY-002` refuses on the match side.
SQUAD_TEAM_NOT_IN_SAISON = "REQ-SQUAD-001"


def normalised_nummer(nummer: str | None) -> str | None:
    """A squad number as any comparison reads it, or `None`.

    Leading zeros are NOT stripped: "07" is a shirt somebody had printed, and calling it the same
    shirt as "7" is a judgement this rule does not make.
    """

    if nummer is None:
        return None

    stripped = nummer.strip()

    return stripped or None


def find_squad_refusal(*, team_in_saison: bool) -> WriteRefusal | None:
    """Why this squad row must be refused, or `None`.

    A shared shirt number is refused on no write path and is declared permitted in
    `fl_backend/app/core/domain.py :: UNENFORCED`.
    """

    if not team_in_saison:
        return WriteRefusal(
            error_code=SQUAD_TEAM_NOT_IN_SAISON,
            message="the named team holds no saison_teams row for this season; a squad entry needs the club to be entered first",
        )

    return None
