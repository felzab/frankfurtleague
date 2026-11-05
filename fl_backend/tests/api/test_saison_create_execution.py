from typing import Any

import pytest
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import post_saison
from app.api.saisons.schemas import FLPostSaisonPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_saison_create_test")

TAKEN_ID = "2026"


class TestACreateUnderATakenIdIsRefusedOnTheId:
    def test_the_refusal_names_the_id_and_writes_nothing(self, mongo_replica_set_url: str):
        """The `_id` index alone answers `duplicate_key` naming no field, so the create dialog's year box would show nothing."""

        async def _run() -> tuple[APIError, Any]:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME) as (_, database):
                stored = documents.saison_document(TAKEN_ID, "active")
                await database[Collection.SAISONS].insert_one(stored)
                with pytest.raises(APIError) as refused:
                    await post_saison(
                        saison_data=FLPostSaisonPayload.model_validate(
                            {
                                "id": TAKEN_ID,
                                "start_date": stored["start_date"],
                                "end_date": stored["end_date"],
                                "rules": stored["rules"],
                                "bewerbung": None,
                                "registrierung": None,
                            }
                        ),
                        saisons_collection=database[Collection.SAISONS],
                        db=database.client,
                    )

                return refused.value, await _seasons(database)

        refusal, seasons = on_the_seed_loop(_run())

        assert (refusal.status_code, refusal.error_code, refusal.fields) == (409, Code.DUPLICATE_KEY, (("id",),))
        assert seasons == [(TAKEN_ID, "active")]


async def _seasons(database: AsyncDatabase) -> list[tuple[str, str]]:
    return [(row["_id"], row["status"]) async for row in database[Collection.SAISONS].find({}, {"status": 1})]
