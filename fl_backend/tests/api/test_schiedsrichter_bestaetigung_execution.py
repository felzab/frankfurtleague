import dataclasses
from collections.abc import Awaitable, Callable, Mapping
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.einwilligung import services as einwilligung_services
from app.api.schiedsrichter.admin_router import (
    delete_schiedsrichter,
    get_schiedsrichter,
    invite_schiedsrichter,
    patch_schiedsrichter,
    post_schiedsrichter,
    reactivate_schiedsrichter,
)
from app.api.schiedsrichter.public_router import get_confirmation_view, post_confirmation
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLPostSchiedsrichterPayload,
    FLSchiedsrichterConfirmationPayload,
    FLSchiedsrichterFilterParams,
)
from app.api.schiedsrichter.services import (
    BESTAETIGUNG_FELD,
    EINWILLIGUNG_FELD,
    bestaetigung_frist_from,
    compose_bestaetigung,
)
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.sentinels import GHOST_INACTIVE_SINCE, GHOST_SCHIEDSRICHTER_ID
from app.shared.einwilligung import FASSUNGEN, LAUFENDE_FASSUNGEN
from app.shared.schemas.bestaetigung import FLTokenPayload
from app.shared.schemas.bounds import MEDIEN_MIN_AGE_YEARS
from app.shared.tokens import hash_token
from tests import documents
from tests.actor_tokens import fresh_admin_actor
from tests.bans import ban_list, ban_through_the_route
from tests.config import grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.loeschung import geloescht
from tests.postausgang import MAIL_NOW, drained
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, the whole slice being one transaction each.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_schiedsrichter_bestaetigung_test")

SAISON_ID = "2026"
# The season before the running one, so a ban naming it as its last has lapsed.
LAPSED = f"{int(SAISON_ID) - 1}"
TODAY = "2026-04-01"
# One day past the deadline a link minted on `TODAY` carries, so the expiry case needs no second mint.
AFTER_THE_DEADLINE = "2026-04-16"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607810001")
SPIEL_OID = ObjectId("6890a1b2c3d4e5f607810011")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6078100a1")

NAME = "Pierluigi Collina"
SCHULE = "Carl-Schurz-Schule"
DEFAULT_PAYMENT = 20

EMAIL = "collina@example.com"
CORRECTED_EMAIL = "collina.pierluigi@example.com"
BANNED_EMAIL = "gesperrt@example.com"
# Under RFC 6761's reserved `.invalid`, which no payload stores and no mail system delivers to.
UNFOLDABLE_EMAIL = "jemand@schule.invalid"
TELEFON = "+49 69 1234567"

AN_ADULTS_BIRTHDATE = "1984-05-09"
A_CHILDS_BIRTHDATE = "2018-01-01"

# The label the referee page runs, the one a new acceptance must name.
TEXT_VERSION = LAUFENDE_FASSUNGEN["bestaetigung_schiedsrichter"]

# Seeded before every confirmation that asserts on it, so "the write reaches one collection" is a
# comparison against a document that exists rather than against an empty collection.
BOOKING: Mapping[str, Any] = {"schiedsrichter_id": SCHIEDSRICHTER_OID, "name": NAME, "payment": DEFAULT_PAYMENT}


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
        **overrides,
    }


