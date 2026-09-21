"""
API · every read of the ban list that reaches a collection

Here rather than in `services.py`, which decides from its arguments and names no handle at all
(`fl_backend/tests/core/test_write_shapes.py :: TestEveryServiceModuleDecidesFromItsArguments`).
The router opens the collection and the client; what it does not do is compose a query.
"""

from collections.abc import Mapping
from typing import Any

from pymongo import DESCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.core.crud import aggregate_many_from_db, pull_many_from_db

# What a served row may hold BEYOND `_id`, which the projection keeps unless something drops it. An
# inclusion rather than an exclusion: a field added to the collection is withheld until somebody
# names it here.
SERVED_FIELDS: Mapping[str, int] = {"grund": 1, "erstellt_von": 1, "erstellt_am": 1}


def build_sperrliste_page_pipeline(*, limit: int) -> list[Mapping[str, Any]]:
    """The page and the total, from ONE pass.

    `$facet`, so the count cannot disagree with the rows beside it: two reads straddle a write and
    report a hidden ban that is not there, or miss one that is.
    """

    return [
        {
            "$facet": {
                # `_id` decides between two bans entered on one day: `erstellt_am` is a date, so it
                # orders a day's rows against each other not at all.
                "rows": [{"$sort": {"erstellt_am": DESCENDING, "_id": DESCENDING}}, {"$limit": limit}, {"$project": dict(SERVED_FIELDS)}],
                "gesamt": [{"$count": "anzahl"}],
            }
        }
    ]


async def read_sperrliste_page(
    *,
    sperrliste_collection: AsyncCollection,
    limit: int,
) -> tuple[list[Mapping[str, Any]], int]:
    """One page of bans, newest first, and how many the collection holds."""

    # `$facet` answers one document holding every row it selected, so the page has to fit BSON's
    # 16MB ceiling. At this limit and this row shape it is four orders of magnitude clear.
    faceted = await aggregate_many_from_db(collection=sperrliste_collection, pipeline=build_sperrliste_page_pipeline(limit=limit), limit=1)

    if not faceted:
        return [], 0

    rows = list(faceted[0].get("rows") or [])
    # `$count` emits NO document for an empty collection rather than a zero.
    counted = faceted[0].get("gesamt") or [{}]

    return rows, int(counted[0].get("anzahl", 0))


async def address_is_gesperrt(
    *,
    sperrliste_collection: AsyncCollection,
    adresse_hash: str,
    session: AsyncClientSession | None = None,
) -> bool:
    """Whether the list holds this hash, as the one equality `uniq_sperrliste_adresse_hash` serves.

    The read is in-session where a caller passes one, so a ban judged inside a transaction is judged
    against what that transaction can see.
    """

    # The id alone and capped at one: a registration asks whether, never which row, and the answer
    # must carry no part of a ban past the lane that may read it.
    found = await pull_many_from_db(
        collection=sperrliste_collection,
        db_filter={"adresse_hash": adresse_hash},
        limit=1,
        projection=["_id"],
        session=session,
    )

    return bool(found)
