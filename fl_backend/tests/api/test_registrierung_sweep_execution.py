from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.registrierungen.system_router import sweep_registrierungen
from app.core.collections import Collection
from app.shared.tokens import hash_token
from tests.acts import deletions_of
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_AUTH, BASE_AUTH, SYSTEM_AUTH, build_test_config
from tests.database import a_clean_database
from tests.documents import (
    SPIELER_TEXT_VERSIONS,
    own_einwilligung_document,
    rules_document,
    saison_document,
    saison_team_document,
    team_document,
)
from tests.passes import refuse_writes_breaking
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
UNDATED_OID = ObjectId("6890a1b2c3d4e5f607970007")
DECIDED_INSIDE_OID = ObjectId("6890a1b2c3d4e5f607970008")
DECIDED_ON_THE_DAY_OID = ObjectId("6890a1b2c3d4e5f607970009")
DECIDED_UNDATED_OID = ObjectId("6890a1b2c3d4e5f60797000a")
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
        "idempotency_key": str(registrierung_id),
        **overrides,
    }


def the_corpus() -> list[dict[str, Any]]:
    """Each clock's boundary from both sides, plus one of another season that no call for `SAISON_ID` may touch."""

    return [
        registrierung(WAITING_OID),
        registrierung(EXPIRED_OID, confirmation=confirmation(EXPIRED_OID, deadline=YESTERDAY)),
        # Its deadline is today, which the link still answers: the pair pins the clock's own boundary.
        registrierung(INSIDE_OID, confirmation=confirmation(INSIDE_OID, deadline=TODAY)),
        # Past its deadline but confirmed, so it waits for the season's end.
        registrierung(
            CONFIRMED_OID, birth_date="2008-05-09", einwilligung=einwilligung(), confirmation=confirmation(CONFIRMED_OID, deadline=YESTERDAY)
        ),
        # No day to count from, so the deadline clock holds it rather than destroying it.
        registrierung(UNDATED_OID, confirmation=None),
        registrierung(
            DECLINED_OID,
            status="declined",
            decision={"made_at": "2026-02-15", "reason": "other_person"},
        ),
        # Decided thirteen days ago and fourteen: the decline clock's own boundary. The first is past its link's deadline
        # too, which is the deadline clock's for a submitted row alone.
        registrierung(
            DECIDED_INSIDE_OID,
            status="declined",
            decision={"made_at": "2026-03-19", "reason": None},
            confirmation=confirmation(DECIDED_INSIDE_OID, deadline=YESTERDAY),
        ),
        registrierung(DECIDED_ON_THE_DAY_OID, status="declined", decision={"made_at": "2026-03-18", "reason": None}),
        registrierung(DECIDED_UNDATED_OID, status="declined", decision=None),
        registrierung(OTHER_SEASON_OID, saison_id=OTHER_SAISON_ID, confirmation=confirmation(OTHER_SEASON_OID, deadline=YESTERDAY)),
    ]


def season(saison_id: str, status: str) -> dict[str, Any]:
    return saison_document(saison_id, status, rules=rules_document(number_of_gruppen=2, teams_per_gruppe=2))


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(url: str, body: Body, *, status: str = "active", mutates_schema: bool = False) -> Any:
    """The SHIPPED indexes.

    `mutates_schema` for a body that installs a validator through `refuse_writes_breaking`.
    """

    async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
        await database[Collection.SAISONS].insert_many([season(SAISON_ID, status), season(OTHER_SAISON_ID, "past")])
        await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, TEAM_NAME, "ADX", website_url=None, schulform="gymnasium_g9"))
        await database[Collection.SAISON_TEAMS].insert_one(saison_team_document(SAISON_ID, TEAM_OID, TEAM_NAME, "ADX"))
        await database[Collection.REGISTRIERUNGEN].insert_many(the_corpus())

        return await body(database, client)


