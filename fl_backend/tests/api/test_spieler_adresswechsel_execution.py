"""
API · a pupil's address change, driven end to end against the shipped validators

A pupil's new address waits in its own block until its mailbox confirms it, the stored address keeping the record and
the sign-in meanwhile: the referee's flow, twinned (`tests/api/test_schiedsrichter_adresswechsel_execution.py`). The
person's own start and the records the effect moves beside the pupil row are
`tests/api/test_konto_adresswechsel_execution.py`'s; the decisions underneath are
`tests/api/test_spieler_adresswechsel_refusal.py`'s.
"""

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.crud import find_subjekt
from app.api.identitaet.router import get_anmeldung
from app.api.identitaet.schemas import FLSubjektPayload
from app.api.konto.router import post_adresswechsel as start_on_the_account_page
from app.api.konto.schemas import FLKontoAdresswechselPayload
from app.api.registrierungen.person_router import aufnehmen
from app.api.registrierungen.schemas import FLRegistrierungAufnehmenPayload
from app.api.spieler.admin_router import delete_adresswechsel, einladen_adresswechsel, get_spieler_memberships, post_adresswechsel
from app.api.spieler.adresswechsel_router import get_adresswechsel_ansicht, post_adresswechsel_antwort, post_adresswechsel_stopp
from app.api.spieler.crud import erase_person_in_session
from app.api.spieler.schemas import (
    FLSpielerAdminSingleResponse,
    FLSpielerAdresswechselAnsichtPayload,
    FLSpielerAdresswechselAntwortPayload,
    FLSpielerAdresswechselAntwortResponse,
    FLSpielerAdresswechselPayload,
    FLSpielerAdresswechselStoppPayload,
)
from app.api.spieler.services import (
    SPIELER_ADRESSE_GESPERRT,
    SPIELER_ADRESSE_UNVERAENDERT,
    SPIELER_ADRESSE_VERGEBEN,
    SPIELER_ADRESSWECHSEL_FELD,
    SPIELER_BESTAETIGUNG_GESPERRT,
    SPIELER_ERSETZTE_ADRESSE_GESPERRT,
    SPIELER_KEINE_ADRESSE,
    SPIELER_NAME_IM_GRUND,
    SPIELER_TOKEN_EXPIRED,
    SPIELER_TOKEN_UNKNOWN,
    build_address_holder_filter,
    build_pending_spieler_adresswechsel_filter,
    build_spieler_adresswechsel_filter,
)
from app.api.zustellung.router import angenommen_zustellung
from app.api.zustellung.schemas import FLZustellungAngenommenPayload
from app.core.collections import Collection
from app.core.exceptions import DOCUMENT_NOT_FOUND, DUPLICATE_KEY, DocumentNotFoundException, WriteRefusalException
from app.core.recording import log_stamp
from app.core.sentinels import GHOST_SPIELER_ID
from app.core.transactions import transaction_session
from app.shared.adresswechsel import als_utc, compose_block
from tests import documents
from tests.bans import ban_list, ban_through_the_route
from tests.config import build_test_config, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.holds import HeldCollection
from tests.records import record_collections
from tests.whole_database import where_held
from tests.worker import worker_database

# Module level: every case below reaches a real mongod, each write being one transaction.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spieler_adresswechsel_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
A_LATER_INSTANT = NOW + timedelta(days=4)
# An hour past the deadline a link minted at `NOW` carries.
AFTER_THE_DEADLINE = NOW + timedelta(hours=25)
# Written out rather than computed from `log_stamp`, which would agree with any conversion of `NOW`.
REDACTED_AT = "2026-04-01T10:30:00+00:00"

SPIELER_OID = ObjectId("6890a1b2c3d4e5f607840001")
OTHER_OID = ObjectId("6890a1b2c3d4e5f607840002")
NO_ADDRESS_OID = ObjectId("6890a1b2c3d4e5f607840003")
ABSENT_OID = ObjectId("6890a1b2c3d4e5f607849999")

VORNAME = "Lenore"
EMAIL = "lenore.quastenbach@schule.example"
NEW_EMAIL = "lenore.q@neupost.example.org"
# How a person may type the new address: the payload keeps the local part's case. A case requesting this spelling
# fails where a writer judges the address as typed rather than its fold.
NEW_AS_TYPED = "Lenore.Q@NeuPost.Example.org"
THIRD_EMAIL = "quastenbach.lenore@drittpost.example.net"
OTHER_EMAIL = "jonte.wirbelauer@schule.example"
# The address the pupil's own registration carries where it is not the one on file.
REGISTERED_EMAIL = "lenore@zweitpost.example"
# How an administrator checked who asks, naming nobody.
GRUND = "Postfach von der Schule gelöscht, bestätigt durch die Ansprechperson am 21.10.2026"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607840101")
REGISTRIERUNG_OID = ObjectId("6890a1b2c3d4e5f607840102")
# The seat `documents.kontaktperson_document` gives the team's confirmed contact person, who admits.
SEAT = "anna@example.com"

MESSAGE_ID = "1b6f7a52-29c1-4f0e-9b7a-6d1c2e3f4a5c"
ACCEPTED_AT = "2026-04-01T10:00:00.000000+00:00"
A_BOUNCE: Mapping[str, Any] = {"nachricht_id": "m-1", "stand": "unzustellbar", "grund": "NoEmail", "am": ACCEPTED_AT}

# Who signs in at each pupil's address, the person's own start being keyed on it.
ADDRESS_OF = {SPIELER_OID: EMAIL, OTHER_OID: OTHER_EMAIL}


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


async def start(database: AsyncDatabase, client: AsyncMongoClient, *, email: str, spieler_id: ObjectId = SPIELER_OID) -> Any:
    """The person's own start on their account page, which the new mailbox's confirmation makes take effect at once."""

    return await start_on_the_account_page(
        identifier=ADDRESS_OF[spieler_id],
        adresswechsel_data=FLKontoAdresswechselPayload(email=email),
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        config=build_test_config(),
        germany_now=NOW,
    )


