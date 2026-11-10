"""
API · a referee's own answer through their link, and the editor's save an administrator read before it

The answer moves fields the referee editor never saves, so it is no edit of the record: a save on the version read
before it lands, and the answer stands beside it.
"""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.schiedsrichter.admin_router import patch_schiedsrichter
from app.api.schiedsrichter.public_router import post_confirmation, post_decline
from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload, FLSchiedsrichterConfirmationPayload
from app.api.schiedsrichter.services import compose_mint_update
from app.core.collections import Collection
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.tokens import hash_token
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.outbox import MAIL_NOW
from tests.worker import worker_database

# Module level: the press and the save are each one transaction on a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_own_press_schiedsrichter_test")

TODAY = "2026-04-01"
SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607830001")
TOKEN = "own-press-schiedsrichter-link"
EMAIL = "collina@example.com"
BIRTH_DATE = "1984-05-09"

# What the editor was served before the press: the referee as entered, their link minted and unanswered.
SERVED_VERSION = 0


def referee_document() -> dict[str, Any]:
    minted = compose_mint_update(today=TODAY)

    return documents.schiedsrichter_document(
        SCHIEDSRICHTER_OID,
        email=EMAIL,
        name="Pierluigi Collina",
        default_payment=20,
        einwilligung=None,
        confirmation={**minted["confirmation"], "token_hashes": [hash_token(TOKEN)]},
        erase_at=minted["erase_at"],
        version=SERVED_VERSION,
    )


async def confirm(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await post_confirmation(
        answer_data=FLSchiedsrichterConfirmationPayload.model_validate(
            {
                "token": TOKEN,
                "birth_date": BIRTH_DATE,
                "scope": "kader_public",
                "media": True,
                "text_versions": dict(documents.SCHIEDSRICHTER_TEXT_VERSIONS),
            }
        ),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        db=client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


async def decline(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await post_decline(
        decline_data=FLTokenPayload(token=TOKEN), schiedsrichter_collection=database[Collection.SCHIEDSRICHTER], db=client, today=TODAY
    )


Press = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[None]]


def pressed_then_saved(url: str, press: Press) -> dict[str, Any]:
    """The row after the person's press and then the editor's save of a new school on the version served before it."""

    async def _run() -> dict[str, Any]:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SCHIEDSRICHTER].insert_one(referee_document())
            await press(database, client)
            await patch_schiedsrichter(
                schiedsrichter_id=SCHIEDSRICHTER_OID,
                schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate(
                    {
                        "name": "Pierluigi Collina",
                        "schule": "Carl-Schurz-Schule",
                        "default_payment": 20,
                        "kontakt": {"phone": "+49 69 5550202", "email": EMAIL},
                        "version": SERVED_VERSION,
                    }
                ),
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                outbox_collection=database[Collection.OUTBOX],
                db=client,
                today=TODAY,
                now=MAIL_NOW,
            )
            row = await database[Collection.SCHIEDSRICHTER].find_one({"_id": SCHIEDSRICHTER_OID})
            assert row is not None

            return row

    return on_the_seed_loop(_run())


class TestTheEditorsSaveLandsOverTheAnswer:
    def test_a_confirmation_stands_beside_the_save(self, mongo_replica_set_url: str):
        row = pressed_then_saved(mongo_replica_set_url, confirm)

        assert row["schule"] == "Carl-Schurz-Schule"
        assert (row["birth_date"], row["einwilligung"]["confirmed_at"], row["einwilligung"]["media"]) == (BIRTH_DATE, TODAY, True)
        assert "erase_at" not in row

    def test_an_objection_stands_beside_the_save(self, mongo_replica_set_url: str):
        row = pressed_then_saved(mongo_replica_set_url, decline)

        assert row["schule"] == "Carl-Schurz-Schule"
        assert row["confirmation"]["declined_at"] == TODAY
