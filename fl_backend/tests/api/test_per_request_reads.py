import asyncio
from collections.abc import Coroutine, Mapping
from contextlib import nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast, get_args

import pytest
from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.aktionen import admin_router as aktionen_admin_router
from app.api.aktionen.schemas import FLAktionenFilterParams
from app.api.berechtigungen import crud as berechtigungen_crud
from app.api.bewerbungen import router as bewerbungen_router
from app.api.bewerbungen.schemas import FLBewerbungenFilterParams, FLBewerbungSaisonbezug, FLBewerbungStatus
from app.api.identitaet import crud as identitaet_crud
from app.api.identitaet import router as identitaet_router
from app.api.identitaet.schemas import FLAnmeldung, FLSubjekt, FLSubjektPayload
from app.api.konto import router as konto_router
from app.core.collections import Collection
from tests.bans import ban_list
from tests.records import record_collections

IDENTIFIER = "ortrud.zwiebelmayer@schule.de"

ACTIVE_SAISON = "2526"

# Stand-ins for the collections, each read naming the one it was asked of.
SAISON_TEAMS, SAISONS, SPIELER, SCHIEDSRICHTER, BERECHTIGUNGEN = "saison_teams", "saisons", "spieler", "schiedsrichter", "berechtigungen"
BEWERBUNGEN, REGISTRIERUNGEN = "bewerbungen", "registrierungen"

# The lookup a request holds, each handle the name its reads are recorded under.
RECORDS = record_collections(
    {
        Collection.SAISON_TEAMS: SAISON_TEAMS,
        Collection.SAISONS: SAISONS,
        Collection.SPIELER: SPIELER,
        Collection.SCHIEDSRICHTER: SCHIEDSRICHTER,
        Collection.BEWERBUNGEN: BEWERBUNGEN,
        Collection.REGISTRIERUNGEN: REGISTRIERUNGEN,
    }
)

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
    """The system route's lookup with no session, the one a transaction reaches with one."""

    if session is None:
        return asyncio.run(identitaet_crud.find_subjekt(IDENTIFIER, RECORDS))

    return asyncio.run(identitaet_crud.find_subjekt_in_session(IDENTIFIER, RECORDS, session=cast(AsyncClientSession, session)))


class TestTheSubjectLookupsReads:
    """`POST /identitaet/subjekt` answers every signed-in render, so its reads are paid in latency on every page."""

    def test_the_records_the_ban_and_the_grant_are_read_at_once(self, monkeypatch: pytest.MonkeyPatch):
        reads = _Reads()

        async def find_subjekt(_identifier: str, _records: Any) -> FLSubjekt:
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
                records=stand_in,
                sperrliste=ban_list({Collection.SPERRLISTE: stand_in, Collection.SAISONS: stand_in}),
                berechtigungen_collection=stand_in,
            )
        )

        assert sorted(reads.issued) == ["ban", "grant", "records"]
        assert reads.peak == 3, "the endpoint awaited one read before sending the next"

    def test_a_failed_read_cancels_the_two_still_running_and_reaches_the_caller_as_itself(self, monkeypatch: pytest.MonkeyPatch):
        stalled = _Stalled()

        async def find_subjekt(_identifier: str, _records: Any) -> FLSubjekt:
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
                records=stand_in,
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

    def test_a_failed_record_read_cancels_the_two_still_running_and_reaches_the_caller_as_itself(self, monkeypatch: pytest.MonkeyPatch):
        stalled = _Stalled()

        async def aggregate_many_from_db(*, collection: str, pipeline: Any, session: object = None) -> list[Mapping[str, Any]]:
            if collection != SAISON_TEAMS:
                return await stalled.read(collection)
            await asyncio.sleep(0)
            raise ConnectionError("the seat read failed")

        monkeypatch.setattr(identitaet_crud, "aggregate_many_from_db", aggregate_many_from_db)

        failed, cancelled = stalled.failure_and_cancelled_by_then(identitaet_crud.find_subjekt(IDENTIFIER, RECORDS))

        assert (type(failed), str(failed)) == (ConnectionError, "the seat read failed")
        assert sorted(cancelled) == [SCHIEDSRICHTER, SPIELER], "a record read was left running past the lookup's answer"

    def test_a_person_endpoint_reads_the_three_funktion_records_in_its_session(self, monkeypatch: pytest.MonkeyPatch):
        """No application or registration: neither grants a panel, so a person endpoint authorising against them pays for nothing."""

        reads = _Reads()
        monkeypatch.setattr(identitaet_crud, "aggregate_many_from_db", reads.aggregate)
        transaction = object()

        asyncio.run(identitaet_crud.funktionen_of(IDENTIFIER, RECORDS, session=cast(AsyncClientSession, transaction)))

        assert sorted(reads.issued) == [SAISON_TEAMS, SCHIEDSRICHTER, SPIELER]
        assert reads.sessions == [transaction] * 3


