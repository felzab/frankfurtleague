"""
API · a person's erasure through the registry, held against the whole database rather than against the steps

One address holds a pupil row in a live squad, a seat on a season row and on an application beside
two bystanders, a referee row booked on a played fixture and asked to confirm it, a pending and a declined registration,
another referee's and another pupil's pending address change, a pupil row corrected away from the
address, a day's counts, records they made as an administrator, though they hold no grant, and as a
seat holder, and log rows written as a person and as an administrator. Another mailbox at their local
part holds records beside them. Every case asks what is left, so a step removed from the registry
fails here.
"""

import functools
import logging
import sys
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.adresswechsel.crud import end_an_emptied_change_in_session
from app.api.adresswechsel.services import compose_postausgang
from app.api.berechtigungen.antraege import compose_antrag
from app.api.bewerbungen.services import hash_token
from app.api.einladungen.services import compose_einladung, compose_widerruf_update
from app.api.identitaet.crud import ERASURE_STEPS, JEDE_PERSONENGRUPPE, erase_everything
from app.api.identitaet.services import LETZTER_INHABER_ERASURE
from app.api.registrierungen.person_router import aufnehmen
from app.api.registrierungen.schemas import FLRegistrierungAufnehmenPayload
from app.api.registrierungen.services import compose_ablehnung_update
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.api.spielbestaetigungen.services import halter_of
from app.api.spieler.crud import erase_person_in_session
from app.api.spieler.services import build_ghost_spieler
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import delete_many_from_db, patch_one_in_db
from app.core.db import NO_OWNER
from app.core.exceptions import DocumentNotFoundException
from app.core.journal import JOURNAL_TOKEN
from app.core.logging import setup_custom_logger
from app.core.recording import ERASED_ACTOR_MARKER, Actor, PersonActor, actor_var
from app.core.security import ACTOR_HEADER, akteur_pseudonym, loeschung_journal_hash
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID, GHOST_SPIELER_ID
from app.core.transactions import transaction_session
from app.main import create_app
from tests import documents
from tests.actor_tokens import ACTOR_TOKEN_CONTRACT, SignedActor, actor_claims, sign
from tests.app_client import app_client
from tests.bans import ban_list
from tests.config import ADMIN_KEY
from tests.core.app_source import DRIVER_WRITES
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, on_the_seed_loop
from tests.documents import (
    ban_document,
    bericht_document,
    bewerbung_document,
    eigene_einwilligung_document,
    kontakte_document,
    kontaktperson_document,
    neue_schule_document,
    registrierung_document,
    saison_document,
    saison_spieler_document,
    saison_team_document,
    schiedsrichter_document,
    spiel_document,
    spielbericht_document,
    spielbestaetigung_document,
    spieler_document,
    team_document,
)
from tests.erasure import erased, erasure_collections
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.records import record_collections
from tests.whole_database import where_folded_to, where_held, where_referenced
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_funktionen_erasure_test")

CONFIG = config_for(DATABASE_NAME)

PATH = f"/api/v{API_VERSION}/identitaet/selbst/erasure"

SAISON_ID = "2026"
TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
# Injected through `get_germany_now`, and in summer, so the conversion to the log's stamp moves the clock.
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# The person as a request or a pasted grant may spell them, and the fold every record the league writes stores.
TYPED = "Zorbanax.Quillfeather@Example.org"
IDENTIFIER = "zorbanax.quillfeather@example.org"
# As a hand-typed row may spell it, the domain fullwidth: the fold equates it with theirs, a pattern listing domains never.
PASTED = IDENTIFIER.replace("example", "".join(chr(ord(letter) + 0xFEE0) for letter in "example"))
VORNAME, NACHNAME = "Zorbanax", "Quillfeather"
TELEFON = "+49 69 7771234"
GEBURTSDATUM = "2008-07-14"
# The one their referee row holds, which they typed otherwise.
REFEREE_GEBURTSDATUM = "1990-02-03"
PSEUDONYM = akteur_pseudonym(IDENTIFIER, schluessel=CONFIG.sperrliste_schluessel)

# The submission digests of two applications the person holds a seat on, the second predating the confirmation block.
THEIR_DIGEST = "digest-7f3a1c-mit-block"
THEIR_BLOCKLESS_DIGEST = "digest-7f3a1c-ohne-block"
# Why they declined to officiate, in their own words.
THEIR_REASON = "Knieverletzung beim Hallenturnier"

# Distinctive, so a hit in a whole-database scan is never coincidence: every value the person holds.
THEIR_VALUES = (
    VORNAME,
    NACHNAME,
    IDENTIFIER,
    PASTED,
    "7771234",
    GEBURTSDATUM,
    REFEREE_GEBURTSDATUM,
    PSEUDONYM,
    THEIR_DIGEST,
    THEIR_BLOCKLESS_DIGEST,
    THEIR_REASON,
)

# The people beside them, each asserted still present: a step taking anybody else's record with theirs fails.
BYSTANDER_VALUES = ("Quillhilde", "Bramblewick", "Wraxlington", "kraus.bernd@example.com")
# Those the seed's own edits file into shared log images beside the person, which keep them past the erasure.
BYSTANDERS_IN_THE_LOG = ("Quillhilde", "Bramblewick", "kraus.bernd@example.com")
OTHER_PSEUDONYM = akteur_pseudonym("wraxlington@example.com", schluessel=CONFIG.sperrliste_schluessel)

HOME_TEAM_OID = ObjectId("6890a1b2c3d4e5f607b00001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607b00002")
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607b00011")
THEIR_SQUAD_ROW_OID = ObjectId("6890a1b2c3d4e5f607b00013")
OTHER_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607b00012")
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607b00021")
OTHER_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607b00022")
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607b00031")
BLOCKLESS_BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607b00032")
PENDING_OID = ObjectId("6890a1b2c3d4e5f607b00041")
DECLINED_OID = ObjectId("6890a1b2c3d4e5f607b00042")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607b00051")
THEIR_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b00061")
OTHER_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b00062")
# The records the person made as an administrator and as a seat holder, and their own grant.
THEIR_GRANT_OID = ObjectId("6890a1b2c3d4e5f607b00071")
# A second owner, granted by nobody the person is, so no record of theirs ties the two erasures together.
OTHER_OWNER_OID = ObjectId("6890a1b2c3d4e5f607b00077")
OTHER_OWNER = "ortwin.inhaber@example.com"
GRANTED_BY_THEM_OID = ObjectId("6890a1b2c3d4e5f607b00072")
BANNED_BY_THEM_OID = ObjectId("6890a1b2c3d4e5f607b00073")
BANNED_BY_THEM_PASTED_OID = ObjectId("6890a1b2c3d4e5f607b00078")
INVITED_BY_THEM_OID = ObjectId("6890a1b2c3d4e5f607b00074")
DECIDED_BY_THEM_OID = ObjectId("6890a1b2c3d4e5f607b00075")
DECLINED_BY_THEM_OID = ObjectId("6890a1b2c3d4e5f607b00076")
# Another pupil, moving to the person's address: the row is theirs until the change is confirmed.
MOVING_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607b00081")
# A pupil once entered under the person's address and corrected to another: the row is the other's.
READDRESSED_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607b00082")
# Another mailbox at the person's local part, whose records every read narrowed by that local part reaches: the fold
# after each read alone keeps them. Lower case, so no exact scan for the person's names finds it.
ELSEWHERE = IDENTIFIER.replace("@example.org", "@anderswo.org")
ELSEWHERE_REGISTRATION_OID = ObjectId("6890a1b2c3d4e5f607b00091")
ELSEWHERE_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607b00092")
ELSEWHERE_GRANT_OID = ObjectId("6890a1b2c3d4e5f607b00093")
REFEREE_MOVING_ELSEWHERE_OID = ObjectId("6890a1b2c3d4e5f607b00094")
PUPIL_MOVING_ELSEWHERE_OID = ObjectId("6890a1b2c3d4e5f607b00095")
ELSEWHERE_SEAT_ROW_OID = ObjectId("6890a1b2c3d4e5f607b00096")
# The pending changes naming the person's address, or the one sharing its local part, as their new one.
OTHER_REFEREE_CHANGE_OID = ObjectId("6890a1b2c3d4e5f607b000c1")
MOVING_PUPIL_CHANGE_OID = ObjectId("6890a1b2c3d4e5f607b000c2")
REFEREE_MOVING_ELSEWHERE_CHANGE_OID = ObjectId("6890a1b2c3d4e5f607b000c3")
PUPIL_MOVING_ELSEWHERE_CHANGE_OID = ObjectId("6890a1b2c3d4e5f607b000c4")
THEIR_CHANGE_OID = ObjectId("6890a1b2c3d4e5f607b000c5")
# Their referee row's confirmations: one standing, one an undraw of an earlier season took; and another referee's.
THEIR_CONFIRMATION_OID = ObjectId("6890a1b2c3d4e5f607b000a1")
THEIR_UNDRAWN_CONFIRMATION_OID = ObjectId("6890a1b2c3d4e5f607b000a2")
OTHER_CONFIRMATION_OID = ObjectId("6890a1b2c3d4e5f607b000a3")
# Their team's open row, its link on the seat they hold, which the seat member voids.
TEAM_CONFIRMATION_OID = ObjectId("6890a1b2c3d4e5f607b000a4")
UNDRAWN_SAISON_ID = "2025"
OTHER_REASON = "Dienstreise nach Hamburg"
# Every record of their own the erasure removes, each id looked for in the whole database afterwards: a reference left
# naming one names nobody.
THEIR_RECORDS = (PUPIL_OID, THEIR_SQUAD_ROW_OID, REFEREE_OID, PENDING_OID, DECLINED_OID, THEIR_CONFIRMATION_OID)

