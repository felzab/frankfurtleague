"""
API · a referee's link, from the writes that mint it to the person's answer through it

Each case is one whose failure no page shows: a link left live in a mailbox the entry no longer names, a person mailed
who was not to be asked, an answer stored against the rules it is judged by, or an entry outliving the fourteen days
the privacy notice gives it. Served against the shipped indexes, every write one transaction.
"""

import dataclasses
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.schiedsrichter.admin_router import (
    delete_schiedsrichter,
    patch_schiedsrichter,
    post_schiedsrichter,
    reactivate_schiedsrichter,
    resend_confirmation,
)
from app.api.schiedsrichter.public_router import get_confirmation_view, post_confirmation, post_decline
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLPostSchiedsrichterPayload,
    FLSchiedsrichterConfirmationPayload,
)
from app.api.schiedsrichter.services import (
    CONFIRMATION_FIELD,
    EINWILLIGUNG_FIELD,
    ERASE_AT_FIELD,
    confirmation_deadline_from,
    erase_at_from,
)
from app.api.schiedsrichter.system_router import sweep_schiedsrichter
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.tokens import hash_token
from tests import documents
from tests.acts import deletions_of
from tests.database import a_clean_database
from tests.isolation import InterleavedCollection
from tests.outbox import MAIL_NOW, drained
from tests.stored import the_row
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, the whole slice being one transaction each.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_schiedsrichter_confirmation_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
# One day past the deadline a link minted on `TODAY` carries, so the expiry case needs no second mint.
AFTER_THE_DEADLINE = "2026-04-16"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607810001")
NAME = "Pierluigi Collina"
SCHULE = "Carl-Schurz-Schule"
DEFAULT_PAYMENT = 20

EMAIL = "collina@example.com"
CORRECTED_EMAIL = "collina.pierluigi@example.com"
PHONE = "+49 69 90009123"

AN_ADULTS_BIRTHDATE = "1984-05-09"
A_CHILDS_BIRTHDATE = "2018-01-01"

# The labels the referee page names beside its two choices.
TEXT_VERSIONS = documents.SCHIEDSRICHTER_TEXT_VERSIONS


def saison_document() -> dict[str, Any]:
    """The RUNNING season."""

    return documents.saison_document(SAISON_ID, "active")


def referee_document(*, email: str = EMAIL, **overrides: Any) -> dict[str, Any]:
    """A referee entered before this flow: no link, no record, no birthdate."""

    return documents.schiedsrichter_document(
        overrides.pop("_id", SCHIEDSRICHTER_OID),
        email=email,
        name=overrides.pop("name", NAME),
        default_payment=DEFAULT_PAYMENT,
        einwilligung=None,
        **{"schule": SCHULE, "kontakt": {"phone": PHONE, "email": email}, **overrides},
    )


def payload_body(*, email: str | None = EMAIL) -> dict[str, Any]:
    return {"name": NAME, "schule": SCHULE, "default_payment": DEFAULT_PAYMENT, "kontakt": {"phone": PHONE, "email": email}}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


@dataclasses.dataclass(frozen=True)
class Mailed:
    """A write's answer, beside the link the Postausgang minted for the mail it owed and its address: `None` where it owed none."""

    answer: Any
    token: str | None
    to: str | None


async def mailed(database: AsyncDatabase, client: AsyncMongoClient, answer: Any) -> Mailed:
    """The write's answer and the one link its mail carries, the outbox drained as the frontend drains it after the write."""

    mails = await drained(database, client)
    assert len(mails) <= 1, "one write owes one referee one mail at most"

    return Mailed(answer=answer, token=mails[0].token if mails else None, to=mails[0].to if mails else None)


