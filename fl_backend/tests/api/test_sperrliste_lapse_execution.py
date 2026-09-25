"""
API · a ban's five-season bound, from the season the write counts it from to the activation that removes the row

The boundary is pinned on BOTH sides in every case that touches it: a check that always answers
False and a sweep that always deletes each pass one side of it.
"""

from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.saisons.admin_router import activate_saison
from app.api.saisons.crud import pull_massgebliche_saison_id
from app.api.sperrliste.admin_router import get_sperrliste, post_sperrliste_eintrag
from app.api.sperrliste.crud import address_is_gesperrt
from app.api.sperrliste.schemas import FLPostSperrlistePayload
from app.api.sperrliste.services import SPERRLISTE_KEINE_SAISON, SPERRLISTE_SCHLUESSEL_VERSION, adresse_hash
from app.core.collections import Collection
from app.core.exceptions import DocumentConflictException
from tests import documents
from tests.config import build_test_config
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, on_the_seed_loop
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_sperrliste_lapse_test")

CONFIG = build_test_config()

TODAY = "2026-04-01"

ADMIN = "admin@frankfurtleague.de"

BANNED = "Zorbanax@Beispielschule.de"
OTHER = "quillhilde@beispielschule.de"

GRUND = "Falsches Geburtsdatum bei der Anmeldung"

# The season a ban entered under 2026 covers through, and the one after it. Spelled rather than
# computed: a case reading the arithmetic it exists to pin would follow the code wherever it went.
ENTERED_UNDER = "2026"
LAST_COVERED = "2031"
FIRST_CLEAR = "2032"

TEAM_ID = ObjectId("6890a1b2c3d4e5f607250001")
# `spiele.spieltag_id` is `objectId` and NOT nullable in the shipped validator, so a drawn fixture
# names a matchday whether or not one is seeded; nothing checks that the row exists.
SPIELTAG_ID = ObjectId("6890a1b2c3d4e5f6072500a1")

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def saison_document(saison_id: str, status: str) -> dict[str, Any]:
    """The span and the rules are what the shipped validator requires of any season; `status` is what this suite varies."""

    return documents.saison_document(saison_id, status, rules=documents.rules_document(number_of_groups=2, erlaubte_stufen=["E1"]))


async def a_drawn_target(database: AsyncDatabase, saison_id: str) -> None:
    """A `future` season and the one fixture that makes it activatable at all.

    `REQ-ACTIVATE-003` refuses an undrawn target before the rollover writes anything, and no matchday
    row is seeded, a season holding none owing no date (`REQ-ACTIVATE-004`).
    """

    await database[Collection.SAISONS].insert_one(saison_document(saison_id, "future"))
    await database[Collection.SPIELE].insert_one(
        documents.spiel_document(
            spiel_id=ObjectId(),
            saison_id=saison_id,
            spiel_nr=1,
            spieltag_id=SPIELTAG_ID,
            team1={"team_id": TEAM_ID, "name": "Alpha", "shorthand": "AL", "tore": None},
        )
    )


