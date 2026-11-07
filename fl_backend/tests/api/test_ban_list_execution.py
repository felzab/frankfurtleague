from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.api.ban_list.admin_router import delete_ban_list_entry, get_ban_list_entries
from app.api.ban_list.crud import address_is_barred, read_ban_list_page
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.recording import actor_var
from tests.bans import ban_through_the_route
from tests.config import grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import rules_document, saison_document, spieler_document
from tests.erasure import erased
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_ban_list_test")

TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

ADMIN = "admin@frankfurtleague.de"

BANNED = "Zorbanax@Beispielschule.de"
# The same person typing the same address differently: the case the write and the check must agree on.
BANNED_RETYPED = "zorbanax@beispielschule.de"
OTHER = "quillhilde@beispielschule.de"
# A row whose wait has not run out, which counts as held.
WAITING = "wartet@beispielschule.de"

BAN_REASON = "Falsches Geburtsdatum bei der Anmeldung"

# The league a ban needs to exist at all (`app/api/ban_list/services.py ::
# find_no_saison_refusal`), and the season every case here is counted from. What the five-season
# bound does with it is `tests/api/test_ban_list_lapse_execution.py`'s.
ACTIVE_SAISON_ID = "2026"

SAISON_DOCUMENT: dict[str, Any] = saison_document(ACTIVE_SAISON_ID, "active", rules=rules_document(number_of_gruppen=2, allowed_stufen=["E1"]))

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_clean_list(url: str, body: Body) -> Any:
    """The shipped unique index, so a duplicate production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # The ban re-judges its actor's grant inside its transaction.
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())
            await database[Collection.SAISONS].insert_one(dict(SAISON_DOCUMENT))

            return await body(database, client)

    return on_the_seed_loop(_run())


async def listed(database: AsyncDatabase) -> Any:
    return await get_ban_list_entries(ban_list_collection=database[Collection.BAN_LIST])


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, email: str = BANNED, ban_reason: str = BAN_REASON, by: str = ADMIN) -> Any:
    return await ban_through_the_route(database, client, email=email, ban_reason=ban_reason, by=by, today=TODAY)


async def lift(database: AsyncDatabase, client: AsyncMongoClient, ban_list_entry_id: ObjectId) -> Any:
    token = actor_var.set(ADMIN)
    try:
        return await delete_ban_list_entry(ban_list_entry_id=ban_list_entry_id, ban_list_collection=database[Collection.BAN_LIST], db=client)
    finally:
        actor_var.reset(token)


async def rows_of(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return [row async for row in database[Collection.BAN_LIST].find().sort("_id", 1)]


class TestASecondBanOfOneAddress:
    def test_the_same_address_retyped_meets_the_row_it_already_has(self, mongo_replica_set_url: str):
        """One person, two spellings, one row, the index answering 409 `duplicate_key`."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client)

            with pytest.raises(DuplicateKeyError):
                await ban(database, client, email=BANNED_RETYPED)

            return await database[Collection.BAN_LIST].count_documents({})

        assert on_a_clean_list(mongo_replica_set_url, body) == 1


