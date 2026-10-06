"""
API · a confirmed referee's address change, driven end to end against the shipped validators

A confirmed referee's moved address waits in its own block until the new mailbox confirms it, the
stored address keeping the record and the sign-in meanwhile. The decisions underneath are
`tests/api/test_schiedsrichter_adresswechsel_refusal.py`'s.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.router import get_anmeldung
from app.api.identitaet.schemas import FLSubjektPayload
from app.api.schiedsrichter.admin_router import (
    anonymise_schiedsrichter,
    delete_adresswechsel,
    einladen_adresswechsel,
    einladen_schiedsrichter,
    patch_schiedsrichter,
)
from app.api.schiedsrichter.adresswechsel_router import get_adresswechsel_ansicht, post_adresswechsel
from app.api.schiedsrichter.bestaetigung_router import post_bestaetigung
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLSchiedsrichterAdresswechselAnsichtPayload,
    FLSchiedsrichterAdresswechselPayload,
    FLSchiedsrichterBestaetigungPayload,
)
from app.api.schiedsrichter.services import (
    ADRESSWECHSEL_FELD,
    BESTAETIGUNG_FELD,
    EINWILLIGUNG_FELD,
    SCHIEDSRICHTER_ADRESSE_GESPERRT,
    SCHIEDSRICHTER_BESTAETIGUNG_GESPERRT,
    SCHIEDSRICHTER_ERSETZTE_ADRESSE_GESPERRT,
    SCHIEDSRICHTER_TOKEN_EXPIRED,
    SCHIEDSRICHTER_TOKEN_UNKNOWN,
    bestaetigung_frist_from,
)
from app.api.zustellung.router import angenommen_zustellung
from app.api.zustellung.schemas import FLZustellungAngenommenPayload
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from tests import documents
from tests.actor_tokens import FRESH_STEP_UP_CHECK, SignedActor
from tests.app_client import app_client
from tests.bans import ban_list, ban_through_the_route
from tests.config import ADMIN_KEY, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.records import record_collections
from tests.whole_database import where_held
from tests.worker import worker_database

from .conftest import config_for

# Module level: every case below reaches a real mongod, each write being one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_schiedsrichter_adresswechsel_test")
CONFIG = config_for(DATABASE_NAME)

SAISON_ID = "2026"
TODAY = "2026-04-01"
A_LATER_DAY = "2026-04-05"
# One day past the deadline a link minted on `TODAY` carries.
AFTER_THE_DEADLINE = "2026-04-16"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607830001")

NAME = "Ortwin Pfeiffenberger"
EMAIL = "ortwin.pfeiffenberger@example.com"
NEW_EMAIL = "o.pfeiffenberger@neuepost.example.org"
THIRD_EMAIL = "pfeiffenberger.ortwin@drittpost.example.net"
TELEFON = "+49 69 5550303"

MESSAGE_ID = "1b6f7a52-29c1-4f0e-9b7a-6d1c2e3f4a5b"
ACCEPTED_AT = "2026-04-01T10:00:00.000000+00:00"
A_BOUNCE: Mapping[str, Any] = {"nachricht_id": "m-1", "stand": "unzustellbar", "grund": "NoEmail", "am": ACCEPTED_AT}

KONTO_PATH = f"/api/v{API_VERSION}/konto/einwilligungen"


def referee_document(**overrides: Any) -> dict[str, Any]:
    """A referee as the administrator entered them, before their own answer."""

    return {
        "_id": SCHIEDSRICHTER_OID,
        "name": NAME,
        "schule": "Bettina-Schule",
        "default_payment": 20,
        "kontakt": {"telefon": TELEFON, "email": EMAIL},
        "inactive_since": None,
        **overrides,
    }


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, confirmed: bool = True) -> Any:
    """The SHIPPED validators, a running season, and one referee who answered their own link unless `confirmed` says otherwise."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # The ban re-judges its actor's grant inside its transaction (`docs/backend/spec.md :: I450`).
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.SCHIEDSRICHTER].insert_one(referee_document())
            minted = await resend_consent_link(database, client)
            if confirmed:
                await confirm_consent(database, client, minted.bestaetigung.token)

            return await body(database, client)

    return on_the_seed_loop(_run())


