"""
API · a confirmed referee's address change, driven end to end against the shipped validators

A confirmed referee's new address waits in its own block until the change takes effect, the stored address keeping the
record and the sign-in meanwhile; the save refuses to move it. The person's own start and the records the effect moves
beside the referee row are `tests/api/test_konto_adresswechsel_execution.py`'s; the decisions underneath are
`tests/api/test_schiedsrichter_adresswechsel_refusal.py`'s.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.router import get_anmeldung
from app.api.identitaet.schemas import FLSubjektPayload
from app.api.konto.router import post_adresswechsel as start_on_the_account_page
from app.api.konto.schemas import FLKontoAdresswechselPayload
from app.api.schiedsrichter.admin_router import (
    delete_adresswechsel,
    einladen_adresswechsel,
    einladen_schiedsrichter,
    patch_schiedsrichter,
    post_adresswechsel,
)
from app.api.schiedsrichter.adresswechsel_router import get_adresswechsel_ansicht, post_adresswechsel_stopp
from app.api.schiedsrichter.adresswechsel_router import post_adresswechsel as post_adresswechsel_antwort
from app.api.schiedsrichter.bestaetigung_router import post_bestaetigung
from app.api.schiedsrichter.router import get_schiedsrichter_by_id
from app.api.schiedsrichter.schemas import (
    FLPatchSchiedsrichterPayload,
    FLSchiedsrichterAdresswechselAnsichtPayload,
    FLSchiedsrichterAdresswechselAntwortPayload,
    FLSchiedsrichterAdresswechselPayload,
    FLSchiedsrichterAdresswechselStoppPayload,
    FLSchiedsrichterBestaetigungPayload,
)
from app.api.schiedsrichter.services import (
    ADRESSWECHSEL_FELD,
    BESTAETIGUNG_FELD,
    EINWILLIGUNG_FELD,
    SCHIEDSRICHTER_ADRESSE_GESPERRT,
    SCHIEDSRICHTER_ADRESSE_NUR_PER_WECHSEL,
    SCHIEDSRICHTER_ADRESSE_UNVERAENDERT,
    SCHIEDSRICHTER_BESTAETIGUNG_GESPERRT,
    SCHIEDSRICHTER_ERSETZTE_ADRESSE_GESPERRT,
    SCHIEDSRICHTER_KEINE_ADRESSE,
    SCHIEDSRICHTER_NAME_IM_GRUND,
    SCHIEDSRICHTER_TOKEN_EXPIRED,
    SCHIEDSRICHTER_TOKEN_UNKNOWN,
    SCHIEDSRICHTER_UNBESTAETIGT,
)
from app.api.spieler.services import SPIELER_ADRESSE_VERGEBEN
from app.api.zustellung.router import angenommen_zustellung
from app.api.zustellung.schemas import FLZustellungAngenommenPayload
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.adresswechsel import als_utc
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from tests import documents
from tests.actor_tokens import FRESH_STEP_UP_CHECK, SignedActor
from tests.app_client import app_client
from tests.bans import ban_list, ban_through_the_route
from tests.config import ADMIN_KEY, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.erasure import erased
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
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
A_LATER_INSTANT = NOW + timedelta(days=4)
# An hour past the deadline a link minted at `NOW` carries.
AFTER_THE_DEADLINE = NOW + timedelta(hours=25)
# Written out rather than computed from `log_stamp`, which would agree with any conversion of `NOW`.
REDACTED_AT = "2026-04-01T10:30:00+00:00"

SCHIEDSRICHTER_OID = ObjectId("6890a1b2c3d4e5f607830001")
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607830002")
OTHER_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607830003")

NAME = "Ortwin Pfeiffenberger"
EMAIL = "ortwin.pfeiffenberger@example.com"
NEW_EMAIL = "o.pfeiffenberger@neuepost.example.org"
THIRD_EMAIL = "pfeiffenberger.ortwin@drittpost.example.net"
TELEFON = "+49 69 5550303"
GRUND = "Postfach gelöscht, telefonisch unter der hinterlegten Nummer bestätigt am 21.10.2026"

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


async def save(database: AsyncDatabase, client: AsyncMongoClient, *, email: str) -> Any:
    return await patch_schiedsrichter(
        schiedsrichter_id=SCHIEDSRICHTER_OID,
        schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate(
            {"name": NAME, "schule": "Bettina-Schule", "default_payment": 25, "kontakt": {"telefon": TELEFON, "email": email}}
        ),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        today=TODAY,
        refuse_unconfirmed=FRESH_STEP_UP_CHECK,
    )


async def start(database: AsyncDatabase, client: AsyncMongoClient, *, email: str) -> Any:
    """The referee's own start on their account page, which the new mailbox's confirmation makes take effect at once."""

    return await start_on_the_account_page(
        identifier=EMAIL,
        adresswechsel_data=FLKontoAdresswechselPayload(email=email),
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        config=CONFIG,
        germany_now=NOW,
    )


async def request(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    email: str,
    grund: str | None = GRUND,
    schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID,
) -> Any:
    """An administrator's start, with a reason by default, so the new mailbox is minted its link at once."""

    return await post_adresswechsel(
        schiedsrichter_id=schiedsrichter_id,
        adresswechsel_data=FLSchiedsrichterAdresswechselPayload.model_validate({"email": email, "grund": grund}),
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        germany_now=NOW,
    )


