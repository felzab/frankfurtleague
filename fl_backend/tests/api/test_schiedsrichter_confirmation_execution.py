"""
API · a referee's link, from the writes that mint it to the person's answer through it

Each case is one whose failure no page shows: a link left live in a mailbox the entry no longer names, a person mailed
who was not to be asked, an answer stored against the rules it is judged by, or an entry outliving the fourteen days
the privacy notice gives it. Served against the shipped indexes, every write one transaction.
"""

import dataclasses
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.schiedsrichter.admin_router import (
    delete_schiedsrichter,
    invite_schiedsrichter,
    patch_schiedsrichter,
    post_schiedsrichter,
    reactivate_schiedsrichter,
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
    compose_confirmation,
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
from tests.database import a_clean_database, on_the_seed_loop
from tests.outbox import MAIL_NOW, drained
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
PHONE = "+49 69 1234567"

AN_ADULTS_BIRTHDATE = "1984-05-09"
A_CHILDS_BIRTHDATE = "2018-01-01"

# The labels the referee page names beside its two choices.
TEXT_VERSIONS = documents.SCHIEDSRICHTER_TEXT_VERSIONS


def saison_document() -> dict[str, Any]:
    """The RUNNING season."""

    return documents.saison_document(SAISON_ID, "active")


def referee_document(*, email: str | None = EMAIL, **overrides: Any) -> dict[str, Any]:
    """A referee entered before this flow: no link, no record, no birthdate."""

    return {
        "_id": SCHIEDSRICHTER_OID,
        "name": NAME,
        "schule": SCHULE,
        "default_payment": DEFAULT_PAYMENT,
        "kontakt": {"phone": PHONE, "email": email},
        "inactive_since": None,
        "version": 0,
        **overrides,
    }


def payload_body(*, email: str | None = EMAIL) -> dict[str, Any]:
    return {"name": NAME, "schule": SCHULE, "default_payment": DEFAULT_PAYMENT, "kontakt": {"phone": PHONE, "email": email}}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


@dataclasses.dataclass(frozen=True)
class Mailed:
    """A write's answer, beside the link the Postausgang minted for the mail it owed: `None` where it owed none."""

    answer: Any
    token: str | None


async def mailed(database: AsyncDatabase, client: AsyncMongoClient, answer: Any) -> Mailed:
    """The write's answer and the one link its mail carries, the outbox drained as the frontend drains it after the write."""

    mails = await drained(database, client)
    assert len(mails) <= 1, "one write owes one referee one mail at most"

    return Mailed(answer=answer, token=mails[0].token if mails else None)


def on_a_league(url: str, body: Body, *, referees: list[dict[str, Any]] | None = None) -> Any:
    """The SHIPPED indexes, so a block or a record production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_one(saison_document())
            seeded = [referee_document()] if referees is None else referees
            if seeded:
                await database[Collection.SCHIEDSRICHTER].insert_many(seeded)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def create(database: AsyncDatabase, client: AsyncMongoClient, *, email: str | None = EMAIL, today: str = TODAY) -> Mailed:
    answer = await post_schiedsrichter(
        schiedsrichter_data=FLPostSchiedsrichterPayload.model_validate(payload_body(email=email)),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=today,
        now=MAIL_NOW,
    )

    return await mailed(database, client, answer)


async def correct(database: AsyncDatabase, client: AsyncMongoClient, *, email: str | None, today: str = TODAY) -> Mailed:
    # The version an editor opened now would be served, as the save sends it back.
    version = (await stored(database))["version"]
    answer = await patch_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate({**payload_body(email=email), "version": version}),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=today,
        now=MAIL_NOW,
    )

    return await mailed(database, client, answer)


async def resend(
    database: AsyncDatabase, client: AsyncMongoClient, *, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID, today: str = TODAY
) -> Mailed:
    answer = await invite_schiedsrichter(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=today,
        now=MAIL_NOW,
    )

    return await mailed(database, client, answer)


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
        db=client,
        today=today,
    )


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime) -> Any:
    return await sweep_schiedsrichter(
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        db=client,
        germany_now=now,
    )


async def stored(database: AsyncDatabase, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID) -> Mapping[str, Any]:
    found = await database[Collection.SCHIEDSRICHTER].find_one({"_id": schiedsrichter_id})
    assert found is not None, "the referee this case seeded is gone"

    return found


class TestTheCreateIsTheInvitation:
    """Entering an address IS the invitation, so no second press decides whether this person is asked."""

    def test_a_create_with_an_address_answers_a_token_the_stored_hash_matches(self, mongo_replica_set_url: str):
        """The create mints the link its mail carries and starts the entry's clock: a hash the token misses opens nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await create(database, client)
            row = await stored(database, response.answer.created_id)

            return response, row

        response, row = on_a_league(mongo_replica_set_url, body, referees=[])

        assert response.answer.confirmation is not None
        assert row[CONFIRMATION_FIELD]["token_hashes"] == [hash_token(str(response.token))]
        assert row[CONFIRMATION_FIELD]["deadline"] == response.answer.confirmation.deadline == confirmation_deadline_from(today=TODAY)
        # The clock the TTL index reads: absent, the unanswered entry outlives the fourteen days the notice promises.
        assert row[ERASE_AT_FIELD].replace(tzinfo=UTC) == erase_at_from(deadline=confirmation_deadline_from(today=TODAY))


class TestACorrectedAddressReMintsAndRetiresTheOldLink:
    """The ruled behaviour: the old link was posted to a mailbox nobody reads, and leaving it live is a credential in the wrong inbox."""

    def test_the_old_token_dies_and_the_new_one_opens_the_entry(self, mongo_replica_set_url: str):
        """The old link left live is a credential in a mailbox nobody reads, and nothing on any page says it is."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            corrected = await correct(database, client, email=CORRECTED_EMAIL)

            with pytest.raises(APIError) as old_link:
                await read_view(database, first.token)

            return corrected, await stored(database), old_link.value

        corrected, row, old_link = on_a_league(mongo_replica_set_url, body)

        assert corrected.answer.confirmation is not None
        assert row[CONFIRMATION_FIELD]["token_hashes"] == [hash_token(str(corrected.token))]
        assert row["kontakt"]["email"] == CORRECTED_EMAIL
        assert old_link.error_code == Code.LINK_INVALID

    def test_a_retired_referees_new_address_is_stored_and_mints_nothing(self, mongo_replica_set_url: str):
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

        saved, row, old_link, clock = on_a_league(mongo_replica_set_url, body)

        assert saved.answer.confirmation is None
        assert row["kontakt"]["email"] == CORRECTED_EMAIL
        assert CONFIRMATION_FIELD not in row
        assert old_link.error_code == Code.LINK_INVALID
        assert row[ERASE_AT_FIELD] == clock


class TestTheReSend:
    def test_a_second_re_send_replaces_the_block_whole(self, mongo_replica_set_url: str):
        """Every earlier link stops at the re-send: one left live answers beside the link the person was last sent."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            second = await resend(database, client)

            with pytest.raises(APIError) as first_link:
                await read_view(database, first.token)

            return second, await stored(database), first_link.value

        second, row, first_link = on_a_league(mongo_replica_set_url, body)

        assert second.token is not None
        assert row[CONFIRMATION_FIELD] == {**compose_confirmation(today=TODAY), "token_hashes": [hash_token(second.token)]}
        assert first_link.error_code == Code.LINK_INVALID

    def test_an_address_moved_since_the_caller_read_it_is_the_one_answered(self, mongo_replica_set_url: str):
        """The row moves between the caller's read and this write, which is the whole case.

        Owed to the caller's own earlier read instead, the mail would carry the credential to the mailbox the save took
        the referee away from.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # What the caller read before pressing, and what it would have mailed to.
            before = (await stored(database))["kontakt"]["email"]
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"kontakt.email": CORRECTED_EMAIL}})

            return before, await resend(database, client), await stored(database)

        before, response, row = on_a_league(mongo_replica_set_url, body)

        assert before == EMAIL
        assert response.answer.confirmation.email == CORRECTED_EMAIL
        assert row[CONFIRMATION_FIELD]["token_hashes"] == [hash_token(str(response.token))]

    def test_a_retired_referee_is_refused(self, mongo_replica_set_url: str):
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

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.SCHIEDSRICHTER_RETIRED
        assert CONFIRMATION_FIELD not in row

    def test_a_referee_who_has_already_answered_is_refused_and_keeps_their_block(self, mongo_replica_set_url: str):
        """A fresh link for them can never be spent, and minting one would start the deletion clock on a confirmed entry."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await confirm(database, client, first.token)

            with pytest.raises(APIError) as refused:
                await resend(database, client)

            return first, refused.value, await stored(database)

        first, refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_EXISTS
        assert row[CONFIRMATION_FIELD]["token_hashes"] == [hash_token(str(first.token))]
        assert ERASE_AT_FIELD not in row


async def reactivate(database: AsyncDatabase, client: AsyncMongoClient) -> Mailed:
    answer = await reactivate_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        now=MAIL_NOW,
    )

    return await mailed(database, client, answer)