def fixture_document() -> dict[str, Any]:
    """One played fixture this referee officiated, seeded so a fan-out onto `spiele` has somewhere to land."""

    return documents.spiel_document(
        spiel_id=SPIEL_OID,
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=SPIELTAG_OID,
        datum="2026-03-15",
        uhrzeit="14:00:00",
        schiedsrichter=dict(BOOKING),
        ergebnis="2:1",
    )


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
    """The SHIPPED validators, so a block or a record production would refuse fails here too."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # The ban re-judges its actor's grant inside its transaction.
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            await database[Collection.SAISONS].insert_one(saison_document())
            seeded = [referee_document()] if referees is None else referees
            if seeded:
                await database[Collection.SCHIEDSRICHTER].insert_many(seeded)
                await database[Collection.SPIELE].insert_one(fixture_document())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def create(database: AsyncDatabase, client: AsyncMongoClient, *, email: str | None = EMAIL, today: str = TODAY) -> Mailed:
    answer = await post_schiedsrichter(
        schiedsrichter_data=FLPostSchiedsrichterPayload.model_validate(payload_body(email=email)),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        postausgang_collection=database[Collection.POSTAUSGANG],
        sperrliste=ban_list(database),
        db=client,
        today=today,
        now=MAIL_NOW,
    )

    return await mailed(database, client, answer)


async def correct(database: AsyncDatabase, client: AsyncMongoClient, *, email: str | None, today: str = TODAY) -> Mailed:
    answer = await patch_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate(payload_body(email=email)),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        postausgang_collection=database[Collection.POSTAUSGANG],
        sperrliste=ban_list(database),
        db=client,
        today=today,
        now=MAIL_NOW,
        actor=fresh_admin_actor(),
    )

    return await mailed(database, client, answer)


async def resend(
    database: AsyncDatabase, client: AsyncMongoClient, *, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID, today: str = TODAY
) -> Mailed:
    answer = await invite_schiedsrichter(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        postausgang_collection=database[Collection.POSTAUSGANG],
        sperrliste=ban_list(database),
        db=client,
        today=today,
        now=MAIL_NOW,
    )

    return await mailed(database, client, answer)


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, email: str) -> Any:
    return await ban_through_the_route(
        database, client, email=email, grund="Wiederholte Falschangaben", von="admin@frankfurtleague.de", today=TODAY
    )


async def ansicht(database: AsyncDatabase, token: str | None, *, today: str = TODAY) -> Any:
    assert token is not None, "the write owed no link to open"

    return await get_confirmation_view(
        ansicht_data=FLTokenPayload(token=token),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        today=today,
    )


async def confirm(database: AsyncDatabase, client: AsyncMongoClient, token: str | None, *, today: str = TODAY, **overrides: Any) -> Any:
    body = {
        "token": token,
        "geburtsdatum": AN_ADULTS_BIRTHDATE,
        "umfang": "kader_oeffentlich",
        "medien": True,
        "text_version": TEXT_VERSION,
        **overrides,
    }

    return await post_confirmation(
        antwort_data=FLSchiedsrichterConfirmationPayload.model_validate(body),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        db=client,
        today=today,
        germany_now=NOW,
    )


async def stored(database: AsyncDatabase, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID) -> Mapping[str, Any]:
    found = await database[Collection.SCHIEDSRICHTER].find_one({"_id": schiedsrichter_id})
    assert found is not None, "the referee this case seeded is gone"

    return found


async def stored_fixture(database: AsyncDatabase) -> Mapping[str, Any]:
    found = await database[Collection.SPIELE].find_one({"_id": SPIEL_OID})
    assert found is not None, "the fixture this case seeded is gone"

    return found


class TestTheCreateIsTheInvitation:
    """Entering an address IS the invitation, so no second press decides whether this person is asked."""

    def test_a_create_with_an_address_answers_a_token_the_stored_hash_matches(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await create(database, client)
            row = await stored(database, response.answer.created_id)

            return response, row

        response, row = on_a_league(mongo_replica_set_url, body, referees=[])

        assert response.answer.confirmation is not None
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(response.token))]
        assert row[BESTAETIGUNG_FELD]["frist"] == response.answer.confirmation.frist == bestaetigung_frist_from(today=TODAY)

    def test_the_link_the_create_answered_opens_that_referees_entry(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await create(database, client)
            assert response.answer.confirmation is not None

            return await ansicht(database, response.token)

        view = on_a_league(mongo_replica_set_url, body, referees=[])

        assert view.state == "valid"
        assert "Pierluigi" not in view.model_dump_json()

    def test_a_banned_address_leaves_no_referee_behind(self, mongo_replica_set_url: str):
        """What the create's transaction is for: judged outside one, the row stands with a live link the caller was told had been refused."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(APIError) as refused:
                await create(database, client, email=BANNED_EMAIL)

            return refused.value, await database[Collection.SCHIEDSRICHTER].count_documents({})

        refused, rows = on_a_league(mongo_replica_set_url, body, referees=[])

        assert refused.error_code == Code.SCHIEDSRICHTER_ADRESSE_BARRED
        assert rows == 0

    def test_a_league_that_has_run_no_season_still_invites(self, mongo_replica_set_url: str):
        """A league before its first season counts no ban's seasons, so the create asks the hash alone rather than failing on the season."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].delete_many({})

            return await create(database, client)

        assert on_a_league(mongo_replica_set_url, body, referees=[]).answer.confirmation is not None

    def test_a_league_that_has_run_no_season_still_refuses_a_banned_address(self, mongo_replica_set_url: str):
        """The control: a create skipping the ban list whenever there is no season would pass the case above."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)
            await database[Collection.SAISONS].delete_many({})
            with pytest.raises(APIError) as refused:
                await create(database, client, email=BANNED_EMAIL)

            return refused.value

        assert on_a_league(mongo_replica_set_url, body, referees=[]).error_code == Code.SCHIEDSRICHTER_ADRESSE_BARRED


