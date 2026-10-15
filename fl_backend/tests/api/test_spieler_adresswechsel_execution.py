"""
API · a pupil's address change, driven end to end against the shipped validators

A pupil's new address waits in its own block until its mailbox confirms it, the stored address
keeping the record and the sign-in meanwhile: the referee's flow, twinned
(`tests/api/test_schiedsrichter_adresswechsel_execution.py`). The decisions underneath are
`tests/api/test_spieler_adresswechsel_refusal.py`'s.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.crud import find_subjekt
from app.api.identitaet.router import get_anmeldung
from app.api.identitaet.schemas import FLSubjektPayload
from app.api.spieler.admin_router import delete_adresswechsel, einladen_adresswechsel, get_spieler_memberships, post_adresswechsel
from app.api.spieler.adresswechsel_router import get_adresswechsel_ansicht, post_adresswechsel_antwort
from app.api.spieler.crud import erase_person_in_session
from app.api.spieler.schemas import (
    FLSpielerAdresswechselAnsichtPayload,
    FLSpielerAdresswechselAntwortPayload,
    FLSpielerAdresswechselPayload,
)
from app.api.spieler.services import (
    SPIELER_ADRESSE_GESPERRT,
    SPIELER_ADRESSE_UNVERAENDERT,
    SPIELER_ADRESSE_VERGEBEN,
    SPIELER_ADRESSWECHSEL_FELD,
    SPIELER_BESTAETIGUNG_GESPERRT,
    SPIELER_ERSETZTE_ADRESSE_GESPERRT,
    SPIELER_KEINE_ADRESSE,
    SPIELER_TOKEN_EXPIRED,
    SPIELER_TOKEN_UNKNOWN,
    spieler_adresswechsel_frist_from,
)
from app.api.zustellung.router import angenommen_zustellung
from app.api.zustellung.schemas import FLZustellungAngenommenPayload
from app.core.collections import Collection
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.core.recording import log_stamp
from app.core.sentinels import GHOST_SPIELER_ID
from app.core.transactions import transaction_session
from tests import documents
from tests.bans import ban_list, ban_through_the_route
from tests.config import grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.records import record_collections
from tests.whole_database import where_held
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, each write being one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spieler_adresswechsel_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
A_LATER_DAY = "2026-04-05"
# One day past the deadline a link minted on `TODAY` carries.
AFTER_THE_DEADLINE = "2026-04-16"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Written out rather than computed from `log_stamp`, which would agree with any conversion of `NOW`.
REDACTED_AT = "2026-04-01T10:30:00+00:00"

SPIELER_OID = ObjectId("6890a1b2c3d4e5f607840001")
OTHER_OID = ObjectId("6890a1b2c3d4e5f607840002")
NO_ADDRESS_OID = ObjectId("6890a1b2c3d4e5f607840003")
ABSENT_OID = ObjectId("6890a1b2c3d4e5f607849999")

VORNAME = "Lenore"
EMAIL = "lenore.quastenbach@schule.example"
NEW_EMAIL = "lenore.q@neupost.example.org"
# How an administrator may type the new address: the payload keeps the local part's case.
NEW_AS_TYPED = "Lenore.Q@NeuPost.Example.org"
THIRD_EMAIL = "quastenbach.lenore@drittpost.example.net"
OTHER_EMAIL = "jonte.wirbelauer@schule.example"

MESSAGE_ID = "1b6f7a52-29c1-4f0e-9b7a-6d1c2e3f4a5c"
ACCEPTED_AT = "2026-04-01T10:00:00.000000+00:00"
A_BOUNCE: Mapping[str, Any] = {"nachricht_id": "m-1", "stand": "unzustellbar", "grund": "NoEmail", "am": ACCEPTED_AT}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body) -> Any:
    """The SHIPPED validators, a running season, one pupil holding `EMAIL`, a second holding `OTHER_EMAIL` and a third holding none."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # The ban re-judges its actor's grant inside its transaction (`docs/backend/spec.md :: I450`).
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.SPIELER].insert_many(
                [
                    documents.spieler_document(SPIELER_OID, VORNAME, "Quastenbach", email=EMAIL, geburtsdatum="2009-05-04"),
                    documents.spieler_document(OTHER_OID, "Jonte", "Wirbelauer", email=OTHER_EMAIL),
                    documents.spieler_document(NO_ADDRESS_OID, "Ilvy", "Ohnepost"),
                ]
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def request(database: AsyncDatabase, client: AsyncMongoClient, *, email: str, spieler_id: ObjectId = SPIELER_OID) -> Any:
    return await post_adresswechsel(
        spieler_id=spieler_id,
        adresswechsel_data=FLSpielerAdresswechselPayload.model_validate({"email": email}),
        spieler_collection=database[Collection.SPIELER],
        sperrliste=ban_list(database),
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def resend(database: AsyncDatabase, client: AsyncMongoClient, *, spieler_id: ObjectId = SPIELER_OID, today: str = TODAY) -> Any:
    return await einladen_adresswechsel(
        spieler_id=spieler_id, spieler_collection=database[Collection.SPIELER], sperrliste=ban_list(database), db=client, today=today
    )


async def discard(database: AsyncDatabase, client: AsyncMongoClient, *, spieler_id: ObjectId = SPIELER_OID) -> Any:
    return await delete_adresswechsel(
        spieler_id=spieler_id,
        spieler_collection=database[Collection.SPIELER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        germany_now=NOW,
    )


async def view(database: AsyncDatabase, token: str, *, today: str = TODAY) -> Any:
    return await get_adresswechsel_ansicht(
        ansicht_data=FLSpielerAdresswechselAnsichtPayload(token=token),
        spieler_collection=database[Collection.SPIELER],
        sperrliste=ban_list(database),
        today=today,
    )


async def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, antwort: str, *, today: str = TODAY) -> Any:
    return await post_adresswechsel_antwort(
        antwort_data=FLSpielerAdresswechselAntwortPayload.model_validate({"token": token, "antwort": antwort}),
        spieler_collection=database[Collection.SPIELER],
        sperrliste=ban_list(database),
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=today,
        germany_now=NOW,
    )


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, email: str) -> Any:
    return await ban_through_the_route(database, client, email=email, grund="Falschangaben", von="admin@frankfurtleague.de", today=TODAY)


async def accepted(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await angenommen_zustellung(
        angenommen_data=FLZustellungAngenommenPayload.model_validate(
            {"ziel": "spieler_adresswechsel", "ziel_id": str(SPIELER_OID), "rollen": [], "nachricht_id": MESSAGE_ID, "am": ACCEPTED_AT}
        ),
        db=database,
        db_client=client,
    )


async def holds_an_account_record(database: AsyncDatabase, email: str) -> bool:
    """The sign-in gate's own answer: whether this mailbox holds a record the account page serves."""

    answered = await get_anmeldung(
        anmeldung_data=FLSubjektPayload(email=email),
        records=record_collections(database),
        sperrliste=ban_list(database),
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
    )

    return answered.konto


async def subject_pupils(database: AsyncDatabase, email: str) -> list[ObjectId]:
    """The subject read's pupils for this mailbox, the join every person's page and the erasure start from."""

    return [ObjectId(str(record.spieler_id)) for record in (await find_subjekt(email, record_collections(database))).spieler]


async def stored(database: AsyncDatabase, spieler_id: ObjectId = SPIELER_OID) -> Mapping[str, Any]:
    found = await database[Collection.SPIELER].find_one({"_id": spieler_id})
    assert found is not None, "the pupil this case seeded is gone"

    return found


async def refused_code(call: Awaitable[Any]) -> str:
    with pytest.raises(WriteRefusalException) as refused:
        await call

    return refused.value.error_code


async def the_pupils_images(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return (
        await database[Collection.AKTIONEN]
        .find({"collection": str(Collection.SPIELER), "document_id": SPIELER_OID})
        .sort("_id", 1)
        .to_list(length=None)
    )


class TestTheRequest:
    def test_it_holds_the_new_address_apart_and_answers_both_addresses(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored(database)

            return before, await request(database, client, email=NEW_EMAIL), await stored(database)

        before, minted, row = on_a_league(mongo_replica_set_url, body)

        mint = minted.adresswechsel
        assert (mint.email, mint.bisherige_email, mint.vorname) == (NEW_EMAIL, EMAIL, VORNAME)
        assert mint.frist == spieler_adresswechsel_frist_from(today=TODAY)
        assert row[SPIELER_ADRESSWECHSEL_FELD] == {
            "email": NEW_EMAIL,
            "token_hash": hash_token(mint.token),
            "verschickt_am": TODAY,
            "frist": spieler_adresswechsel_frist_from(today=TODAY),
        }
        # The stored address stays in force, and nothing else of the row moves.
        assert {key: value for key, value in row.items() if key != SPIELER_ADRESSWECHSEL_FELD} == before

    def test_a_second_request_replaces_the_change_and_kills_the_first_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await request(database, client, email=NEW_EMAIL)
            third = await request(database, client, email=THIRD_EMAIL)

            return third, await stored(database), await refused_code(view(database, first.adresswechsel.token))

        third, row, old_link = on_a_league(mongo_replica_set_url, body)

        assert (row[SPIELER_ADRESSWECHSEL_FELD]["email"], row[SPIELER_ADRESSWECHSEL_FELD]["token_hash"]) == (
            THIRD_EMAIL,
            hash_token(third.adresswechsel.token),
        )
        assert row["email"] == EMAIL
        assert old_link == SPIELER_TOKEN_UNKNOWN

    def test_the_whole_database_holds_the_replaced_address_nowhere_afterwards(self, mongo_replica_set_url: str):
        """The first request, its re-send and the replacing request each file an image carrying the replaced address."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)
            await resend(database, client)
            await request(database, client, email=THIRD_EMAIL)

            return await where_held(database, NEW_EMAIL, THIRD_EMAIL)

        held = on_a_league(mongo_replica_set_url, body)

        assert held[NEW_EMAIL] == []
        assert held[THIRD_EMAIL] != [], "the scan read nothing the replacing request wrote"


class TestTheRequestsRefusals:
    """Each refusal leaves the row as it stood: no block, and the stored address."""

    def test_a_barred_new_address_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(request(database, client, email=NEW_EMAIL)), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_ADRESSE_GESPERRT
        assert SPIELER_ADRESSWECHSEL_FELD not in row

    def test_an_address_another_pupil_signs_in_on_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(request(database, client, email=OTHER_EMAIL.upper())), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_ADRESSE_VERGEBEN
        assert SPIELER_ADRESSWECHSEL_FELD not in row

    def test_the_stored_address_in_another_spelling_is_refused(self, mongo_replica_set_url: str):
        """Judged on the fold, as the sign-in compares: a change to the mailbox the pupil already signs in on proves nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(request(database, client, email=EMAIL.title())), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_ADRESSE_UNVERAENDERT
        assert SPIELER_ADRESSWECHSEL_FELD not in row

    def test_a_pupil_holding_no_address_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(request(database, client, email=NEW_EMAIL, spieler_id=NO_ADDRESS_OID)), await stored(
                database, NO_ADDRESS_OID
            )

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_KEINE_ADRESSE
        assert (SPIELER_ADRESSWECHSEL_FELD in row, row.get("email")) == (False, None)

    @pytest.mark.parametrize("spieler_id", [GHOST_SPIELER_ID, ABSENT_OID], ids=["the-sentinel", "no-such-pupil"])
    def test_an_id_naming_nobody_answers_not_found(self, mongo_replica_set_url: str, spieler_id: ObjectId):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(documents.spieler_document(GHOST_SPIELER_ID, VORNAME, None, email=THIRD_EMAIL))
            with pytest.raises(DocumentNotFoundException):
                await request(database, client, email=NEW_EMAIL, spieler_id=spieler_id)

            return await where_held(database, NEW_EMAIL)

        assert on_a_league(mongo_replica_set_url, body) == {NEW_EMAIL: []}


class TestWhoTheNewMailboxIsMeanwhile:
    """Until it confirms, the new mailbox holds nothing: no read keys on the pending address."""

    def test_the_gate_and_the_subject_read_see_the_pupil_at_the_old_address_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)

            return (
                {email: await holds_an_account_record(database, email) for email in (EMAIL, NEW_EMAIL)},
                {email: await subject_pupils(database, email) for email in (EMAIL, NEW_EMAIL)},
            )

        gate, subject = on_a_league(mongo_replica_set_url, body)

        assert gate == {EMAIL: True, NEW_EMAIL: False}
        assert subject == {EMAIL: [SPIELER_OID], NEW_EMAIL: []}


class TestTheConfirmation:
    def test_it_stores_the_folded_address_ends_the_change_and_leaves_the_consent_byte_for_byte(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored(database)
            minted = await request(database, client, email=NEW_AS_TYPED)
            answered = await answer(database, client, minted.adresswechsel.token, "bestaetigt")

            return before, minted, answered, await stored(database)

        before, minted, answered, row = on_a_league(mongo_replica_set_url, body)

        # The premise: the address as the payload rule keeps it is not its fold, or the case proves nothing.
        assert minted.adresswechsel.email != NEW_EMAIL
        assert answered.antwort == "bestaetigt"
        assert row == {**before, "email": NEW_EMAIL}

    def test_the_record_then_belongs_to_the_new_mailbox_and_no_longer_to_the_old(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await request(database, client, email=NEW_AS_TYPED)
            await answer(database, client, minted.adresswechsel.token, "bestaetigt")

            return (
                {email: await holds_an_account_record(database, email) for email in (EMAIL, NEW_EMAIL)},
                {email: await subject_pupils(database, email) for email in (EMAIL, NEW_EMAIL)},
            )

        gate, subject = on_a_league(mongo_replica_set_url, body)

        assert gate == {EMAIL: False, NEW_EMAIL: True}
        assert subject == {EMAIL: [], NEW_EMAIL: [SPIELER_OID]}

    def test_a_reopened_link_opens_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await request(database, client, email=NEW_EMAIL)).adresswechsel.token
            await answer(database, client, token, "bestaetigt")

            return await refused_code(view(database, token)), await refused_code(answer(database, client, token, "bestaetigt"))

        codes = on_a_league(mongo_replica_set_url, body)

        assert codes == (SPIELER_TOKEN_UNKNOWN, SPIELER_TOKEN_UNKNOWN)


class TestTheConfirmationsRefusals:
    """Each refusal moves nothing: the stored address stays, and so does the change."""

    def test_past_the_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await request(database, client, email=NEW_EMAIL)).adresswechsel.token
            before = await stored(database)

            return await refused_code(answer(database, client, token, "bestaetigt", today=AFTER_THE_DEADLINE)), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_TOKEN_EXPIRED
        assert row == before

    def test_to_an_address_barred_since_the_request(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await request(database, client, email=NEW_EMAIL)).adresswechsel.token
            await ban(database, client, email=NEW_EMAIL)
            before = await stored(database)

            return await refused_code(answer(database, client, token, "bestaetigt")), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_BESTAETIGUNG_GESPERRT
        assert row == before

    def test_from_a_stored_address_barred_since_the_request(self, mongo_replica_set_url: str):
        """A barred person cannot move their record off the address the ban keys on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await request(database, client, email=NEW_EMAIL)).adresswechsel.token
            await ban(database, client, email=EMAIL)
            before = await stored(database)

            return await refused_code(answer(database, client, token, "bestaetigt")), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_ERSETZTE_ADRESSE_GESPERRT
        assert row == before

    def test_a_ban_on_both_addresses_answers_the_link_s_own(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await request(database, client, email=NEW_EMAIL)).adresswechsel.token
            await ban(database, client, email=EMAIL)
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(answer(database, client, token, "bestaetigt"))

        assert on_a_league(mongo_replica_set_url, body) == SPIELER_BESTAETIGUNG_GESPERRT

    def test_to_an_address_another_pupil_has_come_to_sign_in_on(self, mongo_replica_set_url: str):
        """The pre-read refuses it by name; `uniq_spieler_email` stands behind it for the race the read cannot see."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await request(database, client, email=NEW_EMAIL)).adresswechsel.token
            await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})
            before = await stored(database)

            return await refused_code(answer(database, client, token, "bestaetigt")), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_ADRESSE_VERGEBEN
        assert row == before


class TestTheDecline:
    def test_it_removes_the_change_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored(database)
            token = (await request(database, client, email=NEW_EMAIL)).adresswechsel.token
            answered = await answer(database, client, token, "abgelehnt")

            return before, answered, await stored(database)

        before, answered, row = on_a_league(mongo_replica_set_url, body)

        assert answered.antwort == "abgelehnt"
        assert row == before

    @pytest.mark.parametrize("late_or_barred", ["late", "barred", "replaced-barred"])
    def test_a_lapsed_or_barred_link_still_takes_it_and_leaves_the_address_nowhere(self, mongo_replica_set_url: str, late_or_barred: str):
        """A decline removes an address nobody proved, which neither the deadline nor a ban on either address has a reason to keep.

        The re-send and the decline each file an image carrying the address, which the decline's redaction reaches.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)
            token = (await resend(database, client)).adresswechsel.token
            if late_or_barred != "late":
                # Hashed, so the ban list itself holds the address nowhere for the scan below to find.
                await ban(database, client, email=NEW_EMAIL if late_or_barred == "barred" else EMAIL)
            await answer(database, client, token, "abgelehnt", today=AFTER_THE_DEADLINE if late_or_barred == "late" else TODAY)

            return await stored(database), await where_held(database, NEW_EMAIL)

        row, held = on_a_league(mongo_replica_set_url, body)

        assert (SPIELER_ADRESSWECHSEL_FELD in row, row["email"]) == (False, EMAIL)
        assert held == {NEW_EMAIL: []}


class TestTheView:
    def test_it_answers_exactly_the_first_name_the_state_and_the_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await view(database, (await request(database, client, email=NEW_EMAIL)).adresswechsel.token)

        seen = on_a_league(mongo_replica_set_url, body)

        assert seen.model_dump() == {
            "acknowledged": 1,
            "zustand": "gueltig",
            "vorname": VORNAME,
            "frist": spieler_adresswechsel_frist_from(today=TODAY),
        }

    @pytest.mark.parametrize(
        ("ban_on", "held_by_another", "today", "zustand"),
        [
            pytest.param((), False, AFTER_THE_DEADLINE, "abgelaufen", id="lapsed"),
            pytest.param((NEW_EMAIL,), False, TODAY, "gesperrt", id="new-address-barred"),
            pytest.param((NEW_EMAIL, EMAIL), False, AFTER_THE_DEADLINE, "gesperrt", id="the-link-s-own-ban-first"),
            pytest.param((EMAIL,), False, TODAY, "nicht_bestaetigbar", id="replaced-address-barred"),
            pytest.param((), True, TODAY, "nicht_bestaetigbar", id="new-address-held-by-another"),
            pytest.param((EMAIL,), True, AFTER_THE_DEADLINE, "abgelaufen", id="the-deadline-before-either"),
        ],
    )
    def test_it_ranks_the_states_as_the_press_refuses(
        self, mongo_replica_set_url: str, ban_on: tuple[str, ...], held_by_another: bool, today: str, zustand: str
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await request(database, client, email=NEW_EMAIL)).adresswechsel.token
            for email in ban_on:
                await ban(database, client, email=email)
            if held_by_another:
                await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})

            return (await view(database, token, today=today)).zustand

        assert on_a_league(mongo_replica_set_url, body) == zustand

    def test_a_token_no_pupil_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)

            return await refused_code(view(database, "a-token-nobody-was-sent"))

        assert on_a_league(mongo_replica_set_url, body) == SPIELER_TOKEN_UNKNOWN


class TestTheReSend:
    def test_it_replaces_the_link_restarts_the_deadline_and_drops_the_delivery_state(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await request(database, client, email=NEW_EMAIL)
            await database[Collection.SPIELER].update_one(
                {"_id": SPIELER_OID}, {"$set": {f"{SPIELER_ADRESSWECHSEL_FELD}.zustellung": dict(A_BOUNCE)}}
            )
            second = await resend(database, client, today=A_LATER_DAY)

            return second, await stored(database), await refused_code(view(database, first.adresswechsel.token))

        second, row, old_link = on_a_league(mongo_replica_set_url, body)

        assert (second.adresswechsel.email, second.adresswechsel.bisherige_email, second.adresswechsel.vorname) == (
            NEW_EMAIL,
            EMAIL,
            VORNAME,
        )
        assert row[SPIELER_ADRESSWECHSEL_FELD] == {
            "email": NEW_EMAIL,
            "token_hash": hash_token(second.adresswechsel.token),
            "verschickt_am": A_LATER_DAY,
            "frist": spieler_adresswechsel_frist_from(today=A_LATER_DAY),
        }
        assert old_link == SPIELER_TOKEN_UNKNOWN

    def test_a_pending_address_barred_since_the_request_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await request(database, client, email=NEW_EMAIL)
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(resend(database, client)), first, await stored(database)

        code, first, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_ADRESSE_GESPERRT
        assert row[SPIELER_ADRESSWECHSEL_FELD]["token_hash"] == hash_token(first.adresswechsel.token)

    def test_a_pending_address_another_pupil_has_come_to_sign_in_on_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)
            await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})

            return await refused_code(resend(database, client))

        assert on_a_league(mongo_replica_set_url, body) == SPIELER_ADRESSE_VERGEBEN

    @pytest.mark.parametrize("spieler_id", [SPIELER_OID, GHOST_SPIELER_ID], ids=["nothing-pending", "the-sentinel"])
    def test_a_pupil_holding_no_pending_change_answers_not_found(self, mongo_replica_set_url: str, spieler_id: ObjectId):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # The sentinel given a block by hand, so only the by-id filter keeps it out.
            await database[Collection.SPIELER].insert_one(
                documents.spieler_document(
                    GHOST_SPIELER_ID,
                    VORNAME,
                    None,
                    **{
                        SPIELER_ADRESSWECHSEL_FELD: {
                            "email": THIRD_EMAIL,
                            "token_hash": hash_token("by-hand"),
                            "verschickt_am": TODAY,
                            "frist": TODAY,
                        }
                    },
                )
            )
            with pytest.raises(DocumentNotFoundException):
                await resend(database, client, spieler_id=spieler_id)

            return "not found"

        assert on_a_league(mongo_replica_set_url, body) == "not found"


class TestTheDiscard:
    def test_it_keeps_the_address_removes_the_change_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored(database)
            await request(database, client, email=NEW_EMAIL)
            token = (await resend(database, client)).adresswechsel.token
            discarded = await discard(database, client)

            return before, discarded, await stored(database), await refused_code(view(database, token)), await where_held(database, NEW_EMAIL)

        before, discarded, row, old_link, held = on_a_league(mongo_replica_set_url, body)

        assert (discarded.spieler_id, discarded.vorname) == (SPIELER_OID, VORNAME)
        assert row == before
        assert old_link == SPIELER_TOKEN_UNKNOWN
        assert held == {NEW_EMAIL: []}

    def test_a_second_discard_answers_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)
            await discard(database, client)

            with pytest.raises(DocumentNotFoundException):
                await discard(database, client)

            return "not found"

        assert on_a_league(mongo_replica_set_url, body) == "not found"


class TestThePupilsOwnTrailStays:
    """Each way a pending address ends takes that address out of the pupil's log images and leaves the rest of each."""

    @pytest.mark.parametrize("ending", ["declined", "discarded", "replaced"])
    def test_only_the_pending_block_leaves_the_log(self, mongo_replica_set_url: str, ending: str):
        """Empty the images whole instead and this fails: the pupil's earlier states are the log's to restore from."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)
            token = (await resend(database, client)).adresswechsel.token
            if ending == "declined":
                await answer(database, client, token, "abgelehnt")
            elif ending == "discarded":
                await discard(database, client)
            else:
                await request(database, client, email=THIRD_EMAIL)

            return await the_pupils_images(database)

        rows = on_a_league(mongo_replica_set_url, body)
        emptied = [row for row in rows if row["before"].get(SPIELER_ADRESSWECHSEL_FELD, "absent") is None]

        assert NEW_EMAIL not in str(rows)
        # The re-send and the ending each filed an image holding the block, so two are emptied and stamped.
        assert [row["redacted_at"] for row in emptied] == [REDACTED_AT] * 2
        # The pupil's own record beside the block stands in every image.
        assert {(row["before"]["email"], row["before"]["vorname"]) for row in rows} == {(EMAIL, VORNAME)}


class TestTheDeliveryState:
    def test_a_report_on_the_pupils_link_lands_on_its_block(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)

            return await accepted(database, client), await stored(database)

        applied, row = on_a_league(mongo_replica_set_url, body)

        assert applied.angewendet is True
        assert row[SPIELER_ADRESSWECHSEL_FELD]["zustellung"] == {
            "nachricht_id": MESSAGE_ID,
            "stand": "angenommen",
            "grund": None,
            "am": ACCEPTED_AT,
        }


class TestTheEditorsRead:
    """The editor marks a lapsed link by the backend's own rule, never by a day the browser reads."""

    @pytest.mark.parametrize(("today", "abgelaufen"), [(TODAY, False), (AFTER_THE_DEADLINE, True)], ids=["running", "lapsed"])
    def test_it_serves_the_change_without_its_hash_and_whether_it_lapsed(self, mongo_replica_set_url: str, today: str, abgelaufen: bool):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)

            return await get_spieler_memberships(spieler_collection=database[Collection.SPIELER], today=today)

        read = {row.id: row for row in on_a_league(mongo_replica_set_url, body).spieler}

        served = read[SPIELER_OID].model_dump(mode="json")
        assert served["adresswechsel"] == {
            "email": NEW_EMAIL,
            "verschickt_am": TODAY,
            "frist": spieler_adresswechsel_frist_from(today=TODAY),
            "zustellung": None,
        }
        assert served["adresswechsel_abgelaufen"] is abgelaufen
        assert (read[OTHER_OID].adresswechsel, read[OTHER_OID].adresswechsel_abgelaufen) == (None, False)


class TestTheErasure:
    def test_the_whole_database_holds_no_pending_address_after_the_pupil_is_erased(self, mongo_replica_set_url: str):
        """The re-send and the delivery report each log an image holding the pending address, which the erasure reaches by the id."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)
            await resend(database, client)
            await accepted(database, client)

            async def erase(session: AsyncClientSession) -> Any:
                return await erase_person_in_session(
                    spieler_collection=database[Collection.SPIELER],
                    saison_spieler_collection=database[Collection.SAISON_SPIELER],
                    aktionen_collection=database[Collection.AKTIONEN],
                    spieler_id=SPIELER_OID,
                    stamp=log_stamp(NOW),
                    session=session,
                )

            async with transaction_session(client) as session:
                await session.with_transaction(erase)

            return await where_held(database, NEW_EMAIL)

        assert on_a_league(mongo_replica_set_url, body) == {NEW_EMAIL: []}
