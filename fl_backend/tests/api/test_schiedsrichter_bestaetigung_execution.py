"""
API · a referee's link, from the writes that mint it to the person's answer through it

Each case is one whose failure no page shows: a link left live in a mailbox the entry no longer names, a person mailed
who was not to be asked, an answer stored against the rules it is judged by, or an entry outliving the fourteen days
the privacy notice gives it. Served against the shipped indexes, every write one transaction.
"""

import dataclasses
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.schiedsrichter.admin_router import (
    delete_schiedsrichter,
    get_schiedsrichter,
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
    FLSchiedsrichterFilterParams,
)
from app.api.schiedsrichter.services import (
    BESTAETIGUNG_FELD,
    EINWILLIGUNG_FELD,
    ERASE_AT_FIELD,
    bestaetigung_frist_from,
    compose_bestaetigung,
    erase_at_from,
)
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.tokens import hash_token
from tests import documents
from tests.bans import ban_list, ban_through_the_route
from tests.config import grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.outbox import MAIL_NOW, drained
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, the whole slice being one transaction each.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_schiedsrichter_bestaetigung_test")

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
BANNED_EMAIL = "gesperrt@example.com"
TELEFON = "+49 69 1234567"

AN_ADULTS_BIRTHDATE = "1984-05-09"
A_CHILDS_BIRTHDATE = "2018-01-01"

# The labels the referee page names beside its two choices.
TEXT_VERSIONS = documents.SCHIEDSRICHTER_TEXT_VERSIONS


def saison_document() -> dict[str, Any]:
    """The RUNNING season. Every mint reads it, the ban list being judged against the season in progress."""

    return documents.saison_document(SAISON_ID, "active")


def referee_document(*, email: str | None = EMAIL, **overrides: Any) -> dict[str, Any]:
    """A referee entered before this flow: no link, no record, no birthdate."""

    return {
        "_id": SCHIEDSRICHTER_OID,
        "name": NAME,
        "schule": SCHULE,
        "default_payment": DEFAULT_PAYMENT,
        "kontakt": {"telefon": TELEFON, "email": email},
        "inactive_since": None,
        "version": 0,
        **overrides,
    }


def payload_body(*, email: str | None = EMAIL) -> dict[str, Any]:
    return {"name": NAME, "schule": SCHULE, "default_payment": DEFAULT_PAYMENT, "kontakt": {"telefon": TELEFON, "email": email}}


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
            # The ban re-judges its actor's grant inside its transaction.
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())
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
        ban_list=ban_list(database),
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
        ban_list=ban_list(database),
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
        ban_list=ban_list(database),
        db=client,
        today=today,
        now=MAIL_NOW,
    )

    return await mailed(database, client, answer)


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, email: str) -> Any:
    return await ban_through_the_route(
        database, client, email=email, grund="Wiederholte Falschangaben", by="admin@frankfurtleague.de", today=TODAY
    )


async def read_view(database: AsyncDatabase, token: str | None, *, today: str = TODAY) -> Any:
    assert token is not None, "the write owed no link to open"

    return await get_confirmation_view(
        view_data=FLTokenPayload(token=token),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        ban_list=ban_list(database),
        today=today,
    )