class TestACorrectedAddressReMintsAndRetiresTheOldLink:
    """The ruled behaviour: the old link was posted to a mailbox nobody reads, and leaving it live is a credential in the wrong inbox."""

    def test_the_old_token_dies_and_the_new_one_opens_the_entry(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            corrected = await correct(database, client, email=CORRECTED_EMAIL)

            return first, corrected, await stored(database)

        first, corrected, row = on_a_league(mongo_replica_set_url, body)

        assert corrected.answer.confirmation is not None
        assert corrected.token != first.token
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(corrected.token))]
        assert row["kontakt"]["email"] == CORRECTED_EMAIL

    def test_the_old_token_then_opens_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await correct(database, client, email=CORRECTED_EMAIL)

            with pytest.raises(APIError) as refused:
                await ansicht(database, first.token)

            return refused.value

        assert on_a_league(mongo_replica_set_url, body).error_code == Code.LINK_INVALID

    def test_a_save_leaving_the_address_alone_mints_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await resend(database, client)
            unchanged = await correct(database, client, email=EMAIL)

            return before, unchanged, await stored(database)

        before, unchanged, row = on_a_league(mongo_replica_set_url, body)

        assert unchanged.answer.confirmation is None
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(before.token))]

    def test_a_retired_referees_new_address_is_stored_and_mints_nothing(self, mongo_replica_set_url: str):
        """A retired person is asked nothing, and the save is not refused for it: every save carries an address, so a refusal locks the row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": "2026-01-01"}})
            saved = await correct(database, client, email=CORRECTED_EMAIL)

            with pytest.raises(APIError) as old_link:
                await ansicht(database, first.token)

            return saved, await stored(database), old_link.value

        saved, row, old_link = on_a_league(mongo_replica_set_url, body)

        assert saved.answer.confirmation is None
        assert row["kontakt"]["email"] == CORRECTED_EMAIL
        # The old link went to the mailbox the save moved away from, so it dies with no successor.
        assert BESTAETIGUNG_FELD not in row
        assert old_link.error_code == Code.LINK_INVALID

    def test_a_retired_referee_whose_address_does_not_move_is_saved(self, mongo_replica_set_url: str):
        """The control under the case above: nothing there refuses a retired row outright, the rename being still owed to it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": "2026-01-01"}})
            saved = await correct(database, client, email=EMAIL)

            return saved, await stored(database)

        saved, row = on_a_league(mongo_replica_set_url, body)

        assert saved.answer.confirmation is None
        assert row["inactive_since"] == "2026-01-01"

    def test_a_banned_new_address_is_refused_and_the_rename_is_rolled_back(self, mongo_replica_set_url: str):
        """The rename and the mint are one transaction, so a refused link leaves no moved address behind for the dead one to sit on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(APIError) as refused:
                await correct(database, client, email=BANNED_EMAIL)

            return refused.value, await stored(database), await stored_fixture(database)

        refused, row, fixture = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.SCHIEDSRICHTER_ADRESSE_BARRED
        assert row["kontakt"]["email"] == EMAIL
        assert fixture["schiedsrichter"] == BOOKING


class TestTheReSend:
    def test_it_writes_a_block_whose_hash_matches_the_token_it_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await resend(database, client)

            return response, await stored(database)

        response, row = on_a_league(mongo_replica_set_url, body)

        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(response.token))]
        assert row[BESTAETIGUNG_FELD]["sent_at"] == TODAY

    def test_a_second_re_send_replaces_the_block_whole(self, mongo_replica_set_url: str):

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            second = await resend(database, client)

            return first, second, await stored(database)

        first, second, row = on_a_league(mongo_replica_set_url, body)

        assert second.token != first.token
        assert second.token is not None
        assert row[BESTAETIGUNG_FELD] == {**compose_bestaetigung(today=TODAY), "token_hashes": [hash_token(second.token)]}

    def test_the_first_token_then_opens_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await resend(database, client)

            with pytest.raises(APIError) as refused:
                await ansicht(database, first.token)

            return refused.value

        assert on_a_league(mongo_replica_set_url, body).error_code == Code.LINK_INVALID

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
        """A fresh link for them can never be spent — the confirmation refuses every press of one — and minting it replaces a live block."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await confirm(database, client, first.token)

            with pytest.raises(APIError) as refused:
                await resend(database, client)

            return first, refused.value, await stored(database)

        first, refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_EXISTS
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(first.token))]

    def test_a_referee_with_no_address_is_refused_and_no_send_is_stamped(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await resend(database, client)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=None)])

        assert refused.error_code == Code.SCHIEDSRICHTER_NO_ADRESSE
        assert BESTAETIGUNG_FELD not in row

    def test_a_stored_address_no_payload_would_take_is_refused_as_none(self, mongo_replica_set_url: str):
        """The ban-list hash cannot key it, so unjudged it answers 500 rather than a refusal the panel words."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await resend(database, client)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=UNFOLDABLE_EMAIL)])

        assert refused.error_code == Code.SCHIEDSRICHTER_NO_ADRESSE
        assert BESTAETIGUNG_FELD not in row

    def test_an_address_on_the_ban_list_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(APIError) as refused:
                await resend(database, client)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=BANNED_EMAIL)])

        assert refused.error_code == Code.SCHIEDSRICHTER_ADRESSE_BARRED
        assert BESTAETIGUNG_FELD not in row

    def test_the_ghost_answers_not_found_rather_than_a_refusal(self, mongo_replica_set_url: str):
        """`build_referee_filter` decides it before any refusal this slice writes is reached."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].insert_one(
                {
                    "_id": GHOST_SCHIEDSRICHTER_ID,
                    "name": None,
                    "schule": None,
                    "default_payment": 0,
                    "kontakt": {"telefon": None, "email": None},
                    "inactive_since": GHOST_INACTIVE_SINCE,
                }
            )

            with pytest.raises(DocumentNotFoundError):
                await resend(database, client, schiedsrichter_id=GHOST_SCHIEDSRICHTER_ID)

            return None

        on_a_league(mongo_replica_set_url, body)