class TestTheSignInGatesReads:
    """`POST /identitaet/anmeldung` answers a sign-in rather than a render, and is the one read paying for the two kinds granting no panel."""

    def test_the_five_record_reads_are_in_flight_together(self, monkeypatch: pytest.MonkeyPatch):
        reads = _Reads()
        monkeypatch.setattr(identitaet_crud, "aggregate_many_from_db", reads.aggregate)

        asyncio.run(identitaet_crud.find_anmeldung(IDENTIFIER, RECORDS))

        assert sorted(reads.issued) == [BEWERBUNGEN, REGISTRIERUNGEN, SAISON_TEAMS, SCHIEDSRICHTER, SPIELER]
        assert reads.peak == 5, "the gate awaited one record read before sending the next"

    def test_the_records_the_ban_and_the_grant_are_read_at_once(self, monkeypatch: pytest.MonkeyPatch):
        reads = _Reads()

        async def find_anmeldung(_identifier: str, _records: Any) -> FLAnmeldung:
            return await reads.answer("records", FLAnmeldung(unbestaetigt=False, konto=False))

        async def hash_gesperrt(*_: Any, **__: Any) -> bool:
            return await reads.answer("ban", False)

        async def verwaltung_of(**_: Any) -> None:
            return await reads.answer("grant", None)

        monkeypatch.setattr(identitaet_router, "find_anmeldung", find_anmeldung)
        monkeypatch.setattr(identitaet_router, "hash_gesperrt", hash_gesperrt)
        monkeypatch.setattr(identitaet_router, "verwaltung_of", verwaltung_of)

        stand_in = cast(Any, None)
        asyncio.run(
            identitaet_router.get_anmeldung(
                anmeldung_data=FLSubjektPayload(email=IDENTIFIER),
                records=stand_in,
                sperrliste=ban_list({Collection.SPERRLISTE: stand_in, Collection.SAISONS: stand_in}),
                berechtigungen_collection=stand_in,
            )
        )

        assert sorted(reads.issued) == ["ban", "grant", "records"]
        assert reads.peak == 3, "the endpoint awaited one read before sending the next"


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


class TestTheListsGatheredReads:
    """The action log's and the application queue's reads, gathered beside their tallies."""

    def test_a_failed_tally_cancels_the_action_log_s_page_and_reaches_the_caller_as_itself(self, monkeypatch: pytest.MonkeyPatch):
        stalled = _Stalled()

        async def aggregate_many_from_db(**_: Any) -> list[Mapping[str, Any]]:
            await asyncio.sleep(0)
            raise ConnectionError("the tally failed")

        async def pull_many_from_db(**_: Any) -> list[Mapping[str, Any]]:
            return await stalled.read("page")

        monkeypatch.setattr(aktionen_admin_router, "aggregate_many_from_db", aggregate_many_from_db)
        monkeypatch.setattr(aktionen_admin_router, "pull_many_from_db", pull_many_from_db)

        failed, cancelled = stalled.failure_and_cancelled_by_then(
            aktionen_admin_router.get_aktionen(
                aktionen_collection=cast(Any, None), sperrliste=cast(Any, None), filters=FLAktionenFilterParams()
            )
        )

        assert (type(failed), str(failed)) == (ConnectionError, "the tally failed")
        assert cancelled == ["page"], "the page read was left running past the list's answer"

    @pytest.mark.parametrize("failing", [*get_args(FLBewerbungStatus), *get_args(FLBewerbungSaisonbezug), "dubletten"])
    def test_a_failed_read_of_the_queue_cancels_every_other_and_reaches_the_caller_as_itself(
        self, monkeypatch: pytest.MonkeyPatch, failing: str
    ):
        """A count failing is the load-bearing arm: a nested gather that leaves its siblings running still cancels when its parent does."""

        stalled = _Stalled()

        async def read(name: str) -> Any:
            if name != failing:
                return await stalled.read(name)
            await asyncio.sleep(0)
            raise ConnectionError(f"the {name} read failed")

        async def aggregate_many_from_db(**_: Any) -> list[Mapping[str, Any]]:
            return await read("dubletten")

        class _Counted:
            # Each count named for the status or the season relation it answers, unfiltered requests
            # counting the relation against `None`.
            async def count_documents(self, db_filter: Mapping[str, Any]) -> int:
                if "status" in db_filter:
                    return await read(db_filter["status"])
                return await read("andere_saison" if isinstance(db_filter["saison_id"], dict) else "diese_saison")

        monkeypatch.setattr(bewerbungen_router, "aggregate_many_from_db", aggregate_many_from_db)

        failed, cancelled = stalled.failure_and_cancelled_by_then(
            bewerbungen_router.get_bewerbungen(
                bewerbungen_collection=cast(Any, _Counted()), sperrliste=cast(Any, None), filters=FLBewerbungenFilterParams()
            )
        )

        every_read = {*get_args(FLBewerbungStatus), *get_args(FLBewerbungSaisonbezug), "dubletten"}
        assert (type(failed), str(failed)) == (ConnectionError, f"the {failing} read failed")
        assert sorted(cancelled) == sorted(every_read - {failing}), "a read was left running past the queue's answer"


class TestTheAccountReadsReads:
    def test_each_record_collection_is_read_once(self, monkeypatch: pytest.MonkeyPatch):
        """The Funktionen the page judges a grant by come from the rows the read already holds, never a second read of them."""

        reads = _Reads()
        monkeypatch.setattr(konto_router, "aggregate_many_from_db", reads.aggregate)
        monkeypatch.setattr(identitaet_crud, "aggregate_many_from_db", reads.aggregate)
        snapshot = object()

        asyncio.run(
            konto_router.get_einwilligungen(
                identifier=IDENTIFIER,
                spieler_collection=cast(Any, SPIELER),
                schiedsrichter_collection=cast(Any, SCHIEDSRICHTER),
                saison_teams_collection=cast(Any, SAISON_TEAMS),
                teams_collection=cast(Any, "teams"),
                bewerbungen_collection=cast(Any, BEWERBUNGEN),
                registrierungen_collection=cast(Any, REGISTRIERUNGEN),
                records=RECORDS,
                db=cast(Any, SimpleNamespace(start_session=lambda **_: nullcontext(snapshot))),
                today="2026-10-03",
            )
        )

        assert [reads.issued.count(name) for name in (SPIELER, SCHIEDSRICHTER, SAISON_TEAMS)] == [1, 1, 1]
