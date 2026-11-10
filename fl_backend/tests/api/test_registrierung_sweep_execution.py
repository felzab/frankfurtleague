import asyncio
import functools
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient, MongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.registrierungen.services import SWEEP_PAGE
from app.api.registrierungen.system_router import sweep_registrierungen
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import DocumentNotFoundError
from app.main import create_app
from app.shared.tokens import hash_token
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, BASE_AUTH, SYSTEM_AUTH, build_test_config
from tests.database import a_clean_database, a_clean_database_sync, on_the_seed_loop
from tests.documents import (
    SPIELER_TEXT_VERSIONS,
    own_einwilligung_document,
    rules_document,
    saison_document,
    saison_team_document,
    team_document,
)
from tests.wire import commands_by_name
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_sweep_test")

SAISON_ID = "2026"
OTHER_SAISON_ID = "2025"
TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
MAILED_ON_THE_MARK = "2026-03-29"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Fixed rather than generated, so a failure names the same row every run.
WAITING_OID = ObjectId("6890a1b2c3d4e5f607970001")
EXPIRED_OID = ObjectId("6890a1b2c3d4e5f607970002")
INSIDE_OID = ObjectId("6890a1b2c3d4e5f607970003")
CONFIRMED_OID = ObjectId("6890a1b2c3d4e5f607970004")
DECLINED_OID = ObjectId("6890a1b2c3d4e5f607970005")
OTHER_SEASON_OID = ObjectId("6890a1b2c3d4e5f607970006")
TEAM_OID = ObjectId("6890a1b2c3d4e5f607970011")
INVITATION_OID = ObjectId("6890a1b2c3d4e5f607970021")

TEAM_NAME = "Adler"


def einwilligung(*, confirmed_at: str = MAILED_ON_THE_MARK) -> dict[str, Any]:
    stored = own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at=MAILED_ON_THE_MARK)

    return {**stored, "confirmed_at": confirmed_at}


def confirmation(registrierung_id: ObjectId, *, deadline: str = "2026-04-05", **overrides: Any) -> dict[str, Any]:
    return {
        "token_hashes": [hash_token(f"first-{registrierung_id}")],
        "sent_at": MAILED_ON_THE_MARK,
        "deadline": deadline,
        **overrides,
    }


def registrierung(registrierung_id: ObjectId, *, saison_id: str = SAISON_ID, **overrides: Any) -> dict[str, Any]:
    """One submitted registration inside its deadline, that each row below moves one thing of."""

    return {
        "_id": registrierung_id,
        "saison_id": saison_id,
        "team_id": TEAM_OID,
        "invitation_id": INVITATION_OID,
        "submitted_at": MAILED_ON_THE_MARK,
        "status": "submitted",
        "first_name": "Quillhilde",
        "last_name": "Brackenmoor",
        "email": f"{registrierung_id}@example.com",
        "position": None,
        "nummer": None,
        "stufe": "Q1",
        "birth_date": None,
        "einwilligung": None,
        "confirmation": confirmation(registrierung_id),
        "decision": None,
        **overrides,
    }


def the_corpus() -> list[dict[str, Any]]:
    """One registration per clock, plus one of another season that no call for `SAISON_ID` may touch."""

    return [
        registrierung(WAITING_OID),
        registrierung(EXPIRED_OID, confirmation=confirmation(EXPIRED_OID, deadline=YESTERDAY)),
        # Its deadline is today, which the link still answers: the pair pins the clock's own boundary.
        registrierung(INSIDE_OID, confirmation=confirmation(INSIDE_OID, deadline=TODAY)),
        registrierung(CONFIRMED_OID, birth_date="2008-05-09", einwilligung=einwilligung()),
        registrierung(
            DECLINED_OID,
            status="declined",
            decision={"made_at": "2026-02-15", "reason": "kein Platz"},
        ),
        registrierung(OTHER_SEASON_OID, saison_id=OTHER_SAISON_ID, confirmation=confirmation(OTHER_SEASON_OID, deadline=YESTERDAY)),
    ]


