import asyncio
from collections.abc import Coroutine, Mapping
from contextlib import nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest
from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.berechtigungen import crud as berechtigungen_crud
from app.api.identitaet import crud as identitaet_crud
from app.api.identitaet import router as identitaet_router
from app.api.identitaet.schemas import FLSubjekt, FLSubjektPayload
from app.core.collections import Collection
from tests.bans import ban_list

IDENTIFIER = "ortrud.zwiebelmayer@schule.de"

ACTIVE_SAISON = "2526"

# Stand-ins for the collections, each read naming the one it was asked of.
SAISON_TEAMS, SAISONS, SPIELER, SCHIEDSRICHTER, BERECHTIGUNGEN = "saison_teams", "saisons", "spieler", "schiedsrichter", "berechtigungen"

SEAT_ROW = {
    "saison_id": ACTIVE_SAISON,
    "team_id": ObjectId("6890a1b2c3d4e5f607820001"),
    "name": "Helmholtz",
    "kontakte": {"trainer": {"email": IDENTIFIER, "einwilligung": {"bestaetigt_am": "2026-01-20"}}},
}


class _Reads:
    """Every read a case issued, by the collection it named, and the most that were in flight at once."""

    def __init__(self, rows: Mapping[str, list[Mapping[str, Any]]] | None = None) -> None:
        self.rows = rows or {}
        self.issued: list[str] = []
        self.sessions: list[object] = []
        self.peak = 0
        self._in_flight = 0

    async def answer(self, name: str, answer: Any, session: object = None) -> Any:
        self.issued.append(name)
        self.sessions.append(session)
        self._in_flight += 1
        self.peak = max(self.peak, self._in_flight)
        # One turn of the loop, as a round trip yields: every read gathered beside this one starts
        # before it returns, and a read awaited after it cannot.
        await asyncio.sleep(0)
        self._in_flight -= 1
        return answer

    async def aggregate(self, *, collection: str, pipeline: Any, session: object = None) -> list[Mapping[str, Any]]:
        return await self.answer(collection, self.rows.get(collection, []), session)


class _Stalled:
    """Reads that answer only after the loop has turned far past a sibling's failure, recording each cancelled."""

    def __init__(self) -> None:
        self.cancelled: list[str] = []

    async def read(self, name: str) -> Any:
        try:
            for _ in range(50):
                await asyncio.sleep(0)
        except asyncio.CancelledError:
            self.cancelled.append(name)
            raise
        raise AssertionError(f"the {name} read ran to its end past a sibling's failure")

    def failure_and_cancelled_by_then(self, call: Coroutine[Any, Any, Any]) -> tuple[BaseException, list[str]]:
        """What `call` raised, and which reads were cancelled by the moment it did.

        Read inside the loop: `asyncio.run` cancels every task still pending once it returns, so a read
        left running would read as cancelled after it.
        """

        async def answered() -> tuple[BaseException, list[str]]:
            try:
                await call
            except Exception as failed:
                return failed, list(self.cancelled)
            raise AssertionError("the call answered past a failed read")

        return asyncio.run(answered())


def _find_subjekt(reads: _Reads, session: object = None) -> FLSubjekt:
    return asyncio.run(
        identitaet_crud.find_subjekt(
            IDENTIFIER,
            saison_teams_collection=cast(Any, SAISON_TEAMS),
            saisons_collection=cast(Any, SAISONS),
            spieler_collection=cast(Any, SPIELER),
            schiedsrichter_collection=cast(Any, SCHIEDSRICHTER),
            session=cast(AsyncClientSession | None, session),
        )
    )


