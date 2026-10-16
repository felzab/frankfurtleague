from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.crud import ERASURE_STEPS
from app.api.identitaet.person_router import erase_selbst
from app.api.identitaet.schemas import FLErasureResponse
from app.core.collections import Collection
from app.shared.folding import sign_in_identifier
from tests.actor_tokens import FRESH_STEP_UP_CHECK
from tests.bans import ban_list
from tests.config import build_test_config

_CONFIG = build_test_config()


def erasure_collections(database: AsyncDatabase | Mapping[Collection, Any], **replaced: Any) -> dict[str, Any]:
    """Every collection the registry's steps reach, keyed as the erasure routes take them, any replaced by name.

    Read off `app/api/identitaet/crud.py :: ERASURE_STEPS`: a step reaching a collection no route takes, or the reverse,
    fails the call handing these on.
    """

    handles = {f"{collection}_collection": database[collection] for step in ERASURE_STEPS for collection in sorted(step.reaches)}

    return {**handles, **replaced}


async def erased(
    database: AsyncDatabase | Mapping[Collection, Any], client: AsyncMongoClient, address: str, *, germany_now: datetime, **replaced: Any
) -> FLErasureResponse:
    """Every record `address` holds, erased by the person route's own function outside a request, any collection replaced by name.

    Folded here as the route's binder folds the signed address: handed on as typed, it would match no stored record.
    """

    return await erase_selbst(
        identifier=sign_in_identifier(address),
        **erasure_collections(database, **replaced),
        sperrliste=ban_list(database),
        # Refusing none: a grant holder's passkey is held over HTTP, in `tests/api/test_step_up_execution.py`.
        refuse_unconfirmed=FRESH_STEP_UP_CHECK,
        db=client,
        config=_CONFIG,
        germany_now=germany_now,
    )