async def on_a_league(url: str, body: Body, *, referees: list[dict[str, Any]] | None = None) -> Any:
    """The SHIPPED indexes, so a block or a record production would refuse fails here too."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
        await database[Collection.SAISONS].insert_one(saison_document())
        seeded = [referee_document()] if referees is None else referees
        if seeded:
            await database[Collection.SCHIEDSRICHTER].insert_many(seeded)

        return await body(database, client)


async def create(database: AsyncDatabase, client: AsyncMongoClient, *, email: str | None = EMAIL, today: str = TODAY) -> Mailed:
    async with client.start_session(snapshot=True) as session:
        answer = await post_schiedsrichter(
            schiedsrichter_data=FLPostSchiedsrichterPayload.model_validate(payload_body(email=email)),
            schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
            outbox_collection=database[Collection.OUTBOX],
            db=client,
            today=today,
            germany_now=MAIL_NOW,
            session=session,
        )

    return await mailed(database, client, answer)


async def correct(database: AsyncDatabase, client: AsyncMongoClient, *, email: str | None, today: str = TODAY) -> Mailed:
    # The version an editor opened now would be served, as the save sends it back.
    version = (await stored(database))["version"]
    async with client.start_session(snapshot=True) as session:
        answer = await patch_schiedsrichter(
            schiedsrichter_id=SCHIEDSRICHTER_OID,
            schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate({**payload_body(email=email), "version": version}),
            schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
            outbox_collection=database[Collection.OUTBOX],
            db=client,
            today=today,
            germany_now=MAIL_NOW,
            session=session,
        )

    return await mailed(database, client, answer)


async def resend(
    database: AsyncDatabase, client: AsyncMongoClient, *, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID, today: str = TODAY
) -> Mailed:
    await resend_confirmation(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=today,
        germany_now=MAIL_NOW,
    )

    return await mailed(database, client, None)


async def read_view(database: AsyncDatabase, token: str | None, *, today: str = TODAY) -> Any:
    assert token is not None, "the write owed no link to open"

    return await get_confirmation_view(
        view_data=FLTokenPayload(token=token),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        today=today,
    )


async def confirm(database: AsyncDatabase, client: AsyncMongoClient, token: str | None, *, today: str = TODAY, **overrides: Any) -> Any:
    body = {
        "token": token,
        "birth_date": AN_ADULTS_BIRTHDATE,
        "scope": "kader_public",
        "media": True,
        "text_versions": dict(TEXT_VERSIONS),
        **overrides,
    }

    return await post_confirmation(
        answer_data=FLSchiedsrichterConfirmationPayload.model_validate(body),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        db=client,
        today=today,
        germany_now=NOW,
    )


async def decline(database: AsyncDatabase, client: AsyncMongoClient, token: str | None, *, today: str = TODAY) -> None:
    assert token is not None, "the write owed no link to decline through"

    await post_decline(
        decline_data=FLTokenPayload(token=token),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        db=client,
        today=today,
        germany_now=NOW,
    )


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime) -> Any:
    return await sweep_schiedsrichter(
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        db=client,
        germany_now=now,
    )


async def stored(database: AsyncDatabase, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID) -> Mapping[str, Any]:
    return await the_row(database, Collection.SCHIEDSRICHTER, {"_id": schiedsrichter_id}, "the referee this case seeded is gone")


class TestTheCreateIsTheInvitation:
    """Entering an address IS the invitation, so no second press decides whether this person is asked."""

    async def test_a_create_with_an_address_answers_a_token_the_stored_hash_matches(self, mongo_replica_set_url: str):
        """The create mints the link its mail carries and starts the entry's clock: a hash the token misses opens nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await create(database, client)
            row = await stored(database, response.answer.created_id)

            return response, row

        response, row = await on_a_league(mongo_replica_set_url, body, referees=[])

        assert response.to == EMAIL
        assert row[CONFIRMATION_FIELD]["token_hashes"] == [hash_token(str(response.token))]
        assert row[CONFIRMATION_FIELD]["deadline"] == confirmation_deadline_from(today=TODAY)
        # The clock the TTL index reads: absent, the unanswered entry outlives the fourteen days the notice promises.
        assert row[ERASE_AT_FIELD].replace(tzinfo=UTC) == erase_at_from(deadline=confirmation_deadline_from(today=TODAY))
        # Stored null, as a registration's: absent, the read and record models requiring the keys refuse the row.
        assert (row[EINWILLIGUNG_FIELD], row["birth_date"]) == (None, None)

    async def test_the_answer_names_the_mailbox_as_stored_not_as_typed(self, mongo_replica_set_url: str):
        """The dialog's note names this address, so a capital typed into it reads as the mailbox the editor later shows."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await create(database, client, email=" Collina@Example.COM ")

        response = await on_a_league(mongo_replica_set_url, body, referees=[])

        assert (response.to, response.answer.confirmation.email) == (EMAIL, EMAIL)


class TestANameAnotherRefereeHolds:
    @pytest.mark.parametrize("act", ["an entry", "a correction"])
    async def test_it_is_refused_on_its_box_a_retired_referee_s_included(self, mongo_replica_set_url: str, act: str):
        """Left to the unique index, the refusal names no box and reaches the shared failure line, which sends the administrator to a retry."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await (create(database, client) if act == "an entry" else correct(database, client, email=EMAIL))

            return refused.value.error_code, refused.value.fields, await database[Collection.OUTBOX].count_documents({})

        holders = [
            referee_document(name="Howard Webb", email=CORRECTED_EMAIL),
            referee_document(_id=ObjectId(), email="alte.pfeife@example.com", inactive_since="2026-01-01"),
        ]

        assert await on_a_league(mongo_replica_set_url, body, referees=holders) == (Code.DUPLICATE_KEY, (("name",),), 0)