async def reactivate(database: AsyncDatabase, client: AsyncMongoClient) -> Mailed:
    answer = await reactivate_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        postausgang_collection=database[Collection.POSTAUSGANG],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
        now=MAIL_NOW,
        actor=fresh_admin_actor(),
    )

    return await mailed(database, client, answer)


RETIRED: Mapping[str, Any] = {"inactive_since": "2026-01-01"}


class TestTheReactivation:
    """The mint a retired referee's save withholds: bringing an unanswered referee back is what asks them."""

    def test_an_unanswered_referee_is_minted_a_link_the_stored_hash_matches(self, mongo_replica_set_url: str):
        """In ONE write: the revival and the mint are one press, so the log holds one row for it."""

        naming = {"collection": str(Collection.SCHIEDSRICHTER), "document_id": SCHIEDSRICHTER_OID}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await database[Collection.AKTIONEN].count_documents(naming)
            response = await reactivate(database, client)
            filed = await database[Collection.AKTIONEN].count_documents(naming) - before

            return response, await stored(database), filed

        response, row, filed = on_a_league(mongo_replica_set_url, body, referees=[referee_document(**RETIRED)])

        assert row["inactive_since"] is None
        assert response.answer.confirmation.email == EMAIL
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(response.token))]
        assert filed == 1

    def test_a_row_holding_no_usable_address_comes_back_unasked(self, mongo_replica_set_url: str):
        """Entering a real address is the save that mints; a link minted here would go to nobody."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await reactivate(database, client), await stored(database)

        response, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=UNFOLDABLE_EMAIL, **RETIRED)])

        assert row["inactive_since"] is None
        assert response.answer.confirmation is None
        assert BESTAETIGUNG_FELD not in row

    def test_a_referee_who_has_answered_comes_back_unasked(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await resend(database, client)
            await confirm(database, client, first.token)
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": dict(RETIRED)})

            return first, await reactivate(database, client), await stored(database)

        first, response, row = on_a_league(mongo_replica_set_url, body)

        assert response.answer.confirmation is None
        assert row[BESTAETIGUNG_FELD]["token_hashes"] == [hash_token(str(first.token))]

    def test_a_banned_address_is_refused_and_the_row_stays_retired(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=BANNED_EMAIL)

            with pytest.raises(APIError) as refused:
                await reactivate(database, client)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body, referees=[referee_document(email=BANNED_EMAIL, **RETIRED)])

        assert refused.error_code == Code.SCHIEDSRICHTER_ADRESSE_BARRED
        assert row["inactive_since"] == RETIRED["inactive_since"]
        assert BESTAETIGUNG_FELD not in row


class TestTheConfirmation:
    def test_it_writes_the_birthdate_and_the_record_in_one_update(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            response = await confirm(database, client, minted.token)

            return response, await stored(database)

        response, row = on_a_league(mongo_replica_set_url, body)

        assert row["geburtsdatum"] == AN_ADULTS_BIRTHDATE
        # Each choice evidenced by the confirmation, its instant in UTC: `NOW` is half past noon in
        # Frankfurt's summer time.
        assert row[EINWILLIGUNG_FELD] == {
            "umfang": "kader_oeffentlich",
            "datum": TODAY,
            "confirmed_at": TODAY,
            "text_version": TEXT_VERSION,
            "medien": True,
            "nachweis": {
                "umfang": {"am": "2026-04-01T10:30:00+00:00", "text_version": TEXT_VERSION},
                "medien": {"am": "2026-04-01T10:30:00+00:00", "text_version": TEXT_VERSION},
            },
        }
        assert (response.umfang, response.medien, response.confirmed_at) == ("kader_oeffentlich", True, TODAY)

    def test_a_second_press_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.token)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, umfang="intern")

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_EXISTS
        # The first answer stands: a refusal that wrote would have replaced the scope this person chose.
        assert row[EINWILLIGUNG_FELD]["umfang"] == "kader_oeffentlich"

    def test_a_press_after_the_deadline_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, today=AFTER_THE_DEADLINE)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.LINK_EXPIRED
        assert row.get(EINWILLIGUNG_FELD) is None
        assert row.get("geburtsdatum") is None

    def test_someone_who_answered_and_presses_again_after_the_deadline_is_told_their_answer_stands(self, mongo_replica_set_url: str):
        """Both refusals apply, and the stamp is asked first.

        The other order sends a person who already consented off to ask the administration for a
        fresh link, which is a repair for a state they are not in.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.token)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, today=AFTER_THE_DEADLINE)

            return refused.value

        assert on_a_league(mongo_replica_set_url, body).error_code == Code.CONFIRMATION_EXISTS

    def test_a_birthdate_under_the_floor_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, geburtsdatum=A_CHILDS_BIRTHDATE)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.CONFIRMATION_AGE
        assert row.get("geburtsdatum") is None

    def test_a_token_no_referee_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(APIError) as refused:
                await confirm(database, client, "a-token-nobody-minted")

            return refused.value

        assert on_a_league(mongo_replica_set_url, body).error_code == Code.LINK_INVALID

    def test_the_link_of_an_geloescht_referee_opens_nothing(self, mongo_replica_set_url: str):
        """The lookup finds no row rather than a nulled one: the erasure deletes the document and the block goes with it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await geloescht(database, client, EMAIL, germany_now=NOW)

            with pytest.raises(APIError) as refused:
                await ansicht(database, minted.token)

            return refused.value, await database[Collection.SCHIEDSRICHTER].count_documents({"_id": SCHIEDSRICHTER_OID})

        refused, surviving = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.LINK_INVALID
        # Read back rather than inferred from the refusal: a row nulled in place would refuse the
        # same way while still holding the birthdate and the record.
        assert surviving == 0


# An older version of the referee page, built for the case: the registry holds only the version a stored
# record can cite, and an older one is what a page loaded before a deploy names.
EARLIER_LABEL = "2026-01-schiedsrichterseite"


class TestTheLabelAPressNames:
    """`wording_not_allowed`: a referee's press names the referee page's running label and nothing else."""

    @pytest.fixture(autouse=True)
    def _an_earlier_version_of_the_page(self, monkeypatch: pytest.MonkeyPatch) -> None:
        running = FASSUNGEN[LAUFENDE_FASSUNGEN["bestaetigung_schiedsrichter"]]
        earlier = dataclasses.replace(running, applies_from=date(2026, 1, 1))
        monkeypatch.setattr(einwilligung_services, "FASSUNGEN", {**FASSUNGEN, EARLIER_LABEL: earlier})

    @pytest.mark.parametrize(
        "named",
        [
            pytest.param(EARLIER_LABEL, id="a superseded label of the referee page"),
            pytest.param(LAUFENDE_FASSUNGEN["bestaetigung_spieler"], id="the pupil page's running label"),
            pytest.param("2026-04-schiedsrichterseite", id="a label the registry never held"),
        ],
    )
    def test_any_other_label_is_refused_and_spends_nothing(self, mongo_replica_set_url: str, named: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            before = await stored(database)
            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, text_version=named)

            return refused.value, before, await stored(database), await ansicht(database, minted.token)

        refusal, before, after, view = on_a_league(mongo_replica_set_url, body)

        assert (refusal.error_code, refusal.status_code) == (Code.WORDING_NOT_ALLOWED, 409)
        assert after == before
        assert view.state == "valid"


class TestAWithheldNameReachesOneCollection:
    """The scope has one home, so there is nothing to fan out and nothing on a fixture to fall out of step."""

    def test_the_scope_is_written_on_the_referees_own_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.token, umfang="intern", medien=False)

            return await stored(database)

        row = on_a_league(mongo_replica_set_url, body)

        assert row[EINWILLIGUNG_FELD]["umfang"] == "intern"
        assert row[EINWILLIGUNG_FELD]["medien"] is False

    def test_the_fixture_they_officiated_is_byte_identical_afterwards(self, mongo_replica_set_url: str):
        """Seeded BEFORE the confirmation, or the comparison would be over a fixture the case created after it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored_fixture(database)
            minted = await resend(database, client)
            await confirm(database, client, minted.token, umfang="intern", medien=False)

            return before, await stored_fixture(database)

        before, after = on_a_league(mongo_replica_set_url, body)

        assert after == before
        assert after["schiedsrichter"] == BOOKING