async def resend(
    database: AsyncDatabase, client: AsyncMongoClient, *, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID, now: datetime = NOW
) -> Any:
    return await einladen_adresswechsel(
        schiedsrichter_id=schiedsrichter_id,
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        db=client,
        germany_now=now,
    )


async def discard(database: AsyncDatabase, client: AsyncMongoClient, *, schiedsrichter_id: ObjectId = SCHIEDSRICHTER_OID) -> Any:
    return await delete_adresswechsel(
        schiedsrichter_id=schiedsrichter_id,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        germany_now=NOW,
    )


async def view(database: AsyncDatabase, token: str, *, now: datetime = NOW) -> Any:
    return (
        await get_adresswechsel_ansicht(
            ansicht_data=FLSchiedsrichterAdresswechselAnsichtPayload(token=token),
            schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
            spieler_collection=database[Collection.SPIELER],
            sperrliste=ban_list(database),
            germany_now=now,
        )
    ).ansicht


async def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, antwort: str, *, now: datetime = NOW) -> Any:
    return await post_adresswechsel_antwort(
        antwort_data=FLSchiedsrichterAdresswechselAntwortPayload.model_validate({"token": token, "antwort": antwort}),
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        sperrliste=ban_list(database),
        aktionen_collection=database[Collection.AKTIONEN],
        adressanker_collection=database[Collection.ADRESSANKER],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        db=client,
        config=CONFIG,
        germany_now=now,
    )


async def stop(database: AsyncDatabase, client: AsyncMongoClient, token: str) -> Any:
    return await post_adresswechsel_stopp(
        stopp_data=FLSchiedsrichterAdresswechselStoppPayload(token=token),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        config=CONFIG,
        germany_now=NOW,
    )


async def ban(database: AsyncDatabase, client: AsyncMongoClient, *, email: str) -> Any:
    return await ban_through_the_route(database, client, email=email, grund="Falschangaben", von="admin@frankfurtleague.de", today=TODAY)


async def a_pupil_at_the_address(database: AsyncDatabase) -> None:
    """The referee is a pupil too, so a change of their address moves the pupil row, which another pupil's address refuses."""

    await database[Collection.SPIELER].insert_many(
        [
            documents.spieler_document(PUPIL_OID, "Ortwin", "Pfeiffenberger", email=EMAIL),
            documents.spieler_document(OTHER_PUPIL_OID, "Ilka", "Andere", email=NEW_EMAIL),
        ]
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


async def stored(database: AsyncDatabase) -> Mapping[str, Any]:
    found = await database[Collection.SCHIEDSRICHTER].find_one({"_id": SCHIEDSRICHTER_OID})
    assert found is not None, "the referee this case seeded is gone"

    return found


async def refused_code(call: Awaitable[Any]) -> str:
    with pytest.raises(WriteRefusalException) as refused:
        await call

    return refused.value.error_code


class TestTheSaveOnAConfirmedReferee:
    """`REQ-SCHIEDSRICHTER-011`: a confirmed referee's address is who signs in as them, and the save moves it never."""

    @pytest.mark.parametrize("retired", [False, True], ids=["serving", "retired"])
    def test_a_save_moving_it_is_refused_and_nothing_of_the_save_lands(self, mongo_replica_set_url: str, retired: bool):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if retired:
                await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"inactive_since": "2026-03-01"}})
            before = await stored(database)

            return await refused_code(save(database, client, email=NEW_EMAIL)), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_ADRESSE_NUR_PER_WECHSEL
        assert row == before

    def test_a_save_keeping_it_with_its_domain_respelled_lands_and_leaves_a_pending_change_standing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await request(database, client, email=NEW_EMAIL)
            saved = await save(database, client, email="ortwin.pfeiffenberger@EXAMPLE.com")

            return minted, saved, await stored(database)

        minted, saved, row = on_a_league(mongo_replica_set_url, body)

        assert saved.bestaetigung is None
        assert "adresswechsel" not in saved.model_dump()
        assert row["default_payment"] == 25
        assert row[ADRESSWECHSEL_FELD]["token_hash"] == hash_token(str(minted.adresswechsel.token))