REFEREE_NAME = f"{VORNAME} {NACHNAME}"
PAYMENT = 25

# A day count of each age the TTL monitor may not have reached, under a bound far off so the monitor
# itself never takes one during a case.
COUNT_IDS = (
    f"kontakt:{PSEUDONYM}:{TODAY}",
    f"spieler:{PSEUDONYM}:{YESTERDAY}",
    f"schiedsrichter:{PSEUDONYM}:2026-03-02",
    f"adresswechsel:{PSEUDONYM}:{TODAY}",
)
OTHER_COUNT_ID = f"kontakt:{OTHER_PSEUDONYM}:{TODAY}"
FAR_OFF = datetime(2099, 1, 1, tzinfo=UTC)

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


@functools.cache
def _app() -> FastAPI:
    return create_app(CONFIG)


# The suite's settings with the application's own lines silenced, as an operator may set them.
QUIET = CONFIG.model_copy(update={"log_level_app": "WARNING"})


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Never inside a case: a build re-runs the logging `dictConfig`, which strips the handler `caplog` reads that case's records from."""

    _app()


def their_seat() -> dict[str, Any]:
    return kontaktperson_document(VORNAME, bestaetigt_am="2026-03-21", nachname=NACHNAME, email=IDENTIFIER, telefon=TELEFON)


def referee(schiedsrichter_id: ObjectId, *, email: str, name: str, **fields: Any) -> dict[str, Any]:
    return schiedsrichter_document(
        schiedsrichter_id,
        email=email,
        name=name,
        default_payment=PAYMENT,
        einwilligung=eigene_einwilligung_document(text_version="v1", bestaetigt_am="2026-03-01"),
        **fields,
    )


def a_registration(registrierung_id: ObjectId, email: str, **fields: Any) -> dict[str, Any]:
    return registrierung_document(
        registrierung_id,
        email,
        saison_id=SAISON_ID,
        team_id=HOME_TEAM_OID,
        vorname=VORNAME,
        nachname=NACHNAME,
        token=f"token-{registrierung_id}",
        eingereicht_am="2026-03-25",
        frist="2026-04-08",
        **fields,
    )


async def acting(actor: Any, call: Callable[[], Awaitable[Any]]) -> Any:
    """`call` with the actor bound as its binder binds it, and unbound afterwards."""

    token = actor_var.set(actor)
    try:
        return await call()
    finally:
        actor_var.reset(token)


async def edited(database: AsyncDatabase, collection: Collection, document_id: Any, update: Mapping[str, Any]) -> None:
    """One recorded edit, so the log holds the document's image as it stood: a seed alone writes no log row."""

    await patch_one_in_db(collection=database[collection], db_filter={"_id": document_id}, update=update, return_document=ReturnDocument.BEFORE)


# The reports a referee sent, one of theirs an undraw of an earlier season took, and another referee's.
THEIR_REPORT_OID = ObjectId("6890a1b2c3d4e5f607b000b1")
OTHER_REPORT_OID = ObjectId("6890a1b2c3d4e5f607b000b2")
OWED_NOTICE_OID = ObjectId("6890a1b2c3d4e5f607b000d1")
THEIR_REMARKS = "Flutlicht fiel in der 70. Minute aus."


def a_report(report_id: ObjectId, schiedsrichter_id: ObjectId, *, spiel_id: ObjectId, saison_id: str = SAISON_ID) -> dict[str, Any]:
    return spielbericht_document(
        {"_id": spiel_id, "saison_id": saison_id},
        _id=report_id,
        bericht=bericht_document(eingereicht_von={"art": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id}, bemerkungen=THEIR_REMARKS),
    )


async def their_reports(database: AsyncDatabase) -> None:
    """Each kind of log image naming them as a report's sender: two corrections' and an undraw's array."""

    reports = database[Collection.SPIELBERICHTE]
    await reports.insert_many(
        [
            a_report(THEIR_REPORT_OID, REFEREE_OID, spiel_id=THEIR_SPIEL_OID),
            a_report(OTHER_REPORT_OID, OTHER_REFEREE_OID, spiel_id=OTHER_SPIEL_OID),
            a_report(ObjectId(), REFEREE_OID, spiel_id=ObjectId(), saison_id=UNDRAWN_SAISON_ID),
        ]
    )
    await edited(database, Collection.SPIELBERICHTE, THEIR_REPORT_OID, {"$inc": {"bericht.version": 1}})
    await edited(database, Collection.SPIELBERICHTE, OTHER_REPORT_OID, {"$inc": {"bericht.version": 1}})
    async with database.client.start_session() as session:
        await delete_many_from_db(collection=reports, db_filter={"saison_id": UNDRAWN_SAISON_ID}, session=session)


