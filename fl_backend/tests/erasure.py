from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.person_router import erase_selbst
from app.api.identitaet.schemas import FLErasureResponse
from app.core.collections import Collection
from app.shared.folding import sign_in_identifier
from tests.actor_tokens import FRESH_STEP_UP_CHECK
from tests.bans import ban_list
from tests.config import build_test_config

_CONFIG = build_test_config()


async def erased(
    database: AsyncDatabase | Mapping[Collection, Any], client: AsyncMongoClient, address: str, *, germany_now: datetime
) -> FLErasureResponse:
    """Every record `address` holds, erased by the person route's own function outside a request.

    Folded here as the route's binder folds the signed address: handed on as typed, it would match no stored record.
    """

    return await erase_selbst(
        identifier=sign_in_identifier(address),
        spieler_collection=database[Collection.SPIELER],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        drosselung_collection=database[Collection.DROSSELUNG],
        aktionen_collection=database[Collection.AKTIONEN],
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
        berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
        einladungen_collection=database[Collection.EINLADUNGEN],
        sperrliste_collection=database[Collection.SPERRLISTE],
        sperrliste=ban_list(database),
        # Refusing none: a grant holder's passkey is held over HTTP, in `tests/api/test_step_up_execution.py`.
        refuse_unconfirmed=FRESH_STEP_UP_CHECK,
        db=client,
        config=_CONFIG,
        germany_now=germany_now,
    )