class TestABanOfAnAdministratorsAddress:
    """`ban_list_admin`: an address holding a grant takes no ban, whatever its spelling and whichever tier it holds."""

    def test_it_is_refused_and_nothing_is_stored_while_another_address_is_banned(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            # `ADMIN` holds `administration` rather than `owner`, so the refusal reads every grant.
            with pytest.raises(APIError) as raised:
                await ban(database, client, email=ADMIN.upper())
            refused = await database[Collection.BAN_LIST].count_documents({})
            # The control: a check refusing every address would pass the refusal above.
            await ban(database, client)

            return raised.value.error_code, refused

        assert on_a_clean_list(mongo_replica_set_url, body) == (Code.BAN_LIST_ADMIN, 0)

    def test_a_row_whose_wait_has_not_run_out_is_refused_too(self, mongo_replica_set_url: str):
        """Until the owner stops it: judging only the grants in effect would ban an address about to hold the administration."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await database[Collection.GRANTS].insert_one(
                {**grants_for_the_suite()[-1], "_id": ObjectId(), "address": WAITING, "effective_from": datetime(2999, 1, 1, tzinfo=UTC)}
            )

            with pytest.raises(APIError) as raised:
                await ban(database, client, email=WAITING)

            return raised.value.error_code

        assert on_a_clean_list(mongo_replica_set_url, body) == Code.BAN_LIST_ADMIN


class TestTheCheckASignInAsks:
    def test_a_banned_address_answers_the_check_in_every_spelling(self, mongo_replica_set_url: str):
        """A spelling the check does not fold is an address the list holds and does not bar."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[bool]:
            await ban(database, client)

            return [
                await address_is_barred(ban_list_collection=database[Collection.BAN_LIST], address=typed)
                for typed in (BANNED, BANNED_RETYPED, "Zorbanax@BEISPIELSCHULE.DE  ", OTHER)
            ]

        assert on_a_clean_list(mongo_replica_set_url, body) == [True, True, True, False]


class TestWhatTheListServes:
    def test_a_row_is_served_with_its_folded_address(self, mongo_replica_set_url: str):
        """The page's row is what an administrator lifts by, so a row served without its address is one nobody can tell apart."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client)

            return await listed(database)

        served = on_a_clean_list(mongo_replica_set_url, body)

        assert len(served.ban_list) == 1
        assert served.ban_list[0].address == BANNED_RETYPED
        assert served.ban_list[0].ban_reason == BAN_REASON
        assert served.ban_list[0].created_by == ADMIN
        assert served.ban_list[0].created_at == TODAY

    def test_the_total_counts_the_collection_and_not_the_rows_served(self, mongo_replica_set_url: str):
        """A ban past the cap is enforced and not rendered, so the count is what says one is there to lift.

        The cap is driven rather than named: a total copied off the served rows passes otherwise.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            await ban(database, client)
            await ban(database, client, email=OTHER)

            served = await listed(database)
            capped = await read_ban_list_page(ban_list_collection=database[Collection.BAN_LIST], limit=1)

            return served.count_total, capped[1]

        # The cap is what makes the pair differ: one row served, two held, and both reads say two.
        assert on_a_clean_list(mongo_replica_set_url, body) == (2, 2)


class TestLiftingABan:
    def test_the_row_is_gone_and_its_neighbour_stands(self, mongo_replica_set_url: str):
        """A removal reaching past its own id would empty the list, which nothing else here would catch."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            created = await ban(database, client)
            await ban(database, client, email=OTHER, ban_reason="Bleibt stehen")

            await lift(database, client, ObjectId(created.created_id))

            return [str(row["ban_reason"]) for row in await rows_of(database)]

        assert on_a_clean_list(mongo_replica_set_url, body) == ["Bleibt stehen"]

    def test_an_id_no_row_holds_is_a_404_that_removes_nothing(self, mongo_replica_set_url: str):
        """A removal answering 200 over an empty result tells an administrator a ban is lifted that still stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client)

            with pytest.raises(DocumentNotFoundError):
                await lift(database, client, ObjectId("6890a1b2c3d4e5f60794ffff"))

            return await database[Collection.BAN_LIST].count_documents({})

        assert on_a_clean_list(mongo_replica_set_url, body) == 1


class TestAnLoeschungLeavesTheListStanding:
    def test_loeschen_a_pupil_moves_no_row_of_the_ban_list(self, mongo_replica_set_url: str):
        """The deliberate exception: the one record a person's own erasure does not reach.

        Driven through the real erasure rather than asserted about it, so a collection added to that
        walk fails here.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, list[Mapping[str, Any]], list[Mapping[str, Any]]]:
            await ban(database, client)
            before = await rows_of(database)

            # Seeded rather than admitted: this case needs a stored pupil at the barred address, not a
            # route that made one.
            await database[Collection.SPIELER].insert_one(
                spieler_document(ObjectId(), "Zorbanax", "Mustermann", email=BANNED_RETYPED, birth_date="2009-05-09")
            )
            gone = await erased(database, client, BANNED, germany_now=NOW)

            return gone.spieler, before, await rows_of(database)

        geloescht_pupils, before, after = on_a_clean_list(mongo_replica_set_url, body)

        # The premise: an erasure reaching nobody leaves the list standing too.
        assert geloescht_pupils == 1
        # Non-empty first: two empty lists compare equal, and an erasure that emptied the collection
        # would then read as one that left it alone.
        assert before
        assert after == before