def season(saison_id: str, status: str) -> dict[str, Any]:
    return saison_document(saison_id, status, rules=rules_document(number_of_gruppen=2, teams_per_gruppe=2))


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, status: str = "active", mutates_schema: bool = False) -> Any:
    """The SHIPPED indexes.

    `mutates_schema` for a body that installs a validator through `refuse_writes_breaking`.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SAISONS].insert_many([season(SAISON_ID, status), season(OTHER_SAISON_ID, "past")])
            await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, TEAM_NAME, "ADX", website_url=None, schulform="gymnasium_g9"))
            await database[Collection.SAISON_TEAMS].insert_one(saison_team_document(SAISON_ID, TEAM_OID, TEAM_NAME, "ADX"))
            await database[Collection.REGISTRIERUNGEN].insert_many(the_corpus())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str = SAISON_ID, today: str = TODAY) -> Any:
    return await sweep_registrierungen(
        saison_id=saison_id,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        today=today,
    )


async def stored(database: AsyncDatabase, registrierung_id: ObjectId) -> Mapping[str, Any] | None:
    return await database[Collection.REGISTRIERUNGEN].find_one({"_id": registrierung_id})


async def standing(database: AsyncDatabase) -> list[ObjectId]:
    rows = await database[Collection.REGISTRIERUNGEN].find({}, {"_id": 1}).sort("_id", 1).to_list(length=None)

    return [row["_id"] for row in rows]


class TestTheDeadlineClock:
    def test_it_loescht_the_day_after_the_deadline_and_not_on_it(self, mongo_replica_set_url: str):
        """The two rows part on one day: the link answers on its deadline, so the erasure waits.

        Both carry a null consent record, which is what says the page's consent term reads one.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await standing(database)

        response, left = on_a_league(mongo_replica_set_url, body)

        assert response.erased_unconfirmed == 1
        assert EXPIRED_OID not in left
        assert INSIDE_OID in left

    def test_a_registration_of_another_season_is_untouched(self, mongo_replica_set_url: str):
        """Every removal names this season alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await standing(database)

        assert OTHER_SEASON_OID in on_a_league(mongo_replica_set_url, body)


class TestTheSeasonsOwnEnd:
    def test_it_takes_every_undecided_row_whatever_the_pupil_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await standing(database)

        response, left = on_a_league(mongo_replica_set_url, body, status="past")

        assert response.erased_without_decision == 4
        # The other season's row alone: the declined one goes to the decline clock in the same pass,
        # and every removal here names this season.
        assert left == [OTHER_SEASON_OID]


class TestTheDeclineClock:
    def test_it_loescht_a_declined_registration_past_its_fourteen_days(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await standing(database)

        response, left = on_a_league(mongo_replica_set_url, body)

        assert response.erased_declined == 1
        assert DECLINED_OID not in left


async def refuse_writes_breaking(database: AsyncDatabase, collection: Collection, schema: Mapping[str, Any]) -> None:
    """How this suite forces one row's write to fail mid-pass: a `$jsonSchema` the planted row breaks and every other row keeps."""

    await database.command("collMod", str(collection), validator={"$jsonSchema": dict(schema)}, validationLevel="strict")


