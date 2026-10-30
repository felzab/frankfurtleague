"""
API · the Postausgang against a real replica set: the enqueue, the drain's lease, its report, the delivery event and the expiry

Each case drives the slice's own functions with a database and a clock of its own, as the routes hand them. The kinds
are incidental: a case reaches for whichever member of the union the mechanism needs.
"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.postausgang.crud import read_the_newest
from app.api.postausgang.router import post_anmeldung, post_ausgabe, post_ereignis, post_ergebnis
from app.api.postausgang.schemas import (
    FLAnmeldecodeDaten,
    FLPostausgangAnmeldungPayload,
    FLPostausgangAusgabeResponse,
    FLPostausgangBezug,
    FLPostausgangDaten,
    FLPostausgangEreignisPayload,
    FLPostausgangErgebnis,
    FLPostausgangErgebnisArt,
    FLPostausgangErgebnisPayload,
    FLPostausgangErgebnisResponse,
    FLPostausgangLink,
    FLPostausgangZustellStand,
    FLSperreDaten,
)
from app.api.postausgang.services import BEANSPRUCHUNG_DAUER, NACHLAUF, WIEDERHOLUNG_NACH, enqueue_mail, unzustellbar
from app.core.collections import Collection
from app.core.transactions import transaction_session
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_postausgang_test")

# A century ahead of the real clock: the TTL monitor deletes a row whose delete date has passed, under a case reading it.
NOW = datetime(2126, 4, 16, 12, 30, tzinfo=UTC)
EINLADUNG = ObjectId("6890a1b2c3d4e5f607f30001")
BEZUG = FLPostausgangBezug(sammlung=Collection.EINLADUNGEN, id=EINLADUNG, sitz=None)
NORA = "nora.neu@beispielschule.de"
SPERRE = FLSperreDaten(art="sperre", grund="Falsches Geburtsdatum", gesperrt_bis_saison_id="2127")

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_database(url: str, body: Body) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (client, database):
            await database[Collection.EINLADUNGEN].insert_one({"_id": EINLADUNG, "email": NORA, "token_hashes": []})
            return await body(database, client)

    return on_the_seed_loop(_run())


def utc(moment: datetime) -> datetime:
    """A stored instant as the UTC it is: the driver reads one back with no offset."""

    return moment.replace(tzinfo=UTC)


# The one record's link: its array, minted while the record still names the recipient.
LINK = FLPostausgangLink(pfade=["token_hashes"], adressen=["email"], ersetzt=False)


async def owe(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    schluessel: str,
    *,
    daten: FLPostausgangDaten = SPERRE,
    link: bool = False,
    bezug: FLPostausgangBezug = BEZUG,
    spec: FLPostausgangLink = LINK,
) -> ObjectId:
    """One mail owed inside a transaction of its own, as a write owing it would."""

    async def write(session: Any) -> ObjectId:
        return await enqueue_mail(
            postausgang_collection=database[Collection.POSTAUSGANG],
            session=session,
            schluessel=schluessel,
            an=NORA,
            daten=daten,
            now=NOW,
            bezug=bezug if link else None,
            link=spec if link else None,
        )

    async with transaction_session(client) as session:
        return await session.with_transaction(write)


async def claimed(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime = NOW) -> FLPostausgangAusgabeResponse:
    return await post_ausgabe(
        postausgang_collection=database[Collection.POSTAUSGANG], sperrliste=ban_list(database), db=database, db_client=client, now=now
    )


async def reported(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    beanspruchung: str | None,
    row_id: ObjectId,
    ergebnis: FLPostausgangErgebnisArt,
    *,
    now: datetime = NOW,
) -> FLPostausgangErgebnisResponse:
    assert beanspruchung is not None
    return await post_ergebnis(
        ergebnis_data=FLPostausgangErgebnisPayload(
            beanspruchung=beanspruchung,
            ergebnisse=[FLPostausgangErgebnis(id=row_id, ergebnis=ergebnis, nachricht_id=f"msg-{row_id}" if ergebnis == "gesendet" else None)],
        ),
        postausgang_collection=database[Collection.POSTAUSGANG],
        db_client=client,
        now=now,
    )


async def stored(database: AsyncDatabase, row_id: ObjectId) -> dict[str, Any]:
    row = await database[Collection.POSTAUSGANG].find_one({"_id": row_id})
    assert row is not None
    return row


class TestTheEnqueue:
    def test_a_replay_of_the_same_write_owes_the_mail_once(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[ObjectId, ObjectId, int]:
            first = await owe(database, client, "sperre/1")
            again = await owe(database, client, "sperre/1")

            return first, again, await database[Collection.POSTAUSGANG].count_documents({})

        first, again, rows = on_a_database(mongo_replica_set_url, body)

        assert (again, rows) == (first, 1)


class TestTheDrain:
    def test_two_concurrent_drains_never_hold_one_row(self, mongo_replica_set_url: str):
        """Both claim at once; the rows both read conflict, and the retried claim finds them held."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            owed = {await owe(database, client, f"sperre/{position}") for position in range(4)}
            first, second = await asyncio.gather(claimed(database, client), claimed(database, client))

            return owed, [mail.id for mail in first.mails], [mail.id for mail in second.mails]

        owed, first, second = on_a_database(mongo_replica_set_url, body)

        assert (set(first) & set(second), set(first) | set(second)) == (set(), owed)

    def test_a_lost_report_leaves_the_mail_to_the_drain_after_the_lease_with_a_fresh_link(self, mongo_replica_set_url: str):
        """The first drain's report never arrives, so the drain after its lease hands the mail out again.

        Inside the lease nobody takes it, and the first drain's late report is ignored. Both links stay valid, and the
        action log keeps no row of the bookkeeping.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            row_id = await owe(database, client, "sperre/1", link=True)
            lost = await claimed(database, client)
            inside = await claimed(database, client, now=NOW + BEANSPRUCHUNG_DAUER - timedelta(seconds=1))
            after = await claimed(database, client, now=NOW + BEANSPRUCHUNG_DAUER)
            late = await reported(database, client, lost.beanspruchung, row_id, "gesendet")
            settled = await reported(database, client, after.beanspruchung, row_id, "gesendet")
            record = await database[Collection.EINLADUNGEN].find_one({"_id": EINLADUNG})
            logged = await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.POSTAUSGANG)})

            return lost, inside, after, late, settled, await stored(database, row_id), record, logged

        lost, inside, after, late, settled, row, record, logged = on_a_database(mongo_replica_set_url, body)

        (first,), (second,) = lost.mails, after.mails
        assert (inside.mails, first.versuch, second.versuch) == ([], 1, 2)
        assert first.token is not None and second.token is not None
        assert record is not None and set(record["token_hashes"]) == {hash_token(first.token), hash_token(second.token)}
        assert ((late.gesendet, late.ignoriert), (settled.gesendet, settled.ignoriert)) == ((0, 1), (1, 0))
        assert (row["stand"], row["nachricht_id"]) == ("gesendet", f"msg-{row['_id']}")
        assert logged == 0

    def test_a_link_goes_into_every_seat_it_names_and_a_mail_whose_seat_moved_on_since_is_dropped(self, mongo_replica_set_url: str):
        """One link for a person holding two seats, minted into both; a seat emptied or re-addressed since mints nothing.

        The emptied seat is the case a write through its null entry would refuse, aborting the claim for every row on it.
        """

        saison_team = ObjectId("6890a1b2c3d4e5f607f30002")
        spec = FLPostausgangLink(
            pfade=["kontakte.trainer.token_hashes", "kontakte.betreuer.token_hashes"],
            adressen=["kontakte.trainer.email", "kontakte.betreuer.email"],
            ersetzt=False,
        )
        bezug = FLPostausgangBezug(sammlung=Collection.SAISON_TEAMS, id=saison_team, sitz="trainer")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            beide = {"email": NORA, "token_hashes": []}
            await database[Collection.SAISON_TEAMS].insert_one(
                {"_id": saison_team, "version": 0, "kontakte": {"trainer": beide, "betreuer": beide}}
            )
            minted = await owe(database, client, "sitze/1", link=True, bezug=bezug, spec=spec)
            first = await claimed(database, client)
            record = await database[Collection.SAISON_TEAMS].find_one({"_id": saison_team})

            await database[Collection.SAISON_TEAMS].update_one({"_id": saison_team}, {"$set": {"kontakte.betreuer": None}})
            leer = await owe(database, client, "sitze/2", link=True, bezug=bezug, spec=spec)
            emptied = await claimed(database, client)
            await database[Collection.SAISON_TEAMS].update_one(
                {"_id": saison_team}, {"$set": {"kontakte.betreuer": {"email": "nachfolge@beispielschule.de", "token_hashes": []}}}
            )
            weiter = await owe(database, client, "sitze/3", link=True, bezug=bezug, spec=spec)
            handed_on = await claimed(database, client)

            dropped = [*emptied.mails, *handed_on.mails]
            return minted, first, record, dropped, [(await stored(database, row_id))["stand"] for row_id in (leer, weiter)]

        minted, first, record, dropped, staende = on_a_database(mongo_replica_set_url, body)

        (mail,) = first.mails
        assert mail.id == minted and mail.token is not None
        assert record is not None
        assert [record["kontakte"][seat]["token_hashes"] for seat in ("trainer", "betreuer")] == [[hash_token(mail.token)]] * 2
        # Bookkeeping, as an anchor is: an editor read before the drain still saves.
        assert record["version"] == 0
        assert (dropped, staende) == ([], ["entfallen", "entfallen"])

    def test_a_mail_to_a_barred_address_stops_at_the_hand_out_and_the_bans_own_notice_goes(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(ban_document(NORA, bis="2999"))
            code = await owe(database, client, "anmeldecode/1", daten=FLAnmeldecodeDaten(art="anmeldecode"))
            sperre = await owe(database, client, "sperre/1")
            answer = await claimed(database, client)

            return [mail.id for mail in answer.mails], sperre, (await stored(database, code))["stand"]

        handed, sperre, stand = on_a_database(mongo_replica_set_url, body)

        assert (handed, stand) == ([sperre], "gesperrt")

    def test_a_failed_send_waits_and_goes_again(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            row_id = await owe(database, client, "sperre/1")
            first = await claimed(database, client)
            failed = await reported(database, client, first.beanspruchung, row_id, "wiederholen")
            waiting = await claimed(database, client, now=NOW + WIEDERHOLUNG_NACH - timedelta(seconds=1))
            again = await claimed(database, client, now=NOW + WIEDERHOLUNG_NACH)

            return failed.wiederholt, waiting.mails, [mail.id for mail in again.mails], row_id

        wiederholt, waiting, again, row_id = on_a_database(mongo_replica_set_url, body)

        assert (wiederholt, waiting, again) == (1, [], [row_id])


class TestTheSignInCode:
    def test_a_failed_send_gives_it_up_and_its_secret_goes_with_the_final_state(self, mongo_replica_set_url: str):
        """The library repairs a failed code with a fresh one, so the row is tried once; its own lapse stays its delete date."""

        gueltig_bis = NOW + timedelta(minutes=10)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            owed = await post_anmeldung(
                anmeldung_data=FLPostausgangAnmeldungPayload(
                    schluessel="anmeldecode/1", an=NORA, daten=FLAnmeldecodeDaten(art="anmeldecode"), geheim="chiffrat", gueltig_bis=gueltig_bis
                ),
                postausgang_collection=database[Collection.POSTAUSGANG],
                db_client=client,
                now=NOW,
            )
            first = await claimed(database, client)
            failed = await reported(database, client, first.beanspruchung, owed.id, "wiederholen")

            return first, failed, await stored(database, owed.id)

        first, failed, row = on_a_database(mongo_replica_set_url, body)

        assert [mail.geheim for mail in first.mails] == ["chiffrat"]
        assert (failed.wiederholt, failed.aufgegeben) == (0, 1)
        assert (row["stand"], "geheim" in row, "daten" in row, utc(row["loeschen_am"])) == ("aufgegeben", False, False, gueltig_bis)


class TestTheExpiry:
    def test_a_settled_row_is_deleted_a_retention_after_its_final_state_and_keeps_no_data(self, mongo_replica_set_url: str):
        settled_at = NOW + timedelta(hours=1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, Any]:
            row_id = await owe(database, client, "sperre/1")
            answer = await claimed(database, client, now=settled_at)
            await reported(database, client, answer.beanspruchung, row_id, "gesendet", now=settled_at)

            return await stored(database, row_id)

        row = on_a_database(mongo_replica_set_url, body)

        assert (utc(row["loeschen_am"]), "daten" in row) == (settled_at + NACHLAUF, False)


class TestTheDeliveryEvent:
    def test_an_event_finds_its_row_before_the_report_and_a_state_never_moves_back(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            row_id = await owe(database, client, "sperre/1", link=True)
            answer = await claimed(database, client)

            async def event(stand: FLPostausgangZustellStand, row: ObjectId = row_id) -> bool:
                payload = FLPostausgangEreignisPayload(id=row, stand=stand, grund=None, am=NOW)
                return (await post_ereignis(ereignis_data=payload, postausgang_collection=database[Collection.POSTAUSGANG])).angewendet

            # The provider's event can outrun the send's own report, which has then recorded nothing of the message.
            first = await event("unzustellbar")
            await reported(database, client, answer.beanspruchung, row_id, "gesendet")
            applied = [first, await event("verzoegert"), await event("zugestellt"), await event("zugestellt", ObjectId())]
            newest = await read_the_newest(postausgang_collection=database[Collection.POSTAUSGANG], bezug=BEZUG)

            return applied, newest, await stored(database, row_id)

        applied, newest, row = on_a_database(mongo_replica_set_url, body)

        assert applied == [True, False, False, False]
        assert newest is not None and unzustellbar(newest)
        assert row["stand"] == "gesendet"