# Against `TODAY`, 18 to the day and 17 years and 364 days.
AT_THE_MEDIA_AGE = "2008-04-01"
A_DAY_SHORT_OF_THE_MEDIA_AGE = "2008-04-02"


class TestTheMediaAge:
    """`medien_age` at the endpoint: the refusal is wired in, and judged before the write."""

    def test_the_view_serves_the_age_the_page_offers_the_switch_from(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            return await ansicht(database, minted.token)

        assert on_a_league(mongo_replica_set_url, body).medien_minimum_age == MEDIEN_MIN_AGE_YEARS

    def test_a_yes_a_day_short_of_the_media_age_is_refused_before_anything_is_written(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, geburtsdatum=A_DAY_SHORT_OF_THE_MEDIA_AGE, medien=True)

            return refused.value, await stored(database)

        refused, row = on_a_league(mongo_replica_set_url, body)

        assert refused.error_code == Code.MEDIEN_AGE
        assert row.get("geburtsdatum") is None
        assert row.get(EINWILLIGUNG_FELD) is None

    def test_a_yes_at_the_media_age_to_the_day_is_stored(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the case above passes for a refusal of every yes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.token, geburtsdatum=AT_THE_MEDIA_AGE, medien=True)

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body)[EINWILLIGUNG_FELD]["medien"] is True

    def test_a_no_a_day_short_of_the_media_age_is_stored(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.token, geburtsdatum=A_DAY_SHORT_OF_THE_MEDIA_AGE, medien=False)

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body)[EINWILLIGUNG_FELD]["medien"] is False


