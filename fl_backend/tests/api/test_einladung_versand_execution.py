from collections.abc import Mapping
from typing import Any, cast

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import _mail_one_team
from app.core.collections import Collection
from app.shared.tokens import hash_token
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import kontaktperson_document
from tests.outbox import MAIL_NOW
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_einladung_versand_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
TEAM_ID = ObjectId("6890a1b2c3d4e5f607270001")
SEEDED_EINLADUNG = ObjectId("6890a1b2c3d4e5f607270011")

TEAM: Mapping[str, Any] = {
    "team_id": TEAM_ID,
    "name": "Adler",
    "austritt": None,
    "kontakte": {
        "trainer": kontaktperson_document("Wraxlington", confirmed_at="2026-03-20", nachname="Mustermann", telefon="+49 69 1234567"),
        "ansprechperson": None,
        "stellvertretung": None,
        "trainer_is_also": None,
    },
}

# Live and never mailed, so the plan replaces it and the first attempt reads a link.
SEEDED_LINK: Mapping[str, Any] = {
    "_id": SEEDED_EINLADUNG,
    "saison_id": SAISON_ID,
    "team_id": TEAM_ID,
    "token_hashes": [hash_token("seeded")],
    "created_at": "2026-03-15",
    "created_by": "admin@frankfurtleague.de",
    "widerrufen_am": None,
}

# What a rival's press costs the first attempt: `with_transaction` runs the callback again.
RIVAL_CONFLICT = OperationFailure("write conflict", 112, {"ok": 0, "code": 112, "errorLabels": ["TransientTransactionError"]})

# The retry's own read refused outright, standing in for the request deadline running out there.
READ_REFUSED = OperationFailure("refused", 2, {"ok": 0, "code": 2})


class _RetryFailsBeforeItsRead:
    """The real collection, with the first mint conflicting and the retry's link read refused."""

    def __init__(self, collection: AsyncCollection) -> None:
        self._collection = collection
        self._reads = 0
        self._mints = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    def find(self, *args: Any, **kwargs: Any) -> Any:
        self._reads += 1
        if self._reads > 1:
            raise READ_REFUSED

        return self._collection.find(*args, **kwargs)

    async def insert_one(self, *args: Any, **kwargs: Any) -> Any:
        self._mints += 1
        if self._mints == 1:
            raise RIVAL_CONFLICT

        return await self._collection.insert_one(*args, **kwargs)


class TestARetriedMint:
    def test_a_retry_failing_before_its_read_says_nothing_of_a_link(self, mongo_replica_set_url: str):
        """The first attempt read a live link; the row must not report it, as a rival may have revoked it since."""

        async def body() -> Any:
            async with a_clean_database(mongo_replica_set_url, DATABASE_NAME, constraints=True) as (client, database):
                await database[Collection.INVITATIONS].insert_one(dict(SEEDED_LINK))

                zeile = await _mail_one_team(
                    einladungen_collection=cast(AsyncCollection, _RetryFailsBeforeItsRead(database[Collection.INVITATIONS])),
                    postausgang_collection=database[Collection.OUTBOX],
                    db=cast(AsyncMongoClient, client),
                    saison_id=SAISON_ID,
                    team=TEAM,
                    resend=False,
                    barred=set(),
                    created_by="admin@frankfurtleague.de",
                    today=TODAY,
                    now=MAIL_NOW,
                )

                live = await database[Collection.INVITATIONS].find({"widerrufen_am": None}).to_list(length=None)

                return zeile, [row["_id"] for row in live]

        zeile, live = on_the_seed_loop(body())

        assert (zeile.skipped, zeile.had_link, zeile.replaced_link) == ("erzeugung_failed", None, False)
        # The control: nothing committed, so the seeded link the first attempt read still opens.
        assert live == [SEEDED_EINLADUNG]