async def the_one(database: AsyncDatabase, collection: Collection, db_filter: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
    """The one row a case reads, refused where none stands rather than read as a null."""

    found = await database[collection].find_one(db_filter or {})
    assert found is not None, f"{collection} holds no row matching {db_filter}"
    return found


def a_confirmation(row_id: ObjectId, partei: dict[str, Any], *, spiel_id: ObjectId, saison_id: str = SAISON_ID) -> dict[str, Any]:
    """An open, unanswered row, as the sweep mints one; a referee's holds no seats."""

    spiel = spiel_document(
        spiel_id=spiel_id,
        saison_id=saison_id,
        spiel_nr=1,
        spieltag_id=SPIELTAG_OID,
        datum="2026-03-15",
        uhrzeit="14:00:00",
        team1={"team_id": HOME_TEAM_OID},
        team2={"team_id": OTHER_TEAM_OID},
    )

    return spielbestaetigung_document(spiel, partei=partei, _id=row_id, frist="2026-03-08", angefragt_am="2026-03-01", kontakte=None)


def a_referee(schiedsrichter_id: ObjectId) -> dict[str, Any]:
    return {"art": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id}


def declined(begruendung: str) -> dict[str, Any]:
    return {"art": "abgelehnt", "am": "2026-03-03", "von": {"art": "schiedsrichter"}, "vorschlag": None, "begruendung": begruendung}


async def their_confirmations(database: AsyncDatabase) -> None:
    """Each kind of log image holding their id or reason, two patches' and an undraw's array, and their team's row linking their seat."""

    confirmations = database[Collection.SPIELBESTAETIGUNGEN]
    await confirmations.insert_many(
        [
            a_confirmation(THEIR_CONFIRMATION_OID, a_referee(REFEREE_OID), spiel_id=THEIR_SPIEL_OID),
            {
                **a_confirmation(OTHER_CONFIRMATION_OID, a_referee(OTHER_REFEREE_OID), spiel_id=OTHER_SPIEL_OID),
                "antwort": declined(OTHER_REASON),
            },
            {
                **a_confirmation(THEIR_UNDRAWN_CONFIRMATION_OID, a_referee(REFEREE_OID), spiel_id=ObjectId(), saison_id=UNDRAWN_SAISON_ID),
                "antwort": declined(THEIR_REASON),
            },
            {
                **a_confirmation(TEAM_CONFIRMATION_OID, {"art": "team", "team_id": HOME_TEAM_OID}, spiel_id=THEIR_SPIEL_OID),
                "kontakte": {"trainer": None, "ansprechperson": {"token_hashes": [hash_token("their-seats-link")]}, "stellvertretung": None},
            },
        ]
    )
    await edited(database, Collection.SPIELBESTAETIGUNGEN, THEIR_CONFIRMATION_OID, {"$set": {"antwort": declined(THEIR_REASON)}})
    await edited(
        database,
        Collection.SPIELBESTAETIGUNGEN,
        THEIR_CONFIRMATION_OID,
        {"$set": {"geschlossen": {"am": "2026-03-04", "grund": "schiedsrichter_gewechselt"}}},
    )
    await edited(database, Collection.SPIELBESTAETIGUNGEN, OTHER_CONFIRMATION_OID, {"$set": {"erinnert_am": ["2026-03-05"]}})
    async with database.client.start_session() as session:
        await delete_many_from_db(collection=confirmations, db_filter={"saison_id": UNDRAWN_SAISON_ID}, session=session)


async def a_person_holding_everything(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
    await database[Collection.TEAMS].insert_many(
        [team_document(HOME_TEAM_OID, "Heim-Schule", "HS"), team_document(OTHER_TEAM_OID, "Gast-Schule", "GS")]
    )
    await database[Collection.SAISON_TEAMS].insert_one(
        saison_team_document(
            SAISON_ID,
            HOME_TEAM_OID,
            "Heim-Schule",
            "HS",
            kontakte=kontakte_document(
                ansprechperson=their_seat(),
                stellvertretung=kontaktperson_document("Quillhilde", bestaetigt_am="2026-03-21"),
                trainer=kontaktperson_document("Bramblewick", bestaetigt_am="2026-03-21"),
            ),
        )
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            BEWERBUNG_OID,
            SAISON_ID,
            "eingereicht",
            kontakte=kontakte_document(
                trainer=their_seat(),
                ansprechperson=kontaktperson_document("Quillhilde"),
                stellvertretung=kontaktperson_document("Bramblewick"),
            ),
            eingereicht_am="2026-03-10",
            bestaetigungsfrist="2026-04-10",
            schule=neue_schule_document("Neue", "NE"),
            idempotenz_fingerabdruck=THEIR_DIGEST,
        )
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            BLOCKLESS_BEWERBUNG_OID,
            SAISON_ID,
            "eingereicht",
            kontakte=kontakte_document(ansprechperson=their_seat()),
            eingereicht_am="2026-02-10",
            schule=neue_schule_document("Alte", "AL"),
            idempotenz_fingerabdruck=THEIR_BLOCKLESS_DIGEST,
        )
    )
    einwilligung = eigene_einwilligung_document(text_version="v1", bestaetigt_am="2026-03-02")
    # A pupil's address as it stood before its correction, which the person's own pupil row holds after it: the
    # correction's image alone keeps it, a row the person's steps never reach.
    await database[Collection.SPIELER].insert_one(
        spieler_document(READDRESSED_PUPIL_OID, "Hartwig", "Hartwig-Muster", email=IDENTIFIER, einwilligung=einwilligung)
    )
    await edited(database, Collection.SPIELER, READDRESSED_PUPIL_OID, {"$set": {"email": "hartwig@example.com"}})
    await database[Collection.SPIELER].insert_many(
        [
            spieler_document(PUPIL_OID, VORNAME, NACHNAME, email=IDENTIFIER, geburtsdatum=GEBURTSDATUM, einwilligung=einwilligung),
            spieler_document(OTHER_PUPIL_OID, "Wraxlington", "Wraxlington-Muster", email="wraxlington@example.com", einwilligung=einwilligung),
        ]
    )
    their_row, other_row = THEIR_SQUAD_ROW_OID, ObjectId()
    await database[Collection.SAISON_SPIELER].insert_many(
        [
            saison_spieler_document(PUPIL_OID, SAISON_ID, HOME_TEAM_OID, _id=their_row, nummer="7"),
            saison_spieler_document(OTHER_PUPIL_OID, SAISON_ID, HOME_TEAM_OID, _id=other_row, nummer="8"),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            referee(
                REFEREE_OID,
                email=IDENTIFIER,
                name=REFEREE_NAME,
                geburtsdatum=REFEREE_GEBURTSDATUM,
                kontakt={"telefon": TELEFON, "email": IDENTIFIER},
            ),
            referee(OTHER_REFEREE_OID, email="kraus.bernd@example.com", name="Bernd Kraus"),
        ]
    )
    await database[Collection.SPIELE].insert_many(
        [
            spiel_document(
                spiel_id=spiel_id,
                saison_id=SAISON_ID,
                spiel_nr=spiel_nr,
                spieltag_id=SPIELTAG_OID,
                datum="2026-03-15",
                uhrzeit="14:00:00",
                schiedsrichter={"schiedsrichter_id": referee_id, "name": name, "payment": PAYMENT},
                ergebnis="2:1",
            )
            for spiel_nr, (spiel_id, referee_id, name) in enumerate(
                ((THEIR_SPIEL_OID, REFEREE_OID, REFEREE_NAME), (OTHER_SPIEL_OID, OTHER_REFEREE_OID, "Bernd Kraus")), start=1
            )
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [
            a_registration(PENDING_OID, IDENTIFIER),
            a_registration(
                DECLINED_OID,
                IDENTIFIER,
                **compose_ablehnung_update(von="quillhilde@example.com", grund=None, today="2026-03-28")["$set"],
            ),
        ]
    )
    await database[Collection.DROSSELUNG].insert_many(
        [{"_id": count_id, "n": 3, "ablauf": FAR_OFF} for count_id in (*COUNT_IDS, OTHER_COUNT_ID)]
    )
    await records_they_made_holding_no_grant(database)
    # A grant asked for their address and one they asked for another's, neither decided: a request outlives neither person.
    await database[Collection.BERECHTIGUNGEN_ANTRAEGE].insert_many(
        [
            compose_antrag(
                adresse=IDENTIFIER, verwaltung="administration", berechtigung_id=None, gestartet_von="quillhilde@example.com", now=FAR_OFF
            ),
            compose_antrag(
                adresse="neu.kollegin@example.com", verwaltung="administration", berechtigung_id=None, gestartet_von=IDENTIFIER, now=FAR_OFF
            ),
        ]
    )
    await database[Collection.SPIELER].insert_one(
        spieler_document(MOVING_PUPIL_OID, "Gwendolyn", "Gwendolyn-Muster", email="gwendolyn@example.com", einwilligung=einwilligung)
    )
    await pending_changes(
        database,
        (OTHER_REFEREE_CHANGE_OID, "kraus.bernd@example.com", IDENTIFIER, "their-new-address", "2026-03-28"),
        (MOVING_PUPIL_CHANGE_OID, "gwendolyn@example.com", IDENTIFIER, "her-new-address", "2026-03-29"),
    )
    # A notice still owed to them from an earlier change of theirs, which the pass has not delivered yet.
    # A fixed id: the log keeps the erasure's filter by id, which two runs of this seed must spell alike.
    await database[Collection.ADRESSWECHSEL_POSTAUSGANG].insert_one(
        {
            "_id": OWED_NOTICE_OID,
            **compose_postausgang(
                art="wirksam", bisherige_email="vorher.zorbanax@example.org", email=IDENTIFIER, vorname="Zorbanax", weg="konto", now=NOW
            ),
        }
    )

    # The history: every image the log holds of the person is one of these edits'.
    await edited(database, Collection.SAISON_TEAMS, (await the_one(database, Collection.SAISON_TEAMS))["_id"], {"$set": {"gruppe": "B"}})
    await edited(database, Collection.BEWERBUNGEN, BEWERBUNG_OID, {"$set": {"wunschgegner": "Gast-Schule"}})
    await edited(database, Collection.SAISON_SPIELER, their_row, {"$set": {"nummer": "9"}})
    await edited(database, Collection.SCHIEDSRICHTER, REFEREE_OID, {"$set": {"schule": "Carl-Schurz-Schule"}})
    await edited(database, Collection.SPIELE, THEIR_SPIEL_OID, {"$set": {"uhrzeit": "15:00:00"}})
    for registrierung_id in (PENDING_OID, DECLINED_OID):
        await edited(database, Collection.REGISTRIERUNGEN, registrierung_id, {"$set": {"nummer": "11"}})
    # Images of rows the person's steps never reach, each holding the address: two pending changes.
    for change_id in (OTHER_REFEREE_CHANGE_OID, MOVING_PUPIL_CHANGE_OID):
        await edited(database, Collection.ADRESSWECHSEL, change_id, {"$set": {"verschickt_am": "2026-03-30"}})
    # And of the records they made, each image keeping them as its author: the address pass's alone to reach.
    await edited(database, Collection.BERECHTIGUNGEN, GRANTED_BY_THEM_OID, {"$set": {"erteilt_am": datetime(2026, 1, 2, tzinfo=UTC)}})
    await edited(database, Collection.SPERRLISTE, BANNED_BY_THEM_OID, {"$set": {"grund": "Doppelte Anmeldung"}})
    await edited(database, Collection.EINLADUNGEN, INVITED_BY_THEM_OID, compose_widerruf_update(today=TODAY))
    await edited(database, Collection.BEWERBUNGEN, DECIDED_BY_THEM_OID, {"$set": {"wunschgegner": "Gast-Schule"}})
    await edited(database, Collection.REGISTRIERUNGEN, DECLINED_BY_THEM_OID, {"$set": {"nummer": "12"}})
    await their_confirmations(database)
    await their_reports(database)

    # Written AS the person: their own record as a pupil, and another pupil's squad row as a seat holder.
    await acting(
        PersonActor(pseudonym=PSEUDONYM, funktion="spieler"),
        lambda: edited(database, Collection.SPIELER, PUPIL_OID, {"$set": {"einwilligung.medien": False}}),
    )
    await acting(
        PersonActor(pseudonym=PSEUDONYM, funktion="kontakt"),
        lambda: edited(database, Collection.SAISON_SPIELER, other_row, {"$set": {"nummer": "10"}}),
    )
    # And as an administrator, under the folded address every administrator's row stores.
    await acting(
        Actor(kind="admin_session", email=IDENTIFIER),
        lambda: edited(database, Collection.TEAMS, OTHER_TEAM_OID, {"$set": {"name": "Gast-Schule"}}),
    )

    await a_mailbox_sharing_their_local_part(database)


async def pending_changes(database: AsyncDatabase, *changes: tuple[ObjectId, str, str, str, str]) -> None:
    """Each `(id, address on file, new address, link, day)` as a start inserts it."""

    await database[Collection.ADRESSWECHSEL].insert_many(
        [
            {"_id": change_id, **documents.adresswechsel_document(adresse=adresse, email=email, token_hash=hash_token(link), day=day)}
            for change_id, adresse, email, link, day in changes
        ]
    )


async def a_mailbox_sharing_their_local_part(database: AsyncDatabase) -> None:
    await database[Collection.REGISTRIERUNGEN].insert_one(
        registrierung_document(
            ELSEWHERE_REGISTRATION_OID,
            ELSEWHERE,
            saison_id=SAISON_ID,
            team_id=HOME_TEAM_OID,
            vorname="Quendolin",
            nachname="Anderswo",
            token="token-anderswo",
            eingereicht_am="2026-03-25",
            frist="2026-04-08",
        )
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            referee(ELSEWHERE_REFEREE_OID, email=ELSEWHERE, name="Quendolin Anderswo"),
            referee(REFEREE_MOVING_ELSEWHERE_OID, email="umzug.dritter@example.com", name="Udo Dritter"),
        ]
    )
    await database[Collection.SPIELER].insert_one(
        spieler_document(
            PUPIL_MOVING_ELSEWHERE_OID,
            "Ulla",
            "Ulla-Muster",
            email="ulla@example.com",
            einwilligung=eigene_einwilligung_document(text_version="v1", bestaetigt_am="2026-03-02"),
        )
    )
    await pending_changes(
        database,
        (REFEREE_MOVING_ELSEWHERE_CHANGE_OID, "umzug.dritter@example.com", ELSEWHERE, "to-anderswo", "2026-03-28"),
        (PUPIL_MOVING_ELSEWHERE_CHANGE_OID, "ulla@example.com", ELSEWHERE, "ulla-to-anderswo", "2026-03-29"),
    )
    await a_grant(database, ELSEWHERE_GRANT_OID, ELSEWHERE, "administration")
    await database[Collection.SAISON_TEAMS].insert_one(
        saison_team_document(
            SAISON_ID,
            OTHER_TEAM_OID,
            "Gast-Schule",
            "GS",
            _id=ELSEWHERE_SEAT_ROW_OID,
            kontakte=kontakte_document(
                ansprechperson=kontaktperson_document("Quendolin", bestaetigt_am="2026-03-21", nachname="Anderswo", email=ELSEWHERE)
            ),
        )
    )
    # Not on `teams`: the case reading the person's administrator rows takes every row there.
    await acting(
        Actor(kind="admin_session", email=ELSEWHERE),
        lambda: edited(database, Collection.SPIELE, OTHER_SPIEL_OID, {"$set": {"uhrzeit": "16:00:00"}}),
    )