class TestOneRowHoldsBackNoOther:
    """One case per write the call makes: with the site's isolation gone the whole call raises, every hour."""

    def test_a_refused_retention_row_leaves_its_rows_and_stops_no_later_clock(self, mongo_replica_set_url: str):
        """No deletion stands without its row, and a clock that raised would end the pass ahead of every clock behind it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_writes_breaking(
                database, Collection.ACTION_LOG, {"properties": {"action": {"not": {"enum": ["retention.registrierungen"]}}}}
            )
            answer = await sweep(database, client)

            return answer, await standing(database)

        answer, left = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert (answer.erased_declined, answer.erased_unconfirmed, answer.failed) == (0, 0, 2)
        assert {DECLINED_OID, EXPIRED_OID} <= set(left)


# A page and a short one after it. At a page plus ONE the first read takes every row, so a clock
# that stopped after one erasure would leave nothing behind and pass.
OVERFLOW = SWEEP_PAGE + 5


def overflowing(**overrides: Any) -> list[dict[str, Any]]:
    """More due rows of one season than one page holds, each an id of its own."""

    return [registrierung(ObjectId(f"6890a1b2c3d4e5f6079{position:05d}"), **overrides) for position in range(OVERFLOW)]


class TestAPageAndOneMoreIsDrainedRatherThanRefused:
    """More due rows than one page, which is the population only the erasure shrinks.

    Seeded as real rows: a page size the endpoint took as an argument would be an API this
    application has only because a test wants one.
    """

    @pytest.mark.parametrize(
        ("clock", "overrides", "status", "counted"),
        [
            pytest.param(
                "deadline", {"confirmation": confirmation(EXPIRED_OID, deadline=YESTERDAY)}, "active", "erased_unconfirmed", id="deadline"
            ),
            pytest.param("season's end", {}, "past", "erased_without_decision", id="season's end"),
            pytest.param(
                "decline",
                {"status": "declined", "decision": {"made_at": "2026-02-15", "reason": None}},
                "active",
                "erased_declined",
                id="decline",
            ),
        ],
    )
    def test_every_due_row_goes_in_one_pass(self, mongo_replica_set_url: str, clock: str, overrides: Any, status: str, counted: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].delete_many({})
            await database[Collection.REGISTRIERUNGEN].insert_many(overflowing(**overrides))
            response = await sweep(database, client)

            return getattr(response, counted), await database[Collection.REGISTRIERUNGEN].count_documents({"saison_id": SAISON_ID})

        erased_count, left = on_a_league(mongo_replica_set_url, body, status=status)

        assert (erased_count, left) == (OVERFLOW, 0), f"the {clock} clock left rows the next pass would read into the same full page"


class TestASeasonNobodyHas:
    def test_the_pass_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundError):
                await sweep(database, client, saison_id="1999")

            return await standing(database)

        assert len(on_a_league(mongo_replica_set_url, body)) == len(the_corpus())


# The commands of the worst call, erasing one page per clock.
COMMANDS = 9


class TestTheWorstCallSendsTheCommandsItsBudgetCounts:
    def test_the_sweep(self, mongo_replica_set_url: str):
        """Both erasing clocks take a page.

        A command added to the call turns this red, so the call is judged against the request's deadline again.
        """

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, sweep)

        answer, names = on_a_league(mongo_replica_set_url, body)

        assert (answer.erased_declined, answer.erased_unconfirmed) == (1, 1)
        assert sum(names.values()) == COMMANDS, names


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(build_test_config())


def through_the_app(url: str, path: str, *, auth: Mapping[str, str]) -> tuple[int, list[Mapping[str, Any]]]:
    """One call over the wire, so the guard, the system binder and the route template all run."""

    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, database_name)
        database[Collection.SAISONS].insert_many([season(SAISON_ID, "active"), season(OTHER_SAISON_ID, "past")])
        database[Collection.REGISTRIERUNGEN].insert_one(registrierung(EXPIRED_OID, confirmation=confirmation(EXPIRED_OID, deadline=YESTERDAY)))

        async def _called() -> int:
            async with app_client(url, app=_served(), now=NOW) as http:
                response = await http.post(f"/api/v{API_VERSION}{path}", json=None, headers=dict(auth))
                return response.status_code

        status = asyncio.run(_called())

        return status, list(database[Collection.ACTION_LOG].find({"action": "retention.registrierungen"}))
    finally:
        client.close()


class TestTheSystemTierOverTheWire:
    """On the replica set: the erasure runs in a transaction, which a standalone mongod refuses outright."""

    def test_the_erasure_answers_on_the_system_tier_and_writes_its_row(self, mongo_replica_set_url: str):
        status, rows = through_the_app(mongo_replica_set_url, f"/registrierungen/sweep/{SAISON_ID}", auth=SYSTEM_AUTH)

        assert status == 200
        assert [(row["by"], row["label"], row["count"]) for row in rows] == [("system", SAISON_ID, 1)]

    @pytest.mark.parametrize("auth", [BASE_AUTH, ADMIN_AUTH], ids=("base", "admin"))
    def test_neither_other_key_reaches_it(self, mongo_replica_set_url: str, auth: Mapping[str, str]):
        """The other two keys are refused as the wrong credential before any body is read, so nothing is erased."""

        status, rows = through_the_app(mongo_replica_set_url, f"/registrierungen/sweep/{SAISON_ID}", auth=auth)

        assert status == 401
        assert rows == []
