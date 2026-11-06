from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.sperrliste.admin_router import delete_sperrliste_entry, get_sperrliste
from app.api.sperrliste.crud import address_is_barred, read_sperrliste_page
from app.api.sperrliste.services import address_hash
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, DocumentNotFoundError
from tests.bans import ban_list, ban_through_the_route
from tests.config import build_test_config, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import rules_document, saison_document, spieler_document
from tests.erasure import erased
from tests.isolation import InterleavedCollection
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_sperrliste_test")

CONFIG = build_test_config()

TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

ADMIN = "admin@frankfurtleague.de"

# Distinctive rather than "test@example.com": a sweep of a whole database for a fragment is evidence
# of absence only where a hit could not be coincidence.
BANNED = "Zorbanax@Beispielschule.de"
# The same person typing the same address differently -- the case the write and the check must agree
# on, and the one a per-spelling hash would let through.
BANNED_RETYPED = "zorbanax@beispielschule.de"
OTHER = "quillhilde@beispielschule.de"

# Searched for apart, so a row keeping either half of the address is caught where the whole is not.
BANNED_LOCAL_PART, BANNED_DOMAIN = BANNED.lower().split("@")
BANNED_SCHOOL = BANNED_DOMAIN.split(".")[0]

GRUND = "Falsches Geburtsdatum bei der Anmeldung"

# The league a ban needs to exist at all (`app/api/sperrliste/services.py ::
# find_keine_saison_refusal`), and the season every case here is counted from. What the five-season
# bound does with it is `tests/api/test_sperrliste_lapse_execution.py`'s.
ACTIVE_SAISON_ID = "2026"

SAISON_DOCUMENT: dict[str, Any] = saison_document(ACTIVE_SAISON_ID, "active", rules=rules_document(number_of_gruppen=2, allowed_stufen=["E1"]))

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


class SeasonsRunningARivalAfterTheFirstRead(InterleavedCollection):
    """Runs a rival write once, just after the first `find_one`: the ban's reference season, so the rival lands before the list check."""

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._collection.find_one(*args, **kwargs)
        await self.run_the_rival()

        return found


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
    """The list read with its two dependencies: the season the ban list compares against, and the key."""

    return await get_sperrliste(
        ban_list_collection=database[Collection.BAN_LIST],
        ban_list=ban_list(database),
    )


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, email: str = BANNED, grund: str = GRUND, by: str = ADMIN) -> Any:
    return await ban_through_the_route(database, client, email=email, grund=grund, by=by, today=TODAY)


