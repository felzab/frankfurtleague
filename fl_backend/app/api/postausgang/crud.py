from collections.abc import Mapping
from typing import Any

from pymongo import DESCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.postausgang.schemas import FLPostausgangBezug


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