async def what_elsewhere_holds(database: AsyncDatabase) -> dict[str, int]:
    """Each record counted where it still names `ELSEWHERE`, beside the notices about its grant: one taken as the person's queues one."""

    changes = database[Collection.ADRESSWECHSEL]

    return {
        "registration": await database[Collection.REGISTRIERUNGEN].count_documents({"_id": ELSEWHERE_REGISTRATION_OID, "email": ELSEWHERE}),
        "referee": await database[Collection.SCHIEDSRICHTER].count_documents({"_id": ELSEWHERE_REFEREE_OID, "kontakt.email": ELSEWHERE}),
        "seat": await database[Collection.SAISON_TEAMS].count_documents(
            {
                "_id": ELSEWHERE_SEAT_ROW_OID,
                "kontakte.ansprechperson.email": ELSEWHERE,
                "kontakte.ansprechperson.einwilligung.bestaetigt_am": {"$ne": None},
            }
        ),
        "grant": await database[Collection.BERECHTIGUNGEN].count_documents({"_id": ELSEWHERE_GRANT_OID, "adresse": ELSEWHERE}),
        "announced": await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].count_documents({"_id": ELSEWHERE_GRANT_OID, "adresse": ELSEWHERE}),
        "notices": await database[Collection.BERECHTIGUNGEN_POSTAUSGANG].count_documents({"berechtigung_id": ELSEWHERE_GRANT_OID}),
        "referee_change": await changes.count_documents({"_id": REFEREE_MOVING_ELSEWHERE_CHANGE_OID, "email": ELSEWHERE}),
        "pupil_change": await changes.count_documents({"_id": PUPIL_MOVING_ELSEWHERE_CHANGE_OID, "email": ELSEWHERE}),
        "log_actor": await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.SPIELE), "actor.email": ELSEWHERE}),
    }


ELSEWHERE_HOLDS = {
    "registration": 1,
    "referee": 1,
    "seat": 1,
    "grant": 1,
    "announced": 1,
    "notices": 0,
    "referee_change": 1,
    "pupil_change": 1,
    "log_actor": 1,
}


GRANTED = datetime(2026, 1, 1, tzinfo=UTC)


async def records_they_made_holding_no_grant(database: AsyncDatabase) -> None:
    """A grant, two bans, an invitation and two decisions in their name, each typed as stored, while the address holds no grant.

    The grants step marks each: it runs in the full scope whatever the address holds.
    """

    await database[Collection.BERECHTIGUNGEN].insert_one(
        {
            "_id": GRANTED_BY_THEM_OID,
            "adresse": "bramblewick.admin@example.com",
            "verwaltung": "administration",
            "erteilt_von": IDENTIFIER,
            "erteilt_am": GRANTED,
        }
    )
    await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].insert_one(
        {"_id": GRANTED_BY_THEM_OID, "adresse": "bramblewick.admin@example.com", "verwaltung": "administration", "angekuendigt_am": GRANTED}
    )
    await database[Collection.SPERRLISTE].insert_many(
        [
            ban_document(address, bis=compose_gesperrt_bis_saison_id(massgebliche_saison_id=SAISON_ID), _id=ban_id, erstellt_von=von)
            for address, ban_id, von in (
                ("gebannt@beispiel.de", BANNED_BY_THEM_OID, IDENTIFIER),
                ("gebannt-zwei@beispiel.de", BANNED_BY_THEM_PASTED_OID, PASTED),
            )
        ]
    )
    await database[Collection.EINLADUNGEN].insert_one(
        {
            "_id": INVITED_BY_THEM_OID,
            **compose_einladung(
                saison_id=SAISON_ID, team_id=HOME_TEAM_OID, token_hash="hash-of-their-invite", erstellt_von=IDENTIFIER, today=TODAY
            ),
        }
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            DECIDED_BY_THEM_OID,
            SAISON_ID,
            "abgelehnt",
            kontakte=kontakte_document(),
            eingereicht_am="2026-03-01",
            schule=neue_schule_document("Abgelehnt", "AB"),
            entscheidung={"getroffen_am": "2026-03-10", "von": IDENTIFIER, "grund": "Keine Halle"},
        )
    )
    declined = registrierung_document(
        DECLINED_BY_THEM_OID,
        "rita@beispiel.de",
        saison_id=SAISON_ID,
        team_id=HOME_TEAM_OID,
        vorname="Rita",
        nachname="Registriert",
        token="token-rita",
        eingereicht_am="2026-03-20",
        frist="2026-03-27",
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        {**declined, **compose_ablehnung_update(von=IDENTIFIER, grund=None, today="2026-03-22")["$set"]}
    )


async def a_grant(database: AsyncDatabase, grant_id: ObjectId, adresse: str, verwaltung: str) -> None:
    """A grant and its announced row, granted by a paste, for the cases about a grant the address holds."""

    await database[Collection.BERECHTIGUNGEN].insert_one(
        {"_id": grant_id, "adresse": adresse, "verwaltung": verwaltung, "erteilt_von": "PLAYGROUND", "erteilt_am": GRANTED}
    )
    await database[Collection.BERECHTIGUNGEN_ANGEKUENDIGT].insert_one(
        {"_id": grant_id, "adresse": adresse, "verwaltung": verwaltung, "angekuendigt_am": GRANTED}
    )


async def everything_in(database: AsyncDatabase) -> dict[str, list[Any]]:
    """Every document of every collection, in a fixed order, so two reads compare equal only where nothing was written."""

    return {name: await database[name].find().sort("_id", 1).to_list(length=None) for name in sorted(await database.list_collection_names())}