class TestAnUnconfirmedReferee:
    """The control on the class above: an unanswered referee's address is still replaced at once and mailed a fresh consent link."""

    def test_the_address_moves_at_once_and_a_fresh_consent_link_is_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await save(database, client, email=NEW_EMAIL), await stored(database)

        saved, row = on_a_league(mongo_replica_set_url, body, confirmed=False)

        assert saved.bestaetigung is not None
        assert row["kontakt"]["email"] == NEW_EMAIL
        assert row[BESTAETIGUNG_FELD]["token_hash"] == hash_token(saved.bestaetigung.token)
        assert ADRESSWECHSEL_FELD not in row


class TestTheRequest:
    """An administrator's start, for a referee who cannot sign in: the pupil's twin."""

    def test_it_holds_the_new_address_apart_and_answers_its_links_with_both_addresses(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored(database)

            return before, await request(database, client, email=NEW_EMAIL), await stored(database)

        before, minted, row = on_a_league(mongo_replica_set_url, body)

        mint = minted.adresswechsel
        assert (mint.weg, mint.email, mint.bisherige_email, mint.vorname, mint.adresse_belegt) == (
            "wartezeit",
            NEW_EMAIL,
            EMAIL,
            "Ortwin",
            False,
        )
        block = row[ADRESSWECHSEL_FELD]
        assert (block["token_hash"], block["stopp_hash"], block["grund"]) == (
            hash_token(str(mint.token)),
            hash_token(str(mint.stopp_token)),
            GRUND,
        )
        # The answered consent link's block stands, and so does the address in force.
        assert row[BESTAETIGUNG_FELD] == before[BESTAETIGUNG_FELD]
        assert row["kontakt"]["email"] == EMAIL

    def test_the_editor_reads_the_pending_change_and_no_hash(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL, grund=None)

            return await get_schiedsrichter_by_id(
                schiedsrichter_id=SCHIEDSRICHTER_OID,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                today=TODAY,
                germany_now=NOW,
            )

        served = on_a_league(mongo_replica_set_url, body).schiedsrichter.adresswechsel

        assert served is not None
        assert (served.email, served.weg, served.verschickt_am, served.zustellung) == (NEW_EMAIL, "freigabe", TODAY, None)
        assert {"token_hash", "stopp_hash"}.isdisjoint(served.model_dump())

    def test_a_third_address_replaces_the_pending_change_and_kills_its_links(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await request(database, client, email=NEW_EMAIL)
            third = await request(database, client, email=THIRD_EMAIL)

            return (
                third,
                await stored(database),
                await refused_code(view(database, str(first.adresswechsel.token))),
                await refused_code(view(database, str(first.adresswechsel.stopp_token))),
            )

        third, row, old_link, old_stop = on_a_league(mongo_replica_set_url, body)

        assert row[ADRESSWECHSEL_FELD]["email"] == THIRD_EMAIL
        assert row[ADRESSWECHSEL_FELD]["token_hash"] == hash_token(str(third.adresswechsel.token))
        assert (old_link, old_stop) == (SCHIEDSRICHTER_TOKEN_UNKNOWN, SCHIEDSRICHTER_TOKEN_UNKNOWN)

    def test_the_whole_database_holds_the_replaced_address_nowhere_afterwards(self, mongo_replica_set_url: str):
        """The first start, its re-send and the replacing start each file an image carrying the replaced address."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)
            await resend(database, client)
            await request(database, client, email=THIRD_EMAIL)

            return await where_held(database, NEW_EMAIL, THIRD_EMAIL)

        held = on_a_league(mongo_replica_set_url, body)

        assert held[NEW_EMAIL] == []
        assert held[THIRD_EMAIL] != [], "the scan read nothing the replacing start wrote"


class TestTheRequestsRefusals:
    """Each refusal leaves the row as it stood: no block, and the stored address."""

    def test_the_stored_address_in_another_spelling_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(request(database, client, email=EMAIL.upper())), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_ADRESSE_UNVERAENDERT
        assert ADRESSWECHSEL_FELD not in row

    def test_a_barred_new_address_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(request(database, client, email=NEW_EMAIL)), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_ADRESSE_GESPERRT
        assert ADRESSWECHSEL_FELD not in row

    def test_a_reason_naming_the_person_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(request(database, client, email=NEW_EMAIL, grund="Herr Pfeiffenbergers Anruf")), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_NAME_IM_GRUND
        assert ADRESSWECHSEL_FELD not in row

    def test_an_unconfirmed_referee_is_refused_by_the_state_it_is_in(self, mongo_replica_set_url: str):
        """Their address is no sign-in yet: the editor's save corrects it and mints a fresh consent link."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(request(database, client, email=NEW_EMAIL)), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body, confirmed=False)

        assert code == SCHIEDSRICHTER_UNBESTAETIGT
        assert ADRESSWECHSEL_FELD not in row

    def test_a_row_holding_no_usable_address_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER_OID}, {"$set": {"kontakt.email": None}})

            return await refused_code(request(database, client, email=NEW_EMAIL))

        assert on_a_league(mongo_replica_set_url, body) == SCHIEDSRICHTER_KEINE_ADRESSE

    def test_a_pupil_row_at_the_address_is_not_moved_onto_another_pupil_s(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_pupil_at_the_address(database)

            return await refused_code(request(database, client, email=NEW_EMAIL)), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_ADRESSE_VERGEBEN
        assert ADRESSWECHSEL_FELD not in row

    @pytest.mark.parametrize("schiedsrichter_id", [GHOST_SCHIEDSRICHTER_ID, ObjectId("6890a1b2c3d4e5f607839999")], ids=["the-ghost", "nobody"])
    def test_an_id_naming_nobody_answers_not_found(self, mongo_replica_set_url: str, schiedsrichter_id: ObjectId):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await request(database, client, email=NEW_EMAIL, schiedsrichter_id=schiedsrichter_id)

            return "not found"

        assert on_a_league(mongo_replica_set_url, body) == "not found"


class TestWhoTheNewMailboxIsMeanwhile:
    """Until the change takes effect, the new mailbox holds nothing: no read keys on the pending address."""

    def test_the_gate_and_the_account_read_see_the_record_at_the_old_address_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)

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
            minted = await start(database, client, email=NEW_EMAIL)
            answered = await answer(database, client, minted.token, "bestaetigt")

            return before, minted, answered, await stored(database)

        before, minted, answered, row = on_a_league(mongo_replica_set_url, body)

        assert (minted.art, minted.id) == ("schiedsrichter", SCHIEDSRICHTER_OID)
        assert answered.mitteilung is not None
        assert (answered.antwort, answered.mitteilung.bisherige_email, answered.mitteilung.vorname) == ("bestaetigt", EMAIL, "Ortwin")
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
            minted = await start(database, client, email=NEW_EMAIL)
            await answer(database, client, minted.token, "bestaetigt")

            return before, await stored(database)

        before, row = on_a_league(mongo_replica_set_url, body)

        assert row[BESTAETIGUNG_FELD] == {key: value for key, value in before[BESTAETIGUNG_FELD].items() if key != "zustellung"}

    def test_the_record_then_belongs_to_the_new_mailbox_and_no_longer_to_the_old(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            await answer(database, client, minted.token, "bestaetigt")

            return {email: await holds_an_account_record(database, email) for email in (EMAIL, NEW_EMAIL)}

        assert on_a_league(mongo_replica_set_url, body) == {EMAIL: False, NEW_EMAIL: True}

    def test_a_reopened_link_opens_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            await answer(database, client, minted.token, "bestaetigt")

            return await refused_code(view(database, minted.token)), await refused_code(answer(database, client, minted.token, "bestaetigt"))

        assert on_a_league(mongo_replica_set_url, body) == (SCHIEDSRICHTER_TOKEN_UNKNOWN, SCHIEDSRICHTER_TOKEN_UNKNOWN)

    def test_a_confirmation_past_the_deadline_is_refused_and_moves_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            code = await refused_code(answer(database, client, minted.token, "bestaetigt", now=AFTER_THE_DEADLINE))

            return code, await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_TOKEN_EXPIRED
        assert row["kontakt"]["email"] == EMAIL
        assert row[ADRESSWECHSEL_FELD]["email"] == NEW_EMAIL

    def test_a_confirmation_to_an_address_barred_since_the_start_is_refused_and_moves_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(answer(database, client, minted.token, "bestaetigt")), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_BESTAETIGUNG_GESPERRT
        assert row["kontakt"]["email"] == EMAIL

    def test_a_lapsed_link_to_a_barred_address_is_refused_as_its_view_reads_it(self, mongo_replica_set_url: str):
        """The view ranks the ban ahead of the deadline, so the press does: the page then names what a reload shows."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            await ban(database, client, email=NEW_EMAIL)

            return (await view(database, minted.token, now=AFTER_THE_DEADLINE)).zustand, await refused_code(
                answer(database, client, minted.token, "bestaetigt", now=AFTER_THE_DEADLINE)
            )

        assert on_a_league(mongo_replica_set_url, body) == ("gesperrt", SCHIEDSRICHTER_BESTAETIGUNG_GESPERRT)

    def test_a_pupil_row_at_the_address_is_not_moved_onto_another_pupil_s(self, mongo_replica_set_url: str):
        """The change moves the person: their pupil row goes with the referee row, so another pupil's address refuses both."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = (await request(database, client, email=NEW_EMAIL)).adresswechsel
            await a_pupil_at_the_address(database)

            return (await view(database, str(minted.token))).zustand, await refused_code(
                answer(database, client, str(minted.token), "bestaetigt")
            )

        assert on_a_league(mongo_replica_set_url, body) == ("nicht_bestaetigbar", SPIELER_ADRESSE_VERGEBEN)


class TestAChangeReplacingABarredAddress:
    """`REQ-SCHIEDSRICHTER-010`: a ban entered on the address on file while a change is pending stops the change's confirmation."""

    def test_the_view_answers_it_as_not_confirmable(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            await ban(database, client, email=EMAIL)

            return await view(database, minted.token)

        assert on_a_league(mongo_replica_set_url, body).zustand == "nicht_bestaetigbar"

    def test_the_confirmation_is_refused_and_moves_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            await ban(database, client, email=EMAIL)

            return await refused_code(answer(database, client, minted.token, "bestaetigt")), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SCHIEDSRICHTER_ERSETZTE_ADRESSE_GESPERRT
        assert row["kontakt"]["email"] == EMAIL
        assert row[ADRESSWECHSEL_FELD]["email"] == NEW_EMAIL

    def test_the_decline_still_removes_the_change(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            await ban(database, client, email=EMAIL)
            await answer(database, client, minted.token, "abgelehnt")

            return await stored(database)

        assert ADRESSWECHSEL_FELD not in on_a_league(mongo_replica_set_url, body)

    def test_a_ban_on_both_addresses_answers_the_link_s_own(self, mongo_replica_set_url: str):
        """Where both are barred, the link's holder is the barred person, so `-009` and `gesperrt` are true of them."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            await ban(database, client, email=EMAIL)
            await ban(database, client, email=NEW_EMAIL)

            return (await view(database, minted.token)).zustand, await refused_code(answer(database, client, minted.token, "bestaetigt"))

        assert on_a_league(mongo_replica_set_url, body) == ("gesperrt", SCHIEDSRICHTER_BESTAETIGUNG_GESPERRT)


class TestTheDecline:
    def test_it_removes_the_change_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            before = await stored(database)
            await answer(database, client, minted.token, "abgelehnt")

            return before, await stored(database)

        before, row = on_a_league(mongo_replica_set_url, body)

        assert row == {key: value for key, value in before.items() if key != ADRESSWECHSEL_FELD}

    @pytest.mark.parametrize("late_or_barred", ["late", "barred"])
    def test_a_lapsed_or_barred_link_still_takes_it(self, mongo_replica_set_url: str, late_or_barred: str):
        """A decline removes an address nobody proved, which neither the deadline nor a ban has a reason to keep."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            if late_or_barred == "barred":
                await ban(database, client, email=NEW_EMAIL)
            await answer(database, client, minted.token, "abgelehnt", now=AFTER_THE_DEADLINE if late_or_barred == "late" else NOW)

            return await stored(database)

        row = on_a_league(mongo_replica_set_url, body)

        assert ADRESSWECHSEL_FELD not in row
        assert row["kontakt"]["email"] == EMAIL

    def test_the_whole_database_holds_the_disowned_address_nowhere_afterwards(self, mongo_replica_set_url: str):
        """The re-send and the decline each file an image carrying the address, which the decline's redaction reaches."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)
            resent = await resend(database, client)
            await answer(database, client, str(resent.adresswechsel.token), "abgelehnt")

            return await where_held(database, NEW_EMAIL)

        assert on_a_league(mongo_replica_set_url, body) == {NEW_EMAIL: []}


class TestTheStop:
    def test_the_stop_link_ends_the_change_in_its_waiting_time_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = (await request(database, client, email=NEW_EMAIL)).adresswechsel
            await answer(database, client, str(minted.token), "bestaetigt")
            answered = await stop(database, client, str(minted.stopp_token))

            return (
                answered,
                await stored(database),
                await refused_code(stop(database, client, str(minted.stopp_token))),
                await where_held(database, NEW_EMAIL),
            )

        answered, row, again, held = on_a_league(mongo_replica_set_url, body)

        assert answered.gestoppt is True
        assert (ADRESSWECHSEL_FELD in row, row["kontakt"]["email"]) == (False, EMAIL)
        assert again == SCHIEDSRICHTER_TOKEN_UNKNOWN
        assert held == {NEW_EMAIL: []}


class TestTheView:
    def test_it_answers_exactly_its_side_its_state_and_its_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)

            return minted, await view(database, minted.token), await view(database, minted.stopp_token)

        minted, new_side, stop_side = on_a_league(mongo_replica_set_url, body)

        assert new_side.model_dump() == {"seite": "neu", "zustand": "gueltig", "gueltig_bis": minted.gueltig_bis}
        assert stop_side.model_dump() == {"seite": "bisherig", "zustand": "offen", "gueltig_bis": minted.gueltig_bis, "wirksam_ab": None}

    def test_a_lapsed_link_is_served_as_lapsed(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)

            return await view(database, minted.token, now=AFTER_THE_DEADLINE)

        assert on_a_league(mongo_replica_set_url, body).zustand == "abgelaufen"

    def test_a_link_to_a_barred_address_is_served_as_barred(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            await ban(database, client, email=NEW_EMAIL)

            return await view(database, minted.token)

        assert on_a_league(mongo_replica_set_url, body).zustand == "gesperrt"


class TestTheEditorsRead:
    """The editor marks a lapsed change by the backend's own rule, never by a clock the browser reads."""

    @pytest.mark.parametrize(("now", "abgelaufen"), [(NOW, False), (AFTER_THE_DEADLINE, True)], ids=["running", "lapsed"])
    def test_it_answers_whether_the_change_has_lapsed(self, mongo_replica_set_url: str, now: datetime, abgelaufen: bool):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)

            return await get_schiedsrichter_by_id(
                schiedsrichter_id=SCHIEDSRICHTER_OID,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                today=TODAY,
                germany_now=now,
            )

        assert on_a_league(mongo_replica_set_url, body).adresswechsel_abgelaufen is abgelaufen

    def test_an_unconfirmed_referees_lapsed_consent_link_is_answered_apart_from_the_absent_change(self, mongo_replica_set_url: str):
        """The consent flag reads the consent block alone: here only that link exists, and it has lapsed."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            read = await get_schiedsrichter_by_id(
                schiedsrichter_id=SCHIEDSRICHTER_OID,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                today="2026-04-16",
                germany_now=AFTER_THE_DEADLINE,
            )

            return read.bestaetigung_abgelaufen, read.adresswechsel_abgelaufen

        assert on_a_league(mongo_replica_set_url, body, confirmed=False) == (True, False)


class TestTheReSend:
    def test_it_replaces_the_link_restarts_the_deadline_and_keeps_the_stop_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await start(database, client, email=NEW_EMAIL)
            await database[Collection.SCHIEDSRICHTER].update_one(
                {"_id": SCHIEDSRICHTER_OID}, {"$set": {f"{ADRESSWECHSEL_FELD}.zustellung": dict(A_BOUNCE)}}
            )
            second = await resend(database, client, now=A_LATER_INSTANT)

            return first, second, await stored(database), await refused_code(view(database, first.token))

        first, second, row, old_link = on_a_league(mongo_replica_set_url, body)

        mint = second.adresswechsel
        assert (mint.email, mint.bisherige_email, mint.vorname, mint.stopp_token) == (NEW_EMAIL, EMAIL, "Ortwin", None)
        block = row[ADRESSWECHSEL_FELD]
        assert (block["token_hash"], block["stopp_hash"], "zustellung" in block) == (
            hash_token(str(mint.token)),
            hash_token(first.stopp_token),
            False,
        )
        assert als_utc(block["gueltig_bis"]) == A_LATER_INSTANT + timedelta(hours=24)
        assert old_link == SCHIEDSRICHTER_TOKEN_UNKNOWN

    def test_a_pending_address_barred_since_the_start_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(resend(database, client))

        assert on_a_league(mongo_replica_set_url, body) == SCHIEDSRICHTER_ADRESSE_GESPERRT

    def test_a_pending_address_another_pupil_has_come_to_sign_in_on_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)
            await a_pupil_at_the_address(database)

            return await refused_code(resend(database, client))

        assert on_a_league(mongo_replica_set_url, body) == SPIELER_ADRESSE_VERGEBEN

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
            minted = await start(database, client, email=NEW_EMAIL)
            discarded = await discard(database, client)

            return discarded, await stored(database), await refused_code(view(database, minted.token))

        discarded, row, old_link = on_a_league(mongo_replica_set_url, body)

        assert discarded.updated_document.adresswechsel is None
        assert ADRESSWECHSEL_FELD not in row
        assert row["kontakt"]["email"] == EMAIL
        assert old_link == SCHIEDSRICHTER_TOKEN_UNKNOWN

    def test_a_second_discard_answers_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)
            await discard(database, client)

            with pytest.raises(DocumentNotFoundException):
                await discard(database, client)

            return "not found"

        assert on_a_league(mongo_replica_set_url, body) == "not found"

    def test_the_whole_database_holds_the_discarded_address_nowhere_afterwards(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)
            await resend(database, client)
            await discard(database, client)

            return await where_held(database, NEW_EMAIL)

        assert on_a_league(mongo_replica_set_url, body) == {NEW_EMAIL: []}


class TestTheRefereesOwnTrailStays:
    """Each way a pending address ends takes that address out of the referee's log images and leaves the rest of each."""

    @pytest.mark.parametrize("ending", ["declined", "discarded", "replaced", "stopped"])
    def test_only_the_pending_block_leaves_the_log(self, mongo_replica_set_url: str, ending: str):
        """Restore the redaction by document and this fails: the referee's state before their own consent is in the log alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            resent = await resend(database, client)
            if ending == "declined":
                await answer(database, client, str(resent.adresswechsel.token), "abgelehnt")
            elif ending == "discarded":
                await discard(database, client)
            elif ending == "stopped":
                await stop(database, client, minted.stopp_token)
            else:
                await start(database, client, email=THIRD_EMAIL)

            return (
                await database[Collection.AKTIONEN]
                .find({"collection": str(Collection.SCHIEDSRICHTER), "document_id": SCHIEDSRICHTER_OID})
                .sort("_id", 1)
                .to_list(length=None)
            )

        rows = on_a_league(mongo_replica_set_url, body)
        held = [row for row in rows if ADRESSWECHSEL_FELD in row["before"]]

        assert held, "no image held the pending block, so the redaction proves nothing"
        assert [(row["before"][ADRESSWECHSEL_FELD], row["redacted_at"]) for row in held] == [(None, REDACTED_AT)] * len(held)
        # The referee's own record beside the block stands in every image holding it.
        assert {(row["before"]["kontakt"]["email"], row["before"][EINWILLIGUNG_FELD]["umfang"]) for row in held} == {
            (EMAIL, "kader_oeffentlich")
        }
        # The consent trail: the image the referee's own answer filed holds no change and stands as recorded.
        trail = [row for row in rows if EINWILLIGUNG_FELD not in row["before"]]
        assert trail, "the seeded history filed no image from before the referee's answer"
        assert [(row["before"]["name"], row["redacted_at"]) for row in trail] == [(NAME, None)] * len(trail)
        assert NEW_EMAIL not in str(rows)


class TestTheDeliveryState:
    def test_a_report_on_the_address_link_lands_on_its_block_and_not_on_the_consent_links(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)
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
            await start(database, client, email=NEW_EMAIL)
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
            await erased(database, client, EMAIL, germany_now=NOW)

            return await where_held(database, NEW_EMAIL)

        assert on_a_league(mongo_replica_set_url, body) == {NEW_EMAIL: []}
