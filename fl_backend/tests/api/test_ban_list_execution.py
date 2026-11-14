from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.ban_list.admin_router import delete_ban_list_entry, get_ban_list_entries
from app.api.ban_list.crud import address_is_barred
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.recording import actor_var
from tests.bans import ban_through_the_route
from tests.config import grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import address_change_document, rules_document, saison_document, spieler_document
from tests.erasure import erased
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_ban_list_test")

# A century ahead of the real clock: the TTL monitor deletes a row whose delete date has passed, under a case reading it back.
TODAY = "2126-04-01"
NOW = datetime(2126, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

ADMIN = "admin@frankfurtleague.de"

BANNED = "Zorbanax@Beispielschule.de"
# The same person typing the same address differently: the case the write and the check must agree on.
BANNED_RETYPED = "zorbanax@beispielschule.de"
OTHER = "quillhilde@beispielschule.de"
# A row whose wait has not run out, which counts as held.
WAITING = "wartet@beispielschule.de"
# Where a holder's live change moves them.
INCOMING = "neue.adresse@beispielschule.de"

BAN_REASON = "Falsches Geburtsdatum bei der Anmeldung"

# The league a ban needs to exist at all (`app/api/ban_list/services.py ::
# find_no_saison_refusal`), and the season every case here is counted from. What the five-season
# bound does with it is `tests/api/test_ban_list_lapse_execution.py`'s.
ACTIVE_SAISON_ID = "2026"
# The fifth season after it, the last a ban entered then covers.
BARRED_UNTIL = "2031"

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


async def ban(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    email: str = BANNED,
    ban_reason: str = BAN_REASON,
    by: str = ADMIN,
    notify: bool = False,
) -> Any:
    return await ban_through_the_route(database, client, email=email, ban_reason=ban_reason, by=by, today=TODAY, notify=notify)


async def lift(database: AsyncDatabase, client: AsyncMongoClient, ban_list_entry_id: ObjectId) -> Any:
    token = actor_var.set(ADMIN)
    try:
        return await delete_ban_list_entry(ban_list_entry_id=ban_list_entry_id, ban_list_collection=database[Collection.BAN_LIST], db=client)
    finally:
        actor_var.reset(token)


async def rows_of(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return [row async for row in database[Collection.BAN_LIST].find().sort("_id", 1)]


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

    def test_the_address_a_holder_s_live_change_moves_to_is_refused_and_a_non_holder_s_is_not(self, mongo_replica_set_url: str):
        """Nothing judges a ban at the switch, so the hourly pass would move the grant onto an address that cannot sign in."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            await database[Collection.ADDRESS_CHANGES].insert_many(
                [
                    address_change_document(address=ADMIN, email=INCOMING, token_hash=None, day=TODAY),
                    address_change_document(address=OTHER, email=BANNED_RETYPED, token_hash=None, day=TODAY),
                ]
            )

            with pytest.raises(APIError) as raised:
                await ban(database, client, email=INCOMING)
            # The control: the same read answering every change would refuse this one too.
            await ban(database, client)

            return raised.value.error_code, await database[Collection.BAN_LIST].count_documents({})

        assert on_a_clean_list(mongo_replica_set_url, body) == (Code.BAN_LIST_ADMIN, 1)


class TestTheList:
    def test_two_bans_of_one_day_read_each_with_what_the_page_shows(self, mongo_replica_set_url: str):
        """A ban the page cannot name is one nobody can lift."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await ban(database, client)
            second = await ban(database, client, email=OTHER, ban_reason="Bleibt stehen")
            return first.created_id, second.created_id, (await get_ban_list_entries(database[Collection.BAN_LIST])).ban_list

        first, second, rows = on_a_clean_list(mongo_replica_set_url, body)

        assert sorted((row.id, row.address, row.ban_reason, row.created_at, row.barred_until_saison_id) for row in rows) == sorted(
            [(second, OTHER, "Bleibt stehen", TODAY, BARRED_UNTIL), (first, BANNED_RETYPED, BAN_REASON, TODAY, BARRED_UNTIL)]
        )


class TestTheBansOwnMail:
    @pytest.mark.parametrize(("notify", "owed"), [(True, [(BANNED_RETYPED, BAN_REASON, BARRED_UNTIL)]), (False, [])])
    def test_the_address_is_owed_it_exactly_where_the_press_said(self, mongo_replica_set_url: str, notify: bool, owed: list[Any]):
        """Owed unasked, it tells a mailbox holding no account of a list it never met; unowed, a person learns only by failing to sign in."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, notify=notify)
            rows = database[Collection.OUTBOX].find({"kind": "ban"})
            return [(row["to"], row["data"]["ban_reason"], row["data"]["barred_until_saison_id"]) async for row in rows]

        assert on_a_clean_list(mongo_replica_set_url, body) == owed


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


class TestTheLogOfABan:
    def test_a_ban_and_its_lift_each_write_one_row_with_no_label_and_the_address_nowhere(self, mongo_replica_set_url: str):
        """The log keeps a row twelve months and holds an address only on a grant act: a banned person's is no administrator's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            created = await ban(database, client)
            await lift(database, client, ObjectId(created.created_id))

            return ObjectId(created.created_id), await database[Collection.ACTION_LOG].find().sort("_id", 1).to_list(None)

        created_id, rows = on_a_clean_list(mongo_replica_set_url, body)

        assert [(row["action"], row["by"], row["record_id"], row["label"]) for row in rows] == [
            ("ban.added", ADMIN, created_id, None),
            ("ban.removed", ADMIN, created_id, None),
        ]
        assert BANNED_RETYPED not in str(rows)


class TestAnErasureLeavesTheListStanding:
    def test_erase_a_pupil_moves_no_row_of_the_ban_list(self, mongo_replica_set_url: str):
        """The deliberate exception: the one record a person's own erasure does not reach.

        Driven through the real erasure rather than asserted about it, so a collection added to that
        walk fails here.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, list[Mapping[str, Any]], list[Mapping[str, Any]]]:
            await ban(database, client)
            before = await rows_of(database)

            # Seeded rather than admitted: this case needs a stored pupil at the barred address, not a
            # route that made one.
            pupil = spieler_document(ObjectId(), "Zorbanax", "Mustermann", email=BANNED_RETYPED, birth_date="2009-05-09")
            await database[Collection.SPIELER].insert_one(pupil)
            await erased(database, client, BANNED, germany_now=NOW)

            return await database[Collection.SPIELER].count_documents({"_id": pupil["_id"]}), before, await rows_of(database)

        pupils_left, before, after = on_a_clean_list(mongo_replica_set_url, body)

        # The premise: an erasure reaching nobody leaves the list standing too.
        assert pupils_left == 0
        # Non-empty first: two empty lists compare equal, and an erasure that emptied the collection
        # would then read as one that left it alone.
        assert before
        assert after == before