class TestTheSubjectLookupsReads:
    """`POST /identitaet/subjekt` answers every signed-in render, so its reads are paid in latency on every page."""

    def test_the_records_the_ban_and_the_grant_are_read_at_once(self, monkeypatch: pytest.MonkeyPatch):
        reads = _Reads()

        async def find_subjekt(_identifier: str, **_: Any) -> FLSubjekt:
            return await reads.answer("records", FLSubjekt(sitze=[], spieler=[], schiedsrichter=[], unbestaetigt=False))

        async def hash_gesperrt(*_: Any, **__: Any) -> bool:
            return await reads.answer("ban", False)

        async def verwaltung_of(**_: Any) -> None:
            return await reads.answer("grant", None)

        monkeypatch.setattr(identitaet_router, "find_subjekt", find_subjekt)
        monkeypatch.setattr(identitaet_router, "hash_gesperrt", hash_gesperrt)
        monkeypatch.setattr(identitaet_router, "verwaltung_of", verwaltung_of)

        stand_in = cast(Any, None)
        asyncio.run(
            identitaet_router.get_subjekt(
                subjekt_data=FLSubjektPayload(email=IDENTIFIER),
                saison_teams_collection=stand_in,
                saisons_collection=stand_in,
                spieler_collection=stand_in,
                schiedsrichter_collection=stand_in,
                sperrliste=ban_list({Collection.SPERRLISTE: stand_in, Collection.SAISONS: stand_in}),
                berechtigungen_collection=stand_in,
            )
        )

        assert sorted(reads.issued) == ["ban", "grant", "records"]
        assert reads.peak == 3, "the endpoint awaited one read before sending the next"

    def test_a_failed_read_cancels_the_two_still_running_and_reaches_the_caller_as_itself(self, monkeypatch: pytest.MonkeyPatch):
        stalled = _Stalled()

        async def find_subjekt(_identifier: str, **_: Any) -> FLSubjekt:
            await asyncio.sleep(0)
            raise ConnectionError("the records read failed")

        async def hash_gesperrt(*_: Any, **__: Any) -> bool:
            return await stalled.read("ban")

        async def verwaltung_of(**_: Any) -> None:
            return await stalled.read("grant")

        monkeypatch.setattr(identitaet_router, "find_subjekt", find_subjekt)
        monkeypatch.setattr(identitaet_router, "hash_gesperrt", hash_gesperrt)
        monkeypatch.setattr(identitaet_router, "verwaltung_of", verwaltung_of)

        stand_in = cast(Any, None)
        failed, cancelled = stalled.failure_and_cancelled_by_then(
            identitaet_router.get_subjekt(
                subjekt_data=FLSubjektPayload(email=IDENTIFIER),
                saison_teams_collection=stand_in,
                saisons_collection=stand_in,
                spieler_collection=stand_in,
                schiedsrichter_collection=stand_in,
                sperrliste=ban_list({Collection.SPERRLISTE: stand_in, Collection.SAISONS: stand_in}),
                berechtigungen_collection=stand_in,
            )
        )

        assert (type(failed), str(failed)) == (ConnectionError, "the records read failed")
        assert sorted(cancelled) == ["ban", "grant"], "a read was left running past the endpoint's answer"

    def test_the_three_record_reads_are_in_flight_together_outside_a_transaction(self, monkeypatch: pytest.MonkeyPatch):
        reads = _Reads()
        monkeypatch.setattr(identitaet_crud, "aggregate_many_from_db", reads.aggregate)

        _find_subjekt(reads)

        assert reads.peak == 3, "the lookup awaited one record read before sending the next"

    def test_a_mailbox_holding_no_seat_reads_no_season(self, monkeypatch: pytest.MonkeyPatch):
        """The season read follows the gathered three, so made for nothing it is a second round trip on every page."""

        reads = _Reads()
        monkeypatch.setattr(identitaet_crud, "aggregate_many_from_db", reads.aggregate)

        _find_subjekt(reads)

        assert sorted(reads.issued) == [SAISON_TEAMS, SCHIEDSRICHTER, SPIELER]

    def test_a_seat_holders_seasons_are_read_once_its_seats_are_known(self, monkeypatch: pytest.MonkeyPatch):
        """The control for the case above: a lookup reading no season at all passes it and answers no status here."""

        reads = _Reads({SAISON_TEAMS: [SEAT_ROW], SAISONS: [{"_id": ACTIVE_SAISON, "status": "active"}]})
        monkeypatch.setattr(identitaet_crud, "aggregate_many_from_db", reads.aggregate)

        answered = _find_subjekt(reads)

        assert reads.issued[-1] == SAISONS
        assert reads.issued.count(SAISONS) == 1
        assert [sitz.saison_status for sitz in answered.sitze] == ["active"]

    def test_inside_a_transaction_the_reads_run_one_at_a_time_in_its_session(self, monkeypatch: pytest.MonkeyPatch):
        """PyMongo documents that one session runs one operation at a time and refuses nothing, so gathered here they would race unseen."""

        reads = _Reads({SAISON_TEAMS: [SEAT_ROW], SAISONS: [{"_id": ACTIVE_SAISON, "status": "active"}]})
        monkeypatch.setattr(identitaet_crud, "aggregate_many_from_db", reads.aggregate)
        transaction = object()

        _find_subjekt(reads, session=transaction)

        assert reads.peak == 1
        assert reads.sessions == [transaction] * len(reads.issued)