def on_a_league(url: str, seasons: list[dict[str, Any]], body: Body) -> Any:
    """The SHIPPED validator and the unique index, so a document production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            if seasons:
                await database[Collection.SAISONS].insert_many(seasons)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, email: str = BANNED) -> Any:
    return await post_sperrliste_eintrag(
        sperrliste_data=FLPostSperrlistePayload(email=email, grund=GRUND),
        sperrliste_collection=database[Collection.SPERRLISTE],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        config=CONFIG,
        erstellt_von=ADMIN,
        today=TODAY,
    )


def a_raw_row(email: str) -> dict[str, Any]:
    """One conforming entry written straight to the collection, which is what a case varying a single key needs."""

    return {
        "adresse_hash": adresse_hash(email, schluessel=CONFIG.sperrliste_schluessel),
        "schluessel_version": SPERRLISTE_SCHLUESSEL_VERSION,
        "grund": GRUND,
        "erstellt_von": ADMIN,
        "erstellt_am": TODAY,
        "gesperrt_bis_saison_id": LAST_COVERED,
    }


async def is_gesperrt(database: AsyncDatabase, *, against: str | None, email: str = BANNED) -> bool:
    return await address_is_gesperrt(
        sperrliste_collection=database[Collection.SPERRLISTE],
        adresse_hash=adresse_hash(email, schluessel=CONFIG.sperrliste_schluessel),
        massgebliche_saison_id=against,
    )


async def activate(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str) -> Any:
    return await activate_saison(
        saison_id=saison_id,
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        spieltage_collection=database[Collection.SPIELTAGE],
        sperrliste_collection=database[Collection.SPERRLISTE],
        db=client,
    )


class TestWhatTheWriteRecords:
    def test_the_row_and_the_response_name_the_same_last_covered_season(self, mongo_replica_set_url: str):
        """Computed on the SERVER and answered once: the action builds the person's mail from this, and a second read would race the sweep."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, Any]:
            created = await ban(database, client)
            stored = await database[Collection.SPERRLISTE].find_one({})

            assert stored is not None
            return str(stored["gesperrt_bis_saison_id"]), created.gesperrt_bis_saison_id

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == (LAST_COVERED, LAST_COVERED)

    def test_the_served_row_carries_the_bound_and_still_no_hash(self, mongo_replica_set_url: str):
        """The field has to reach the list or a lapsing ban is one an administrator cannot tell from a standing one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client)

            return await get_sperrliste(sperrliste_collection=database[Collection.SPERRLISTE])

        served = on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body)

        assert served.sperrliste[0].gesperrt_bis_saison_id == LAST_COVERED
        assert "adresse_hash" not in served.model_dump_json()


class TestTheSeasonTheBanIsCountedFrom:
    def test_the_running_season_answers_while_one_is_active(self, mongo_replica_set_url: str):
        """The ordinary state, and the control under the two cases answering nothing: a helper always answering `None` passes both."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str | None:
            return await pull_massgebliche_saison_id(saisons_collection=database[Collection.SAISONS])

        seasons = [saison_document("2025", "past"), saison_document(ENTERED_UNDER, "active"), saison_document("2027", "future")]

        assert on_a_league(mongo_replica_set_url, seasons, body) == ENTERED_UNDER

    def test_a_league_holding_only_ended_seasons_answers_nothing(self, mongo_replica_set_url: str):
        """A status set by hand, the rollover promoting in the transaction that demotes (`docs/backend/spec.md :: I18`).

        The newest ended season sorts first, so a helper guessing it answers `ENTERED_UNDER` here.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str | None:
            return await pull_massgebliche_saison_id(saisons_collection=database[Collection.SAISONS])

        seasons = [saison_document("2025", "past"), saison_document(ENTERED_UNDER, "past"), saison_document("2027", "future")]

        assert on_a_league(mongo_replica_set_url, seasons, body) is None

    def test_a_league_holding_only_a_future_season_answers_nothing(self, mongo_replica_set_url: str):
        """A planned season has been played under by nobody, so counting five from it would bar a person five seasons early."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str | None:
            return await pull_massgebliche_saison_id(saisons_collection=database[Collection.SAISONS])

        assert on_a_league(mongo_replica_set_url, [saison_document("2027", "future")], body) is None

    def test_only_a_caller_without_a_session_is_answered_from_the_season_cache(self, mongo_replica_set_url: str):
        """BOTH sides: a helper never consulting the cache fails the first answer, and one consulting it under a session fails the second."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str | None]:
            saisons = database[Collection.SAISONS]
            await pull_massgebliche_saison_id(saisons_collection=saisons)
            # Moved by hand, so nothing drops the season the read above cached.
            await saisons.update_one({"_id": ENTERED_UNDER}, {"$set": {"status": "past"}})
            await saisons.update_one({"_id": "2027"}, {"$set": {"status": "active"}})

            async with client.start_session() as session:
                cached = await pull_massgebliche_saison_id(saisons_collection=saisons)
                sessioned = await pull_massgebliche_saison_id(saisons_collection=saisons, session=session)

            return cached, sessioned

        seasons = [saison_document(ENTERED_UNDER, "active"), saison_document("2027", "future")]

        assert on_a_league(mongo_replica_set_url, seasons, body) == (ENTERED_UNDER, "2027")

    def test_the_running_season_is_read_through_the_session(self, mongo_replica_set_url: str):
        """A season the transaction wrote is seen through its session alone, so the helper answers it only when handed that session."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str | None, str | None]:
            saisons = database[Collection.SAISONS]

            async def write_then_read(session: AsyncClientSession) -> tuple[str | None, str | None]:
                await saisons.insert_one(saison_document("2028", "active"), session=session)

                return (
                    await pull_massgebliche_saison_id(saisons_collection=saisons, session=session),
                    await pull_massgebliche_saison_id(saisons_collection=saisons),
                )

            async with client.start_session() as session:
                return await session.with_transaction(write_then_read)

        seasons = [saison_document(ENTERED_UNDER, "past"), saison_document("2027", "future")]

        assert on_a_league(mongo_replica_set_url, seasons, body) == ("2028", None)


class TestALeagueWithNoSeasonRunning:
    @pytest.mark.parametrize(
        "seasons",
        [
            pytest.param([saison_document("2027", "future")], id="before its first activation"),
            pytest.param([saison_document(ENTERED_UNDER, "past")], id="holding only an ended season"),
        ],
    )
    def test_the_ban_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str, seasons: list[dict[str, Any]]):
        """Driven through the endpoint, so the refusal is shown to stand before the insert rather than beside it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            with pytest.raises(DocumentConflictException) as raised:
                await ban(database, client)

            assert raised.value.error_code == SPERRLISTE_KEINE_SAISON

            return await database[Collection.SPERRLISTE].count_documents({})

        assert on_a_league(mongo_replica_set_url, seasons, body) == 0

    def test_the_check_answers_not_barred_rather_than_refusing(self, mongo_replica_set_url: str):
        """A public submission must not be turned away for the league's own state, and the refusal above is what leaves the list empty."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> bool:
            return await is_gesperrt(database, against=None)

        assert on_a_league(mongo_replica_set_url, [saison_document("2027", "future")], body) is False


