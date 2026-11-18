from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from bson import ObjectId
from httpx2 import Response
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identity.schemas import FLSubjectPayload, FLSubjectResponse
from app.api.identity.system_router import get_subject
from app.core.collections import Collection
from tests.app_client import app_client, app_under_test
from tests.config import SYSTEM_AUTH
from tests.database import a_clean_database
from tests.plans import plans_of_sent_reads
from tests.records import call_sign_in, record_collections
from tests.subject_corpus import (
    ADMIN_STORED,
    GRANT_STORED_OID,
    IDENTIFIER,
    RETIRED,
    UNCONFIRMED,
    the_subjects_corpus,
)
from tests.worker import worker_database

DATABASE_NAME = worker_database("fl_identity_subject_test")

PATH = "/api/identity/subject"


# Holding nothing, at the unconfirmed mailbox's local part: a read wider than the address takes that mailbox's records.
UNCONFIRMED_ELSEWHERE = UNCONFIRMED.replace("@schule.example.org", "@anderswo.example.org")

# The banned address, banned in one spelling and asked in another; and an address whose ban ended
# with the season before the running one.
BARRED_BANNED = "Gerda.Gesperrt@Schule.example.org"
BARRED_ASKED = "GERDA.GESPERRT@schule.example.org"
EXPIRED = "arno.abgelaufen@schule.example.org"
BAN_ACTIVE_OID = ObjectId("6890a1b2c3d4e5f607820041")
BAN_LAPSED_OID = ObjectId("6890a1b2c3d4e5f607820042")

# A grant holder's address, asked in capitals.
ADMIN_ASKED = "Verena.Verwaltung@SCHULE.example.org"

# Past every grant the seed dates.
NOW = datetime(2026, 6, 1, tzinfo=UTC)


Body = Callable[[AsyncDatabase], Awaitable[Any]]


async def on_a_league(url: str, body: Body) -> Any:
    """The shipped indexes, so a seeded row this read has to answer meets the constraints a real one meets."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (_, database):
        await the_subjects_corpus(database)

        return await body(database)


async def _no_body(_: AsyncDatabase) -> None:
    """For a caller that wants the corpus and nothing else: the request below runs on a loop of its own."""

    return None


async def call_subject(database: AsyncDatabase, email: str) -> FLSubjectResponse:
    return await get_subject(
        subject_data=FLSubjectPayload(email=email),
        records=record_collections(database),
        grants_collection=database[Collection.GRANTS],
        germany_now=NOW,
    )


async def answered(url: str, email: str = IDENTIFIER) -> FLSubjectResponse:
    return await on_a_league(url, lambda database: call_subject(database, email))


@pytest.mark.db
async def test_an_address_sharing_only_a_local_part_with_unconfirmed_records_awaits_no_confirmation(mongo_replica_set_url: str):
    """The flag raised, the sign-in gate admits a mailbox the league holds nothing for."""

    answer = await answered(mongo_replica_set_url, UNCONFIRMED_ELSEWHERE)

    assert (answer.unconfirmed, answer.seats, answer.spieler, answer.schiedsrichter) == (False, [], [], [])


@pytest.mark.db
async def test_a_seat_carries_its_own_season_s_status(mongo_replica_set_url: str):
    """The one read of `saisons` a seat costs. Two seasons of differing status, so a status taken from whichever sorted first is wrong here."""

    assert [seat.saison_status for seat in (await answered(mongo_replica_set_url)).seats] == ["past", "active", "active"]


async def served_over_http(url: str, email: str = IDENTIFIER) -> Response:
    """The corpus seeded, then one request through the MOUNTED route."""

    await on_a_league(url, _no_body)

    async def _answered() -> Response:
        async with app_client(url, app=app_under_test(DATABASE_NAME)) as http:
            return await http.post(PATH, headers=SYSTEM_AUTH, json={"email": email})

    return await _answered()


@pytest.mark.db
async def test_the_mounted_route_answers_a_retired_person_as_it_answers_nobody(mongo_replica_set_url: str):
    """A confirmed referee row, retired: empty lists and the flag down, as for a mailbox holding nothing."""

    response = await served_over_http(mongo_replica_set_url, RETIRED)

    assert response.status_code == 200
    assert response.json() == {
        "seats": [],
        "spieler": [],
        "schiedsrichter": [],
        "unconfirmed": False,
        "admin_tier": None,
        "granted_since": None,
    }


# The two collections a public form grows that the gate reads by address on every sign-in attempt.
GATE_READS = frozenset(str(name) for name in (Collection.BEWERBUNGEN, Collection.REGISTRIERUNGEN))


def _selects_by_address(collection: str, command: Mapping[str, Any]) -> bool:
    """A read of a gate collection whose selection names an address, never a join by ids the same handler sends."""

    selection = command.get("filter") or next((stage["$match"] for stage in command.get("pipeline", []) if "$match" in stage), {})

    return collection in GATE_READS and "email" in str(selection)


@pytest.mark.db
class TestTheGateWalksAnIndex:
    """Anybody can send a sign-in attempt, and a stranger grows both collections through the public forms.

    Each read the handler sends is explained by the server: a filter losing its index answers the same over a scan, so
    only the plan shows it.
    """

    async def test_every_address_read_of_the_gate_plans_an_index_scan(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase) -> list[tuple[str, str]]:
            _, plans = await plans_of_sent_reads(
                mongo_replica_set_url,
                database,
                lambda watched, _client: call_sign_in(watched, IDENTIFIER, germany_now=NOW),
                _selects_by_address,
            )

            return plans

        plans = await on_a_league(mongo_replica_set_url, body)

        # The premise: a read the handler never sent would pass the next line vacuously.
        assert {collection for collection, _ in plans} == GATE_READS, plans
        assert [(collection, plan) for collection, plan in plans if "IXSCAN" not in plan or "COLLSCAN" in plan] == []


@pytest.mark.db
class TestTheGrant:
    """`admin_tier`: the one stored answer, read off `grants` on the folded identifier."""

    async def test_a_waiting_row_answers_no_tier_on_either_route(self, mongo_replica_set_url: str):
        """A named person is no administrator until the wait ends, which the owner may yet stop: a tier here admits them early."""

        async def body(database: AsyncDatabase) -> tuple[Any, ...]:
            await database[Collection.GRANTS].update_one({"_id": GRANT_STORED_OID}, {"$set": {"effective_from": NOW + timedelta(hours=1)}})
            subject = await call_subject(database, ADMIN_STORED)
            sign_in = await call_sign_in(database, ADMIN_STORED, germany_now=NOW)

            return subject.admin_tier, subject.granted_since, sign_in.admin_tier

        assert await on_a_league(mongo_replica_set_url, body) == (None, None, None)

    async def test_the_instant_is_served_with_its_offset(self, mongo_replica_set_url: str):
        """The driver reads a stored instant back with no offset, which the frontend would compare as its own local time."""

        response = await served_over_http(mongo_replica_set_url, ADMIN_STORED)

        assert response.json()["granted_since"] == "2026-01-01T00:00:00Z"
        assert response.json()["admin_tier"] == "administration"