class TestACorrectedAddressReMintsAndRetiresTheOldLink:
    """The ruled behaviour: the old link was posted to a mailbox nobody reads, and leaving it live is a credential in the wrong inbox."""

    async def test_the_old_token_dies_and_the_new_one_opens_the_entry(self, mongo_replica_set_url: str):
        """The old link left live is a credential in a mailbox nobody reads, and nothing on any page says it is."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            corrected = await correct(database, client, email=CORRECTED_EMAIL)

            with pytest.raises(APIError) as old_link:
                await read_view(database, first.token)

            return corrected, await stored(database), old_link.value

        corrected, row, old_link = await on_a_league(mongo_replica_set_url, body)

        assert corrected.answer.confirmation is not None
        assert row[CONFIRMATION_FIELD]["token_hashes"] == [hash_token(str(corrected.token))]
        assert row["kontakt"]["email"] == CORRECTED_EMAIL
        assert old_link.error_code == Code.LINK_INVALID

    async def test_a_retired_referees_new_address_is_stored_and_mints_nothing(self, mongo_replica_set_url: str):
        """A retired person is asked nothing, their old link dies, and the entry they never confirmed keeps its clock.

        Mailed, the person is asked to consent to a role nobody gives them; left live, the old link answers for a
        mailbox the entry no longer names; dropped with the block, the clock would let the unconfirmed entry stay for good.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            clock = (await stored(database))[ERASE_AT_FIELD]
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": "2026-01-01"}})
            saved = await correct(database, client, email=CORRECTED_EMAIL)

            with pytest.raises(APIError) as old_link:
                await read_view(database, first.token)

            return saved, await stored(database), old_link.value, clock

        saved, row, old_link, clock = await on_a_league(mongo_replica_set_url, body)

        assert saved.answer.confirmation is None
        assert row["kontakt"]["email"] == CORRECTED_EMAIL
        assert row[CONFIRMATION_FIELD] is None
        assert old_link.error_code == Code.LINK_INVALID
        assert row[ERASE_AT_FIELD] == clock


class TestTheReSend:
    async def test_a_second_re_send_replaces_the_block_whole(self, mongo_replica_set_url: str):
        """Every earlier link stops at the re-send: one left live answers beside the link the person was last sent."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            second = await resend(database, client)

            with pytest.raises(APIError) as first_link:
                await read_view(database, first.token)

            return second, await stored(database), first_link.value

        second, row, first_link = await on_a_league(mongo_replica_set_url, body)

        assert second.token is not None
        # Spelled out rather than composed: built by the composer the write calls, a key it misspelled would stand on both sides.
        assert row[CONFIRMATION_FIELD] == {"token_hashes": [hash_token(second.token)], "sent_at": TODAY, "deadline": "2026-04-15"}
        assert first_link.error_code == Code.LINK_INVALID

    async def test_a_retired_referee_is_refused(self, mongo_replica_set_url: str):
        """Mailed, a retired person is asked to consent to a role nobody gives them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await delete_schiedsrichter(
                schiedsrichter_id=SCHIEDSRICHTER_OID,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                spiele_collection=database[Collection.SPIELE],
                db=client,
                today=TODAY,
            )

            with pytest.raises(APIError) as refused:
                await resend(database, client)

            return refused.value, await stored(database)

        refused, row = await on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.SCHIEDSRICHTER_RETIRED
        assert row[CONFIRMATION_FIELD] is None

    # No null: every referee record holds an address, which the record model and the read-back hold it to.
    async def test_a_referee_holding_no_address_a_link_can_go_to_is_refused(self, mongo_replica_set_url: str):
        """A mint here records a message nobody composed and starts the deletion clock on a person nobody asked."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await resend(database, client)

            return refused.value, await stored(database)

        refused, row = await on_a_league(mongo_replica_set_url, body, referees=[referee_document(email="no-address")])

        assert (refused.error_code, refused.status_code) == (Code.SCHIEDSRICHTER_NO_ADDRESS, 409)
        assert row[CONFIRMATION_FIELD] is None

    async def test_a_referee_who_has_already_answered_is_refused_and_keeps_their_block(self, mongo_replica_set_url: str):
        """A fresh link for them can never be spent, and minting one would start the deletion clock on a confirmed entry."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await confirm(database, client, first.token)

            with pytest.raises(APIError) as refused:
                await resend(database, client)

            return first, refused.value, await stored(database)

        first, refused, row = await on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_EXISTS
        assert row[CONFIRMATION_FIELD]["token_hashes"] == [hash_token(str(first.token))]
        assert row[ERASE_AT_FIELD] is None