class TestALinkToABarredAddress:
    """`link_barred`: a ban reaches a link already in somebody's inbox, entered here through its own route after the mint."""

    def test_the_press_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
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

    def test_a_ban_on_another_address_leaves_the_link_answering(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the case above passes for a check refusing every press."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await ban(database, client, email=BANNED_EMAIL)
            await confirm(database, client, minted.token)

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body)[EINWILLIGUNG_FELD]["confirmed_at"] == TODAY

    def test_the_link_answers_again_once_the_ban_is_lifted(self, mongo_replica_set_url: str):
        """Nothing of the ban is written on the entry, so lifting it is all a mistaken ban needs undone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await ban(database, client, email=EMAIL)
            with pytest.raises(APIError):
                await confirm(database, client, minted.token)
            await database[Collection.SPERRLISTE].delete_many({})
            await confirm(database, client, minted.token)

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body)[EINWILLIGUNG_FELD]["confirmed_at"] == TODAY

    def test_a_ban_past_its_last_season_bars_nothing(self, mongo_replica_set_url: str):
        """The running season is what the bound is read against: asked without it, the lapsed row would still bar.

        Seeded by hand, the route entering a standing ban alone; the cases above are its control.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document(EMAIL, bis=LAPSED))
            await confirm(database, client, minted.token)

            return await stored(database)

        assert on_a_league(mongo_replica_set_url, body)[EINWILLIGUNG_FELD]["confirmed_at"] == TODAY

    def test_an_entry_confirmed_before_the_ban_answers_the_stamp_rather_than_the_ban(self, mongo_replica_set_url: str):
        """The order: the answer given before the ban stands until an administrator acts, so a second press is refused as confirmed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await confirm(database, client, minted.token)
            await ban(database, client, email=EMAIL)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token)

            return refused.value

        assert on_a_league(mongo_replica_set_url, body).error_code == Code.CONFIRMATION_EXISTS

    def test_a_barred_press_carrying_a_refused_date_answers_the_ban_rather_than_the_age(self, mongo_replica_set_url: str):
        """The other half of the order: a corrected date buys a barred address nothing, so it is not what the referee is asked for."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await resend(database, client)
            await ban(database, client, email=EMAIL)

            with pytest.raises(APIError) as refused:
                await confirm(database, client, minted.token, geburtsdatum=A_CHILDS_BIRTHDATE)

            return refused.value

        assert on_a_league(mongo_replica_set_url, body).error_code == Code.LINK_BARRED