async def confirm(database: AsyncDatabase, client: AsyncMongoClient, token: str | None, *, today: str = TODAY, **overrides: Any) -> Any:
    body = {
        "token": token,
        "geburtsdatum": AN_ADULTS_BIRTHDATE,
        "scope": "kader_oeffentlich",
        "media": True,
        "text_versions": dict(TEXT_VERSIONS),
        **overrides,
    }

    return await post_confirmation(
        antwort_data=FLSchiedsrichterConfirmationPayload.model_validate(body),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        ban_list=ban_list(database),
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
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(response.token))]
        assert row[BESTAETIGUNG_FELD]["frist"] == response.answer.confirmation.frist == bestaetigung_frist_from(today=TODAY)
        # The clock the TTL index reads: absent, the unanswered entry outlives the fourteen days the notice promises.
        assert row[ERASE_AT_FIELD].replace(tzinfo=UTC) == erase_at_from(frist=bestaetigung_frist_from(today=TODAY))

    def test_a_banned_address_leaves_no_referee_behind(self, mongo_replica_set_url: str):
        """What the create's transaction is for: judged outside one, the row stands with a live link the caller was told had been refused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(APIError) as refused:
                await create(database, client, email=BANNED_EMAIL)

            return refused.value, await database[Collection.SCHIEDSRICHTER].count_documents({})

        refused, rows = on_a_league(mongo_replica_set_url, body, referees=[])

        assert refused.error_code == Code.SCHIEDSRICHTER_ADDRESS_BARRED
        assert rows == 0

    def test_a_league_that_has_run_no_season_still_refuses_a_banned_address(self, mongo_replica_set_url: str):
        """The control: a create skipping the ban list whenever there is no season would pass the case above."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)
            await database[Collection.SAISONS].delete_many({})
            with pytest.raises(APIError) as refused:
                await create(database, client, email=BANNED_EMAIL)

            return refused.value

        assert on_a_league(mongo_replica_set_url, body, referees=[]).error_code == Code.SCHIEDSRICHTER_ADDRESS_BARRED


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
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(corrected.token))]
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
        assert BESTAETIGUNG_FELD not in row
        assert old_link.error_code == Code.LINK_INVALID
        assert row[ERASE_AT_FIELD] == clock

    def test_a_banned_new_address_is_refused_and_the_rename_is_rolled_back(self, mongo_replica_set_url: str):
        """The rename and the mint are one transaction, so a refused link leaves no moved address behind for the dead one to sit on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(APIError) as refused:
                await correct(database, client, email=BANNED_EMAIL)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.SCHIEDSRICHTER_ADDRESS_BARRED
        assert row["kontakt"]["email"] == EMAIL


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
        assert row[BESTAETIGUNG_FELD] == {**compose_bestaetigung(today=TODAY), "token_hashes": [hash_token(second.token)]}
        assert first_link.error_code == Code.LINK_INVALID

    def test_the_admin_list_serves_no_hash_for_a_referee_who_holds_one(self, mongo_replica_set_url: str):
        """Over a row that HOLDS a hash: on a row with no block the same assertion passes over an empty carrier."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await resend(database, client)
            assert (await stored(database))[BESTAETIGUNG_FELD]["token_hashes"]

            return await get_schiedsrichter(
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER], filters=FLSchiedsrichterFilterParams()
            )

        listed = on_a_league(mongo_replica_set_url, body)

        assert "token_hash" not in listed.model_dump_json()

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
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(response.token))]

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
        assert BESTAETIGUNG_FELD not in row

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
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(first.token))]
        assert ERASE_AT_FIELD not in row

    def test_an_address_on_the_ban_list_is_refused(self, mongo_replica_set_url: str):
        """A banned address mailed a link is the person the ban exists to keep out."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(APIError) as refused:
                await resend(database, client)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=BANNED_EMAIL)])

        assert refused.error_code == Code.SCHIEDSRICHTER_ADDRESS_BARRED
        assert BESTAETIGUNG_FELD not in row


async def reactivate(database: AsyncDatabase, client: AsyncMongoClient) -> Mailed:
    answer = await reactivate_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        outbox_collection=database[Collection.OUTBOX],
        ban_list=ban_list(database),
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
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(response.token))]
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
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(first.token))]
        assert ERASE_AT_FIELD not in row

    def test_a_banned_address_is_refused_and_the_row_stays_retired(self, mongo_replica_set_url: str):
        """A banned address mailed a link is the person the ban exists to keep out, and the row stays as it stood."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(APIError) as refused:
                await reactivate(database, client)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=BANNED_EMAIL, **RETIRED)])

        assert refused.error_code == Code.SCHIEDSRICHTER_ADDRESS_BARRED
        assert row["inactive_since"] == RETIRED["inactive_since"]
        assert BESTAETIGUNG_FELD not in row


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

        assert row["geburtsdatum"] == AN_ADULTS_BIRTHDATE
        # Each choice evidenced by the confirmation, its instant in UTC: `NOW` is half past noon in
        # Frankfurt's summer time.
        assert row[EINWILLIGUNG_FELD] == {
            "scope": "kader_oeffentlich",
            "date": TODAY,
            "confirmed_at": TODAY,
            "media": True,
            "evidence": {
                "scope": {"at": "2026-04-01T10:30:00+00:00", "text_version": TEXT_VERSIONS["scope"]},
                "media": {"at": "2026-04-01T10:30:00+00:00", "text_version": TEXT_VERSIONS["media"]},
            },
        }
        assert (response.scope, response.media, response.confirmed_at) == ("kader_oeffentlich", True, TODAY)
        assert ERASE_AT_FIELD not in row

    def test_a_second_press_is_refused(self, mongo_replica_set_url: str):
        """A second press writing would replace the publication scope the person chose first."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.token)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, scope="intern")

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_EXISTS
        assert row[EINWILLIGUNG_FELD]["scope"] == "kader_oeffentlich"

    def test_a_press_after_the_deadline_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """A lapsed link still answering takes a consent after the deadline the mail named, on an entry already due to go."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, today=AFTER_THE_DEADLINE)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.LINK_EXPIRED
        assert row.get(EINWILLIGUNG_FELD) is None
        assert row.get("geburtsdatum") is None

    def test_a_birthdate_under_the_floor_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        """A consent from someone under the referees' minimum age is one the league may not hold."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, geburtsdatum=A_CHILDS_BIRTHDATE)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_AGE
        assert row.get("geburtsdatum") is None


class TestTheDecline:
    def test_a_declined_entry_keeps_its_clock_and_is_asked_nothing_again(self, mongo_replica_set_url: str):
        """The privacy notice says a declined entry goes on the unconfirmed one's clock, and nobody mails a person who objected.

        Dropped from the clock, the entry outlives what the notice promises; asked again, the person is mailed against their
        objection. Neither shows on any page.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            clock = (await stored(database))[ERASE_AT_FIELD]
            await decline(database, client, minted.token)

            with pytest.raises(APIError) as asked_again:
                await resend(database, client)

            return clock, await stored(database), asked_again.value, (await read_view(database, minted.token)).state

        clock, row, asked_again, state = on_a_league(mongo_replica_set_url, body)

        assert row[BESTAETIGUNG_FELD]["declined_at"] == TODAY
        assert row[ERASE_AT_FIELD] == clock
        assert row.get(EINWILLIGUNG_FELD) is None
        assert asked_again.error_code == Code.CONFIRMATION_EXISTS
        assert state == "declined"

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
        assert row.get(EINWILLIGUNG_FELD) is None
        assert row.get("geburtsdatum") is None
        assert ERASE_AT_FIELD in row


# Against `TODAY`, 17 years and 364 days.
A_DAY_SHORT_OF_THE_MEDIA_AGE = "2008-04-02"


class TestTheMediaAge:
    def test_a_yes_a_day_short_of_the_media_age_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        """A yes from someone below the media age stores a media consent the league does not take from them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, geburtsdatum=A_DAY_SHORT_OF_THE_MEDIA_AGE, media=True)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.MEDIA_AGE
        assert row.get("geburtsdatum") is None
        assert row.get(EINWILLIGUNG_FELD) is None


class TestALinkToABarredAddress:
    """`link_barred`: a ban reaches a link already in somebody's inbox, entered here through its own route after the mint."""

    def test_the_press_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        """A link minted before the ban still answering lets the banned person into the league."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await ban(database, client, email=EMAIL)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert (refused.error_code, refused.status_code) == (Code.LINK_BARRED, 403)
        assert row.get(EINWILLIGUNG_FELD) is None
        assert row.get("geburtsdatum") is None