RETIRED: Mapping[str, Any] = {"inactive_since": "2026-01-01"}


class TestTheReactivation:
    """The mint a retired referee's save withholds: bringing an unanswered referee back is what asks them."""

    def test_an_unanswered_referee_is_minted_a_link_the_stored_hash_matches(self, mongo_replica_set_url: str):
        """A referee brought back unasked is bookable by nobody and asked by nothing: no page says the link is owed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await reactivate(database, client), await stored(database)

        response, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(**RETIRED)])

        assert row["inactive_since"] is None
        assert response.answer.confirmation.email == EMAIL
        assert row[CONFIRMATION_FIELD]["token_hashes"] == [hash_token(str(response.token))]
        assert ERASE_AT_FIELD in row

    def test_a_referee_who_has_answered_comes_back_unasked(self, mongo_replica_set_url: str):
        """A mint here replaces a confirmed person's block and starts the clock that deletes the entry they confirmed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await confirm(database, client, first.token)
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": dict(RETIRED)})

            return first, await reactivate(database, client), await stored(database)

        first, response, row = on_a_league(mongo_replica_set_url, body)

        assert response.answer.confirmation is None
        assert row[CONFIRMATION_FIELD]["token_hashes"] == [hash_token(str(first.token))]
        assert ERASE_AT_FIELD not in row


