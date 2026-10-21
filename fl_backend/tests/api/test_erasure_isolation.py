"""
API · a record written for an address while that address's erasure runs, against the shipped validators and the whole database

The erasure reads what an address holds once, in its transaction's snapshot, and a writer committing a record for
that address after the read writes no document the erasure writes: with nothing written by both, both commit and
the record outlives the erasure that answered it gone (`docs/backend/spec.md :: I53`). Each case runs one writer to
its commit inside the erasure, after the erasure's first read, and asks the whole database what holds the address
once the erasure has answered.
"""

import functools
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.adresswechsel.admin_router import post_adresswechsel_verwaltung
from app.api.adresswechsel.schemas import FLAdresswechselVerwaltungPayload
from app.api.berechtigungen.admin_router import post_berechtigung
from app.api.berechtigungen.schemas import FLPostBerechtigungPayload
from app.api.bewerbungen.admin_router import besetze_kontakt_sitz, korrigiere_kontakt_email
from app.api.bewerbungen.public_router import post_bewerbung
from app.api.bewerbungen.schemas import FLBewerbungKontaktEmailPayload, FLBewerbungKontaktSitzPayload, FLPostBewerbungPayload
from app.api.bewerbungen.services import compose_decline_update, hash_token
from app.api.registrierungen.public_router import post_registrierung
from app.api.registrierungen.schemas import FLPostRegistrierungPayload
from app.api.schiedsrichter.admin_router import patch_schiedsrichter, post_schiedsrichter
from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload, FLPostSchiedsrichterPayload
from app.api.teams.admin_router import patch_saison_team, patch_saison_team_kontakte
from app.api.teams.schemas import FLPatchSaisonTeamKontaktePayload, FLPatchSaisonTeamPayload, kontakte_stand_of
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.security import akteur_pseudonym
from app.main import create_app
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.folding import sign_in_identifier
from tests.actor_tokens import FRESH_STEP_UP_CHECK, SignedActor
from tests.app_client import app_client
from tests.bans import ban_list
from tests.config import ADMIN_KEY, ADMINISTRATORS, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    bewerbung_document,
    kontakte_document,
    kontaktperson_document,
    neue_schule_document,
    registrierung_document,
    saison_document,
    saison_team_document,
    schiedsrichter_document,
    spieler_document,
    team_document,
)
from tests.erasure import erased
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.records import record_collections
from tests.whole_database import where_folded_to, where_held
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_erasure_isolation_test")

NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-04-01"
SAISON_ID = "2026"

# Typed as a visitor types it, and the fold every record stores: the fold, never the spelling, says whose a record is.
TYPED = "Zorbanax.Quillfeather@Example.org"
IDENTIFIER = sign_in_identifier(TYPED)
PSEUDONYM = akteur_pseudonym(IDENTIFIER, schluessel=config_for(DATABASE_NAME).sperrliste_schluessel)

TEAM_OID = ObjectId("6890a1b2c3d4e5f607e10001")
EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f607e10002")
EINLADUNG_TOKEN = "einladung-erasure-isolation"
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607e10003")
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607e10004")
PUPIL_EMAIL = "wraxlington@example.com"
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607e10005")
REGISTRATION_OID = ObjectId("6890a1b2c3d4e5f607e10006")
STEPPED_OUT_OID = ObjectId("6890a1b2c3d4e5f607e10007")

OPEN_WINDOW = {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}

REFEREE_NAME = "Bernd Kraus"
TELEFON = "+49 69 5550202"

# An administrator holding no owner grant, whose erasure the floor of two refuses nothing.
ADMINISTRATOR = ADMINISTRATORS[2]

Rival = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


@functools.cache
def _app() -> FastAPI:
    return create_app(config_for(DATABASE_NAME))


class GrantsReadThenRival(InterleavedCollection):
    """The grants, running the rival to its commit after the erasure's first read: its snapshot is open, and it has written nothing."""

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        await self.run_the_rival()
        return cursor


