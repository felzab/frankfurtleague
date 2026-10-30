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

from app.api.outbox.crud import state_of
from app.api.outbox.schemas import (
    FLOutboxData,
    FLOutboxDeliveryStand,
    FLOutboxEventPayload,
    FLOutboxHandoutResponse,
    FLOutboxLink,
    FLOutboxReference,
    FLOutboxResultArt,
    FLOutboxResultPayload,
    FLOutboxResultResponse,
    FLOutboxSignInPayload,
    FLSignInCodeData,
    FLSperreData,
)
from app.api.outbox.services import (
    LEASE_DURATION,
    REPETITION_AFTER,
    RETENTION,
    SEITE,
    OwedMail,
    enqueue_mails,
)
from app.api.outbox.system_router import post_event, post_handout, post_result, post_sign_in
from app.core.collections import Collection
from app.core.transactions import transaction_session
from app.shared.tokens import hash_token
from tests.bans import ban_list
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import ban_document
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_outbox_test")

# A century ahead of the real clock: the TTL monitor deletes a row whose delete date has passed, under a case reading it.
NOW = datetime(2126, 4, 16, 12, 30, tzinfo=UTC)
INVITATION = ObjectId("6890a1b2c3d4e5f607f30001")
REFERENCE = FLOutboxReference(collection=Collection.INVITATIONS, id=INVITATION, seat=None)
NORA = "nora.neu@beispielschule.de"
SPERRE = FLSperreData(art="sperre", grund="Falsches Geburtsdatum", barred_until_saison_id="2127")

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_database(url: str, body: Body) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (client, database):
            await database[Collection.INVITATIONS].insert_one({"_id": INVITATION, "email": NORA, "token_hashes": []})
            return await body(database, client)

    return on_the_seed_loop(_run())


def utc(moment: datetime) -> datetime:
    """A stored instant as the UTC it is: the driver reads one back with no offset."""

    return moment.replace(tzinfo=UTC)


# The one record's link: its array, minted while the record still names the recipient.
LINK = FLOutboxLink(paths=["token_hashes"], adressen=["email"], replaced=False)


async def owe(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    key: str,
    *,
    data: FLOutboxData = SPERRE,
    link: bool = False,
    reference: FLOutboxReference = REFERENCE,
    spec: FLOutboxLink = LINK,
) -> ObjectId:
    """One mail owed inside a transaction of its own, as a write owing it would, and the id of the row its key names."""

    async def write(session: Any) -> None:
        await enqueue_mails(
            outbox_collection=database[Collection.OUTBOX],
            session=session,
            mails=[OwedMail(key=key, an=NORA, data=data, reference=reference if link else None, link=spec if link else None)],
            now=NOW,
        )

    async with transaction_session(client) as session:
        await session.with_transaction(write)

    return (await stored_by_key(database, key))["_id"]


async def stored_by_key(database: AsyncDatabase, key: str) -> dict[str, Any]:
    row = await database[Collection.OUTBOX].find_one({"key": key})
    assert row is not None
    return row


async def claimed(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime = NOW) -> FLOutboxHandoutResponse:
    return await post_handout(
        outbox_collection=database[Collection.OUTBOX], sperrliste=ban_list(database), db=database, db_client=client, now=now
    )


async def reported(
    database: AsyncDatabase,
    lease: str | None,
    row_id: ObjectId,
    result: FLOutboxResultArt,
    *,
    now: datetime = NOW,
    grund: str | None = None,
) -> FLOutboxResultResponse:
    assert lease is not None
    return await post_result(
        result_data=FLOutboxResultPayload(
            lease=lease,
            id=row_id,
            result=result,
            message_id=f"msg-{row_id}" if result == "sent" else None,
            grund=grund,
        ),
        outbox_collection=database[Collection.OUTBOX],
        now=now,
    )


async def stored(database: AsyncDatabase, row_id: ObjectId) -> dict[str, Any]:
    row = await database[Collection.OUTBOX].find_one({"_id": row_id})
    assert row is not None
    return row