class TestTheViewOfALinkToABarredAddress:
    """The page reads the ban off the view, so it never offers a barred referee the form."""

    def test_the_view_answers_gesperrt(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            minted = await resend(database, client)
            await ban(database, client, email=EMAIL)

            return (await ansicht(database, minted.token)).state

        assert on_a_league(mongo_replica_set_url, body) == "barred"

    def test_a_ban_on_another_address_leaves_the_view_open(self, mongo_replica_set_url: str):
        """The other half of the pair: without it the case above passes for a view answering `barred` to everyone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            minted = await resend(database, client)
            await ban(database, client, email=BANNED_EMAIL)

            return (await ansicht(database, minted.token)).state

        assert on_a_league(mongo_replica_set_url, body) == "valid"

    def test_the_view_opens_again_once_the_ban_is_lifted(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, str]:
            minted = await resend(database, client)
            await ban(database, client, email=EMAIL)
            barred = (await ansicht(database, minted.token)).state
            await database[Collection.SPERRLISTE].delete_many({})

            return barred, (await ansicht(database, minted.token)).state

        assert on_a_league(mongo_replica_set_url, body) == ("barred", "valid")

    def test_a_ban_past_its_last_season_leaves_the_view_open(self, mongo_replica_set_url: str):
        """Read against the running season as the press reads it: asked without it, the lapsed row would bar the view alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            minted = await resend(database, client)
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document(EMAIL, bis=LAPSED))

            return (await ansicht(database, minted.token)).state

        assert on_a_league(mongo_replica_set_url, body) == "valid"

    def test_an_entry_confirmed_before_the_ban_reopens_on_the_ban(self, mongo_replica_set_url: str):
        """The ban outranks the stamp here, where the press ranks it below: the page shows a barred referee nothing else."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> str:
            minted = await resend(database, client)
            await confirm(database, client, minted.token)
            await ban(database, client, email=EMAIL)

            return (await ansicht(database, minted.token)).state

        assert on_a_league(mongo_replica_set_url, body) == "barred"