async def reactivate(database: AsyncDatabase, client: AsyncMongoClient) -> Mailed:
    answer = await reactivate_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )

    return await mailed(database, client, answer)


RETIRED: Mapping[str, Any] = {"inactive_since": "2026-01-01"}


class TestTheReactivation:
    """The mint a retired referee's save withholds: bringing an unanswered referee back is what asks them."""

    async def test_an_unanswered_referee_is_minted_a_link_the_stored_hash_matches(self, mongo_replica_set_url: str):
        """A referee brought back unasked is bookable by nobody and asked by nothing: no page says the link is owed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await reactivate(database, client), await stored(database)

        response, row = await on_a_league(mongo_replica_set_url, body, referees=[referee_document(**RETIRED)])

        assert row["inactive_since"] is None
        # The answer names the mailbox the link went to, which the editor reports once the press is done.
        assert (response.to, response.answer.confirmation.email) == (EMAIL, EMAIL)
        assert row[CONFIRMATION_FIELD]["token_hashes"] == [hash_token(str(response.token))]
        assert ERASE_AT_FIELD in row

    async def test_a_referee_who_confirmed_comes_back_unasked(self, mongo_replica_set_url: str):
        """A mint here replaces a confirmed person's block and starts the clock that deletes the entry they confirmed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await confirm(database, client, first.token)
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": dict(RETIRED)})

            return first, await reactivate(database, client), await stored(database)

        first, response, row = await on_a_league(mongo_replica_set_url, body)

        assert (response.token, response.answer.confirmation) == (None, None)
        assert row[CONFIRMATION_FIELD]["token_hashes"] == [hash_token(str(first.token))]
        assert row[ERASE_AT_FIELD] is None


class TestTheConfirmation:
    async def test_it_writes_the_birthdate_and_the_record_in_one_update(self, mongo_replica_set_url: str):
        """The consent's evidence names the wording each choice was given under, and the clock goes with the answer.

        A record citing the wrong wording proves nothing the person agreed to; a clock left standing deletes the entry
        they confirmed.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.token)

            return await stored(database)

        row = await on_a_league(mongo_replica_set_url, body)

        assert row["birth_date"] == AN_ADULTS_BIRTHDATE
        # Each choice evidenced by the confirmation, its instant in UTC: `NOW` is half past noon in
        # Frankfurt's summer time.
        assert row[EINWILLIGUNG_FIELD] == {
            "scope": "kader_public",
            "date": TODAY,
            "confirmed_at": TODAY,
            "media": True,
            "evidence": {
                "scope": {"at": "2026-04-01T10:30:00+00:00", "text_version": TEXT_VERSIONS["scope"]},
                "media": {"at": "2026-04-01T10:30:00+00:00", "text_version": TEXT_VERSIONS["media"]},
            },
        }
        assert row[ERASE_AT_FIELD] is None

    async def test_a_second_press_is_refused(self, mongo_replica_set_url: str):
        """A second press writing would replace the publication scope the person chose first."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.token)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, scope="internal")

            return refused.value, await stored(database)

        refused, row = await on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_EXISTS
        assert row[EINWILLIGUNG_FIELD]["scope"] == "kader_public"

    async def test_a_press_after_the_deadline_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """A lapsed link still answering takes a consent after the deadline the mail named, on an entry already due to go."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, today=AFTER_THE_DEADLINE)

            return refused.value, await stored(database)

        refused, row = await on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.LINK_EXPIRED
        assert row.get(EINWILLIGUNG_FIELD) is None
        assert row.get("birth_date") is None

    async def test_a_birthdate_under_the_floor_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        """A consent from someone under the referees' minimum age is one the league may not hold."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, birth_date=A_CHILDS_BIRTHDATE)

            return refused.value, await stored(database)

        refused, row = await on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_AGE
        assert row.get("birth_date") is None