async def request(
    database: AsyncDatabase, client: AsyncMongoClient, *, email: str, grund: str | None = GRUND, spieler_id: ObjectId = SPIELER_OID
) -> Any:
    """An administrator's start, with a reason by default, so the new mailbox is minted its link at once."""

    return await post_adresswechsel(
        spieler_id=spieler_id,
        adresswechsel_data=FLSpielerAdresswechselPayload.model_validate({"email": email, "grund": grund}),
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        germany_now=NOW,
    )


async def resend(database: AsyncDatabase, client: AsyncMongoClient, *, spieler_id: ObjectId = SPIELER_OID, now: datetime = NOW) -> Any:
    return await einladen_adresswechsel(
        spieler_id=spieler_id,
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        sperrliste=ban_list(database),
        db=client,
        germany_now=now,
    )


async def discard(database: AsyncDatabase, client: AsyncMongoClient, *, spieler_id: ObjectId = SPIELER_OID, spieler: Any = None) -> Any:
    return await delete_adresswechsel(
        spieler_id=spieler_id,
        spieler_collection=spieler if spieler is not None else database[Collection.SPIELER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        config=build_test_config(),
        germany_now=NOW,
    )


async def view(database: AsyncDatabase, token: str, *, now: datetime = NOW) -> Any:
    return (
        await get_adresswechsel_ansicht(
            ansicht_data=FLSpielerAdresswechselAnsichtPayload(token=token),
            spieler_collection=database[Collection.SPIELER],
            sperrliste=ban_list(database),
            germany_now=now,
        )
    ).ansicht


async def answer(
    database: AsyncDatabase, client: AsyncMongoClient, token: str, antwort: str, *, now: datetime = NOW, spieler: Any = None
) -> Any:
    replaced = {} if spieler is None else {"spieler_collection": spieler}

    return await post_adresswechsel_antwort(
        antwort_data=FLSpielerAdresswechselAntwortPayload.model_validate({"token": token, "antwort": antwort}),
        records=record_collections(database, **replaced),
        spieler_collection=replaced.get("spieler_collection", database[Collection.SPIELER]),
        schiedsrichter_collection=replaced.get("schiedsrichter_collection", database[Collection.SCHIEDSRICHTER]),
        saison_teams_collection=replaced.get("saison_teams_collection", database[Collection.SAISON_TEAMS]),
        bewerbungen_collection=replaced.get("bewerbungen_collection", database[Collection.BEWERBUNGEN]),
        registrierungen_collection=replaced.get("registrierungen_collection", database[Collection.REGISTRIERUNGEN]),
        sperrliste=ban_list(database),
        aktionen_collection=database[Collection.AKTIONEN],
        adressanker_collection=database[Collection.ADRESSANKER],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        db=client,
        config=build_test_config(),
        germany_now=now,
    )


async def stop(database: AsyncDatabase, client: AsyncMongoClient, token: str) -> Any:
    return await post_adresswechsel_stopp(
        stopp_data=FLSpielerAdresswechselStoppPayload(token=token),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        config=build_test_config(),
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


async def admit(database: AsyncDatabase, client: AsyncMongoClient, *, email: str, spieler_id: ObjectId | None) -> Any:
    """The pupil's own confirmed registration, carrying `email`, admitted by the team's contact person into `spieler_id`."""

    await database[Collection.TEAMS].insert_one(documents.team_document(TEAM_OID, "Zorbanax", "ZO"))
    await database[Collection.SAISON_TEAMS].insert_one(
        documents.saison_team_document(
            SAISON_ID,
            TEAM_OID,
            "Zorbanax",
            "ZO",
            kontakte={
                "trainer": None,
                "ansprechperson": documents.kontaktperson_document("Anna", bestaetigt_am="2026-03-21"),
                "stellvertretung": None,
                "trainer_ist_zugleich": None,
            },
        )
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        documents.registrierung_document(
            REGISTRIERUNG_OID,
            email,
            saison_id=SAISON_ID,
            team_id=TEAM_OID,
            vorname=VORNAME,
            nachname="Quastenbach",
            token="the-registration-s-own-link",
            eingereicht_am="2026-03-30",
            frist="2026-04-06",
            bestaetigt={
                "geburtsdatum": "2009-05-04",
                "umfang": "intern",
                "medien": False,
                "text_version": "2026-09",
                "today": "2026-03-31",
                "am": "2026-03-31T08:00:00+00:00",
            },
        )
    )

    return await aufnehmen(
        registrierung_id=REGISTRIERUNG_OID,
        aufnahme_data=FLRegistrierungAufnehmenPayload(spieler_id=spieler_id),
        identifier=SEAT,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saisons_collection=database[Collection.SAISONS],
        spieler_collection=database[Collection.SPIELER],
        records=record_collections(database),
        spieltage_collection=database[Collection.SPIELTAGE],
        aktionen_collection=database[Collection.AKTIONEN],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
        germany_now=NOW,
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


async def remove_the_address_by_hand(database: AsyncDatabase) -> None:
    """The one way a pupil comes to hold a change and no address: no route removes `email` while a change waits."""

    await database[Collection.SPIELER].update_one({"_id": SPIELER_OID}, {"$unset": {"email": ""}})


async def give_the_pupil_a_change_by_hand(database: AsyncDatabase, spieler_id: ObjectId) -> str:
    """A change pending on a pupil no start reaches, the one holding no address among them; answers its new mailbox's raw link."""

    await database[Collection.SPIELER].update_one(
        {"_id": spieler_id},
        {
            "$set": {
                SPIELER_ADRESSWECHSEL_FELD: compose_block(
                    email=NEW_EMAIL, weg="konto", token_hash=hash_token("by-hand"), stopp_hash=hash_token("stop-by-hand"), grund=None, now=NOW
                )
            }
        },
    )

    return "by-hand"


def refusal_of(outcome: BaseException | object) -> str:
    """The code one refused writer answers with: its own refusal, or the index's, which the API answers as `DB-COMMON-002`."""

    if isinstance(outcome, WriteRefusalException):
        return outcome.error_code
    if isinstance(outcome, DuplicateKeyError):
        return DUPLICATE_KEY
    if isinstance(outcome, DocumentNotFoundException):
        return outcome.error_code
    raise AssertionError(f"{outcome!r} is neither an answer nor a refusal")


class _HoldsAfterItsRead(HeldCollection):
    """A writer held after its read through one filter until another writer has committed.

    Records each such read and each write's failure as well: how many attempts ran, and how the server ordered the two.
    """

    MISSED = "the writer answered without its read, so nothing held it across the other writer's commit"

    def __init__(self, collection: Any, committed: asyncio.Event, *, read: Mapping[str, Any]) -> None:
        super().__init__(collection, committed)
        self._read = read
        self.reads = 0
        self.write_failures: list[str] = []

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._collection.find_one(*args, **kwargs)
        if kwargs.get("filter", args[0] if args else {}) == self._read:
            self.reads += 1
            await self.hold()

        return found

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        try:
            return await self._collection.find_one_and_update(*args, **kwargs)
        except Exception as failure:
            self.write_failures.append(f"{type(failure).__name__}:{getattr(failure, 'code', None)}")
            raise


async def held_against(
    held: HeldCollection, committed: asyncio.Event, writer: Awaitable[Any], rival: Callable[[], Awaitable[Any]]
) -> tuple[Any, BaseException | Any]:
    """The rival's answer and then the held writer's, the writer released once the rival has committed."""

    task = asyncio.ensure_future(writer)
    await held.until_held(task)
    try:
        answered = await rival()
    except BaseException:
        await held.abandon(task)
        raise
    committed.set()

    return answered, (await asyncio.gather(task, return_exceptions=True))[0]


async def the_pupils_images(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return (
        await database[Collection.AKTIONEN]
        .find({"collection": str(Collection.SPIELER), "document_id": SPIELER_OID})
        .sort("_id", 1)
        .to_list(length=None)
    )


class TestTheRequest:
    """An administrator's start, for a person who cannot sign in: nothing moves until the new mailbox, and maybe time, decide."""

    def test_without_a_reason_it_asks_the_address_on_file_first_and_mints_the_new_mailbox_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored(database)

            return before, await request(database, client, email=NEW_EMAIL, grund=None), await stored(database)

        before, minted, row = on_a_league(mongo_replica_set_url, body)

        mint = minted.adresswechsel
        assert (mint.weg, mint.token, mint.email, mint.bisherige_email, mint.vorname) == ("freigabe", None, NEW_EMAIL, EMAIL, VORNAME)
        assert mint.stopp_token is not None
        block = row[SPIELER_ADRESSWECHSEL_FELD]
        assert (block["weg"], block["token_hash"], block["stopp_hash"], block["grund"]) == (
            "freigabe",
            None,
            hash_token(mint.stopp_token),
            None,
        )
        assert als_utc(block["gueltig_bis"]) == mint.gueltig_bis
        # The stored address stays in force, and nothing else of the row moves.
        assert {key: value for key, value in row.items() if key != SPIELER_ADRESSWECHSEL_FELD} == before

    def test_with_a_reason_it_mints_the_new_mailbox_its_link_and_records_the_reason(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await request(database, client, email=NEW_EMAIL), await stored(database)

        minted, row = on_a_league(mongo_replica_set_url, body)

        mint = minted.adresswechsel
        assert (mint.weg, mint.adresse_belegt) == ("wartezeit", False)
        assert mint.token is not None and mint.stopp_token is not None
        assert (row[SPIELER_ADRESSWECHSEL_FELD]["token_hash"], row[SPIELER_ADRESSWECHSEL_FELD]["grund"]) == (hash_token(mint.token), GRUND)

    def test_it_warns_where_the_new_address_holds_records_of_its_own(self, mongo_replica_set_url: str):
        """The administrator is owed the answer the person's own start never gives: the confirmation would join the two."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].insert_one(
                documents.schiedsrichter_document(
                    ObjectId(),
                    email=NEW_EMAIL,
                    name="Somebody Else",
                    default_payment=20,
                    einwilligung=documents.eigene_einwilligung_document(text_version="v1", bestaetigt_am="2026-03-01"),
                )
            )

            return (await request(database, client, email=NEW_EMAIL)).adresswechsel.adresse_belegt

        assert on_a_league(mongo_replica_set_url, body) is True

    def test_a_second_request_replaces_the_change_and_kills_the_first_links(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await request(database, client, email=NEW_EMAIL)
            third = await request(database, client, email=THIRD_EMAIL)

            return (
                third,
                await stored(database),
                await refused_code(view(database, first.adresswechsel.token)),
                await refused_code(view(database, first.adresswechsel.stopp_token)),
            )

        third, row, old_link, old_stop = on_a_league(mongo_replica_set_url, body)

        assert (row[SPIELER_ADRESSWECHSEL_FELD]["email"], row[SPIELER_ADRESSWECHSEL_FELD]["token_hash"]) == (
            THIRD_EMAIL,
            hash_token(third.adresswechsel.token),
        )
        assert row["email"] == EMAIL
        assert (old_link, old_stop) == (SPIELER_TOKEN_UNKNOWN, SPIELER_TOKEN_UNKNOWN)

    def test_the_whole_database_holds_the_replaced_address_nowhere_afterwards(self, mongo_replica_set_url: str):
        """The first request, its re-send and the replacing request each file an image carrying the replaced address."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_AS_TYPED)
            await resend(database, client)
            await request(database, client, email=THIRD_EMAIL)

            return await where_held(database, NEW_EMAIL, THIRD_EMAIL, folded=True)

        held = on_a_league(mongo_replica_set_url, body)

        assert held[NEW_EMAIL] == []
        assert held[THIRD_EMAIL] != [], "the scan read nothing the replacing request wrote"


class TestTheRequestsRefusals:
    """Each refusal leaves the row as it stood: no block, and the stored address."""

    def test_a_barred_new_address_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(request(database, client, email=NEW_AS_TYPED)), await stored(database)

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

    @pytest.mark.parametrize("grund", ["Lenore hat angerufen", "Bitte von QUASTENBACH per Telefon"], ids=["forename", "surname-upper"])
    def test_a_reason_naming_the_person_is_refused(self, mongo_replica_set_url: str, grund: str):
        """The reason rides the start's log row a year, where no erasure's redaction reaches it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(request(database, client, email=NEW_EMAIL, grund=grund)), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_NAME_IM_GRUND
        assert SPIELER_ADRESSWECHSEL_FELD not in row

    @pytest.mark.parametrize("spieler_id", [GHOST_SPIELER_ID, ABSENT_OID], ids=["the-sentinel", "no-such-pupil"])
    def test_an_id_naming_nobody_answers_not_found(self, mongo_replica_set_url: str, spieler_id: ObjectId):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(documents.spieler_document(GHOST_SPIELER_ID, VORNAME, None, email=THIRD_EMAIL))
            with pytest.raises(DocumentNotFoundException):
                await request(database, client, email=NEW_EMAIL, spieler_id=spieler_id)

            return await where_held(database, NEW_EMAIL)

        assert on_a_league(mongo_replica_set_url, body) == {NEW_EMAIL: []}


class TestWhoTheNewMailboxIsMeanwhile:
    """Until the change takes effect, the new mailbox holds nothing: no read keys on the pending address."""

    def test_the_gate_and_the_subject_read_see_the_pupil_at_the_old_address_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)

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
            minted = await start(database, client, email=NEW_AS_TYPED)
            answered = await answer(database, client, minted.token, "bestaetigt")

            return before, minted, answered, await stored(database)

        before, minted, answered, row = on_a_league(mongo_replica_set_url, body)

        # The premise: the address as the payload rule keeps it is not its fold, or the case proves nothing.
        assert minted.email != NEW_EMAIL
        assert answered.antwort == "bestaetigt"
        assert row == {**before, "email": NEW_EMAIL}

    def test_the_record_then_belongs_to_the_new_mailbox_and_no_longer_to_the_old(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_AS_TYPED)
            await answer(database, client, minted.token, "bestaetigt")

            return (
                {email: await holds_an_account_record(database, email) for email in (EMAIL, NEW_EMAIL)},
                {email: await subject_pupils(database, email) for email in (EMAIL, NEW_EMAIL)},
            )

        gate, subject = on_a_league(mongo_replica_set_url, body)

        assert gate == {EMAIL: False, NEW_EMAIL: True}
        assert subject == {EMAIL: [], NEW_EMAIL: [SPIELER_OID]}

    def test_a_reopened_link_opens_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            await answer(database, client, minted.token, "bestaetigt")

            return (
                await refused_code(view(database, minted.token)),
                await refused_code(answer(database, client, minted.token, "bestaetigt")),
                await refused_code(stop(database, client, minted.stopp_token)),
            )

        codes = on_a_league(mongo_replica_set_url, body)

        assert codes == (SPIELER_TOKEN_UNKNOWN,) * 3

    def test_a_change_started_with_a_reason_is_confirmed_and_waits(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await request(database, client, email=NEW_EMAIL)
            answered = await answer(database, client, minted.adresswechsel.token, "bestaetigt")

            return minted, answered, await stored(database), await refused_code(view(database, minted.adresswechsel.token))

        minted, answered, row, spent = on_a_league(mongo_replica_set_url, body)

        assert (answered.mitteilung, answered.wirksam_ab) == (None, NOW + timedelta(days=7))
        block = row[SPIELER_ADRESSWECHSEL_FELD]
        assert (row["email"], block["token_hash"], block["gueltig_bis"], als_utc(block["wirksam_ab"])) == (
            EMAIL,
            None,
            None,
            answered.wirksam_ab,
        )
        # The new mailbox's link is spent; the stop link stays until the change takes effect.
        assert spent == SPIELER_TOKEN_UNKNOWN
        assert block["stopp_hash"] == hash_token(minted.adresswechsel.stopp_token)


class TestTheConfirmationsRefusals:
    """Each refusal moves nothing: the stored address stays, and so does the change."""

    def test_past_the_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_EMAIL)).token
            before = await stored(database)

            return await refused_code(answer(database, client, token, "bestaetigt", now=AFTER_THE_DEADLINE)), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_TOKEN_EXPIRED
        assert row == before

    def test_to_an_address_barred_since_the_start(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_AS_TYPED)).token
            await ban(database, client, email=NEW_EMAIL)
            before = await stored(database)

            return await refused_code(answer(database, client, token, "bestaetigt")), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_BESTAETIGUNG_GESPERRT
        assert row == before

    def test_from_a_stored_address_barred_since_the_start(self, mongo_replica_set_url: str):
        """A barred person cannot move their record off the address the ban keys on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_EMAIL)).token
            await ban(database, client, email=EMAIL)
            before = await stored(database)

            return await refused_code(answer(database, client, token, "bestaetigt")), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_ERSETZTE_ADRESSE_GESPERRT
        assert row == before

    def test_a_ban_on_both_addresses_answers_the_link_s_own(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_EMAIL)).token
            await ban(database, client, email=EMAIL)
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(answer(database, client, token, "bestaetigt"))

        assert on_a_league(mongo_replica_set_url, body) == SPIELER_BESTAETIGUNG_GESPERRT

    def test_to_an_address_another_pupil_has_come_to_sign_in_on(self, mongo_replica_set_url: str):
        """The pre-read refuses it by name; `uniq_spieler_email` stands behind it for the race the read cannot see."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_AS_TYPED)).token
            await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})
            before = await stored(database)

            return await refused_code(answer(database, client, token, "bestaetigt")), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_ADRESSE_VERGEBEN
        assert row == before

    def test_to_an_address_the_sentinel_was_given_by_hand(self, mongo_replica_set_url: str):
        """The holder read takes `uniq_spieler_email`'s whole population, the sentinel included, so the view's state and this refusal agree."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_EMAIL)).token
            await database[Collection.SPIELER].insert_one(documents.spieler_document(GHOST_SPIELER_ID, VORNAME, None, email=NEW_EMAIL))
            before = await stored(database)

            return await refused_code(answer(database, client, token, "bestaetigt")), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_ADRESSE_VERGEBEN
        assert row == before

    def test_for_a_pupil_whose_address_was_removed_by_hand(self, mongo_replica_set_url: str):
        """Confirmed, the change would enter an address on a pupil holding none, which no start ever may."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_EMAIL)).token
            await remove_the_address_by_hand(database)
            before = await stored(database)

            return await refused_code(answer(database, client, token, "bestaetigt")), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_KEINE_ADRESSE
        assert row == before

    def test_for_a_pupil_a_hand_edit_left_outside_its_address_s_records_it_is_discarded(self, mongo_replica_set_url: str):
        """An address stored unfolded: no record of the address carries the change, so the press discards it as the hourly pass would."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_EMAIL)).token
            await database[Collection.SPIELER].update_one({"_id": SPIELER_OID}, {"$set": {"email": EMAIL.upper()}})

            return await refused_code(answer(database, client, token, "bestaetigt")), await stored(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_TOKEN_UNKNOWN
        assert (row["email"], SPIELER_ADRESSWECHSEL_FELD in row) == (EMAIL.upper(), False)


class TestTheDecline:
    def test_it_removes_the_change_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored(database)
            token = (await start(database, client, email=NEW_EMAIL)).token
            answered = await answer(database, client, token, "abgelehnt")

            return before, answered, await stored(database)

        before, answered, row = on_a_league(mongo_replica_set_url, body)

        assert (answered.antwort, answered.wirksam_ab, answered.mitteilung) == ("abgelehnt", None, None)
        assert row == before

    @pytest.mark.parametrize("late_or_barred", ["late", "barred", "replaced-barred"])
    def test_a_lapsed_or_barred_link_still_takes_it_and_leaves_the_address_nowhere(self, mongo_replica_set_url: str, late_or_barred: str):
        """A decline removes an address nobody proved, which neither the deadline nor a ban on either address has a reason to keep.

        The re-send and the decline each file an image carrying the address, which the decline's redaction reaches.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_AS_TYPED)
            token = (await resend(database, client)).adresswechsel.token
            if late_or_barred != "late":
                # Hashed, so the ban list itself holds the address nowhere for the scan below to find.
                await ban(database, client, email=NEW_EMAIL if late_or_barred == "barred" else EMAIL)
            await answer(database, client, token, "abgelehnt", now=AFTER_THE_DEADLINE if late_or_barred == "late" else NOW)

            return await stored(database), await where_held(database, NEW_EMAIL, folded=True)

        row, held = on_a_league(mongo_replica_set_url, body)

        assert (SPIELER_ADRESSWECHSEL_FELD in row, row["email"]) == (False, EMAIL)
        assert held == {NEW_EMAIL: []}


class TestTheStop:
    """The address on file's stop link ends the change in every state, refused nothing but a token no pupil holds."""

    @pytest.mark.parametrize("when", ["running", "late", "barred", "waiting"])
    def test_it_ends_the_change_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str, when: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = (await request(database, client, email=NEW_AS_TYPED)).adresswechsel
            await resend(database, client)
            if when == "barred":
                await ban(database, client, email=EMAIL)
            elif when == "waiting":
                await answer(database, client, (await resend(database, client)).adresswechsel.token, "bestaetigt")
            answered = await stop(database, client, minted.stopp_token)

            return answered, await stored(database), await where_held(database, NEW_EMAIL, folded=True)

        answered, row, held = on_a_league(mongo_replica_set_url, body)

        assert answered.gestoppt is True
        assert (SPIELER_ADRESSWECHSEL_FELD in row, row["email"]) == (False, EMAIL)
        assert held == {NEW_EMAIL: []}

    def test_a_second_stop_and_the_new_mailbox_s_link_open_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            await stop(database, client, minted.stopp_token)

            return await refused_code(stop(database, client, minted.stopp_token)), await refused_code(view(database, minted.token))

        assert on_a_league(mongo_replica_set_url, body) == (SPIELER_TOKEN_UNKNOWN, SPIELER_TOKEN_UNKNOWN)


class TestTheView:
    def test_the_new_mailbox_s_link_answers_exactly_its_side_its_state_and_its_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            return minted, await view(database, minted.token)

        minted, seen = on_a_league(mongo_replica_set_url, body)

        assert seen.model_dump() == {"seite": "neu", "zustand": "gueltig", "gueltig_bis": minted.gueltig_bis}

    @pytest.mark.parametrize(
        ("grund", "confirmed", "zustand"),
        [(None, False, "freigabe_offen"), (GRUND, False, "offen"), (GRUND, True, "wartezeit")],
        ids=["awaiting-approval", "awaiting-the-new-mailbox", "waiting"],
    )
    def test_the_stop_link_answers_the_step_the_change_waits_on_and_nothing_else(
        self, mongo_replica_set_url: str, grund: str | None, confirmed: bool, zustand: str
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = (await request(database, client, email=NEW_EMAIL, grund=grund)).adresswechsel
            if confirmed:
                await answer(database, client, minted.token, "bestaetigt")

            return await view(database, minted.stopp_token)

        seen = on_a_league(mongo_replica_set_url, body)

        assert (seen.seite, seen.zustand) == ("bisherig", zustand)
        assert set(seen.model_dump()) == {"seite", "zustand", "gueltig_bis", "wirksam_ab"}
        assert (seen.wirksam_ab is not None) is confirmed

    @pytest.mark.parametrize(
        ("ban_on", "held_by_another", "now", "zustand", "code"),
        [
            pytest.param((), False, AFTER_THE_DEADLINE, "abgelaufen", SPIELER_TOKEN_EXPIRED, id="lapsed"),
            pytest.param((NEW_EMAIL,), False, NOW, "gesperrt", SPIELER_BESTAETIGUNG_GESPERRT, id="new-address-barred"),
            pytest.param(
                (NEW_EMAIL, EMAIL), False, AFTER_THE_DEADLINE, "gesperrt", SPIELER_BESTAETIGUNG_GESPERRT, id="the-link-s-own-ban-first"
            ),
            pytest.param((EMAIL,), False, NOW, "nicht_bestaetigbar", SPIELER_ERSETZTE_ADRESSE_GESPERRT, id="replaced-address-barred"),
            pytest.param((), True, NOW, "nicht_bestaetigbar", SPIELER_ADRESSE_VERGEBEN, id="new-address-held-by-another"),
            pytest.param((EMAIL,), True, AFTER_THE_DEADLINE, "abgelaufen", SPIELER_TOKEN_EXPIRED, id="the-deadline-before-either"),
        ],
    )
    def test_it_ranks_the_states_as_the_press_refuses(
        self, mongo_replica_set_url: str, ban_on: tuple[str, ...], held_by_another: bool, now: datetime, zustand: str, code: str
    ):
        """And the press refuses in that rank, so a refused confirmation names what a reload of the link shows."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_AS_TYPED)).token
            for email in ban_on:
                await ban(database, client, email=email)
            if held_by_another:
                await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})

            return (await view(database, token, now=now)).zustand, await refused_code(answer(database, client, token, "bestaetigt", now=now))

        assert on_a_league(mongo_replica_set_url, body) == (zustand, code)

    def test_a_token_no_pupil_holds_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)

            return await refused_code(view(database, "a-token-nobody-was-sent"))

        assert on_a_league(mongo_replica_set_url, body) == SPIELER_TOKEN_UNKNOWN

    def test_a_pupil_whose_address_was_removed_by_hand_reads_as_not_confirmable(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_EMAIL)).token
            await remove_the_address_by_hand(database)

            return (await view(database, token)).zustand

        assert on_a_league(mongo_replica_set_url, body) == "nicht_bestaetigbar"


class TestTheReSend:
    def test_it_replaces_the_link_restarts_the_deadline_and_keeps_the_stop_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await start(database, client, email=NEW_EMAIL)
            await database[Collection.SPIELER].update_one(
                {"_id": SPIELER_OID}, {"$set": {f"{SPIELER_ADRESSWECHSEL_FELD}.zustellung": dict(A_BOUNCE)}}
            )
            second = await resend(database, client, now=A_LATER_INSTANT)

            return (
                first,
                second,
                await stored(database),
                await refused_code(view(database, first.token)),
                await view(database, first.stopp_token),
            )

        first, second, row, old_link, stop_side = on_a_league(mongo_replica_set_url, body)

        mint = second.adresswechsel
        assert (mint.weg, mint.stopp_token, mint.email, mint.bisherige_email, mint.vorname) == ("konto", None, NEW_EMAIL, EMAIL, VORNAME)
        block = row[SPIELER_ADRESSWECHSEL_FELD]
        assert (block["token_hash"], block["stopp_hash"], block["verschickt_am"], "zustellung" in block) == (
            hash_token(str(mint.token)),
            hash_token(first.stopp_token),
            "2026-04-05",
            False,
        )
        assert als_utc(block["gueltig_bis"]) == mint.gueltig_bis == A_LATER_INSTANT + timedelta(hours=24)
        assert old_link == SPIELER_TOKEN_UNKNOWN
        assert stop_side.seite == "bisherig"

    @pytest.mark.parametrize("grund", [None, "confirmed"], ids=["awaiting-approval", "confirmed-and-waiting"])
    def test_a_change_not_waiting_on_the_new_mailbox_answers_not_found(self, mongo_replica_set_url: str, grund: str | None):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = (await request(database, client, email=NEW_EMAIL, grund=None if grund is None else GRUND)).adresswechsel
            if grund is not None:
                await answer(database, client, str(minted.token), "bestaetigt")
            with pytest.raises(DocumentNotFoundException):
                await resend(database, client)

            return "not found"

        assert on_a_league(mongo_replica_set_url, body) == "not found"

    def test_a_pending_address_barred_since_the_start_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await start(database, client, email=NEW_AS_TYPED)
            await ban(database, client, email=NEW_EMAIL)

            return await refused_code(resend(database, client)), first, await stored(database)

        code, first, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_ADRESSE_GESPERRT
        assert row[SPIELER_ADRESSWECHSEL_FELD]["token_hash"] == hash_token(first.token)

    def test_a_pending_address_another_pupil_has_come_to_sign_in_on_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_AS_TYPED)
            await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})

            return await refused_code(resend(database, client))

        assert on_a_league(mongo_replica_set_url, body) == SPIELER_ADRESSE_VERGEBEN

    def test_a_pupil_whose_address_was_removed_by_hand_is_refused(self, mongo_replica_set_url: str):
        """The address on file is the change's owner, so a re-send with none would answer the text "None" as its address."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)
            await remove_the_address_by_hand(database)
            before = await stored(database)

            return await refused_code(resend(database, client)), before, await stored(database)

        code, before, row = on_a_league(mongo_replica_set_url, body)

        assert code == SPIELER_KEINE_ADRESSE
        assert row == before

    @pytest.mark.parametrize("spieler_id", [SPIELER_OID, GHOST_SPIELER_ID], ids=["nothing-pending", "the-sentinel"])
    def test_a_pupil_holding_no_pending_change_answers_not_found(self, mongo_replica_set_url: str, spieler_id: ObjectId):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # The sentinel given a block by hand, so only the by-id filter keeps it out.
            await database[Collection.SPIELER].insert_one(documents.spieler_document(GHOST_SPIELER_ID, VORNAME, None))
            await give_the_pupil_a_change_by_hand(database, GHOST_SPIELER_ID)
            with pytest.raises(DocumentNotFoundException):
                await resend(database, client, spieler_id=spieler_id)

            return "not found"

        assert on_a_league(mongo_replica_set_url, body) == "not found"


class TestTheDiscard:
    def test_it_keeps_the_address_removes_the_change_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await stored(database)
            await start(database, client, email=NEW_AS_TYPED)
            token = (await resend(database, client)).adresswechsel.token
            discarded = await discard(database, client)

            return (
                before,
                discarded,
                await stored(database),
                await refused_code(view(database, token)),
                await where_held(database, NEW_EMAIL, folded=True),
            )

        before, discarded, row, old_link, held = on_a_league(mongo_replica_set_url, body)

        assert (discarded.spieler_id, discarded.vorname) == (SPIELER_OID, VORNAME)
        assert row == before
        assert old_link == SPIELER_TOKEN_UNKNOWN
        assert held == {NEW_EMAIL: []}

    def test_a_second_discard_answers_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)
            await discard(database, client)

            with pytest.raises(DocumentNotFoundException):
                await discard(database, client)

            return "not found"

        assert on_a_league(mongo_replica_set_url, body) == "not found"


class TestTwoWritersAtOnce:
    """Each writer judges inside its own transaction, so two running at once settle to one outcome, whichever commits first.

    The held cases fix each interleaving the unheld ones leave to the scheduler, so every branch runs every time.
    """

    def test_two_pupils_confirming_one_address_leave_it_one_holder(self, mongo_replica_set_url: str):
        """The loser meets the winner's key in `uniq_spieler_email` as a write conflict, whose retry the in-session read refuses."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            ours = (await start(database, client, email=NEW_EMAIL)).token
            theirs = (await start(database, client, email=NEW_EMAIL, spieler_id=OTHER_OID)).token
            outcomes = await asyncio.gather(
                answer(database, client, ours, "bestaetigt"), answer(database, client, theirs, "bestaetigt"), return_exceptions=True
            )
            holders = await database[Collection.SPIELER].find({"email": NEW_EMAIL}, projection={"_id": 1}).to_list(length=None)

            return outcomes, [holder["_id"] for holder in holders], {row: await stored(database, row) for row in (SPIELER_OID, OTHER_OID)}

        outcomes, holders, rows = on_a_league(mongo_replica_set_url, body)

        answered = [outcome for outcome in outcomes if isinstance(outcome, FLSpielerAdresswechselAntwortResponse)]
        assert len(answered) == 1, outcomes
        assert [refusal_of(outcome) for outcome in outcomes if not isinstance(outcome, FLSpielerAdresswechselAntwortResponse)] == [
            SPIELER_ADRESSE_VERGEBEN
        ]
        assert len(holders) == 1
        # The loser moved nothing: its address on file stands, and so does its change.
        loser = rows[OTHER_OID if holders == [SPIELER_OID] else SPIELER_OID]
        assert (loser["email"], loser[SPIELER_ADRESSWECHSEL_FELD]["email"]) == (
            EMAIL if loser["_id"] == SPIELER_OID else OTHER_EMAIL,
            NEW_EMAIL,
        )

    def test_a_confirmation_and_a_discard_of_one_change_leave_one_of_them(self, mongo_replica_set_url: str):
        """Both write the pupil's one row, so whichever commits second meets the first and finds the change gone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_EMAIL)).token
            outcomes = await asyncio.gather(answer(database, client, token, "bestaetigt"), discard(database, client), return_exceptions=True)

            return outcomes, await stored(database)

        (confirmed, discarded), row = on_a_league(mongo_replica_set_url, body)

        assert SPIELER_ADRESSWECHSEL_FELD not in row
        if isinstance(confirmed, FLSpielerAdresswechselAntwortResponse):
            assert (refusal_of(discarded), row["email"]) == (DOCUMENT_NOT_FOUND, NEW_EMAIL)
        else:
            assert isinstance(discarded, FLSpielerAdminSingleResponse), (confirmed, discarded)
            assert (refusal_of(confirmed), row["email"]) == (SPIELER_TOKEN_UNKNOWN, EMAIL)

    def test_a_confirmation_held_past_its_holder_read_is_refused_by_its_retry(self, mongo_replica_set_url: str):
        """Why no duplicate-key outcome exists: the read opens the snapshot, and a rival's later commit meets the write as a conflict."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            ours = (await start(database, client, email=NEW_EMAIL)).token
            theirs = (await start(database, client, email=NEW_EMAIL, spieler_id=OTHER_OID)).token
            committed = asyncio.Event()
            held = _HoldsAfterItsRead(database[Collection.SPIELER], committed, read=build_address_holder_filter(NEW_EMAIL))
            _, outcome = await held_against(
                held,
                committed,
                answer(database, client, ours, "bestaetigt", spieler=held),
                lambda: answer(database, client, theirs, "bestaetigt"),
            )
            holders = await database[Collection.SPIELER].find({"email": NEW_EMAIL}, projection={"_id": 1}).to_list(length=None)

            return refusal_of(outcome), held.reads, held.write_failures, [holder["_id"] for holder in holders]

        code, reads, failures, holders = on_a_league(mongo_replica_set_url, body)

        assert (code, holders) == (SPIELER_ADRESSE_VERGEBEN, [OTHER_OID])
        # 112 is `WriteConflict`, which `with_transaction` retries: the second run's read finds the rival.
        assert (reads, failures) == (2, ["OperationFailure:112"])

    @pytest.mark.parametrize("held_writer", ["discard", "confirmation"])
    def test_the_writer_held_past_its_read_meets_the_other_s_commit_and_finds_the_change_gone(
        self, mongo_replica_set_url: str, held_writer: str
    ):
        """Each branch of the unheld case above, made to run: whichever writer is held loses."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_EMAIL)).token
            committed = asyncio.Event()
            if held_writer == "discard":
                held = _HoldsAfterItsRead(database[Collection.SPIELER], committed, read=build_pending_spieler_adresswechsel_filter(SPIELER_OID))
                writer, rival = discard(database, client, spieler=held), lambda: answer(database, client, token, "bestaetigt")
            else:
                held = _HoldsAfterItsRead(
                    database[Collection.SPIELER], committed, read=build_spieler_adresswechsel_filter(token_hash=hash_token(token))
                )
                writer, rival = answer(database, client, token, "bestaetigt", spieler=held), lambda: discard(database, client)
            _, outcome = await held_against(held, committed, writer, rival)

            return refusal_of(outcome), held.reads, held.write_failures, await stored(database)

        code, reads, failures, row = on_a_league(mongo_replica_set_url, body)

        assert SPIELER_ADRESSWECHSEL_FELD not in row
        if held_writer == "discard":
            assert (code, row["email"]) == (DOCUMENT_NOT_FOUND, NEW_EMAIL)
        else:
            assert (code, row["email"]) == (SPIELER_TOKEN_UNKNOWN, EMAIL)
        # 112 is `WriteConflict`: the held writer's `_id` write meets the other's, and its retry reads the change gone.
        assert (reads, failures) == (2, ["OperationFailure:112"])


class TestThePupilsOwnTrailStays:
    """Each way a pending address ends takes that address out of the pupil's log images and leaves the rest of each."""

    @pytest.mark.parametrize("ending", ["declined", "discarded", "replaced", "stopped"])
    def test_only_the_pending_block_leaves_the_log(self, mongo_replica_set_url: str, ending: str):
        """Empty the images whole instead and this fails: the pupil's earlier states are the log's to restore from."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client, email=NEW_EMAIL)
            token = (await resend(database, client)).adresswechsel.token
            if ending == "declined":
                await answer(database, client, token, "abgelehnt")
            elif ending == "discarded":
                await discard(database, client)
            elif ending == "stopped":
                await stop(database, client, minted.stopp_token)
            else:
                await start(database, client, email=THIRD_EMAIL)

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
            await start(database, client, email=NEW_EMAIL)

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
    """The editor marks a lapsed change by the backend's own rule, never by a clock the browser reads."""

    @pytest.mark.parametrize(("now", "abgelaufen"), [(NOW, False), (AFTER_THE_DEADLINE, True)], ids=["running", "lapsed"])
    def test_it_serves_the_change_without_its_hashes_and_whether_it_lapsed(self, mongo_replica_set_url: str, now: datetime, abgelaufen: bool):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await request(database, client, email=NEW_EMAIL)

            return await get_spieler_memberships(spieler_collection=database[Collection.SPIELER], germany_now=now)

        read = {row.id: row for row in on_a_league(mongo_replica_set_url, body).spieler}

        served = read[SPIELER_OID].model_dump(mode="json")
        assert set(served["adresswechsel"]) == {
            "email",
            "weg",
            "verschickt_am",
            "gueltig_bis",
            "freigegeben_am",
            "grund",
            "bestaetigt_am",
            "wirksam_ab",
            "zustellung",
        }
        assert (served["adresswechsel"]["email"], served["adresswechsel"]["grund"]) == (NEW_EMAIL, GRUND)
        assert served["adresswechsel_abgelaufen"] is abgelaufen
        assert (read[OTHER_OID].adresswechsel, read[OTHER_OID].adresswechsel_abgelaufen) == (None, False)


class TestAnAdmissionMeanwhile:
    """The pupil's own registration admitted while a change waits, the other writer of `email` (`docs/backend/spec.md :: I265`)."""

    def test_one_entering_another_address_ends_the_change_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str):
        """Only a hand edit leaves a pupil holding a change and no address, the one a registration carrying another may enter.

        Left standing, the change's link would then move the address just proved to a mailbox its notice never reached.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_AS_TYPED)
            token = (await resend(database, client)).adresswechsel.token
            await remove_the_address_by_hand(database)
            await admit(database, client, email=REGISTERED_EMAIL, spieler_id=SPIELER_OID)

            return await stored(database), await refused_code(view(database, token)), await where_held(database, NEW_EMAIL, folded=True)

        row, link, held = on_a_league(mongo_replica_set_url, body)

        assert (SPIELER_ADRESSWECHSEL_FELD in row, row["email"]) == (False, REGISTERED_EMAIL)
        assert link == SPIELER_TOKEN_UNKNOWN
        assert held == {NEW_EMAIL: []}

    def test_one_at_the_address_in_force_leaves_the_change_to_its_link(self, mongo_replica_set_url: str):
        """The change was asked over this address and its notice reached it, so the registration proving it again ends nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            token = (await start(database, client, email=NEW_EMAIL)).token
            await admit(database, client, email=EMAIL.upper(), spieler_id=None)
            admitted = await stored(database)
            await answer(database, client, token, "bestaetigt")

            return admitted, await stored(database)

        admitted, row = on_a_league(mongo_replica_set_url, body)

        assert (admitted["email"], admitted[SPIELER_ADRESSWECHSEL_FELD]["email"]) == (EMAIL, NEW_EMAIL)
        assert (SPIELER_ADRESSWECHSEL_FELD in row, row["email"]) == (False, NEW_EMAIL)


class TestTheErasure:
    def test_the_whole_database_holds_no_pending_address_after_the_pupil_is_erased(self, mongo_replica_set_url: str):
        """The re-send and the delivery report each log an image holding the pending address, which the erasure reaches by the id."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client, email=NEW_EMAIL)
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