async def a_league(database: AsyncDatabase) -> None:
    """A season open to both windows, a club entered seatless with its live link, two applications, a pupil and an unconfirmed referee.

    Nothing here holds the erased address: what the case's writer commits is all of it.
    """

    await database[Collection.SAISONS].insert_one(
        saison_document(SAISON_ID, "active", registrierung=dict(OPEN_WINDOW), bewerbung=dict(OPEN_WINDOW))
    )
    await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, "Lindenschule", "LS"))
    await database[Collection.SAISON_TEAMS].insert_one(saison_team_document(SAISON_ID, TEAM_OID, "Lindenschule", "LS", kontakte=None))
    await database[Collection.EINLADUNGEN].insert_one(
        {
            "_id": EINLADUNG_OID,
            "saison_id": SAISON_ID,
            "team_id": TEAM_OID,
            "token_hash": hash_token(EINLADUNG_TOKEN),
            "erstellt_am": "2026-03-15",
            "erstellt_von": "admin@frankfurtleague.de",
            "widerrufen_am": None,
            "versand": {},
        }
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            BEWERBUNG_OID,
            SAISON_ID,
            "eingereicht",
            kontakte=kontakte_document(
                ansprechperson=kontaktperson_document("Quillhilde"),
                stellvertretung=kontaktperson_document("Bramblewick"),
                trainer=kontaktperson_document("Wigglesworth"),
            ),
            eingereicht_am="2026-03-10",
            bestaetigungsfrist="2026-04-10",
            schule=neue_schule_document("Neue", "NE"),
        )
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            STEPPED_OUT_OID,
            SAISON_ID,
            "eingereicht",
            kontakte=kontakte_document(
                ansprechperson=kontaktperson_document("Quintessa"),
                stellvertretung=kontaktperson_document("Brunhilde"),
                trainer=kontaktperson_document("Ottokar"),
            ),
            eingereicht_am="2026-03-10",
            bestaetigungsfrist="2026-04-10",
            schule=neue_schule_document("Ander", "AN"),
        )
    )
    # As the Stellvertretung's own Widerspruch leaves it, the one state a seat is filled again from.
    await database[Collection.BEWERBUNGEN].update_one(
        {"_id": STEPPED_OUT_OID}, compose_decline_update(seats=["stellvertretung"], today="2026-03-20")
    )
    await database[Collection.SPIELER].insert_one(spieler_document(PUPIL_OID, "Wraxlington", "Muster", email=PUPIL_EMAIL))
    await database[Collection.SCHIEDSRICHTER].insert_one(
        schiedsrichter_document(REFEREE_OID, email="kraus.bernd@example.com", name=REFEREE_NAME, default_payment=25, einwilligung=None)
    )