class TestTheObjection:
    async def test_it_erases_the_entry_in_its_own_write_and_its_link_opens_nothing(self, mongo_replica_set_url: str):
        """The privacy notice says an objection deletes the entry, as a contact seat's empties the seat.

        Left on its link's clock, the entry outlives the objection by up to fourteen days; a link still opening it takes a
        consent the person refused. Neither shows on any page.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await decline(database, client, minted.token)

            with pytest.raises(APIError) as reopened:
                await read_view(database, minted.token)
            with pytest.raises(APIError) as consented:
                await confirm(database, client, minted.token)

            left = await database[Collection.SCHIEDSRICHTER].count_documents({"_id": SCHIEDSRICHTER_OID})
            return left, reopened.value.error_code, consented.value.error_code

        assert await on_a_league(mongo_replica_set_url, body) == (0, Code.LINK_INVALID, Code.LINK_INVALID)


CONFIRMED_OID = ObjectId("6890a1b2c3d4e5f607810002")
CONFIRMED_EMAIL = "rosetti@example.com"


class TestTheClock:
    async def test_a_lapsed_entry_goes_and_a_confirmed_one_stays(self, mongo_replica_set_url: str):
        """The privacy notice gives an unconfirmed entry fourteen days.

        Erased early, or a confirmed entry erased at all, a referee the league keeps is gone.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await resend(database, client)
            kept = await resend(database, client, schiedsrichter_id=CONFIRMED_OID)
            await confirm(database, client, kept.token)
            clock = (await stored(database))[ERASE_AT_FIELD].replace(tzinfo=UTC)

            early = await sweep(database, client, now=clock - timedelta(seconds=1))
            standing = await database[Collection.SCHIEDSRICHTER].count_documents({"_id": SCHIEDSRICHTER_OID})
            late = await sweep(database, client, now=clock)
            left = await database[Collection.SCHIEDSRICHTER].find({}, {"_id": 1}).to_list(length=None)

            return (early.erased, standing), (late.erased, late.failed), left, await deletions_of(database, "retention.schiedsrichter")

        early, late, left, deletions = await on_a_league(
            mongo_replica_set_url,
            body,
            referees=[referee_document(), referee_document(_id=CONFIRMED_OID, name="Roberto Rosetti", email=CONFIRMED_EMAIL)],
        )

        assert early == (0, 1)
        assert late == (1, 0)
        assert deletions == [("system", None, 1, None)]
        assert {row["_id"] for row in left} >= {CONFIRMED_OID}
        assert SCHIEDSRICHTER_OID not in {row["_id"] for row in left}

    async def test_an_entry_confirmed_after_the_pass_read_it_stays(self, mongo_replica_set_url: str):
        """The pass reads its entries before any entry's own transaction, so it judges each again there.

        Read as lapsed and erased all the same, a referee who confirmed in the last moment is gone.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            clock = (await stored(database))[ERASE_AT_FIELD].replace(tzinfo=UTC)

            async def confirm_in_between() -> None:
                await confirm(database, client, minted.token)

            # The entry's transaction opens on this read: the confirmation commits after the pass's read of its entries
            # and before the transaction's snapshot.
            referees = InterleavedCollection(database[Collection.SCHIEDSRICHTER], confirm_in_between, before="find_one")
            answer = await sweep_schiedsrichter(
                schiedsrichter_collection=cast(Any, referees),
                spiele_collection=database[Collection.SPIELE],
                spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                db=client,
                germany_now=clock,
            )

            return (
                (answer.erased, answer.failed),
                referees.passes,
                await database[Collection.SCHIEDSRICHTER].count_documents({"_id": SCHIEDSRICHTER_OID}),
            )

        swept, passes, standing = await on_a_league(mongo_replica_set_url, body)

        # The premise: the pass read the entry as lapsed and reached its transaction.
        assert passes == 1
        assert (swept, standing) == ((0, 0), 1)


# Against `TODAY`, 17 years and 364 days.
A_DAY_SHORT_OF_THE_MEDIA_AGE = "2008-04-02"


class TestTheMediaAge:
    async def test_a_yes_a_day_short_of_the_media_age_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        """A yes from someone below the media age stores a media consent the league does not take from them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, birth_date=A_DAY_SHORT_OF_THE_MEDIA_AGE, media=True)

            return refused.value, await stored(database)

        refused, row = await on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.MEDIA_AGE
        assert row.get("birth_date") is None
        assert row.get(EINWILLIGUNG_FIELD) is None