async def rows_of(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return [row async for row in database[Collection.BAN_LIST].find().sort("_id", 1)]


class TestWhatABanStores:
    def test_no_part_of_the_banned_address_reaches_the_row(self, mongo_replica_set_url: str):
        """The whole point of the collection, and the half nothing else in the suite would notice going wrong."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            await ban(database, client)
            stored = await database[Collection.BAN_LIST].find_one({})

            assert stored is not None
            return stored

        stored = on_a_clean_list(mongo_replica_set_url, body)

        # `created_by` is the ADMINISTRATOR's own address and the one field here that may hold
        # one, so the `@` clause is asked of everything beside it.
        assert "@" not in repr({key: value for key, value in stored.items() if key != "created_by"})
        assert BANNED_LOCAL_PART not in repr(stored).lower()
        assert BANNED_SCHOOL not in repr(stored).lower()

    def test_the_write_is_recorded_without_the_address(self, mongo_replica_set_url: str):
        """The log is the second place a value can survive a feature built to keep none: the create files a row here too."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            await ban(database, client)

            return repr([row async for row in database[Collection.ACTION_LOG].find()])

        recorded = on_a_clean_list(mongo_replica_set_url, body)

        assert "sperrliste" in recorded, "the create filed no log row at all, so the assertion below holds of nothing"
        assert BANNED_LOCAL_PART not in recorded.lower()


class TestASecondBanOfOneAddress:
    def test_a_row_written_is_a_row_refused(self, mongo_replica_set_url: str):
        """The full cycle: the write and the check hash under one key, so a second ban meets the first.

        Keyed differently at the two ends, every case here still passes -- and the list silently
        refuses nobody.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> None:
            await ban(database, client)

            with pytest.raises(APIError) as raised:
                await ban(database, client)

            assert raised.value.error_code == Code.DUPLICATE_KEY

        on_a_clean_list(mongo_replica_set_url, body)

    def test_the_same_address_retyped_meets_the_row_it_already_has(self, mongo_replica_set_url: str):
        """The case a per-spelling hash lets through: one person, two spellings, one row and one refusal."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client)

            with pytest.raises(APIError) as raised:
                await ban(database, client, email=BANNED_RETYPED)

            assert raised.value.error_code == Code.DUPLICATE_KEY

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


class TestTheCheckASignUpWillAsk:
    def test_a_banned_address_answers_the_check_in_every_spelling(self, mongo_replica_set_url: str):
        """What a registration calls before it writes; nothing calls it yet, so this is the only thing holding it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[bool]:
            await ban(database, client)

            return [
                await address_is_barred(
                    ban_list_collection=database[Collection.BAN_LIST],
                    address_hash=address_hash(typed, key=CONFIG.sperrliste_key),
                    governing_saison_id=ACTIVE_SAISON_ID,
                )
                for typed in (BANNED, BANNED_RETYPED, "Zorbanax@BEISPIELSCHULE.DE  ")
            ]

        assert on_a_clean_list(mongo_replica_set_url, body) == [True, True, True]


class TestWhatTheListServes:
    def test_the_served_rows_carry_no_address_and_no_hash(self, mongo_replica_set_url: str):
        """A read is the widest surface a stored value escapes through, and the hash is what a leaked collection lacks."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client)

            return await listed(database)

        served = on_a_clean_list(mongo_replica_set_url, body)

        assert len(served.sperrliste) == 1
        rendered = served.model_dump_json()
        # `created_by` carries the administrator's own address, so the banned one is named
        # directly rather than sought by its `@`.
        assert BANNED_LOCAL_PART not in rendered.lower()
        assert "address_hash" not in rendered
        assert served.sperrliste[0].grund == GRUND
        assert served.sperrliste[0].created_by == ADMIN
        assert served.sperrliste[0].created_at == TODAY

    def test_an_author_revoked_and_barred_since_is_withheld_beside_a_flag(self, mongo_replica_set_url: str):
        """The grants list's rule on every admin read: no barred address is served in plain."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=OTHER)
            # Revoked as a paste revokes, then barred through the route by another administrator.
            await database[Collection.GRANTS].delete_one({"address": ADMIN})
            await ban(database, client, email=ADMIN, by=grants_for_the_suite()[0]["address"])

            served = await listed(database)

            return [(row.created_by, row.created_by_barred) for row in served.sperrliste], served.model_dump_json()

        rows, rendered = on_a_clean_list(mongo_replica_set_url, body)

        # Newest first: the ban on the author, entered by an owner the list does not hold, then the author's own.
        assert rows == [(grants_for_the_suite()[0]["address"], False), (None, True)]
        assert ADMIN not in rendered

    def test_the_total_counts_the_collection_and_not_the_rows_served(self, mongo_replica_set_url: str):
        """A ban past the cap is enforced and not rendered, so the count is what says one is there to lift.

        The cap is driven rather than named: a total copied off the served rows passes otherwise.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[int, int]:
            await ban(database, client)
            await ban(database, client, email=OTHER)

            served = await listed(database)
            capped = await read_sperrliste_page(ban_list_collection=database[Collection.BAN_LIST], limit=1)

            return served.count_total, capped[1]

        # The cap is what makes the pair differ: one row served, two held, and both reads say two.
        assert on_a_clean_list(mongo_replica_set_url, body) == (2, 2)


class TestLiftingABan:
    def test_the_row_is_gone_and_its_neighbour_stands(self, mongo_replica_set_url: str):
        """A removal reaching past its own id would empty the list, which nothing else here would catch."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            created = await ban(database, client)
            await ban(database, client, email=OTHER, grund="Bleibt stehen")

            await delete_sperrliste_entry(
                sperrliste_id=ObjectId(created.created_id),
                ban_list_collection=database[Collection.BAN_LIST],
                db=client,
            )

            return [str(row["grund"]) for row in await rows_of(database)]

        assert on_a_clean_list(mongo_replica_set_url, body) == ["Bleibt stehen"]

    def test_the_log_image_holds_the_whole_row_and_no_address(self, mongo_replica_set_url: str):
        """What outlives a lifted ban, pinned rather than assumed: the image is kept for the rule's twelve months.

        A field added to the row joins this image on the next removal, so the set is asserted whole.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            created = await ban(database, client)
            await delete_sperrliste_entry(
                sperrliste_id=ObjectId(created.created_id),
                ban_list_collection=database[Collection.BAN_LIST],
                db=client,
            )
            recorded = await database[Collection.ACTION_LOG].find_one({"operation": "delete_many", "collection": "sperrliste"})

            assert recorded is not None
            return recorded

        recorded = on_a_clean_list(mongo_replica_set_url, body)
        images = recorded["before"]

        assert len(images) == 1
        assert set(images[0]) == {"_id", "address_hash", "key_version", "grund", "created_by", "created_at", "barred_until_saison_id"}
        assert images[0]["grund"] == GRUND
        # The reason the image is safe to keep: it holds the hash and the administrator, never the
        # address the ban was taken from.
        assert BANNED_LOCAL_PART not in repr(images).lower()

    def test_an_id_no_row_holds_is_a_404_that_removes_nothing(self, mongo_replica_set_url: str):
        """A removal answering 200 over an empty result tells an administrator a ban is lifted that still stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client)

            with pytest.raises(DocumentNotFoundError):
                await delete_sperrliste_entry(
                    sperrliste_id=ObjectId("6890a1b2c3d4e5f60794ffff"),
                    ban_list_collection=database[Collection.BAN_LIST],
                    db=client,
                )

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