class TestTheConfirmation:
    def test_it_writes_the_birthdate_and_the_record_in_one_update(self, mongo_replica_set_url: str):
        """The consent's evidence names the wording each choice was given under, and the clock goes with the answer.

        A record citing the wrong wording proves nothing the person agreed to; a clock left standing deletes the entry
        they confirmed.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            response = await confirm(database, client, minted.token)

            return response, await stored(database)

        response, row = on_a_league(mongo_replica_set_url, body)

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
        assert (response.scope, response.media, response.confirmed_at) == ("kader_public", True, TODAY)
        assert ERASE_AT_FIELD not in row

    def test_a_second_press_is_refused(self, mongo_replica_set_url: str):
        """A second press writing would replace the publication scope the person chose first."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.token)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, scope="internal")

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_EXISTS
        assert row[EINWILLIGUNG_FIELD]["scope"] == "kader_public"

    def test_a_press_after_the_deadline_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """A lapsed link still answering takes a consent after the deadline the mail named, on an entry already due to go."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, today=AFTER_THE_DEADLINE)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.LINK_EXPIRED
        assert row.get(EINWILLIGUNG_FIELD) is None
        assert row.get("birth_date") is None

    def test_a_birthdate_under_the_floor_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        """A consent from someone under the referees' minimum age is one the league may not hold."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, birth_date=A_CHILDS_BIRTHDATE)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_AGE
        assert row.get("birth_date") is None


class TestTheDecline:
    def test_a_declined_entry_keeps_its_clock_and_is_asked_nothing_again(self, mongo_replica_set_url: str):
        """The privacy notice says a declined entry goes on the unconfirmed one's clock, and nobody mails a person who objected.

        Dropped from the clock, the entry outlives what the notice promises; asked again, the person is mailed against their
        objection. Neither shows on any page. Reopened, the link names the day of the objection, which nothing else does.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            clock = (await stored(database))[ERASE_AT_FIELD]
            await decline(database, client, minted.token)

            with pytest.raises(APIError) as asked_again:
                await resend(database, client)

            view = await read_view(database, minted.token)
            return clock, await stored(database), asked_again.value, (view.state, view.answered_at)

        clock, row, asked_again, state = on_a_league(mongo_replica_set_url, body)

        assert row[CONFIRMATION_FIELD]["declined_at"] == TODAY
        assert row[ERASE_AT_FIELD] == clock
        assert row.get(EINWILLIGUNG_FIELD) is None
        assert asked_again.error_code == Code.CONFIRMATION_EXISTS
        assert state == ("declined", TODAY)

    def test_a_declined_link_is_spent_and_takes_no_consent(self, mongo_replica_set_url: str):
        """A consent through a link its person objected through would store a birthdate and a publication scope against that objection."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await decline(database, client, minted.token)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_EXISTS
        assert row.get(EINWILLIGUNG_FIELD) is None
        assert row.get("birth_date") is None
        assert ERASE_AT_FIELD in row


CONFIRMED_OID = ObjectId("6890a1b2c3d4e5f607810002")
CONFIRMED_EMAIL = "rosetti@example.com"


class TestTheClock:
    def test_a_lapsed_entry_goes_and_a_confirmed_one_stays(self, mongo_replica_set_url: str):
        """The privacy notice gives an unconfirmed or declined entry fourteen days.

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

        early, late, left, deletions = on_a_league(
            mongo_replica_set_url,
            body,
            referees=[referee_document(), referee_document(_id=CONFIRMED_OID, name="Roberto Rosetti", email=CONFIRMED_EMAIL)],
        )

        assert early == (0, 1)
        assert late == (1, 0)
        assert deletions == [("system", None, 1, None)]
        assert {row["_id"] for row in left} >= {CONFIRMED_OID}
        assert SCHIEDSRICHTER_OID not in {row["_id"] for row in left}


# Against `TODAY`, 17 years and 364 days.
A_DAY_SHORT_OF_THE_MEDIA_AGE = "2008-04-02"


class TestTheMediaAge:
    def test_a_yes_a_day_short_of_the_media_age_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        """A yes from someone below the media age stores a media consent the league does not take from them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, birth_date=A_DAY_SHORT_OF_THE_MEDIA_AGE, media=True)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.MEDIA_AGE
        assert row.get("birth_date") is None
        assert row.get(EINWILLIGUNG_FIELD) is None
