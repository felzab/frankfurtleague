"""
SPIELER · aggregation pipeline

Builds the read pipeline for `GET /spieler`. Players follow the same two-document shape as teams:
`spieler` holds what does not change between seasons, the `saison_spieler` junction what does;
the pipeline joins them and flattens the result into `FLSpieler`.

Invariants:
- Season filters are injected inside the `$lookup` sub-pipeline, never applied after the join.
- Filter values keep their ObjectId type via `model_dump(context={"keep_oid": True})`.
- `build_spieler_pipeline` flattens and `build_spieler_memberships_pipeline` does not (ADR-0027).
"""

from typing import Any, Mapping

from app.api.spieler.schemas import FLSpielerFilterParams
from app.core.collections import Collection
from app.core.exceptions import WriteRefusal

AS_NAME = "saison_data"


def build_spieler_pipeline(filters: FLSpielerFilterParams) -> list[Mapping[str, Any]]:

    pipeline: list[Mapping[str, Any]] = []

    # `include_inactive` is excluded from the dump: it is a switch whose False means "add a filter", so
    # dumping it by value would write `include_inactive: False` into the query as a field to match on.
    active_filters = filters.model_dump(
        exclude_none=True,
        exclude={"limit", "sort_by", "order", "include_inactive"},
        context={"keep_oid": True},
    )

    # Retired PEOPLE, filtered on the base collection before the join (ADR-0025).
    if not filters.include_inactive:
        pipeline.append({"$match": {"inactive_since": None}})

    # A sub-pipeline rather than a post-join `$match`: every filter here narrows the junction BEFORE
    # the rows are attached, so the join never carries a season this request did not ask for.
    lookup_pipeline: list[Mapping[str, Any]] = [{"$match": {"$expr": {"$eq": ["$spieler_id", "$$base_spieler_id"]}}}]

    # Retired SQUAD ROWS, which is a different fact from a retired person: a player who left one
    # team's squad still plays. Filtered inside the join, so it narrows before anything is unwound.
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

    # One row per membership, so a player in two seasons is two documents -- which is the shape
    # `GET /spieler` serves and the reason it cannot answer the admin list's question (ADR-0027).
    strict_join = bool(filters.saison_id or filters.team_id)
    pipeline.append(
        {
            "$unwind": {
                "path": f"${AS_NAME}",
                # Preserved unless a season or team filter is set: without one, a player with no squad
                # row is still a player, and dropping them would make an unfiltered list incomplete.
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

    # After the projection, so a bare field name reaches the root copy rather than the nested one.
    # `vorname`/`nachname` are tiebreakers, so an equal sort key still orders deterministically.
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


# The squad row names a team holding no `saison_teams` row for that season (decided 2026-08-08). A player
# listed for a club that is not in the competition, which is the same dangling reference
# `REQ-ELIGIBILITY-002` refuses on the match side.
SQUAD_TEAM_NOT_IN_SAISON = "REQ-SQUAD-001"

# Two players in one squad wearing one number is PERMITTED (decided 2026-08-13), declared in
# `app/core/domain.py :: UNENFORCED`. Refusing it on two write paths while the reactivate consulted
# no rule was one behaviour spelled three ways.


def normalised_nummer(nummer: str | None) -> str | None:
    """
    A squad number as any comparison of two reads them, or `None` where there is nothing to compare.

    `nummer` is a nullable free-text STRING because numbers are worn rather than counted, so "7" and " 7 "
    are one number and an empty string is no number at all. Leading zeros are NOT stripped: "07" is a shirt
    somebody had printed, and deciding it is the same shirt as "7" is a judgement this rule does not make.
    """

    if nummer is None:
        return None

    stripped = nummer.strip()

    return stripped or None


def find_squad_refusal(*, team_in_saison: bool) -> WriteRefusal | None:
    """
    Why this squad row must be refused, as a `WriteRefusal` -- or `None`.

    `team_in_saison` is whether the named team holds a junction row for the season, read by the caller.

    **One rule.** A shared shirt number is refused neither here nor on any other write path, and is
    declared permitted in `app/core/domain.py :: UNENFORCED`. The squad editor warns about one this
    save would introduce and writes it anyway.
    """

    if not team_in_saison:
        return WriteRefusal(
            error_code=SQUAD_TEAM_NOT_IN_SAISON,
            message="the named team holds no saison_teams row for this season; a squad entry needs the club to be entered first",
        )

    return None
