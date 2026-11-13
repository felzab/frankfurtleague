"""
API · a referee's address in the editor: the save never moves a confirmed one, which an address change alone moves

The change itself, its links and its effect are `tests/api/test_address_change_execution.py`'s; here the editor's save
on a confirmed referee's address. The decision alone, a retired referee's included, is
`tests/api/test_schiedsrichter_reactivation_rules.py`'s.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.schiedsrichter.admin_router import invite_schiedsrichter, patch_schiedsrichter
from app.api.schiedsrichter.public_router import post_confirmation
from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload, FLSchiedsrichterConfirmationPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.outbox import MAIL_NOW, drained
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, each write being one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_schiedsrichter_address_change_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607830001")

NAME = "Ortwin Pfeiffenberger"
EMAIL = "ortwin.pfeiffenberger@example.com"
NEW_EMAIL = "o.pfeiffenberger@neuepost.example.org"
PHONE = "+49 69 5550303"


def referee_document(**overrides: Any) -> dict[str, Any]:
    """A referee as the administrator entered them, before their own answer."""

    return {
        "_id": SCHIEDSRICHTER_OID,
        "name": NAME,
        "schule": "Bettina-Schule",
        "default_payment": 20,
        "kontakt": {"phone": PHONE, "email": EMAIL},
        "inactive_since": None,
        "version": 0,
        **overrides,
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    """The SHIPPED indexes, a running season, and one referee who answered their own link."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.SCHIEDSRICHTER].insert_one(referee_document())
            await invite_schiedsrichter(
                schiedsrichter_id=SCHIEDSRICHTER_OID,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                outbox_collection=database[Collection.OUTBOX],
                db=client,
                today=TODAY,
                now=MAIL_NOW,
            )
            (mail,) = await drained(database, client)
            await post_confirmation(
                answer_data=FLSchiedsrichterConfirmationPayload.model_validate(
                    {
                        "token": mail.token,
                        "birth_date": "1984-05-09",
                        "scope": "kader_public",
                        "media": True,
                        "text_versions": dict(documents.SCHIEDSRICHTER_TEXT_VERSIONS),
                    }
                ),
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                db=client,
                today=TODAY,
                germany_now=NOW,
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def save(database: AsyncDatabase, client: AsyncMongoClient, *, email: str) -> Any:
    served = await database[Collection.SCHIEDSRICHTER].find_one({"_id": SCHIEDSRICHTER_OID}, {"version": 1})
    assert served is not None
    return await patch_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate(
            {
                "name": NAME,
                "schule": "Bettina-Schule",
                "default_payment": 25,
                "kontakt": {"phone": PHONE, "email": email},
                "version": served["version"],
            }
        ),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        now=MAIL_NOW,
    )


async def stored(database: AsyncDatabase) -> Mapping[str, Any]:
    found = await database[Collection.SCHIEDSRICHTER].find_one({"_id": SCHIEDSRICHTER_OID})
    assert found is not None, "the referee this case seeded is gone"

    return found


async def refused_code(call: Awaitable[Any]) -> str:
    with pytest.raises(APIError) as refused:
        await call

    return refused.value.error_code


class TestTheSaveOnAConfirmedReferee:
    """`schiedsrichter_address_only_per_change`: a confirmed referee's address is who signs in as them, and the save moves it never."""

    def test_a_save_moving_it_is_refused_and_nothing_of_the_save_lands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored(database)

            return await refused_code(save(database, client, email=NEW_EMAIL)), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == Code.SCHIEDSRICHTER_ADDRESS_ONLY_PER_CHANGE
        assert row == before