async def resend_consent_link(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await einladen_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
    )


async def confirm_consent(database: AsyncDatabase, client: AsyncMongoClient, token: str) -> Any:
    return await post_bestaetigung(
        antwort_data=FLSchiedsrichterBestaetigungPayload.model_validate(
            {
                "token": token,
                "geburtsdatum": "1984-05-09",
                "umfang": "kader_oeffentlich",
                "medien": True,
                "text_version": LAUFENDE_FASSUNGEN["bestaetigung_schiedsrichter"],
            }
        ),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def save(database: AsyncDatabase, client: AsyncMongoClient, *, email: str, today: str = TODAY) -> Any:
    return await patch_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate(
            {"name": NAME, "schule": "Bettina-Schule", "default_payment": 25, "kontakt": {"telefon": TELEFON, "email": email}}
        ),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        sperrliste=ban_list(database),
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=today,
        germany_now=NOW,
        refuse_unconfirmed=FRESH_STEP_UP_CHECK,
    )


async def resend(
    database: AsyncDatabase, client: AsyncMongoClient, *, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID, today: str = TODAY
) -> Any:
    return await einladen_adresswechsel(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        db=client,
        today=today,
    )


async def discard(database: AsyncDatabase, client: AsyncMongoClient, *, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID) -> Any:
    return await delete_adresswechsel(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        germany_now=NOW,
    )


async def view(database: AsyncDatabase, token: str, *, today: str = TODAY) -> Any:
    return await get_adresswechsel_ansicht(
        ansicht_data=FLSchiedsrichterAdresswechselAnsichtPayload(token=token),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        today=today,
    )


async def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, antwort: str, *, today: str = TODAY) -> Any:
    return await post_adresswechsel(
        antwort_data=FLSchiedsrichterAdresswechselPayload.model_validate({"token": token, "antwort": antwort}),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=today,
        germany_now=NOW,
    )


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, email: str) -> Any:
    return await ban_through_the_route(database, client, email=email, grund="Falschangaben", von="admin@frankfurtleague.de", today=TODAY)


async def holds_an_account_record(database: AsyncDatabase, email: str) -> bool:
    """The sign-in gate's own answer: whether this mailbox holds a record the account page serves."""

    answered = await get_anmeldung(
        anmeldung_data=FLSubjektPayload(email=email),
        records=record_collections(database),
        sperrliste=ban_list(database),
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
    )

    return answered.konto


async def stored(database: AsyncDatabase) -> Mapping[str, Any]:
    found = await database[Collection.SCHIEDSRICHTER].find_one({"_id": SCHIEDSRICHTER_OID})
    assert found is not None, "the referee this case seeded is gone"

    return found


async def refused_code(call: Awaitable[Any]) -> str:
    with pytest.raises(WriteRefusalException) as refused:
        await call

    return refused.value.error_code


