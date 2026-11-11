from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identity.crud import find_sign_in
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import SPIELER_TEXT_VERSIONS
from tests.plans import plans_of_sent_reads
from tests.records import record_collections
from tests.worker import worker_database

# Module level: a query plan is the server's to report.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spieler_email_reads_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
TEAM_OID = ObjectId("6890a1b2c3d4e5f607990001")
FOLDED_EMAIL = "thessaly.okonkwo@beispielschule.de"
TOKEN = "hwGqQ4kP6yJr3VnZbT8sXeM2dLuF9aCwR1oY5iN7pKg"

# Enough persons that the planner prefers an index wherever it can use one.
PERSONS = 60

Reader = Callable[[AsyncDatabase], Awaitable[Any]]


async def seed(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
    await database[Collection.TEAMS].insert_one(documents.team_document(TEAM_OID, "Zorbanax", "ZOX"))
    await database[Collection.SAISON_TEAMS].insert_one(
        documents.saison_team_document(
            SAISON_ID,
            TEAM_OID,
            "Zorbanax",
            "ZOX",
            kontakte={
                "trainer": None,
                "ansprechperson": documents.kontaktperson_document("Anna", confirmed_at="2026-03-21"),
                "stellvertretung": None,
                "trainer_is_also": None,
            },
        )
    )
    await database[Collection.SPIELER].insert_many(
        [
            documents.spieler_document(ObjectId(), f"Person{index}", "Muster", email=f"person{index}@beispielschule.de")
            for index in range(PERSONS)
        ]
        + [documents.spieler_document(ObjectId(), "Thessaly", "Okonkwo-Brandt", email=FOLDED_EMAIL)]
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        documents.registrierung_document(
            ObjectId(),
            FOLDED_EMAIL,
            saison_id=SAISON_ID,
            team_id=TEAM_OID,
            first_name="Thessaly",
            last_name="Okonkwo-Brandt",
            token=TOKEN,
            submitted_at="2026-03-30",
            deadline="2026-04-06",
            confirmed={
                "birth_date": "2009-05-04",
                "scope": "internal",
                "media": False,
                "text_versions": SPIELER_TEXT_VERSIONS,
                "today": "2026-03-31",
                "at": "2026-03-31T08:00:00+00:00",
            },
        )
    )


async def the_gate_read(database: AsyncDatabase) -> Any:
    return await find_sign_in(FOLDED_EMAIL, record_collections(database))


def names_an_address(command: Mapping[str, Any]) -> bool:
    """Whether a `spieler` find or aggregate matches on a stored address, rather than on an id or on no address at all."""

    stages = [stage.get("$match", {}) for stage in command.get("pipeline", [])]
    filters = [command.get("filter") or {}, *stages]

    return any(isinstance(term := matched.get("email"), (str, Mapping)) and term is not None for matched in filters)


def plans_reading_addresses(url: str, reader: Reader) -> list[str]:
    """The server's plan for every `spieler` read the reader sent matching an address."""

    async def _run() -> list[str]:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
            await seed(database)
            _, plans = await plans_of_sent_reads(
                url,
                database,
                lambda watched, _: reader(watched),
                lambda collection, command: collection == Collection.SPIELER and names_an_address(command),
            )

            return [plan for _, plan in plans]

    return on_the_seed_loop(_run())


class TestEveryAddressReadUsesTheIndex:
    """`uniq_spieler_email` is partial on `$type: "string"`, which an equality alone does not imply.

    Driven through its caller, the address reads explained: a call site dropping the term goes red
    here where a builder's own case would not.
    """

    def test_the_plan_walks_the_unique_index(self, mongo_replica_set_url: str):
        plans = plans_reading_addresses(mongo_replica_set_url, the_gate_read)

        # The premise: a reader sending no address read would pass the next line vacuously.
        assert plans
        assert all("IXSCAN { email: 1 }" in plan for plan in plans), plans