def on_a_league(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """The shipped validators and indexes, and the person seeded with their whole history.

    `mutates_schema=True` where the body narrows one of those validators (`tests/database.py :: a_clean_database`).
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            await a_person_holding_everything(database)

            return await body(database, client)

    return on_the_seed_loop(_run())


def as_person(email: str) -> SignedActor:
    return SignedActor(email, ADMIN_KEY, lane="person")


def by_passkey(email: str) -> dict[str, str]:
    """A person who confirmed with their passkey a second before the token, as the page's prompt leaves them: signed when called."""

    claims = {**actor_claims(email, lane="person", signed_in_before_s=1), "amr": [ACTOR_TOKEN_CONTRACT["admin_factor"]]}

    return {**ADMIN_KEY, ACTOR_HEADER: sign(claims)}


async def erased_over_http(url: str, *, email: str = TYPED, headers: Mapping[str, str] | None = None) -> Any:
    async with app_client(url, app=_app(), now=NOW) as http:
        return await http.post(PATH, headers=headers or as_person(email))


async def erased_by_the_handler(database: AsyncDatabase, client: AsyncMongoClient, *, identifier: str = IDENTIFIER, **replaced: Any) -> Any:
    """The route's own function, outside a request: what a case needs to catch the driver's failure itself."""

    return await erased(database, client, identifier, germany_now=NOW, **replaced)


async def erased_in_scope(
    database: AsyncDatabase, client: AsyncMongoClient, scope: frozenset[Any], *, identifier: str = IDENTIFIER, **replaced: Any
) -> Any:
    async def erase(session: Any) -> Any:
        return await erase_everything(
            identifier,
            scope=scope,
            **erasure_collections(database, **replaced),
            sperrliste=ban_list(database),
            geaendert_von=IDENTIFIER,
            schluessel=CONFIG.sperrliste_schluessel,
            stamp=TODAY,
            now=NOW,
            session=session,
        )

    async with transaction_session(client) as session:
        return await session.with_transaction(erase)


class TestNothingOfTheirsIsLeftAnywhere:
    """The witness for reach: the whole database read for what they held, each collection named where something survives.

    Their values case-blind, their address on the fold, and their records by id.
    """

    @pytest.mark.parametrize("holding_a_grant", [False, True], ids=["holding no grant", "holding an administration grant"])
    def test_no_value_of_theirs_survives_and_every_bystanders_does(self, mongo_replica_set_url: str, holding_a_grant: bool):
        """Catches a step removed from the registry, or a store none reaches, the pseudonym's included.

        Each value and id is asserted present first, so a seed that stopped writing one fails; the grant, where held, adds its
        rows and notice.
        """

        records = (*THEIR_RECORDS, *([THEIR_GRANT_OID] if holding_a_grant else []))

        async def scanned(database: AsyncDatabase, *values: str) -> tuple[dict[str, list[str]], list[str], dict[Any, list[str]]]:
            return (
                await where_held(database, *values, folded=True, beside=(ELSEWHERE,)),
                await where_folded_to(database, IDENTIFIER),
                await where_referenced(database, *records),
            )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if holding_a_grant:
                await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            before = await scanned(database, *THEIR_VALUES, *BYSTANDERS_IN_THE_LOG)
            response = await erased_over_http(mongo_replica_set_url, headers=by_passkey(TYPED))

            return before, response.status_code, await scanned(database, *THEIR_VALUES, *BYSTANDER_VALUES)

        (before, folded_before, ids_before), status, (after, folded_after, ids_after) = on_a_league(mongo_replica_set_url, body)

        assert all(before[value] for value in THEIR_VALUES), before
        assert folded_before and all(ids_before.values()), (folded_before, ids_before)
        assert status == 200
        assert {value: after[value] for value in THEIR_VALUES} == dict.fromkeys(THEIR_VALUES, [])
        # On the fold too, which reads a spelling no case-blind match does, whatever the local part spells.
        assert folded_after == []
        assert ids_after == dict.fromkeys(records, [])
        assert [value for value in BYSTANDER_VALUES if not after[value]] == []
        # In the log too: a pass emptying a shared image whole would take the people beside them with it.
        assert {value: "aktionen" in before[value] for value in BYSTANDERS_IN_THE_LOG} == dict.fromkeys(BYSTANDERS_IN_THE_LOG, True), before
        assert {value: "aktionen" in after[value] for value in BYSTANDERS_IN_THE_LOG} == dict.fromkeys(BYSTANDERS_IN_THE_LOG, True), after

    def test_each_kind_is_counted_as_it_went(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (await erased_over_http(mongo_replica_set_url)).json()

        answer = on_a_league(mongo_replica_set_url, body)

        assert {key: value for key, value in answer.items() if key != "acknowledged"} == {
            "spieler": 1,
            "saison_spieler": 1,
            "schiedsrichter": 1,
            "spiele": 1,
            "kontakt_sitze": 3,
            "registrierungen": 2,
            "adresswechsel": 2,
            "berechtigungen": 0,
            # The request about their address and the one they asked.
            "berechtigungen_antraege": 2,
            "drosselung": 4,
        }


class TestWhatStandsBesideThem:
    """What the erasure must NOT take: each a row or a value somebody else holds."""

    def test_their_team_reads_one_player_fewer_and_the_pupil_needed_no_retirement(self, mongo_replica_set_url: str):
        """A pupil in a live squad goes on one pass; the squad is a live list, so nothing is repointed in their place."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            live = {"saison_id": SAISON_ID, "team_id": HOME_TEAM_OID, "inactive_since": None}
            before = await database[Collection.SAISON_SPIELER].count_documents(live)
            await erased_over_http(mongo_replica_set_url)

            return before, await database[Collection.SAISON_SPIELER].count_documents(live)

        assert on_a_league(mongo_replica_set_url, body) == (2, 1)

    def test_the_bystanders_seats_stand_and_theirs_is_empty(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            row = await database[Collection.SAISON_TEAMS].find_one()
            bewerbung = await database[Collection.BEWERBUNGEN].find_one({"_id": BEWERBUNG_OID})
            return row, bewerbung

        row, bewerbung = on_a_league(mongo_replica_set_url, body)

        assert row["kontakte"]["ansprechperson"] is None
        assert (row["kontakte"]["stellvertretung"]["vorname"], row["kontakte"]["trainer"]["vorname"]) == ("Quillhilde", "Bramblewick")
        assert (bewerbung["kontakte"]["trainer"], bewerbung["bestaetigungen"]["trainer"]) == (None, None)
        assert bewerbung["bestaetigungen"]["ansprechperson"] is not None
        assert "idempotenz_fingerabdruck" not in bewerbung

    @pytest.mark.parametrize(
        ("change_id", "collection", "row_id", "path", "stored"),
        [
            pytest.param(
                OTHER_REFEREE_CHANGE_OID,
                Collection.SCHIEDSRICHTER,
                OTHER_REFEREE_OID,
                "kontakt.email",
                "kraus.bernd@example.com",
                id="a referee's",
            ),
            pytest.param(MOVING_PUPIL_CHANGE_OID, Collection.SPIELER, MOVING_PUPIL_OID, "email", "gwendolyn@example.com", id="a pupil's"),
        ],
    )
    def test_another_persons_pending_change_to_their_address_ends_and_that_persons_row_stands(
        self, mongo_replica_set_url: str, change_id: ObjectId, collection: Collection, row_id: ObjectId, path: str, stored: str
    ):
        """The row is the address on file's person's until the change takes effect, so the change alone ends."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return await the_one(database, Collection.ADRESSWECHSEL, {"_id": change_id}), await the_one(database, collection, {"_id": row_id})

        change, row = on_a_league(mongo_replica_set_url, body)

        assert (change["beendet"]["art"], change["email"]) == ("verworfen", None)
        held: Any = row
        for key in path.split("."):
            held = held[key]
        assert held == stored

    def test_their_fixture_names_the_ghost_and_no_name_and_keeps_its_fee(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return {row["_id"]: row["schiedsrichter"] async for row in database[Collection.SPIELE].find()}

        bookings = on_a_league(mongo_replica_set_url, body)

        assert bookings[THEIR_SPIEL_OID] == {"schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "name": None, "payment": PAYMENT}
        assert bookings[OTHER_SPIEL_OID]["schiedsrichter_id"] == OTHER_REFEREE_OID

    def test_their_confirmations_go_and_an_undraws_image_of_theirs_names_the_ghost(self, mongo_replica_set_url: str):
        """Catches a member keyed on the party's kind alone, taking another referee's row and reason with theirs.

        An undraw's array holds a row long gone, which no pass over the standing rows' ids reaches.
        """

        def party_and_reason(image: Mapping[str, Any]) -> tuple[Any, Any]:
            return image["partei"]["schiedsrichter_id"], (image["antwort"] or {}).get("begruendung", "unanswered")

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            rows = await database[Collection.SPIELBESTAETIGUNGEN].find().sort("_id", 1).to_list(length=None)
            logged = await database[Collection.AKTIONEN].find({"collection": str(Collection.SPIELBESTAETIGUNGEN)}).to_list(length=None)
            images = [image for row in logged for image in (row["before"] if isinstance(row["before"], list) else [row["before"]]) if image]

            return [row["_id"] for row in rows], sorted((party_and_reason(image) for image in images), key=str)

        standing, images = on_a_league(mongo_replica_set_url, body)

        assert standing == [OTHER_CONFIRMATION_OID, TEAM_CONFIRMATION_OID]
        assert images == sorted(
            [(GHOST_SCHIEDSRICHTER_ID, None), (OTHER_REFEREE_OID, OTHER_REASON)],
            key=str,
        )

    def test_their_reports_stand_naming_the_ghost_in_the_document_and_every_image(self, mongo_replica_set_url: str):
        """The report is the league's record of the match: it stays, its remarks with it, and another referee's report is theirs."""

        def sender(image: Mapping[str, Any]) -> Any:
            return image["bericht"]["eingereicht_von"]["schiedsrichter_id"]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            reports = await database[Collection.SPIELBERICHTE].find().sort("_id").to_list(length=None)
            logged = await database[Collection.AKTIONEN].find({"collection": str(Collection.SPIELBERICHTE)}).to_list(length=None)
            images = [image for row in logged for image in (row["before"] if isinstance(row["before"], list) else [row["before"]]) if image]

            return [(row["_id"], sender(row), row["bericht"]["bemerkungen"]) for row in reports], sorted(map(sender, images), key=str)

        reports, images = on_a_league(mongo_replica_set_url, body)

        assert reports == [(THEIR_REPORT_OID, GHOST_SCHIEDSRICHTER_ID, THEIR_REMARKS), (OTHER_REPORT_OID, OTHER_REFEREE_OID, THEIR_REMARKS)]
        assert images == sorted([GHOST_SCHIEDSRICHTER_ID, GHOST_SCHIEDSRICHTER_ID, OTHER_REFEREE_OID], key=str)

    def test_only_their_day_counts_go(self, mongo_replica_set_url: str):
        """Every day of theirs, the one the TTL monitor may not have reached included, and another person's count of today stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return [row["_id"] async for row in database[Collection.DROSSELUNG].find()]

        assert on_a_league(mongo_replica_set_url, body) == [OTHER_COUNT_ID]

    def test_a_mailbox_sharing_their_local_part_keeps_every_record(self, mongo_replica_set_url: str):
        """Read before as well, so a seed that stopped writing a record fails rather than agreeing with the erasure on a zero."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await what_elsewhere_holds(database)
            await erased_over_http(mongo_replica_set_url)

            return before, await what_elsewhere_holds(database)

        assert on_a_league(mongo_replica_set_url, body) == (ELSEWHERE_HOLDS, ELSEWHERE_HOLDS)


class TestTheLogNamesNobodyInTheirPlace:
    """The rows they wrote stay, saying an action happened, and name the marker where they stood."""

    def test_every_row_they_wrote_names_the_marker_and_keeps_its_image(self, mongo_replica_set_url: str):
        """Their own rows are this erasure's too: written under their pseudonym before the log's step ran, last."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return await database[Collection.AKTIONEN].find().to_list(length=None)

        rows = on_a_league(mongo_replica_set_url, body)
        as_administrator = [row for row in rows if row["collection"] == str(Collection.TEAMS)]
        as_a_seat_holder = [
            row
            for row in rows
            if row["collection"] == str(Collection.SAISON_SPIELER) and (row["before"] or {}).get("spieler_id") == OTHER_PUPIL_OID
        ]
        erasures = [row for row in rows if row["request"] is not None and row["request"]["path"] == PATH]

        assert [row["actor"] for row in as_administrator] == [{"kind": "admin_session", "email": ERASED_ACTOR_MARKER}]
        assert [row["actor"] for row in as_a_seat_holder] == [
            {"kind": "person_session", "pseudonym": ERASED_ACTOR_MARKER, "funktion": "kontakt"}
        ]
        # An actor-only redaction: the image is another document's and stays, unstamped.
        assert all(row["before"] is not None and row["redacted_at"] is None for row in [*as_administrator, *as_a_seat_holder])
        assert erasures, "the erasure filed no row of its own, so the assertion below holds of nothing"
        assert {row["actor"]["pseudonym"] for row in erasures} == {ERASED_ACTOR_MARKER}


class TestTheSentinels:
    def test_the_first_erasure_writes_a_sentinel_naming_nobody_and_recording_no_consent(self, mongo_replica_set_url: str):
        """A name here is published on every erased pupil's surviving entry; a record here is counted as a consent."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return await database[Collection.SPIELER].find_one({"_id": GHOST_SPIELER_ID})

        sentinel = on_a_league(mongo_replica_set_url, body)

        assert sentinel is not None
        assert (sentinel["vorname"], sentinel["nachname"], sentinel["einwilligung"]) == (None, None, None)

    def test_a_second_erasure_reuses_each_sentinel(self, mongo_replica_set_url: str):
        """Catches a sentinel written per run: one nameless row per erased person, and the second refused on the name index."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)
            # A second pupil and a second referee at a second address, so the second run needs both sentinels again.
            second = "wraxlington@example.com"
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": OTHER_REFEREE_OID}, {"$set": {"kontakt.email": second}})
            await erased_over_http(mongo_replica_set_url, email=second)

            return (
                await database[Collection.SPIELER].find({}, {"_id": 1}).to_list(length=None),
                await database[Collection.SCHIEDSRICHTER].find({}, {"_id": 1}).to_list(length=None),
            )

        pupils, referees = on_a_league(mongo_replica_set_url, body)

        assert sorted(row["_id"] for row in pupils) == sorted(
            [GHOST_SPIELER_ID, MOVING_PUPIL_OID, READDRESSED_PUPIL_OID, PUPIL_MOVING_ELSEWHERE_OID]
        )
        assert sorted(row["_id"] for row in referees) == sorted([GHOST_SCHIEDSRICHTER_ID, ELSEWHERE_REFEREE_OID, REFEREE_MOVING_ELSEWHERE_OID])


class TestTheSentinelIsNobodyToErase:
    def test_the_pupil_step_handed_the_sentinel_removes_nothing(self, mongo_replica_set_url: str):
        """Catches the step keying its removals on the bare id: the sentinel would go, and every reference repointed at it dangle."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(build_ghost_spieler())

            async def erase(session: Any) -> Any:
                return await erase_person_in_session(
                    spieler_collection=database[Collection.SPIELER],
                    saison_spieler_collection=database[Collection.SAISON_SPIELER],
                    aktionen_collection=database[Collection.AKTIONEN],
                    spieler_id=GHOST_SPIELER_ID,
                    stamp=TODAY,
                    session=session,
                )

            with pytest.raises(DocumentNotFoundException):
                async with transaction_session(client) as session:
                    await session.with_transaction(erase)

            return await database[Collection.SPIELER].count_documents({"_id": GHOST_SPIELER_ID})

        assert on_a_league_of_its_own(mongo_replica_set_url, body) == 1


class TestOneTransaction:
    """A failure at a late write takes every step back: an erasure half done reports one that did not happen."""

    def test_a_refused_last_write_leaves_everything_as_it_stood(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The validator refuses the marker on a person's row, which the log's step writes first, after every step removing a record."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database.command(
                "collMod",
                Collection.AKTIONEN.value,
                validator={
                    "$jsonSchema": {"bsonType": "object", "properties": {"actor": {"properties": {"pseudonym": {"pattern": "^[0-9a-f]{64}$"}}}}}
                },
                validationLevel="strict",
            )

            with pytest.raises(OperationFailure) as failure:
                await erased_by_the_handler(database, client)

            return (
                failure.value.code,
                {
                    str(collection): await database[collection].count_documents({})
                    for collection in (
                        Collection.BERECHTIGUNGEN,
                        Collection.SPIELER,
                        Collection.SAISON_SPIELER,
                        Collection.SCHIEDSRICHTER,
                        Collection.REGISTRIERUNGEN,
                        Collection.DROSSELUNG,
                    )
                },
                (
                    (await the_one(database, Collection.SAISON_TEAMS))["kontakte"]["ansprechperson"]["email"],
                    (await the_one(database, Collection.ADRESSWECHSEL, {"_id": OTHER_REFEREE_CHANGE_OID}))["email"],
                    await database[Collection.AKTIONEN].count_documents({"actor.pseudonym": PSEUDONYM}),
                    await database[Collection.AKTIONEN].count_documents({"redacted_at": {"$ne": None}}),
                    await database[Collection.SPIELE].count_documents({"schiedsrichter.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID}),
                ),
            )

        with caplog.at_level(logging.INFO):
            code, counts, (seat, pending, their_rows, stamped, on_the_ghost) = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        # On the code, so this cannot pass because something else failed before any write.
        assert code == DOCUMENT_VALIDATION_FAILED
        assert counts == {"berechtigungen": 2, "spieler": 5, "saison_spieler": 2, "schiedsrichter": 4, "registrierungen": 4, "drosselung": 5}
        assert (seat, pending, their_rows, stamped, on_the_ghost) == (IDENTIFIER, IDENTIFIER, 2, 0, 0)
        # And no journal line nor floor warning: an erasure rolled back is no erasure a replay may repeat.
        assert not [record for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]
        assert NO_OWNER.error_code not in [getattr(record, "error_code", None) for record in caplog.records]


class TestTheGrantsLeftBehind:
    def test_an_erasure_taking_a_grant_names_what_is_left_once_it_commits(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The floor of two holds against no erasure, so the boot's own warning names what is left: here a list holding no owner."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")

            return (await erased_over_http(mongo_replica_set_url, headers=by_passkey(TYPED))).json()["berechtigungen"]

        with caplog.at_level(logging.WARNING):
            removed = on_a_league(mongo_replica_set_url, body)

        assert removed == 1
        assert [getattr(record, "error_code", None) for record in caplog.records].count(NO_OWNER.error_code) == 1


class TestTheJournal:
    def test_one_line_per_erasure_names_the_journal_hash_and_no_address(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (await erased_over_http(mongo_replica_set_url)).status_code

        with caplog.at_level(logging.INFO):
            status = on_a_league(mongo_replica_set_url, body)

        lines = [record.getMessage() for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]
        expected = loeschung_journal_hash(IDENTIFIER, schluessel=CONFIG.sperrliste_schluessel)

        halter = halter_of(IDENTIFIER, schluessel=CONFIG.sperrliste_schluessel)

        assert status == 200
        assert lines == [f"{JOURNAL_TOKEN} {expected} loeschung pseudonym={PSEUDONYM} halter={halter}"]
        # Its own label: under the log's, every choice's line would name the pseudonym the erasure's line alone names.
        assert expected != PSEUDONYM

    def test_the_line_is_written_whatever_the_application_log_level(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches the journal written through the application's own logger, which `LOG_LEVEL_APP=WARNING` silences.

        No `caplog.at_level` here: it would lower the very levels this case is about.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            quiet = create_app(QUIET)
            # The build's `dictConfig` took every handler off the root, `caplog`'s among them: that one back, at no level.
            logging.getLogger().addHandler(caplog.handler)
            try:
                async with app_client(mongo_replica_set_url, app=quiet, now=NOW) as http:
                    return (await http.post(PATH, headers=as_person(TYPED))).status_code
            finally:
                # The suite's own levels back, for every case after this one.
                setup_custom_logger(CONFIG)

        status = on_a_league(mongo_replica_set_url, body)
        lines = [record.getMessage() for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]

        assert (status, len(lines)) == (200, 1)


class OwnersErasingAtOnce(InterleavedCollection):
    """`berechtigungen` as one owner's erasure reads it, the other owner's whole erasure committing once its first read answered."""

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        # After the read rather than before it: the read opens this transaction's snapshot, which the rival must land inside.
        cursor = await self._collection.aggregate(*args, **kwargs)
        await self.run_the_rival()
        return cursor


class TestTheLastOwner:
    """`REQ-PURGE-004`: nobody but an owner makes an owner, so the last one does not leave by erasing themselves."""

    def test_the_last_owner_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "owner")
            before = await everything_in(database)
            outcome = await outcome_of(erased_by_the_handler(database, client))

            return outcome, before == await everything_in(database)

        with caplog.at_level(logging.INFO):
            outcome, untouched = on_a_league(mongo_replica_set_url, body)

        assert (outcome, untouched) == (LETZTER_INHABER_ERASURE, True)
        assert not [record for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]

    def test_a_barred_second_owner_is_no_owner_to_leave_behind(self, mongo_replica_set_url: str):
        """Counted as a demotion counts: a barred owner admits nobody, so it could make nobody an owner."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "owner")
            await a_grant(database, OTHER_OWNER_OID, OTHER_OWNER, "owner")
            await database[Collection.SPERRLISTE].insert_one(
                ban_document(OTHER_OWNER, bis=compose_gesperrt_bis_saison_id(massgebliche_saison_id=SAISON_ID))
            )

            return await outcome_of(erased_by_the_handler(database, client))

        assert on_a_league(mongo_replica_set_url, body) == LETZTER_INHABER_ERASURE

    def test_one_of_two_owners_goes_and_the_other_stands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "owner")
            await a_grant(database, OTHER_OWNER_OID, OTHER_OWNER, "owner")
            outcome = await outcome_of(erased_by_the_handler(database, client))

            return outcome, await database[Collection.BERECHTIGUNGEN].find({"verwaltung": "owner"}, {"_id": 1}).to_list(length=None)

        assert on_a_league(mongo_replica_set_url, body) == (COMMITTED, [{"_id": OTHER_OWNER_OID}])

    def test_two_owners_erasing_themselves_at_once_leave_one_owner(self, mongo_replica_set_url: str):
        """Judged on the snapshot alone, each would see the other standing and both would go, leaving nobody to make an owner."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "owner")
            await a_grant(database, OTHER_OWNER_OID, OTHER_OWNER, "owner")
            rival: list[str] = []

            async def the_other_owner_erases_themselves() -> None:
                rival.append(await outcome_of(erased_by_the_handler(database, client, identifier=OTHER_OWNER)))

            grants = OwnersErasingAtOnce(database[Collection.BERECHTIGUNGEN], the_other_owner_erases_themselves)
            outcome = await outcome_of(erased_by_the_handler(database, client, berechtigungen_collection=grants))

            return grants, outcome, rival, await database[Collection.BERECHTIGUNGEN].count_documents({"verwaltung": "owner"})

        grants, outcome, rival, owners = on_a_league(mongo_replica_set_url, body)

        assert (rival, outcome, owners) == ([COMMITTED], LETZTER_INHABER_ERASURE, 1)
        # The premise last: a read, the rival, the anchor's read meeting the conflict, then the retry's read and its anchor's.
        grants.assert_landed_inside(serially=2)


class TestTheScope:
    """The season-after rule's deletion takes a pupil's data alone, every other kind at the address standing."""

    def test_the_pupil_scope_takes_what_the_address_holds_as_a_pupil_and_nothing_else(self, mongo_replica_set_url: str):
        """The person wrote a log row and holds a day count as a pupil and as a seat holder: the seat's stand with the seat."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            await erased_in_scope(database, client, frozenset({"spieler"}))

            return (
                await database[Collection.SPIELER].count_documents({"_id": PUPIL_OID}),
                await database[Collection.REGISTRIERUNGEN].count_documents({"_id": {"$in": [PENDING_OID, DECLINED_OID]}}),
                (await the_one(database, Collection.SAISON_TEAMS))["kontakte"]["ansprechperson"]["email"],
                await database[Collection.SCHIEDSRICHTER].count_documents({"_id": REFEREE_OID}),
                (await the_one(database, Collection.ADRESSWECHSEL, {"_id": OTHER_REFEREE_CHANGE_OID}))["beendet"] is None,
                await database[Collection.AKTIONEN].count_documents({"actor.email": IDENTIFIER}),
                await database[Collection.BERECHTIGUNGEN].count_documents({"adresse": IDENTIFIER}),
                (await the_one(database, Collection.ADRESSWECHSEL, {"_id": MOVING_PUPIL_CHANGE_OID}))["beendet"] is None,
                sorted(
                    [
                        (row["actor"]["funktion"], row["actor"]["pseudonym"])
                        async for row in database[Collection.AKTIONEN].find({"actor.kind": "person_session"})
                    ]
                ),
                sorted([row["_id"] async for row in database[Collection.DROSSELUNG].find()]),
            )

        *rest, as_a_person, counts = on_a_league(mongo_replica_set_url, body)

        assert rest == [0, 0, IDENTIFIER, 1, True, 1, 1, True]
        assert as_a_person == [("kontakt", PSEUDONYM), ("spieler", ERASED_ACTOR_MARKER)]
        assert counts == sorted(count_id for count_id in (*COUNT_IDS, OTHER_COUNT_ID) if not count_id.startswith("spieler:"))


# The registry's steps by the code each runs, so a write can be put down to the step it was made in.
[EMPTIED] = [step for step in ERASURE_STEPS if step.run is end_an_emptied_change_in_session]
_STEP_OF_CODE = {step.run.__code__: step.run.__name__ for step in ERASURE_STEPS}


def _running_step() -> str | None:
    """The outermost step on the stack: the pupil's share hands its count removal to the counts step's function."""

    frame, step = sys._getframe(), None
    while frame is not None:
        step = _STEP_OF_CODE.get(frame.f_code, step)
        frame = frame.f_back
    return step


class WritesRecorded:
    """A collection noting, per erasure step, each driver write it receives; every call is handed on unchanged."""

    def __init__(self, collection: Any, writes: dict[str, set[str]]) -> None:
        self._collection = collection
        self._writes = writes

    def __getattr__(self, name: str) -> Any:
        attribute = getattr(self._collection, name)
        if name not in DRIVER_WRITES:
            return attribute

        def recorded(*args: Any, **kwargs: Any) -> Any:
            step = _running_step()
            if step is not None:
                self._writes.setdefault(step, set()).add(str(self._collection.name))
            return attribute(*args, **kwargs)

        return recorded


class TestEachStepWritesWhatItDeclares:
    def test_the_collections_each_step_writes_are_the_ones_it_declares(self, mongo_replica_set_url: str):
        """`reaches` is what the completeness case in `tests/core/test_domain.py` trusts; here it is held to the writes themselves.

        The seed and a grant of the person's own give every step something to write in each collection it declares.
        """

        writes: dict[str, set[str]] = {}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            recorded: dict[str, Any] = {name: WritesRecorded(handle, writes) for name, handle in erasure_collections(database).items()}
            await erased_in_scope(database, client, JEDE_PERSONENGRUPPE, **recorded)

        on_a_league(mongo_replica_set_url, body)

        # The whole erasure ends every change naming the address first, leaving the emptied change's step nothing: its own case.
        assert writes == {step.run.__name__: {str(collection) for collection in step.reaches} for step in ERASURE_STEPS if step != EMPTIED}

    def test_a_pupils_erasure_ends_the_change_of_an_address_it_empties_writing_what_that_step_declares(self, mongo_replica_set_url: str):
        """Gwendolyn holds a pupil row alone, so the season's erasure of it leaves her change nothing to move."""

        writes: dict[str, set[str]] = {}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            recorded: dict[str, Any] = {name: WritesRecorded(handle, writes) for name, handle in erasure_collections(database).items()}
            await erased_in_scope(database, client, frozenset({"spieler"}), identifier="gwendolyn@example.com", **recorded)

            return await the_one(database, Collection.ADRESSWECHSEL, {"_id": MOVING_PUPIL_CHANGE_OID})

        change = on_a_league(mongo_replica_set_url, body)

        assert writes[EMPTIED.run.__name__] == {str(collection) for collection in EMPTIED.reaches}
        # Its address on file goes too: no erasure of the address follows a pupil's to take it.
        assert (change["beendet"]["art"], change["adresse"], change["email"]) == ("verworfen", None, None)

    def test_a_pupils_erasure_leaves_the_change_of_an_address_still_holding_records(self, mongo_replica_set_url: str):
        """The person is a referee and a seat holder beside the pupil, so their change still has those to move."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await pending_changes(database, (THEIR_CHANGE_OID, IDENTIFIER, "neu.adresse@anderswo.org", "their-own-change", "2026-03-30"))
            await erased_in_scope(database, client, frozenset({"spieler"}))

            return await the_one(database, Collection.ADRESSWECHSEL, {"_id": THEIR_CHANGE_OID})

        change = on_a_league(mongo_replica_set_url, body)

        assert (change["beendet"], change["adresse"]) == (None, IDENTIFIER)


class RegistrationsAdmittedInside(InterleavedCollection):
    """`registrierungen` as the erasure reads it, an admission of the pending row committing at the first read."""

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.aggregate(*args, **kwargs)


SEAT_HOLDER = "anna@example.com"


async def an_admittable_registration(database: AsyncDatabase) -> None:
    """The person holds nothing but a registration their team's seat holder can admit: the admission is what makes them a pupil."""

    await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
    await database[Collection.TEAMS].insert_one(team_document(HOME_TEAM_OID, "Heim-Schule", "HS"))
    await database[Collection.SAISON_TEAMS].insert_one(
        saison_team_document(
            SAISON_ID,
            HOME_TEAM_OID,
            "Heim-Schule",
            "HS",
            kontakte=kontakte_document(ansprechperson=kontaktperson_document("Anna", bestaetigt_am="2026-03-21")),
        )
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        a_registration(
            PENDING_OID,
            IDENTIFIER,
            bestaetigt={
                "geburtsdatum": GEBURTSDATUM,
                "umfang": "intern",
                "medien": False,
                "text_version": "2026-09",
                "today": YESTERDAY,
                "am": "2026-03-31T08:00:00+00:00",
            },
        )
    )


class TestAnAdmissionInsideTheErasure:
    """The subject is read inside the transaction's callback, so the retry a conflict forces re-reads what the rival wrote."""

    def test_the_person_the_admission_made_does_not_survive_the_retry(self, mongo_replica_set_url: str):
        """Resolved outside the callback, the retry would erase the gone registration, answer zero and leave the admitted pupil."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await an_admittable_registration(database)

            async def admission() -> None:
                await aufnehmen(
                    registrierung_id=PENDING_OID,
                    aufnahme_data=FLRegistrierungAufnehmenPayload(spieler_id=None),
                    identifier=SEAT_HOLDER,
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

            registrations = RegistrationsAdmittedInside(database[Collection.REGISTRIERUNGEN], admission)
            answer = await erased_by_the_handler(database, client, registrierungen_collection=registrations)

            return (
                registrations,
                answer,
                await database[Collection.SPIELER].count_documents({"email": IDENTIFIER}),
                await database[Collection.SAISON_SPIELER].count_documents({}),
                await database[Collection.REGISTRIERUNGEN].count_documents({}),
            )

        registrations, answer, pupils, squad_rows, left = on_a_league_of_its_own(mongo_replica_set_url, body)

        assert (pupils, squad_rows, left) == (0, 0, 0)
        assert (answer.spieler, answer.saison_spieler, answer.registrierungen) == (1, 1, 0)
        # The premise last, so a stale subject fails on the pupil it left rather than on the count of reads.
        registrations.assert_landed_inside(serially=1)


def on_a_league_of_its_own(url: str, body: Body) -> Any:
    """An empty league, the body seeding what it needs."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            return await body(database, client)

    return on_the_seed_loop(_run())


class TestAPersonHoldingNoFunktion:
    """A mailbox whose records grant no panel still signs in, and is erased like anyone else."""

    @pytest.mark.parametrize("only", ["an application seat", "a confirmed pending registration"])
    def test_their_one_record_goes(self, mongo_replica_set_url: str, only: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if only == "an application seat":
                await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
                await database[Collection.BEWERBUNGEN].insert_one(
                    bewerbung_document(
                        BEWERBUNG_OID,
                        SAISON_ID,
                        "eingereicht",
                        kontakte=kontakte_document(trainer=their_seat(), ansprechperson=kontaktperson_document("Quillhilde")),
                        eingereicht_am="2026-03-10",
                        schule=neue_schule_document("Neue", "NE"),
                    )
                )
            else:
                await an_admittable_registration(database)

            response = await erased_over_http(mongo_replica_set_url)

            return response.status_code, await where_held(database, VORNAME)

        status, held = on_a_league_of_its_own(mongo_replica_set_url, body)

        assert (status, held) == (200, {VORNAME: []})


class TestThePreview:
    """What the page shows before the press: every record of the person's own the erasure takes, by name, and no address or birthdate."""

    def test_it_names_every_record_of_their_own_the_erasure_takes(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                return await http.get(f"{PATH}/ansicht", headers=as_person(TYPED))

        response = on_a_league(mongo_replica_set_url, body)
        answer = response.json()

        assert response.status_code == 200
        assert answer["spieler"] == [{"vorname": VORNAME, "nachname": NACHNAME}]
        assert answer["schiedsrichter"] == [{"name": REFEREE_NAME}]
        assert answer["sitze"] == [
            {"saison_id": SAISON_ID, "team_name": "Heim-Schule", "rolle": "ansprechperson", "vorname": VORNAME, "nachname": NACHNAME}
        ]
        assert sorted(answer["bewerbungen"], key=lambda entry: entry["rolle"]) == [
            {"saison_id": SAISON_ID, "rolle": rolle, "vorname": VORNAME, "nachname": NACHNAME} for rolle in ("ansprechperson", "trainer")
        ]
        assert answer["registrierungen"] == [{"saison_id": SAISON_ID, "team_name": "Heim-Schule", "vorname": VORNAME, "nachname": NACHNAME}] * 2
        assert (answer["adresswechsel"], answer["verwaltung"], answer["letzter_inhaber"]) == (2, "administration", False)
        assert "@" not in response.text and GEBURTSDATUM not in response.text

    def test_it_counts_no_change_whose_link_has_not_reached_this_mailbox(self, mongo_replica_set_url: str):
        """An administrator's request still awaiting the address on file has told the new mailbox nothing, and its preview neither."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            asked_first = documents.adresswechsel_document(
                adresse="noch.gefragt@example.com", email=IDENTIFIER, token_hash=None, day="2026-03-30", weg="freigabe"
            )
            await database[Collection.ADRESSWECHSEL].insert_one(asked_first)
            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                preview = (await http.get(f"{PATH}/ansicht", headers=as_person(TYPED))).json()["adresswechsel"]

            return preview, (await erased_by_the_handler(database, client)).adresswechsel

        # The seed's two changes alone; the press still ends all three, nothing of the asked one being this address's.
        assert on_a_league(mongo_replica_set_url, body) == (2, 3)

    def test_a_dead_spelling_of_the_address_goes_unnamed_and_goes(self, mongo_replica_set_url: str):
        """A grant typed in capitals admits nobody, so the preview names no tier for it; the press removes it all the same."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, TYPED, "administration")
            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                verwaltung = (await http.get(f"{PATH}/ansicht", headers=as_person(TYPED))).json()["verwaltung"]

            return verwaltung, (await erased_by_the_handler(database, client)).berechtigungen

        assert on_a_league(mongo_replica_set_url, body) == (None, 1)

    @pytest.mark.parametrize(
        ("second_owner", "barred", "letzter_inhaber"),
        [(False, False, True), (True, False, False), (True, True, True)],
        ids=["the only owner", "beside a second owner", "beside a barred second owner"],
    )
    def test_it_foretells_the_last_owners_refusal_as_the_press_judges_it(
        self, mongo_replica_set_url: str, second_owner: bool, barred: bool, letzter_inhaber: bool
    ):
        """A barred owner admits nobody, so beside one the address is still the last: `letzter_inhaber` reads true.

        The press runs on the same seed, so a preview judging apart from it fails here.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "owner")
            if second_owner:
                await a_grant(database, OTHER_OWNER_OID, OTHER_OWNER, "owner")
            if barred:
                await database[Collection.SPERRLISTE].insert_one(
                    ban_document(OTHER_OWNER, bis=compose_gesperrt_bis_saison_id(massgebliche_saison_id=SAISON_ID))
                )
            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                preview = await http.get(f"{PATH}/ansicht", headers=as_person(TYPED))

            return preview.status_code, preview.json()["letzter_inhaber"], await outcome_of(erased_by_the_handler(database, client))

        status, foretold, pressed = on_a_league(mongo_replica_set_url, body)

        assert (status, foretold) == (200, letzter_inhaber)
        assert pressed == (LETZTER_INHABER_ERASURE if letzter_inhaber else COMMITTED)