class TestTheSaveOnAConfirmedReferee:
    def test_it_holds_the_new_address_apart_and_answers_its_link_with_both_addresses(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await save(database, client, email=NEW_EMAIL), await stored(database)

        saved, row = on_a_league(mongo_replica_set_url, body)

        assert saved.bestaetigung is None
        assert saved.adresswechsel is not None
        assert (saved.adresswechsel.email, saved.adresswechsel.bisherige_email) == (NEW_EMAIL, EMAIL)
        assert saved.adresswechsel.frist == bestaetigung_frist_from(today=TODAY)
        assert row[ADRESSWECHSEL_FELD]["token_hash"] == hash_token(saved.adresswechsel.token)
        assert row[ADRESSWECHSEL_FELD]["email"] == NEW_EMAIL
        # The stored address stays in force, and the rest of the save lands now.
        assert row["kontakt"]["email"] == EMAIL
        assert row["default_payment"] == 25

    def test_the_editor_reads_the_pending_change_and_no_hash(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await save(database, client, email=NEW_EMAIL)

        served = on_a_league(mongo_replica_set_url, body).updated_document.adresswechsel

        assert served is not None
        assert (served.email, served.verschickt_am, served.zustellung) == (NEW_EMAIL, TODAY, None)
        assert "token_hash" not in served.model_dump()

    def test_a_retired_referee_s_moved_address_waits_too(self, mongo_replica_set_url: str):
        """Their record is still theirs on the account page, so the new mailbox proves itself as a serving referee's does."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": "2026-03-01"}})
            return await save(database, client, email=NEW_EMAIL), await stored(database)

        saved, row = on_a_league(mongo_replica_set_url, body)

        assert saved.adresswechsel is not None
        assert row["kontakt"]["email"] == EMAIL

    def test_a_save_leaving_the_address_alone_leaves_the_pending_change_standing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await save(database, client, email=NEW_EMAIL)
            again = await save(database, client, email=EMAIL)

            return first, again, await stored(database)

        first, again, row = on_a_league(mongo_replica_set_url, body)

        assert again.adresswechsel is None
        assert row[ADRESSWECHSEL_FELD]["token_hash"] == hash_token(first.adresswechsel.token)

    def test_a_third_address_replaces_the_pending_change_and_kills_its_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await save(database, client, email=NEW_EMAIL)
            third = await save(database, client, email=THIRD_EMAIL)

            return third, await stored(database), await refused_code(view(database, first.adresswechsel.token))

        third, row, old_link = on_a_league(mongo_replica_set_url, body)

        assert row[ADRESSWECHSEL_FELD]["email"] == THIRD_EMAIL
        assert row[ADRESSWECHSEL_FELD]["token_hash"] == hash_token(third.adresswechsel.token)
        assert old_link == SCHIEDSRICHTER_TOKEN_UNKNOWN

    def test_the_whole_database_holds_the_replaced_address_nowhere_afterwards(self, mongo_replica_set_url: str):
        """The first save, its re-send and the replacing save each file an image carrying the replaced address."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save(database, client, email=NEW_EMAIL)
            await resend(database, client)
            await save(database, client, email=THIRD_EMAIL)

            return await every_collection_as_text(database)

        whole = on_a_league(mongo_replica_set_url, body)

        assert NEW_EMAIL not in whole
        assert THIRD_EMAIL in whole, "the scan read nothing the replacing save wrote"

    def test_a_barred_new_address_is_refused_and_nothing_of_the_save_lands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(save(database, client, email=NEW_EMAIL)), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_ADRESSE_GESPERRT
        assert ADRESSWECHSEL_FELD not in row
        assert row["default_payment"] == 20


class TestAnUnconfirmedReferee:
    """The control on the class above: an unanswered referee's address is still replaced at once and mailed a fresh consent link."""

    def test_the_address_moves_at_once_and_a_fresh_consent_link_is_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await save(database, client, email=NEW_EMAIL), await stored(database)

        saved, row = on_a_league(mongo_replica_set_url, body, confirmed=False)

        assert saved.adresswechsel is None
        assert saved.bestaetigung is not None
        assert row["kontakt"]["email"] == NEW_EMAIL
        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(saved.bestaetigung.token)
        assert ADRESSWECHSEL_FELD not in row


class TestWhoTheNewMailboxIsMeanwhile:
    """Until it confirms, the new mailbox holds nothing: no read keys on the pending address."""

    def test_the_gate_and_the_account_read_see_the_record_at_the_old_address_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save(database, client, email=NEW_EMAIL)

            async with app_client(mongo_replica_set_url, config=CONFIG, now=NOW) as http:
                served = {
                    email: [
                        record["schiedsrichter_id"]
                        for record in (await http.get(KONTO_PATH, headers=SignedActor(email, ADMIN_KEY, lane="person"))).json()[
                            "schiedsrichter"
                        ]
                    ]
                    for email in (EMAIL, NEW_EMAIL)
                }

            return {email: await holds_an_account_record(database, email) for email in (EMAIL, NEW_EMAIL)}, served

        gate, served = on_a_league(mongo_replica_set_url, body)

        assert gate == {EMAIL: True, NEW_EMAIL: False}
        assert served == {EMAIL: [str(SCHIEDSRICHTER_OID)], NEW_EMAIL: []}


class TestTheConfirmation:
    def test_it_moves_the_address_ends_the_change_and_leaves_the_consent_byte_for_byte(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored(database)
            saved = await save(database, client, email=NEW_EMAIL)
            answered = await answer(database, client, saved.adresswechsel.token, "bestaetigt")

            return before, answered, await stored(database)

        before, answered, row = on_a_league(mongo_replica_set_url, body)

        assert answered.antwort == "bestaetigt"
        assert row["kontakt"]["email"] == NEW_EMAIL
        assert ADRESSWECHSEL_FELD not in row
        assert row[EINWILLIGUNG_FELD] == before[EINWILLIGUNG_FELD]
        assert row[BESTAETIGUNG_FELD] == before[BESTAETIGUNG_FELD]

    def test_it_drops_the_consent_link_s_delivery_state_with_the_address_it_described(self, mongo_replica_set_url: str):
        """A bounce of the consent link's message is about the replaced address, so it must not stand beside the new one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one(
                {"_id": SCHIEDSRICHTER_OID}, {"$set": {f"{BESTAETIGUNG_FELD}.zustellung": dict(A_BOUNCE)}}
            )
            before = await stored(database)
            saved = await save(database, client, email=NEW_EMAIL)
            await answer(database, client, saved.adresswechsel.token, "bestaetigt")

            return before, await stored(database)

        before, row = on_a_league(mongo_replica_set_url, body)

        assert row[BESTAETIGUNG_FELD] == {key: value for key, value in before[BESTAETIGUNG_FELD].items() if key != "zustellung"}

    def test_the_record_then_belongs_to_the_new_mailbox_and_no_longer_to_the_old(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            await answer(database, client, saved.adresswechsel.token, "bestaetigt")

            return {email: await holds_an_account_record(database, email) for email in (EMAIL, NEW_EMAIL)}

        assert on_a_league(mongo_replica_set_url, body) == {EMAIL: False, NEW_EMAIL: True}

    def test_a_reopened_link_opens_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            await answer(database, client, saved.adresswechsel.token, "bestaetigt")

            return await refused_code(view(database, saved.adresswechsel.token)), await refused_code(
                answer(database, client, saved.adresswechsel.token, "bestaetigt")
            )

        assert on_a_league(mongo_replica_set_url, body) == (SCHIEDSRICHTER_TOKEN_UNKNOWN, SCHIEDSRICHTER_TOKEN_UNKNOWN)

    def test_a_confirmation_past_the_deadline_is_refused_and_moves_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            code = await refused_code(answer(database, client, saved.adresswechsel.token, "bestaetigt", today=AFTER_THE_DEADLINE))

            return code, await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_TOKEN_EXPIRED
        assert row["kontakt"]["email"] == EMAIL
        assert row[ADRESSWECHSEL_FELD]["email"] == NEW_EMAIL

    def test_a_confirmation_to_an_address_barred_since_the_save_is_refused_and_moves_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(answer(database, client, saved.adresswechsel.token, "bestaetigt")), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_BESTAETIGUNG_GESPERRT
        assert row["kontakt"]["email"] == EMAIL


class TestAChangeReplacingABarredAddress:
    """`REQ-SCHIEDSRICHTER-010`: a ban entered on the address on file while a change is pending stops the change's confirmation."""

    def test_the_view_answers_it_as_not_confirmable(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            await ban(database, client, email=EMAIL)

            return await view(database, saved.adresswechsel.token)

        seen = on_a_league(mongo_replica_set_url, body)

        assert (seen.zustand, seen.vorname) == ("nicht_bestaetigbar", "Ortwin")

    def test_the_confirmation_is_refused_and_moves_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            await ban(database, client, email=EMAIL)

            return await refused_code(answer(database, client, saved.adresswechsel.token, "bestaetigt")), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_ERSETZTE_ADRESSE_GESPERRT
        assert row["kontakt"]["email"] == EMAIL
        assert row[ADRESSWECHSEL_FELD]["email"] == NEW_EMAIL

    def test_the_decline_still_removes_the_change(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            await ban(database, client, email=EMAIL)
            await answer(database, client, saved.adresswechsel.token, "abgelehnt")

            return await stored(database)

        assert ADRESSWECHSEL_FELD not in on_a_league(mongo_replica_set_url, body)

    def test_a_ban_on_both_addresses_answers_the_link_s_own(self, mongo_replica_set_url: str):
        """Where both are barred, the link's holder is the barred person, so `-009` and `gesperrt` are true of them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            await ban(database, client, email=EMAIL)
            await ban(database, client, email=NEW_EMAIL)
            token = saved.adresswechsel.token

            return (await view(database, token)).zustand, await refused_code(answer(database, client, token, "bestaetigt"))

        assert on_a_league(mongo_replica_set_url, body) == ("gesperrt", SCHIEDSRICHTER_BESTAETIGUNG_GESPERRT)


class TestTheDecline:
    def test_it_removes_the_change_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            before = await stored(database)
            await answer(database, client, saved.adresswechsel.token, "abgelehnt")

            return before, await stored(database)

        before, row = on_a_league(mongo_replica_set_url, body)

        assert row == {key: value for key, value in before.items() if key != ADRESSWECHSEL_FELD}

    @pytest.mark.parametrize("late_or_barred", ["late", "barred"])
    def test_a_lapsed_or_barred_link_still_takes_it(self, mongo_replica_set_url: str, late_or_barred: str):
        """A decline removes an address nobody proved, which neither the deadline nor a ban has a reason to keep."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            if late_or_barred == "barred":
                await ban(database, client, email=NEW_EMAIL)
            today = AFTER_THE_DEADLINE if late_or_barred == "late" else TODAY
            await answer(database, client, saved.adresswechsel.token, "abgelehnt", today=today)

            return await stored(database)

        row = on_a_league(mongo_replica_set_url, body)

        assert ADRESSWECHSEL_FELD not in row
        assert row["kontakt"]["email"] == EMAIL

    def test_the_whole_database_holds_the_disowned_address_nowhere_afterwards(self, mongo_replica_set_url: str):
        """The re-send and the decline each file an image carrying the address, which the decline's redaction reaches."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save(database, client, email=NEW_EMAIL)
            resent = await resend(database, client)
            await answer(database, client, resent.adresswechsel.token, "abgelehnt")

            return await every_collection_as_text(database)

        assert NEW_EMAIL not in on_a_league(mongo_replica_set_url, body)


class TestTheView:
    def test_it_answers_the_first_name_the_state_and_the_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)

            return await view(database, saved.adresswechsel.token)

        seen = on_a_league(mongo_replica_set_url, body)

        assert (seen.zustand, seen.vorname, seen.frist) == ("gueltig", "Ortwin", bestaetigung_frist_from(today=TODAY))

    def test_a_lapsed_link_is_served_as_lapsed(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)

            return await view(database, saved.adresswechsel.token, today=AFTER_THE_DEADLINE)

        assert on_a_league(mongo_replica_set_url, body).zustand == "abgelaufen"

    def test_a_link_to_a_barred_address_is_served_as_barred(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            await ban(database, client, email=NEW_EMAIL)

            return await view(database, saved.adresswechsel.token)

        assert on_a_league(mongo_replica_set_url, body).zustand == "gesperrt"


class TestTheReSend:
    def test_it_replaces_the_link_restarts_the_deadline_and_drops_the_old_delivery_state(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await save(database, client, email=NEW_EMAIL)
            await database[Collection.SCHIEDSRICHTER].update_one(
                {"_id": SCHIEDSRICHTER_OID}, {"$set": {f"{ADRESSWECHSEL_FELD}.zustellung": dict(A_BOUNCE)}}
            )
            second = await resend(database, client, today=A_LATER_DAY)

            return first, second, await stored(database), await refused_code(view(database, first.adresswechsel.token))

        first, second, row, old_link = on_a_league(mongo_replica_set_url, body)

        assert (second.adresswechsel.email, second.adresswechsel.bisherige_email) == (NEW_EMAIL, EMAIL)
        assert row[ADRESSWECHSEL_FELD] == {
            "email": NEW_EMAIL,
            "token_hash": hash_token(second.adresswechsel.token),
            "verschickt_am": A_LATER_DAY,
            "frist": bestaetigung_frist_from(today=A_LATER_DAY),
        }
        assert old_link == SCHIEDSRICHTER_TOKEN_UNKNOWN

    def test_a_pending_address_barred_since_the_save_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save(database, client, email=NEW_EMAIL)
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(resend(database, client))

        assert on_a_league(mongo_replica_set_url, body) == SCHIEDSRICHTER_ADRESSE_GESPERRT

    @pytest.mark.parametrize("schiedsrichter_id", [SCHIEDSRICHTER_OID, GHOST_SCHIEDSRICHTER_ID], ids=["nothing-pending", "the-ghost"])
    def test_a_referee_holding_no_pending_change_answers_not_found(self, mongo_replica_set_url: str, schiedsrichter_id: ObjectId):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await resend(database, client, schiedsrichter_id=schiedsrichter_id)

            return "not found"

        assert on_a_league(mongo_replica_set_url, body) == "not found"


class TestTheDiscard:
    def test_it_removes_the_change_and_its_link_and_keeps_the_address(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await save(database, client, email=NEW_EMAIL)
            discarded = await discard(database, client)

            return discarded, await stored(database), await refused_code(view(database, saved.adresswechsel.token))

        discarded, row, old_link = on_a_league(mongo_replica_set_url, body)

        assert discarded.updated_document.adresswechsel is None
        assert ADRESSWECHSEL_FELD not in row
        assert row["kontakt"]["email"] == EMAIL
        assert old_link == SCHIEDSRICHTER_TOKEN_UNKNOWN

    def test_a_second_discard_answers_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save(database, client, email=NEW_EMAIL)
            await discard(database, client)

            with pytest.raises(DocumentNotFoundException):
                await discard(database, client)

            return "not found"

        assert on_a_league(mongo_replica_set_url, body) == "not found"

    def test_the_whole_database_holds_the_discarded_address_nowhere_afterwards(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save(database, client, email=NEW_EMAIL)
            await resend(database, client)
            await discard(database, client)

            return await every_collection_as_text(database)

        assert NEW_EMAIL not in on_a_league(mongo_replica_set_url, body)


class TestTheDeliveryState:
    def test_a_report_on_the_address_link_lands_on_its_block_and_not_on_the_consent_links(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save(database, client, email=NEW_EMAIL)
            before = await stored(database)
            applied = await angenommen_zustellung(
                angenommen_data=FLZustellungAngenommenPayload.model_validate(
                    {
                        "ziel": "schiedsrichter_adresswechsel",
                        "ziel_id": str(SCHIEDSRICHTER_OID),
                        "rollen": [],
                        "nachricht_id": MESSAGE_ID,
                        "am": ACCEPTED_AT,
                    }
                ),
                db=database,
                db_client=client,
            )

            return applied, before, await stored(database)

        applied, before, row = on_a_league(mongo_replica_set_url, body)

        assert applied.angewendet is True
        assert row[ADRESSWECHSEL_FELD]["zustellung"] == {"nachricht_id": MESSAGE_ID, "stand": "angenommen", "grund": None, "am": ACCEPTED_AT}
        assert row[BESTAETIGUNG_FELD] == before[BESTAETIGUNG_FELD]


class TestTheErasure:
    def test_the_whole_database_holds_no_pending_address_afterwards(self, mongo_replica_set_url: str):
        """The re-send and the delivery report each log an image holding the pending address, which the erasure reaches by the id."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save(database, client, email=NEW_EMAIL)
            await resend(database, client)
            await angenommen_zustellung(
                angenommen_data=FLZustellungAngenommenPayload.model_validate(
                    {
                        "ziel": "schiedsrichter_adresswechsel",
                        "ziel_id": str(SCHIEDSRICHTER_OID),
                        "rollen": [],
                        "nachricht_id": MESSAGE_ID,
                        "am": ACCEPTED_AT,
                    }
                ),
                db=database,
                db_client=client,
            )
            await anonymise_schiedsrichter(
                schiedsrichter_id=SCHIEDSRICHTER_OID,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                spiele_collection=database[Collection.SPIELE],
                aktionen_collection=database[Collection.AKTIONEN],
                db=client,
                germany_now=NOW,
            )

            return await where_held(database, NEW_EMAIL)

        assert on_a_league(mongo_replica_set_url, body) == {NEW_EMAIL: []}
