from collections.abc import Mapping, Sequence
from typing import Any

from pymongo import ASCENDING, DESCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.postausgang.schemas import FLPostausgangBezug, FLPostausgangLage
from app.core.collections import Collection
from app.core.crud import aggregate_many_from_db


async def read_the_newest(
    *, postausgang_collection: AsyncCollection, bezug: FLPostausgangBezug, session: AsyncClientSession | None = None
) -> Mapping[str, Any] | None:
    """The last mail owed about one record and seat, which says what became of the last message to its holder.

    Equality on all three keys and the sort on the rest, the shape `postausgang_bezug` serves
    (`app/core/constraints.py :: SUPPORT_INDEXES`).
    """

    return await postausgang_collection.find_one(
        {"bezug.sammlung": str(bezug.sammlung), "bezug.id": bezug.id, "bezug.sitz": bezug.sitz},
        {"stand": 1, "zustellung": 1},
        sort=[("erfasst_am", DESCENDING), ("_id", DESCENDING)],
        session=session,
    )


async def lage_of(
    *, postausgang_collection: AsyncCollection, bezug: FLPostausgangBezug, session: AsyncClientSession | None = None
) -> FLPostausgangLage | None:
    """What became of the last mail about one record and seat, as an editor serves it; `None` where none was ever owed."""

    newest = await read_the_newest(postausgang_collection=postausgang_collection, bezug=bezug, session=session)

    return None if newest is None else FLPostausgangLage.model_validate(newest)


async def lagen_of(
    *, postausgang_collection: AsyncCollection, sammlung: Collection, ids: Sequence[Any], session: AsyncClientSession | None = None
) -> dict[tuple[Any, str | None], FLPostausgangLage]:
    """`lage_of` for every seat of many records of one collection in one read, keyed by record id and seat.

    Sorted on the whole of `postausgang_bezug`, so the index hands the group its first row per record and seat.
    """

    if not ids:
        return {}

    rows = await aggregate_many_from_db(
        collection=postausgang_collection,
        pipeline=[
            {"$match": {"bezug.sammlung": str(sammlung), "bezug.id": {"$in": list(ids)}}},
            {
                "$sort": {
                    "bezug.sammlung": ASCENDING,
                    "bezug.id": ASCENDING,
                    "bezug.sitz": ASCENDING,
                    "erfasst_am": DESCENDING,
                    "_id": DESCENDING,
                }
            },
            {
                "$group": {
                    "_id": {"id": "$bezug.id", "sitz": "$bezug.sitz"},
                    "stand": {"$first": "$stand"},
                    "zustellung": {"$first": "$zustellung"},
                }
            },
        ],
        session=session,
    )

    return {(row["_id"]["id"], row["_id"].get("sitz")): FLPostausgangLage.model_validate(row) for row in rows}