class TestTheActorChecksTwoReads:
    """Every admin-tier request pays this check before its handler runs."""

    def test_the_grant_and_the_ban_are_read_at_once(self, monkeypatch: pytest.MonkeyPatch):
        reads = _Reads()

        # The grant beside its record, as the one read joining the two answers it.
        grant = {"adresse": IDENTIFIER, "erteilt_am": datetime(2026, 1, 1, tzinfo=UTC), "angekuendigt": [{"adresse": IDENTIFIER}]}

        async def aggregate_many_from_db(**_: Any) -> list[Mapping[str, Any]]:
            return await reads.answer(BERECHTIGUNGEN, [grant])

        async def adressen_gesperrt(*_: Any, **__: Any) -> set[str]:
            return await reads.answer("ban", set())

        monkeypatch.setattr(berechtigungen_crud, "aggregate_many_from_db", aggregate_many_from_db)
        monkeypatch.setattr(berechtigungen_crud, "adressen_gesperrt", adressen_gesperrt)

        # The grant read opens its snapshot session on the collection's own client.
        grants = SimpleNamespace(database=SimpleNamespace(client=SimpleNamespace(start_session=lambda **_: nullcontext())))
        asyncio.run(
            berechtigungen_crud.live_unbarred_grant_since(IDENTIFIER, berechtigungen_collection=cast(Any, grants), sperrliste=cast(Any, None))
        )

        assert sorted(reads.issued) == ["ban", BERECHTIGUNGEN]
        assert reads.peak == 2, "the check awaited the grant before asking the ban list"

    def test_a_failed_grant_read_cancels_the_ban_read_and_reaches_the_caller_as_itself(self, monkeypatch: pytest.MonkeyPatch):
        stalled = _Stalled()

        async def aggregate_many_from_db(**_: Any) -> list[Mapping[str, Any]]:
            await asyncio.sleep(0)
            raise ConnectionError("the grant read failed")

        async def adressen_gesperrt(*_: Any, **__: Any) -> set[str]:
            return await stalled.read("ban")

        monkeypatch.setattr(berechtigungen_crud, "aggregate_many_from_db", aggregate_many_from_db)
        monkeypatch.setattr(berechtigungen_crud, "adressen_gesperrt", adressen_gesperrt)

        grants = SimpleNamespace(database=SimpleNamespace(client=SimpleNamespace(start_session=lambda **_: nullcontext())))
        failed, cancelled = stalled.failure_and_cancelled_by_then(
            berechtigungen_crud.live_unbarred_grant_since(IDENTIFIER, berechtigungen_collection=cast(Any, grants), sperrliste=cast(Any, None))
        )

        assert (type(failed), str(failed)) == (ConnectionError, "the grant read failed")
        assert cancelled == ["ban"], "the ban read was left running past the check's answer"
