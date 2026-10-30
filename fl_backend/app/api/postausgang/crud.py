from collections.abc import Sequence
from typing import Any

from pymongo import ASCENDING, DESCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.postausgang.schemas import FLOutboxState, FLPostausgangBezug
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db


async def lage_of(
    *, postausgang_collection: AsyncCollection, reference: FLPostausgangBezug, session: AsyncClientSession | None = None
) -> FLOutboxState | None:
    """What became of the last mail about one record and seat, as an editor serves it; `None` where none was ever owed.

    Equality on all three keys and the sort on the rest, the shape `outbox_reference` serves
    (`app/core/constraints.py :: SUPPORT_INDEXES`).
    """

    newest = await postausgang_collection.find_one(
        {"reference.collection": str(reference.collection), "reference.id": reference.id, "reference.seat": reference.seat},
        {"stand": 1, "delivery": 1},
        sort=[("recorded_at", DESCENDING), ("_id", DESCENDING)],
        session=session,
    )

    return None if newest is None else FLOutboxState.model_validate(newest)


async def lagen_of(
    *, postausgang_collection: AsyncCollection, collection: Collection, ids: Sequence[Any], session: AsyncClientSession | None = None
) -> dict[tuple[Any, str | None], FLOutboxState]:
    """`lage_of` for every seat of many records of one collection in one read, keyed by record id and seat.

    Sorted on the whole of `outbox_reference`, so the index hands the group its first row per record and seat.
    """

    if not ids:
        return {}

    rows = await aggregate_many_from_db(
        collection=postausgang_collection,
        pipeline=[
            {"$match": {"reference.collection": str(collection), "reference.id": {"$in": list(ids)}}},
            {
                "$sort": {
                    "reference.collection": ASCENDING,
                    "reference.id": ASCENDING,
                    "reference.seat": ASCENDING,
                    "recorded_at": DESCENDING,
                    "_id": DESCENDING,
                }
            },
            {
                "$group": {
                    "_id": {"id": "$reference.id", "seat": "$reference.seat"},
                    "stand": {"$first": "$stand"},
                    "delivery": {"$first": "$delivery"},
                }
            },
        ],
        session=session,
    )

    return {(row["_id"]["id"], row["_id"].get("seat")): FLOutboxState.model_validate(row) for row in rows}
