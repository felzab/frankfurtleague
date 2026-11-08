"""
API · every read of the ban list that reaches a collection

Here rather than in `services.py`, which decides from its arguments and names no handle at all.
The router opens the collection and the client; what it does not do is compose a query.
"""

from collections.abc import Iterable, Mapping
from typing import Any

from pymongo import DESCENDING
from pymongo.asynchronous.client_session import AsyncClientSession

from app.core.crud import aggregate_many_from_db, pull_many_from_db
from app.core.readonly import ReadCollection
from app.shared.folding import sign_in_identifier

# What a served row may hold BEYOND `_id`, which the projection keeps unless something drops it. An
# inclusion rather than an exclusion: a field added to the collection is withheld until somebody
# names it here.
SERVED_FIELDS: Mapping[str, int] = {"address": 1, "ban_reason": 1, "created_at": 1, "barred_until_saison_id": 1}


async def read_ban_list(*, ban_list_collection: ReadCollection) -> list[Mapping[str, Any]]:
    """Every ban, newest first, read whole: one left unread would bar an address nobody could lift it from.

    `_id` decides between two bans entered on one day: `created_at` is a date, so it orders a day's rows against each other
    not at all.
    """

    return await aggregate_many_from_db(
        collection=ban_list_collection,
        pipeline=[{"$sort": {"created_at": DESCENDING, "_id": DESCENDING}}, {"$project": dict(SERVED_FIELDS)}],
    )


async def address_is_barred(
    *,
    ban_list_collection: ReadCollection,
    address: str,
    session: AsyncClientSession | None = None,
) -> bool:
    """Whether a ban holds this address, `uniq_ban_list_address` serving the equality.

    A row's presence is the whole answer: the activation that runs past a ban removes it in the
    transaction moving the season.
    """

    found = await pull_many_from_db(
        collection=ban_list_collection,
        db_filter={"address": sign_in_identifier(address)},
        limit=1,
        projection=["_id"],
        session=session,
    )

    return bool(found)


async def read_barred_addresses(
    addresses: Iterable[str],
    *,
    ban_list_collection: ReadCollection,
    session: AsyncClientSession | None = None,
) -> set[str]:
    """Which of these addresses a ban holds, each answered in the spelling it was asked in, in ONE read."""

    folded = {address: sign_in_identifier(address) for address in set(addresses)}
    if not folded:
        return set()

    found = await pull_many_from_db(
        collection=ban_list_collection,
        db_filter={"address": {"$in": sorted(set(folded.values()))}},
        limit=len(folded),
        projection=["address"],
        session=session,
    )
    barred = {str(row["address"]) for row in found}

    return {address for address, fold in folded.items() if fold in barred}