class TestTheBoundaryTheCheckReads:
    def test_the_last_covered_season_still_bars_and_the_one_after_it_does_not(self, mongo_replica_set_url: str):
        """BOTH sides in one case: a check answering False always passes the second assertion, and one answering True passes the first."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[bool, bool]:
            await ban(database, client)

            return await is_gesperrt(database, against=LAST_COVERED), await is_gesperrt(database, against=FIRST_CLEAR)

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == (True, False)

    def test_a_lapsed_row_answers_false_while_it_still_stands(self, mongo_replica_set_url: str):
        """What makes the sweep's failure harmless: nothing else removes a lapsed row, and the check passes over it either way."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[bool, int]:
            await ban(database, client)

            return await is_gesperrt(database, against=FIRST_CLEAR), await database[Collection.SPERRLISTE].count_documents({})

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == (False, 1)

    def test_a_row_carrying_no_lapse_season_at_all_is_refused_before_the_check_reads_it(self, mongo_replica_set_url: str):
        """The conforming twin below stores, so the refusal is the missing key's rather than anything else in the row.

        Why the key is required at all stands at it in `fl_backend/app/core/constraints.py`.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, int]:
            await ban(database, client)
            keyless = a_raw_row(OTHER)
            del keyless["gesperrt_bis_saison_id"]

            with pytest.raises(OperationFailure) as refused:
                await database[Collection.SPERRLISTE].insert_one(keyless)

            await database[Collection.SPERRLISTE].insert_one(a_raw_row(OTHER))

            return refused.value.code, await database[Collection.SPERRLISTE].count_documents({})

        code, stored = on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body)

        assert code == DOCUMENT_VALIDATION_FAILED
        assert stored == 2


class TestTheSweepAtAnActivation:
    def test_a_lapsed_ban_goes_and_a_covered_one_stands(self, mongo_replica_set_url: str):
        """Both rows through one activation: a sweep taking the collection passes a case asserting only that the lapsed row went."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            await ban(database, client)
            await a_drawn_target(database, FIRST_CLEAR)
            # Counted from the running season like the row above, then moved to the season the
            # activation reaches, which covers it.
            await ban(database, client, email=OTHER)
            await database[Collection.SPERRLISTE].update_one(
                {"adresse_hash": adresse_hash(OTHER, schluessel=CONFIG.sperrliste_schluessel)},
                {"$set": {"gesperrt_bis_saison_id": FIRST_CLEAR}},
            )

            await activate(database, client, FIRST_CLEAR)

            return [str(row["gesperrt_bis_saison_id"]) async for row in database[Collection.SPERRLISTE].find()]

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == [FIRST_CLEAR]

    def test_the_season_a_row_names_is_the_last_one_that_bars(self, mongo_replica_set_url: str):
        """The off-by-one, driven rather than argued: activating the last covered season leaves the row. That is what `$lt` buys over `$lte`."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client)
            await a_drawn_target(database, LAST_COVERED)
            await activate(database, client, LAST_COVERED)

            return await database[Collection.SPERRLISTE].count_documents({})

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == 1

    def test_a_year_nobody_activated_is_still_swept(self, mongo_replica_set_url: str):
        """Activation is not sequential, so an equality filter would strand every ban whose own season was skipped."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await ban(database, client)
            await a_drawn_target(database, "2040")
            await activate(database, client, "2040")

            return await database[Collection.SPERRLISTE].count_documents({})

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == 0

    def test_the_lapse_is_recorded_and_keeps_no_image_of_the_row_it_removed(self, mongo_replica_set_url: str):
        """An ERASURE, because the bound ran out: `grund` may name the person barred, and an image would keep that a year past the ban.

        WHO the row names is not asserted: the actor is a router dependency's, unrun here.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            await ban(database, client)
            await a_drawn_target(database, "2040")
            await activate(database, client, "2040")
            recorded = await database[Collection.AKTIONEN].find_one({"collection": "sperrliste"})

            assert recorded is not None
            return recorded

        recorded = on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body)

        # The operation FIRST: a delete would file the same row with an image beside it, and every
        # assertion below would then be about the wrong helper's log row.
        assert recorded["operation"] == "erase_many"
        assert recorded["modified_count"] == 1
        assert recorded.get("before") is None
        assert GRUND not in repr(recorded)
        # The address the ban was taken from survives nowhere, the filter's own values included.
        assert BANNED.split("@")[0].lower() not in repr(recorded).lower()

    def test_an_activation_removing_nothing_still_activates(self, mongo_replica_set_url: str):
        """The floor under every case above: a sweep sharing the rollover's transaction may still never move its answer."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, int]:
            await a_drawn_target(database, FIRST_CLEAR)
            rolled_over = await activate(database, client, FIRST_CLEAR)
            activated = await database[Collection.SAISONS].find_one({"_id": FIRST_CLEAR})

            assert activated is not None
            return str(activated["status"]), rolled_over.deactivated

        assert on_a_league(mongo_replica_set_url, [saison_document(ENTERED_UNDER, "active")], body) == ("active", 1)