async def sweep(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await sweep_registrierungen(
        saison_id=SAISON_ID,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        today=TODAY,
    )


async def stored(database: AsyncDatabase, registrierung_id: ObjectId) -> Mapping[str, Any] | None:
    return await database[Collection.REGISTRIERUNGEN].find_one({"_id": registrierung_id})


async def standing(database: AsyncDatabase) -> list[ObjectId]:
    rows = await database[Collection.REGISTRIERUNGEN].find({}, {"_id": 1}).sort("_id", 1).to_list(length=None)

    return [row["_id"] for row in rows]


class TestTheDeadlineClock:
    async def test_a_registration_of_another_season_is_untouched(self, mongo_replica_set_url: str):
        """Every removal names this season alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await standing(database)

        assert OTHER_SEASON_OID in await on_a_league(mongo_replica_set_url, body)

    async def test_a_running_seasons_pass_takes_exactly_the_rows_past_their_day(self, mongo_replica_set_url: str):
        """Each clock's filter is its whole judgement: the deadline's own day still answers, and a decision's days end on the fourteenth."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await standing(database)

        assert await on_a_league(mongo_replica_set_url, body) == [
            WAITING_OID,
            INSIDE_OID,
            CONFIRMED_OID,
            OTHER_SEASON_OID,
            UNDATED_OID,
            DECIDED_INSIDE_OID,
            DECIDED_UNDATED_OID,
        ]


class TestTheSeasonsOwnEnd:
    async def test_it_takes_every_undecided_row_whatever_the_pupil_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await deletions_of(database, "retention.registrierungen"), await standing(database)

        erasures, left = await on_a_league(mongo_replica_set_url, body, status="past")

        # The decline clock's one write, then the season's end's: its five undecided rows, confirmed or not.
        assert [(saison, count) for _, saison, count, _ in erasures] == [(SAISON_ID, 2), (SAISON_ID, 5)]
        # The other season's row and the two declined ones the decline clock leaves: the season's end takes no decided
        # row, and every removal here names this season.
        assert left == [OTHER_SEASON_OID, DECIDED_INSIDE_OID, DECIDED_UNDATED_OID]


class TestOneRowHoldsBackNoOther:
    """One case per write the call makes: with the site's isolation gone the whole call raises, every hour."""

    async def test_a_refused_retention_row_leaves_its_rows_and_stops_no_later_clock(self, mongo_replica_set_url: str):
        """No deletion stands without its row, and a clock that raised would end the pass ahead of every clock behind it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_writes_breaking(
                database, Collection.ACTION_LOG, {"properties": {"action": {"not": {"enum": ["retention.registrierungen"]}}}}
            )
            answer = await sweep(database, client)

            return answer, await standing(database)

        answer, left = await on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert answer.failed == 2
        assert {DECLINED_OID, EXPIRED_OID} <= set(left)


async def through_the_app(url: str, path: str, *, auth: Mapping[str, str]) -> tuple[int, list[Mapping[str, Any]]]:
    """One call over the wire, so the guard, the system binder and the route template all run."""

    database_name = build_test_config().db_base_name

    async with a_clean_database(url, database_name) as (_, database):
        await database[Collection.SAISONS].insert_many([season(SAISON_ID, "active"), season(OTHER_SAISON_ID, "past")])
        await database[Collection.REGISTRIERUNGEN].insert_one(
            registrierung(EXPIRED_OID, confirmation=confirmation(EXPIRED_OID, deadline=YESTERDAY))
        )

        async with app_client(url, app=app_under_test(), now=NOW) as http:
            response = await http.post(f"/api{path}", json=None, headers=dict(auth))

        return response.status_code, await database[Collection.ACTION_LOG].find({"action": "retention.registrierungen"}).to_list(length=None)


class TestTheSystemTierOverTheWire:
    """On the replica set: the erasure runs in a transaction, which a standalone mongod refuses outright."""

    async def test_the_erasure_answers_on_the_system_tier_and_writes_its_row(self, mongo_replica_set_url: str):
        status, rows = await through_the_app(mongo_replica_set_url, f"/registrierungen/saisons/{SAISON_ID}/sweep", auth=SYSTEM_AUTH)

        assert status == 200
        assert [(row["by"], row["saison_id"], row["count"]) for row in rows] == [("system", SAISON_ID, 1)]

    @pytest.mark.parametrize("auth", [BASE_AUTH, ADMIN_AUTH], ids=("base", "admin"))
    async def test_neither_other_key_reaches_it(self, mongo_replica_set_url: str, auth: Mapping[str, str]):
        """The other two keys are refused as the wrong credential before any body is read, so nothing is erased."""

        status, rows = await through_the_app(mongo_replica_set_url, f"/registrierungen/saisons/{SAISON_ID}/sweep", auth=auth)

        assert status == 401
        assert rows == []
