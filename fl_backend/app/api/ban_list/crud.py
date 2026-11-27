from collections.abc import Iterable, Mapping
from http import HTTPStatus
from typing import Any

from pymongo import DESCENDING
from pymongo.asynchronous.client_session import AsyncClientSession

from app.core.codes import Code
from app.core.crud import pull_many_from_db, pull_whole_from_db
from app.core.exceptions import FieldFault
from app.core.readonly import ReadCollection
from app.shared.folding import sign_in_identifier

# What a served row may hold beyond `_id`, which the projection keeps unless something drops it. An
# inclusion rather than an exclusion: a field added to the collection is withheld until somebody
# names it here.
SERVED_FIELDS: Mapping[str, int] = {"address": 1, "ban_reason": 1, "created_at": 1, "barred_until_saison_id": 1}


async def read_ban_list(*, ban_list_collection: ReadCollection) -> list[Mapping[str, Any]]:
    """Every ban, newest first, read whole: one left unread would bar an address nobody could lift it from.

    `_id` decides between two bans entered on one day: `created_at` is a date, so it orders a day's rows against each other
    not at all.
    """

    return await pull_whole_from_db(
        collection=ban_list_collection,
        db_filter={},
        sort_by=[("created_at", DESCENDING), ("_id", DESCENDING)],
        projection=dict(SERVED_FIELDS),
    )


async def address_is_barred(
    *,
    ban_list_collection: ReadCollection,
    address: str,
    session: AsyncClientSession | None = None,
) -> bool:
    """Whether a ban holds this address, asked of the one reader that folds it.

    A row's presence is the whole answer: the activation that runs past a ban removes it in the
    transaction moving the season.
    """

    return bool(await read_barred_addresses([address], ban_list_collection=ban_list_collection, session=session))


async def find_address_barred_refusal(
    *,
    ban_list_collection: ReadCollection,
    address: str,
    session: AsyncClientSession | None,
) -> FieldFault | None:
    """`address_barred` on the ban's `email` box: a ban holds the address typed there.

    Asked by the ban's own add, ahead of `uniq_ban_list_address`, which answers only a race.
    """

    if not await address_is_barred(ban_list_collection=ban_list_collection, address=address, session=session):
        return None

    return FieldFault(path=("email",), code=Code.ADDRESS_BARRED, status=HTTPStatus.CONFLICT)


async def read_barred_addresses(
    addresses: Iterable[str],
    *,
    ban_list_collection: ReadCollection,
    session: AsyncClientSession | None = None,
) -> set[str]:
    """Which of these addresses a ban holds, each answered in the spelling it was asked in, in one read.

    Folded here alone, so no reader asks a ban by a spelling it was not stored in; `uniq_ban_list_address` serves the `$in`.
    """

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