async def a_grant(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """Granted by an administrator nobody else could approve beside: the league holds no other grant, so it takes effect at once."""

    return await post_berechtigung(
        berechtigung_data=FLPostBerechtigungPayload(email=TYPED),
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
        berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
        berechtigungen_antraege_collection=database[Collection.BERECHTIGUNGEN_ANTRAEGE],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        erteilt_von=ADMINISTRATORS[0],
        now=NOW,
    )


async def a_request(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    """A grant of the address asked for where colleagues could approve it, so it waits as a request (`docs/backend/spec.md :: I848`)."""

    await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())

    return await post_berechtigung(
        berechtigung_data=FLPostBerechtigungPayload(email=TYPED),
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
        berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
        berechtigungen_antraege_collection=database[Collection.BERECHTIGUNGEN_ANTRAEGE],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        erteilt_von=ADMINISTRATORS[0],
        # On the real clock: the request lapses a week after it, and the TTL monitor removes a lapsed one.
        now=datetime.now(UTC),
    )


async def a_seat_on_the_season_row(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    seated = {
        "vorname": "Zorbanax",
        "nachname": "Quillfeather",
        "email": TYPED,
        "telefon": TELEFON,
        "einwilligung": {"umfang": "kontaktdaten", "text_version": LAUFENDE_FASSUNGEN["bewerbung"], "datum": "2026-03-01"},
    }

    return await patch_saison_team_kontakte(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        kontakte_data=FLPatchSaisonTeamKontaktePayload.model_validate(
            {"kontakte": kontakte_document(trainer=seated), "kontakte_stand": kontakte_stand_of(None)}
        ),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        refuse_unconfirmed=FRESH_STEP_UP_CHECK,
        today=TODAY,
    )


async def a_seat_on_the_application(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await korrigiere_kontakt_email(
        bewerbung_id=BEWERBUNG_OID,
        seat="ansprechperson",
        # The seeded Ansprechperson's address, which the correcting page showed.
        email_data=FLBewerbungKontaktEmailPayload(email=TYPED, bisherige_email="quillhilde@example.com"),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        today=TODAY,
    )


def _applying(vorname: str, email: str, telefon: str) -> dict[str, Any]:
    return {
        "vorname": vorname,
        "nachname": "Quillfeather",
        "email": email,
        "telefon": telefon,
        "einwilligung": {"text_version": LAUFENDE_FASSUNGEN["bewerbung"], "erteilt": True},
    }


async def an_application(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await post_bewerbung(
        bewerbung_data=FLPostBewerbungPayload.model_validate(
            {
                "saison_id": SAISON_ID,
                "team_id": None,
                "schule": neue_schule_document("Zorbanax", "ZQ", schulform="gesamtschule"),
                "kontakte": {
                    "trainer": _applying("Wigbert", "wigbert@example.com", "+49 69 5550101"),
                    "ansprechperson": _applying("Zorbanax", TYPED, TELEFON),
                    "stellvertretung": _applying("Fridolin", "fridolin@example.com", "+49 69 5550303"),
                    "trainer_ist_zugleich": None,
                },
                "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
                "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
                "stufengroesse": 90,
            }
        ),
        idempotency_key=None,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        today=TODAY,
    )


async def a_seat_filled_on_the_application(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await besetze_kontakt_sitz(
        bewerbung_id=STEPPED_OUT_OID,
        seat="stellvertretung",
        sitz_data=FLBewerbungKontaktSitzPayload.model_validate(
            {
                "vorname": "Zorbanax",
                "nachname": "Quillfeather",
                "email": TYPED,
                "telefon": TELEFON,
                "text_version": LAUFENDE_FASSUNGEN["bewerbung"],
            }
        ),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        today=TODAY,
    )


async def a_registration(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await post_registrierung(
        registrierung_data=FLPostRegistrierungPayload.model_validate(
            {
                "token": EINLADUNG_TOKEN,
                "vorname": "Zorbanax",
                "nachname": "Quillfeather",
                "email": TYPED,
                "position": None,
                "nummer": None,
                "stufe": None,
            }
        ),
        idempotency_key=None,
        teams_collection=database[Collection.TEAMS],
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        einladungen_collection=database[Collection.EINLADUNGEN],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        today=TODAY,
    )


async def a_pending_pupil_address(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await post_adresswechsel_verwaltung(
        adresswechsel_data=FLAdresswechselVerwaltungPayload(adresse=PUPIL_EMAIL, email=TYPED, grund=None),
        adresswechsel_collection=database[Collection.ADRESSWECHSEL],
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        berechtigungen_angekuendigt_collection=database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT],
        berechtigungen_postausgang_collection=database[Collection.BERECHTIGUNGEN_POSTAUSGANG],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        operator="verwaltung@frankfurtleague.de",
        auth_time=int(time.time()),
        germany_now=NOW,
    )


def _referee_payload(name: str) -> dict[str, Any]:
    return {"name": name, "schule": None, "default_payment": 25, "kontakt": {"telefon": TELEFON, "email": TYPED}}


async def a_referee(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await post_schiedsrichter(
        schiedsrichter_data=FLPostSchiedsrichterPayload.model_validate(_referee_payload("Zorbanax Quillfeather")),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        today=TODAY,
    )


async def a_corrected_referee_address(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await patch_schiedsrichter(
        schiedsrichter_id=REFEREE_OID,
        schiedsrichter_data=FLPatchSchiedsrichterPayload.model_validate(_referee_payload(REFEREE_NAME)),
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spiele_collection=database[Collection.SPIELE],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        refuse_unconfirmed=FRESH_STEP_UP_CHECK,
        today=TODAY,
    )


# Each writer an address enters a record through from a payload, with the count the erasure's answer files it under.
WRITERS: dict[str, tuple[Rival, str]] = {
    "a grant": (a_grant, "berechtigungen"),
    "a request for a grant": (a_request, "berechtigungen_antraege"),
    "a contact seat on a season row": (a_seat_on_the_season_row, "kontakt_sitze"),
    "a contact seat on an application": (a_seat_on_the_application, "kontakt_sitze"),
    "a contact seat filled on an application": (a_seat_filled_on_the_application, "kontakt_sitze"),
    "an application": (an_application, "kontakt_sitze"),
    "a registration": (a_registration, "registrierungen"),
    "a pupil's pending address change": (a_pending_pupil_address, "adresswechsel"),
    "a referee": (a_referee, "schiedsrichter"),
    "a referee's corrected address": (a_corrected_referee_address, "schiedsrichter"),
}


def on_a_league(url: str, body: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await a_league(database)

            return await body(database, client)

    return on_the_seed_loop(_run())


class TestARecordWrittenInsideTheErasureGoesWithIt:
    """`docs/backend/spec.md :: I719`: the writer and the erasure both write the address's anchor, so the one committing second runs again."""

    @pytest.mark.parametrize("writer", list(WRITERS))
    def test_the_erasure_answers_the_record_and_nothing_holds_the_address(self, mongo_replica_set_url: str, writer: str):
        """Remove the writer's anchor and the record stands, the erasure answering it never existed."""

        rival, counted_as = WRITERS[writer]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            written: list[Any] = []

            async def write() -> None:
                written.append(await rival(database, client))

            grants = GrantsReadThenRival(database[Collection.BERECHTIGUNGEN], write)
            answers: list[Any] = []

            async def erase() -> None:
                answers.append(await erased(database, client, TYPED, germany_now=NOW, berechtigungen_collection=grants))

            outcome = await outcome_of(erase())

            return outcome, bool(written), answers[0] if answers else None, await where_folded_to(database, IDENTIFIER)

        outcome, wrote, answer, held = on_a_league(mongo_replica_set_url, body)

        assert (outcome, wrote) == (COMMITTED, True), "the writer or the erasure never committed, so this case proves nothing"
        assert held == [], f"{held} still hold the address the erasure answered for"
        assert getattr(answer, counted_as) == 1


# The person lane: the erased address holds a seat on the club's row, from which it declines another pupil's registration.
SEAT_PATH = f"/api/v{API_VERSION}/registrierungen/{REGISTRATION_OID}/ablehnen"


async def a_seat_holder_with_a_registration_to_decide(database: AsyncDatabase) -> None:
    await database[Collection.SAISON_TEAMS].update_one(
        {"saison_id": SAISON_ID, "team_id": TEAM_OID},
        {
            "$set": {
                "kontakte": kontakte_document(
                    ansprechperson=kontaktperson_document("Zorbanax", bestaetigt_am="2026-03-21", nachname="Quillfeather", email=IDENTIFIER)
                )
            }
        },
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        registrierung_document(
            REGISTRATION_OID,
            "quintessa@example.com",
            saison_id=SAISON_ID,
            team_id=TEAM_OID,
            vorname="Quintessa",
            nachname="Muster",
            token="token-quintessa",
            eingereicht_am="2026-03-25",
            frist="2026-04-08",
        )
    )


class TestAPersonsOwnWriteInsideTheirErasureGoesWithIt:
    """`docs/backend/spec.md :: I719`: the person's judge anchors their address after a write, as the administrator's anchors the grant."""

    def test_the_decline_keeps_neither_their_address_nor_their_pseudonym(self, mongo_replica_set_url: str):
        """Remove the anchor in `app/core/security.py :: person_judge` and the decision keeps the address in plain, the log the pseudonym."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_seat_holder_with_a_registration_to_decide(database)
            statuses: list[int] = []

            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:

                async def decline() -> None:
                    answered = await http.post(SEAT_PATH, json={"grund": None}, headers=SignedActor(TYPED, ADMIN_KEY, lane="person"))
                    statuses.append(answered.status_code)

                grants = GrantsReadThenRival(database[Collection.BERECHTIGUNGEN], decline)
                outcome = await outcome_of(erased(database, client, TYPED, germany_now=NOW, berechtigungen_collection=grants))

            return outcome, statuses, await where_folded_to(database, IDENTIFIER), await where_held(database, PSEUDONYM)

        outcome, statuses, held, pseudonymised = on_a_league(mongo_replica_set_url, body)

        assert (outcome, statuses) == (COMMITTED, [200]), "the decline or the erasure never committed, so this case proves nothing"
        assert held == [], f"{held} still hold the address the erasure answered for"
        assert pseudonymised == {PSEUDONYM: []}, "the person's log row or day count outlives their erasure"


class TestAnAdministratorsOwnWriteInsideTheirErasureGoesWithIt:
    """Held by the administrator's judge, which anchors the actor's grant (`docs/backend/spec.md :: I450`) the erasure removes."""

    def test_the_log_row_they_wrote_names_them_no_more(self, mongo_replica_set_url: str):
        """Remove the anchor in `app/core/security.py :: admin_judge` and the venue's log row keeps the erased administrator's address."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            statuses: list[int] = []
            venue = {
                "name": "Sportplatz Ost",
                "address": {
                    "strasse": "Hanauer Landstraße",
                    "hausnummer": "12a",
                    "plz": "60314",
                    "stadtteil": "Ostend",
                    "stadt": "Frankfurt am Main",
                },
                "default_mietpreis": 80,
            }

            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:

                async def create() -> None:
                    answered = await http.post(f"/api/v{API_VERSION}/spielorte", json=venue, headers=SignedActor(ADMINISTRATOR, ADMIN_KEY))
                    statuses.append(answered.status_code)

                grants = GrantsReadThenRival(database[Collection.BERECHTIGUNGEN], create)
                outcome = await outcome_of(erased(database, client, ADMINISTRATOR, germany_now=NOW, berechtigungen_collection=grants))

            return outcome, statuses, await where_folded_to(database, ADMINISTRATOR)

        outcome, statuses, held = on_a_league(mongo_replica_set_url, body)

        assert (outcome, statuses) == (COMMITTED, [201]), "the venue or the erasure never committed, so this case proves nothing"
        assert held == [], f"{held} still hold the address the erasure answered for"


# The erased person in the club's trainer seat, and somebody a save seats beside them, each as the editor sends a seat.
SEATED = {
    "vorname": "Zorbanax",
    "nachname": "Quillfeather",
    "email": TYPED,
    "telefon": TELEFON,
    "einwilligung": {"umfang": "kontaktdaten", "text_version": LAUFENDE_FASSUNGEN["bewerbung"], "datum": "2026-03-01"},
}
BESIDE = {**SEATED, "vorname": "Ottilie", "nachname": "Andere", "email": "ottilie.andere@example.com", "telefon": "+49 69 5550404"}


async def club_row(database: AsyncDatabase) -> dict[str, Any]:
    found = await database[Collection.SAISON_TEAMS].find_one({"team_id": TEAM_OID, "saison_id": SAISON_ID})
    assert found is not None, "the seeded row is gone"
    return found


async def contacts_saved(database: AsyncDatabase, client: AsyncMongoClient, kontakte: Any, stand: str) -> Any:
    return await patch_saison_team_kontakte(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        kontakte_data=FLPatchSaisonTeamKontaktePayload.model_validate({"kontakte": kontakte, "kontakte_stand": stand}),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        refuse_unconfirmed=FRESH_STEP_UP_CHECK,
        today=TODAY,
    )


async def junction_patched(database: AsyncDatabase, client: AsyncMongoClient, values: dict[str, Any]) -> Any:
    return await patch_saison_team(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        saison_team_data=FLPatchSaisonTeamPayload.model_validate(values),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        db=client,
    )


def junction_values(row: dict[str, Any], **changed: Any) -> dict[str, Any]:
    return {"gruppe": row["gruppe"], "austritt": row.get("austritt"), "trikot_farbe": row.get("trikot_farbe"), **changed}


async def the_block_it_was_served(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    stand = kontakte_stand_of((await club_row(database))["kontakte"])

    return lambda database, client: contacts_saved(database, client, kontakte_document(trainer=SEATED), stand)


async def another_seat_filled(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    stand = kontakte_stand_of((await club_row(database))["kontakte"])

    return lambda database, client: contacts_saved(database, client, kontakte_document(trainer=SEATED, ansprechperson=BESIDE), stand)


async def the_row_as_it_stands(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    # Sent once ahead, so the row already holds what the same PATCH writes.
    await junction_patched(database, client, junction_values(await club_row(database)))
    values = junction_values(await club_row(database))

    return lambda database, client: junction_patched(database, client, values)


async def another_kit_colour(database: AsyncDatabase, client: AsyncMongoClient) -> Rival:
    values = junction_values(await club_row(database), trikot_farbe="gruen")

    return lambda database, client: junction_patched(database, client, values)


# Each write an administrator can make to the club's row keeping the erased person's seat, with the log rows it files there.
KEEPING_WRITES: dict[str, tuple[Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Rival]], int]] = {
    "a contacts save sending the block it was served": (the_block_it_was_served, 0),
    "a contacts save filling another seat": (another_seat_filled, 1),
    "a junction PATCH sending the row as it stands": (the_row_as_it_stands, 0),
    "a junction PATCH changing the kit colour": (another_kit_colour, 1),
}


class TestAWriteKeepingTheirSeatInsideTheErasureLeavesNothing:
    """`docs/backend/spec.md :: I732`: nothing anchors a kept seat, the row being what the erasure writes.

    So a write leaving the row unchanged, which writes nothing the erasure writes, files no log row either.
    """

    @pytest.mark.parametrize("write", list(KEEPING_WRITES))
    def test_nothing_holds_the_address_and_the_log_keeps_each_change(self, mongo_replica_set_url: str, write: str):
        """Record every patch and an unchanged row's log row keeps the address; record none inside a transaction and a change loses its row."""

        prepare, rows_filed = KEEPING_WRITES[write]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Saved twice, the first minting the person's link, so the stored block is what a later send of it composes.
            await contacts_saved(database, client, kontakte_document(trainer=SEATED), kontakte_stand_of(None))
            await contacts_saved(database, client, kontakte_document(trainer=SEATED), kontakte_stand_of((await club_row(database))["kontakte"]))
            keeping = await prepare(database, client)
            on_the_row = {"collection": str(Collection.SAISON_TEAMS)}
            written: list[str] = []
            filed: list[int] = []

            async def keep_the_seat() -> None:
                rows_before = await database[Collection.AKTIONEN].count_documents(on_the_row)
                written.append(await outcome_of(keeping(database, client)))
                filed.append(await database[Collection.AKTIONEN].count_documents(on_the_row) - rows_before)

            grants = GrantsReadThenRival(database[Collection.BERECHTIGUNGEN], keep_the_seat)
            outcome = await outcome_of(erased(database, client, TYPED, germany_now=NOW, berechtigungen_collection=grants))

            return outcome, written, filed, (await club_row(database))["kontakte"]["trainer"], await where_folded_to(database, IDENTIFIER)

        outcome, written, filed, trainer, held = on_a_league(mongo_replica_set_url, body)

        assert (outcome, written) == (COMMITTED, [COMMITTED]), "the write or the erasure never committed, so this case proves nothing"
        assert trainer is None, "the erased person's seat stands"
        assert held == [], f"{held} still hold the address the erasure answered for"
        assert filed == [rows_filed]
