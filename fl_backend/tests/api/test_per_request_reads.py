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
from app.api.identity.crud import find_subjekt, funktionen_of
from app.core.collections import Collection
from tests.records import record_collections

from .test_identity_subjekt_execution import IDENTIFIER, VERWALTUNG_STORED, on_a_league

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


class TestTheSubjectLookupsReads:
    """`POST /identity/subject` answers every signed-in render, so each read it sends is a round trip on every page."""

    def test_a_mailbox_holding_no_seat_reads_no_season(self, mongo_replica_set_url: str):
        """The season read follows the gathered three, so made for nothing it is a second round trip on every page."""

        async def body(database: AsyncDatabase) -> Any:
            return await _counted(mongo_replica_set_url, database, lambda _, db: find_subjekt(VERWALTUNG_STORED, record_collections(db)))

        answer, sent = on_a_league(mongo_replica_set_url, body)

        assert answer.seats == []
        assert sorted(sent.collections()) == sorted(map(str, (Collection.SAISON_TEAMS, Collection.SCHIEDSRICHTER, Collection.SPIELER)))

    def test_a_seat_holders_seasons_are_read_once_its_seats_are_known(self, mongo_replica_set_url: str):
        """The control for the case above: a lookup reading no season at all passes it and answers no status here."""

        async def body(database: AsyncDatabase) -> Any:
            return await _counted(mongo_replica_set_url, database, lambda _, db: find_subjekt(IDENTIFIER, record_collections(db)))

        answer, sent = on_a_league(mongo_replica_set_url, body)

        assert sent.collections()[-1] == Collection.SAISONS
        assert sent.collections().count(Collection.SAISONS) == 1
        assert {seat.saison_status for seat in answer.seats} == {"past", "active"}


def test_a_person_endpoint_reads_the_three_role_records_in_its_session(mongo_replica_set_url: str):
    """No application or registration, neither granting a panel; and no read outside the session the endpoint judges in."""

    async def body(database: AsyncDatabase) -> Any:
        async def judged(client: AsyncMongoClient, db: AsyncDatabase) -> Any:
            async with client.start_session(snapshot=True) as session:
                return await funktionen_of(IDENTIFIER, record_collections(db), session=session), session.session_id

        return await _counted(mongo_replica_set_url, database, judged)

    (_, session_id), sent = on_a_league(mongo_replica_set_url, body)

    assert Counter(sent.collections()) == Counter(
        map(str, (Collection.SAISON_TEAMS, Collection.SAISONS, Collection.SCHIEDSRICHTER, Collection.SPIELER))
    )
    assert [lsid for _, lsid in sent.reads] == [session_id] * len(sent.reads)


def test_the_account_read_reads_each_record_collection_once(mongo_replica_set_url: str):
    """The Funktionen the page judges a grant by come from the rows the read already holds, never a second read of them."""

    async def body(database: AsyncDatabase) -> Any:
        async def read(client: AsyncMongoClient, db: AsyncDatabase) -> Any:
            return await get_einwilligungen(
                identifier=IDENTIFIER,
                spieler_collection=db[Collection.SPIELER],
                schiedsrichter_collection=db[Collection.SCHIEDSRICHTER],
                saison_teams_collection=db[Collection.SAISON_TEAMS],
                teams_collection=db[Collection.TEAMS],
                bewerbungen_collection=db[Collection.BEWERBUNGEN],
                registrierungen_collection=db[Collection.REGISTRIERUNGEN],
                records=record_collections(db),
                db=client,
                today="2026-10-03",
            )

        return await _counted(mongo_replica_set_url, database, read)

    answer, sent = on_a_league(mongo_replica_set_url, body)

    # The premise first: the page answered the mailbox's records, so the count below is of reads that found them.
    assert (answer.spieler is not None, len(answer.schiedsrichter), bool(answer.seats)) == (True, 2, True)
    assert [sent.collections().count(name) for name in (Collection.SPIELER, Collection.SCHIEDSRICHTER, Collection.SAISON_TEAMS)] == [1, 1, 1]
