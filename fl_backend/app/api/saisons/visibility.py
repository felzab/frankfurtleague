from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.services import WITHHELD_FROM_BASE_TIER
from app.core.crud import pull_many_from_db
from app.core.exceptions import DOCUMENT_NOT_FOUND, DocumentNotFoundException
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT


async def saison_is_withheld(*, saisons_collection: AsyncCollection, saison_id: str) -> bool:
    """Whether this season's contents are closed to a caller with no admin scope.

    `base_tier_status_term` narrows the season LIST on `WITHHELD_FROM_BASE_TIER`; a read scoped BY
    one season resolves an id, so it asks here instead.
    """

    found = await saisons_collection.find_one(filter={"_id": saison_id}, projection={"status": 1})

    # A STORED status is the only thing that withholds, so an id naming no season is not withheld --
    # and every caller already answers a season it cannot resolve.
    return found is not None and found["status"] == WITHHELD_FROM_BASE_TIER


async def refuse_withheld_saison(*, saisons_collection: AsyncCollection, saison_id: str) -> None:
    """The 404 an id naming no season already answers, for one this tier may not read.

    Matching that answer is what leaves a season being drawn up indistinguishable from one nobody
    created; a 403 here would confirm it exists.
    """

    if await saison_is_withheld(saisons_collection=saisons_collection, saison_id=saison_id):
        raise DocumentNotFoundException(filter={"_id": saison_id}, error_code=DOCUMENT_NOT_FOUND)


async def withheld_saison_ids(*, saisons_collection: AsyncCollection) -> list[str]:
    """Every season id closed to this tier -- `saison_is_withheld` asked of all of them at once.

    The SET form, for a read that resolves no season and joins rows from every one: it holds no id
    to ask about, so it narrows on the whole set instead.
    """

    withheld = await pull_many_from_db(
        collection=saisons_collection,
        db_filter={"status": WITHHELD_FROM_BASE_TIER},
        projection={"_id": 1},
        limit=LIST_LIMIT_DEFAULT + 1,
    )

    # One over the cap, as `fl_backend/app/api/spiele/crud.py :: advance_bracket_winners` asks:
    # a truncated set narrows on fewer seasons than exist, which is a
    # LEAK rather than a short answer.
    if len(withheld) > LIST_LIMIT_DEFAULT:
        raise ValueError(f"more than {LIST_LIMIT_DEFAULT} seasons are withheld, which is more than one read can narrow on")

    return [str(saison_raw["_id"]) for saison_raw in withheld]
