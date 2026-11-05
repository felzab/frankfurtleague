"""
API · which reads a per-request lookup sends, and in which session, counted off a client of the case's own

Every signed-in render and every person endpoint pays these reads. The reads a lookup gathers are seen in flight together
in `tests/api/test_loeschung_commit_fail_points.py`, the one module that holds the server's answers.
"""

from collections import Counter
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from pymongo import AsyncMongoClient, monitoring
from pymongo.asynchronous.database import AsyncDatabase

from app.api.account.person_router import get_einwilligungen
from app.api.identity.crud import find_subject, roles_of
from app.core.collections import Collection
from tests.records import record_collections

from .test_identity_subject_execution import IDENTIFIER, on_a_league

pytestmark = pytest.mark.db

READS = ("find", "aggregate")


class _Sent(monitoring.CommandListener):
    """Each read the case's own client sends, by collection, with the id of the session it ran in."""

    def __init__(self) -> None:
        self.reads: list[tuple[str, Any]] = []

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        if event.command_name in READS:
            self.reads.append((str(event.command[event.command_name]), event.command.get("lsid")))

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        """Required by the listener interface; a read is counted when it is sent."""

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        """Required by the listener interface; a read is counted when it is sent."""

    def collections(self) -> list[str]:
        return [collection for collection, _ in self.reads]


async def _counted(url: str, database: AsyncDatabase, call: Callable[[AsyncMongoClient, AsyncDatabase], Awaitable[Any]]) -> tuple[Any, _Sent]:
    sent = _Sent()
    client = AsyncMongoClient(url, serverMonitoringMode="poll", event_listeners=[sent])
    try:
        return await call(client, client[database.name]), sent
    finally:
        await client.close()


def test_the_subject_lookup_answers_a_seats_season_from_the_seat_read(mongo_replica_set_url: str):
    """`POST /identity/subject` answers every signed-in render: a season read after the seats is a second round trip on every page."""

    async def body(database: AsyncDatabase) -> Any:
        return await _counted(mongo_replica_set_url, database, lambda _, db: find_subject(IDENTIFIER, record_collections(db)))

    answer, sent = on_a_league(mongo_replica_set_url, body)

    # The premise first: the seats' seasons were answered, so the reads below carried them.
    assert {seat.saison_status for seat in answer.seats} == {"past", "active"}
    assert sorted(sent.collections()) == sorted(map(str, (Collection.SAISON_TEAMS, Collection.SCHIEDSRICHTER, Collection.SPIELER)))


def test_a_person_endpoint_reads_the_three_role_records_in_its_session(mongo_replica_set_url: str):
    """No application or registration, neither granting a panel; and no read outside the session the endpoint judges in."""

    async def body(database: AsyncDatabase) -> Any:
        async def judged(client: AsyncMongoClient, db: AsyncDatabase) -> Any:
            async with client.start_session(snapshot=True) as session:
                return await roles_of(IDENTIFIER, record_collections(db), session=session), session.session_id

        return await _counted(mongo_replica_set_url, database, judged)

    (_, session_id), sent = on_a_league(mongo_replica_set_url, body)

    assert Counter(sent.collections()) == Counter(map(str, (Collection.SAISON_TEAMS, Collection.SCHIEDSRICHTER, Collection.SPIELER)))
    assert [lsid for _, lsid in sent.reads] == [session_id] * len(sent.reads)


def test_the_account_read_is_one_aggregation(mongo_replica_set_url: str):
    """Every kind of own record, the seasons and clubs they name and the Funktionen a grant is judged by, in one round trip."""

    async def body(database: AsyncDatabase) -> Any:
        async def read(client: AsyncMongoClient, db: AsyncDatabase) -> Any:
            return await get_einwilligungen(
                identifier=IDENTIFIER,
                spieler_collection=db[Collection.SPIELER],
                db=client,
                today="2026-10-03",
            )

        return await _counted(mongo_replica_set_url, database, read)

    answer, sent = on_a_league(mongo_replica_set_url, body)

    # The premise first: the page answered the mailbox's records and what they name, so the count below is of a read
    # that found them.
    assert (answer.spieler is not None, len(answer.schiedsrichter), [seat.team_name for seat in answer.seats]) == (
        True,
        2,
        ["Lessing", "Helmholtz"],
    )
    assert answer.seats[0].givable
    assert sent.collections() == [Collection.SPIELER], f"the read sent {len(sent.reads)}: {sent.collections()}"
