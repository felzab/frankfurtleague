"""
API · what a registration is read and judged by, and the erasure's removal of an address's registrations

Here rather than in `services.py`, which decides from its arguments and names no handle.
"""

from collections.abc import Mapping, Sequence
from typing import Any, Final

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.registrierungen.services import (
    PERSON_IDENTITY_FIELDS,
    SUBMITTED,
    WITHOUT_TOKEN_HASHES,
    build_addresses_filter,
    build_open_filter,
    build_registrierungen_sort,
)
from app.core.crud import aggregate_many_from_db, delete_many_from_db, pull_one_from_db
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

# What the admission reads of a person: who they are, for the question, and what it overwrites.
PERSON_FIELDS: tuple[str, ...] = (*PERSON_IDENTITY_FIELDS, "birth_date", "email")


async def pull_open_registrierung(
    *, registrierungen_collection: AsyncCollection, registrierung_id: Any, session: AsyncClientSession
) -> Mapping[str, Any]:
    """The pending registration this id names, or a 404: an admitted one is gone, and a declined one is decided."""

    return await pull_one_from_db(
        collection=registrierungen_collection,
        db_filter={"_id": registrierung_id, "status": SUBMITTED},
        projection=dict(WITHOUT_TOKEN_HASHES),
        session=session,
    )


# The most pending rows one read serves a team, newest first: the collection is written by anybody holding a team's
# link, so the read is bounded whatever the form stored.
OPEN_REGISTRIERUNGEN_CAP: Final = LIST_LIMIT_DEFAULT


async def pull_open_registrierungen(
    *, registrierungen_collection: AsyncCollection, saison_id: str, team_id: Any, session: AsyncClientSession
) -> list[Mapping[str, Any]]:
    """One team's pending rows, newest first, `OPEN_REGISTRIERUNGEN_CAP` at most."""

    return await aggregate_many_from_db(
        collection=registrierungen_collection,
        pipeline=[
            {"$match": build_open_filter(saison_id=saison_id, team_id=team_id)},
            {"$sort": dict(build_registrierungen_sort())},
            {"$limit": OPEN_REGISTRIERUNGEN_CAP},
            # An inclusion: nothing beyond the form's own fields, the consent stamp and the address
            # the join runs on reaches this handler, let alone the wire.
            {
                "$project": {
                    **{field: 1 for field in ("submitted_at", *PERSON_IDENTITY_FIELDS, "nummer", "position", "stufe")},
                    **{field: 1 for field in ("email", "birth_date", "einwilligung.confirmed_at")},
                }
            },
        ],
        session=session,
    )


async def persons_at(
    *, spieler_collection: AsyncCollection, addresses: Sequence[str], session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """The stored persons these folded addresses resolve to, one per address under `uniq_spieler_email`."""

    if not addresses:
        return []

    return await aggregate_many_from_db(
        collection=spieler_collection,
        pipeline=[{"$match": build_addresses_filter(addresses)}, {"$project": {field: 1 for field in PERSON_FIELDS}}],
        session=session,
    )


async def nummern_rows(
    *, saison_spieler_collection: AsyncCollection, saison_id: str, team_id: Any, session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """The live squad's shirt numbers, a nominee's among them: the cap's filter leaves those out, and a nominee wears one too."""

    return await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=[{"$match": {"saison_id": saison_id, "team_id": team_id, "inactive_since": None}}, {"$project": {"nummer": 1}}],
        session=session,
    )


async def kader_rows_of(
    *, saison_spieler_collection: AsyncCollection, saison_id: str, spieler_ids: Sequence[Any], session: AsyncClientSession | None
) -> list[Mapping[str, Any]]:
    """These persons' rows of one season, whichever team holds each: one per person under `uniq_spieler_id_saison_id`."""

    if not spieler_ids:
        return []

    return await aggregate_many_from_db(
        collection=saison_spieler_collection,
        pipeline=[
            {"$match": {"saison_id": saison_id, "spieler_id": {"$in": list(spieler_ids)}}},
            {"$project": {"spieler_id": 1, "is_nachnominiert": 1}},
        ],
        session=session,
    )


async def erase_registrierungen_in_session(
    *,
    registrierungen_collection: AsyncCollection,
    # Each carrying its `_id`, as the erasure's subject read them.
    registrierungen: Sequence[Mapping[str, Any]],
    # REQUIRED, so a caller forgetting it is a TypeError rather than writes committing one by one.
    session: AsyncClientSession,
) -> int:
    """Remove these registrations whole, answering how many went: the document is the person's own."""

    # No command for none.
    if not registrierungen:
        return 0

    erased = await delete_many_from_db(
        collection=registrierungen_collection, db_filter={"_id": {"$in": [row["_id"] for row in registrierungen]}}, session=session
    )

    return erased.deleted_count
