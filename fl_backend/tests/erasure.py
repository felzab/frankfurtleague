from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identity.crud import ERASURE_STEPS
from app.api.identity.person_router import post_account_erasure
from app.api.identity.schemas import FLErasureResponse
from app.core.collections import Collection
from app.shared.folding import sign_in_identifier
from tests.bans import ban_list
from tests.config import build_test_config

_CONFIG = build_test_config()


def erasure_collections(database: AsyncDatabase | Mapping[Collection, Any], **replaced: Any) -> dict[str, Any]:
    """Every collection the registry's steps reach, keyed as the routes take them, any replaced by name.

    Read off `app/api/identity/crud.py :: ERASURE_STEPS`: a step reaching a collection no route takes, or the reverse,
    fails the call.
    """

    handles = {f"{collection.name.lower()}_collection": database[collection] for step in ERASURE_STEPS for collection in sorted(step.reaches)}
    return {**handles, **replaced}


async def erased(
    database: AsyncDatabase | Mapping[Collection, Any], client: AsyncMongoClient, address: str, *, germany_now: datetime, **replaced: Any
) -> FLErasureResponse:
    """Every record `address` holds, erased by the person route's own function outside a request, any collection replaced by name.

    Folded here as the route's binder folds the signed address: handed on as typed, it would match no stored record.
    """

    return await post_account_erasure(
        identifier=sign_in_identifier(address),
        **erasure_collections(database, **replaced),
        ban_list=ban_list(database),
        db=client,
        config=_CONFIG,
        germany_now=germany_now,
    )