class TestTheEnqueue:
    def test_a_replay_of_the_same_write_owes_the_mail_once(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[ObjectId, ObjectId, int]:
            first = await owe(database, client, "sperre/1")
            again = await owe(database, client, "sperre/1")

            return first, again, await database[Collection.OUTBOX].count_documents({})

        first, again, rows = on_a_database(mongo_replica_set_url, body)

        assert (again, rows) == (first, 1)

    def test_a_batch_replayed_owes_only_the_mails_its_first_run_did_not(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[str]:
            async def batch(*keys: str) -> None:
                async def write(session: Any) -> None:
                    await enqueue_mails(
                        outbox_collection=database[Collection.OUTBOX],
                        session=session,
                        mails=[OwedMail(key=key, an=NORA, data=SPERRE) for key in keys],
                        now=NOW,
                    )

                async with transaction_session(client) as session:
                    await session.with_transaction(write)

            await batch("sperre/1", "sperre/2")
            await batch("sperre/2", "sperre/3")

            return sorted(row["key"] for row in await database[Collection.OUTBOX].find({}).to_list())

        assert on_a_database(mongo_replica_set_url, body) == ["sperre/1", "sperre/2", "sperre/3"]


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
            inside = await claimed(database, client, now=NOW + LEASE_DURATION - timedelta(seconds=1))
            after = await claimed(database, client, now=NOW + LEASE_DURATION)
            late = await reported(database, lost.lease, row_id, "sent")
            settled = await reported(database, after.lease, row_id, "sent")
            record = await database[Collection.INVITATIONS].find_one({"_id": INVITATION})
            logged = await database[Collection.ACTION_LOG].count_documents({"collection": str(Collection.OUTBOX)})

            return lost, inside, after, late, settled, await stored(database, row_id), record, logged

        lost, inside, after, late, settled, row, record, logged = on_a_database(mongo_replica_set_url, body)

        (first,), (second,) = lost.mails, after.mails
        assert (inside.mails, first.attempt, second.attempt) == ([], 1, 2)
        assert first.token is not None and second.token is not None
        assert record is not None and set(record["token_hashes"]) == {hash_token(first.token), hash_token(second.token)}
        assert ((late.sent, late.ignored), (settled.sent, settled.ignored)) == ((0, 1), (1, 0))
        assert (row["stand"], row["message_id"]) == ("sent", f"msg-{row['_id']}")
        assert logged == 0

    def test_a_link_goes_into_every_seat_it_names_and_a_mail_whose_seat_moved_on_since_is_dropped(self, mongo_replica_set_url: str):
        """One link for a person holding two seats, minted into both; a seat emptied or re-addressed since mints nothing.

        The emptied seat is the case a write through its null entry would refuse, aborting the claim for every row on it.
        """

        saison_team = ObjectId("6890a1b2c3d4e5f607f30002")
        spec = FLOutboxLink(
            paths=["kontakte.trainer.token_hashes", "kontakte.betreuer.token_hashes"],
            adressen=["kontakte.trainer.email", "kontakte.betreuer.email"],
            replaced=False,
        )
        reference = FLOutboxReference(collection=Collection.SAISON_TEAMS, id=saison_team, seat="trainer")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            beide = {"email": NORA, "token_hashes": []}
            await database[Collection.SAISON_TEAMS].insert_one(
                {"_id": saison_team, "version": 0, "kontakte": {"trainer": beide, "betreuer": beide}}
            )
            minted = await owe(database, client, "sitze/1", link=True, reference=reference, spec=spec)
            first = await claimed(database, client)
            record = await database[Collection.SAISON_TEAMS].find_one({"_id": saison_team})

            await database[Collection.SAISON_TEAMS].update_one({"_id": saison_team}, {"$set": {"kontakte.betreuer": None}})
            empty = await owe(database, client, "sitze/2", link=True, reference=reference, spec=spec)
            emptied = await claimed(database, client)
            await database[Collection.SAISON_TEAMS].update_one(
                {"_id": saison_team}, {"$set": {"kontakte.betreuer": {"email": "nachfolge@beispielschule.de", "token_hashes": []}}}
            )
            continued = await owe(database, client, "sitze/3", link=True, reference=reference, spec=spec)
            handed_on = await claimed(database, client)

            dropped = [*emptied.mails, *handed_on.mails]
            return minted, first, record, dropped, [(await stored(database, row_id))["stand"] for row_id in (empty, continued)]

        minted, first, record, dropped, staende = on_a_database(mongo_replica_set_url, body)

        (mail,) = first.mails
        assert mail.id == minted and mail.token is not None
        assert record is not None
        assert [record["kontakte"][seat]["token_hashes"] for seat in ("trainer", "betreuer")] == [[hash_token(mail.token)]] * 2
        # Bookkeeping, as an anchor is: an editor read before the drain still saves.
        assert record["version"] == 0
        assert (dropped, staende) == ([], ["dropped", "dropped"])

    def test_a_mail_to_a_barred_address_stops_at_the_hand_out_and_the_bans_own_notice_goes(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(ban_document(NORA, bis="2999"))
            code = await owe(database, client, "anmeldecode/1", data=FLSignInCodeData(art="sign_in_code"))
            sperre = await owe(database, client, "sperre/1")
            answer = await claimed(database, client)

            return [mail.id for mail in answer.mails], sperre, (await stored(database, code))["stand"]

        handed, sperre, stand = on_a_database(mongo_replica_set_url, body)

        assert (handed, stand) == ([sperre], "barred")

    def test_a_failed_send_waits_and_goes_again_its_refusal_on_the_row_until_a_send_goes(self, mongo_replica_set_url: str):
        """The row is a send's one record, so the provider's name for its refusal is the only answer to why it waited."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            row_id = await owe(database, client, "sperre/1")
            first = await claimed(database, client)
            failed = await reported(database, first.lease, row_id, "retry", grund="rate_limit_exceeded")
            waiting = await claimed(database, client, now=NOW + REPETITION_AFTER - timedelta(seconds=1))
            refused = (await stored(database, row_id))["grund"]
            again = await claimed(database, client, now=NOW + REPETITION_AFTER)
            await reported(database, again.lease, row_id, "sent", now=NOW + REPETITION_AFTER)

            return failed.repeated, waiting.mails, [mail.id for mail in again.mails], row_id, refused, await stored(database, row_id)

        repeated, waiting, again, row_id, refused, row = on_a_database(mongo_replica_set_url, body)

        assert (repeated, waiting, again) == (1, [], [row_id])
        assert (refused, row["stand"], row["grund"]) == ("rate_limit_exceeded", "sent", None)

    def test_a_mail_whose_link_supersedes_drops_the_older_one_still_waiting_to_go_again(self, mongo_replica_set_url: str):
        """Handed out after the newer mail, the older one would supersede the newer link, and the newest mail opens nothing."""

        ersetzend = FLOutboxLink(paths=["token_hashes"], adressen=["email"], replaced=True)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            older = await owe(database, client, "link/1", link=True, spec=ersetzend)
            first = await claimed(database, client)
            await reported(database, first.lease, older, "retry")
            newer = await owe(database, client, "link/2", link=True, spec=ersetzend)
            second = await claimed(database, client)
            await reported(database, second.lease, newer, "sent")
            later = await claimed(database, client, now=NOW + REPETITION_AFTER)
            record = await database[Collection.INVITATIONS].find_one({"_id": INVITATION})

            return second, later, record, (await stored(database, older))["stand"]

        second, later, record, older_stand = on_a_database(mongo_replica_set_url, body)

        (mail,) = second.mails
        assert mail.token is not None
        assert (later.mails, older_stand) == ([], "dropped")
        assert record is not None and record["token_hashes"] == [hash_token(mail.token)]


class TestTheSignInCode:
    def test_it_is_handed_out_ahead_of_a_full_page_of_older_league_mail(self, mongo_replica_set_url: str):
        """It has one attempt inside its lapse, so a queue of league mail ahead of it would spend the drain's deadline."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            for position in range(SEITE):
                await owe(database, client, f"sperre/{position}")
            code = await owe(database, client, "anmeldecode/1", data=FLSignInCodeData(art="sign_in_code"))
            answer = await claimed(database, client)

            return code, [mail.id for mail in answer.mails]

        code, handed = on_a_database(mongo_replica_set_url, body)

        assert (handed[0], len(handed)) == (code, SEITE)

    def test_a_failed_send_gives_it_up_and_its_secret_goes_with_the_final_state(self, mongo_replica_set_url: str):
        """The library repairs a failed code with a fresh one, so the row is tried once; its own lapse stays its delete date."""

        valid_until = NOW + timedelta(minutes=10)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await post_sign_in(
                sign_in_data=FLOutboxSignInPayload(
                    an=NORA, data=FLSignInCodeData(art="sign_in_code"), secret="chiffrat", valid_until=valid_until
                ),
                outbox_collection=database[Collection.OUTBOX],
                now=NOW,
            )
            first = await claimed(database, client)
            (mail,) = first.mails
            failed = await reported(database, first.lease, mail.id, "retry")

            return first, failed, await stored(database, mail.id)

        first, failed, row = on_a_database(mongo_replica_set_url, body)

        assert [mail.secret for mail in first.mails] == ["chiffrat"]
        assert (failed.repeated, failed.abandoned) == (0, 1)
        assert (row["stand"], "secret" in row, "data" in row, utc(row["erase_at"])) == ("abandoned", False, False, valid_until)


class TestTheExpiry:
    def test_a_settled_row_is_deleted_a_retention_after_its_final_state_and_keeps_no_data(self, mongo_replica_set_url: str):
        settled_at = NOW + timedelta(hours=1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> dict[str, Any]:
            row_id = await owe(database, client, "sperre/1")
            answer = await claimed(database, client, now=settled_at)
            await reported(database, answer.lease, row_id, "sent", now=settled_at)

            return await stored(database, row_id)

        row = on_a_database(mongo_replica_set_url, body)

        assert (utc(row["erase_at"]), "data" in row) == (settled_at + RETENTION, False)


class TestTheDeliveryEvent:
    def test_an_event_finds_its_row_before_the_report_and_a_state_never_moves_back(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            row_id = await owe(database, client, "sperre/1", link=True)
            answer = await claimed(database, client)

            async def event(stand: FLOutboxDeliveryStand, row: ObjectId = row_id) -> bool:
                payload = FLOutboxEventPayload(id=row, stand=stand, grund=None, am=NOW)
                return (await post_event(event_data=payload, outbox_collection=database[Collection.OUTBOX])).applied

            # The provider's event can outrun the send's own report, which has then recorded nothing of the message.
            first = await event("undeliverable")
            await reported(database, answer.lease, row_id, "sent")
            applied = [first, await event("delayed"), await event("delivered"), await event("delivered", ObjectId())]
            newest = await state_of(outbox_collection=database[Collection.OUTBOX], reference=REFERENCE)

            return applied, newest, await stored(database, row_id)

        applied, newest, row = on_a_database(mongo_replica_set_url, body)

        assert applied == [True, False, False, False]
        assert newest is not None and newest.undeliverable
        assert row["stand"] == "sent"
