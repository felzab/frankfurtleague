"""
API · a person's erasure through the registry, held against the whole database rather than against the steps

One address holds a pupil row in a live squad, a seat on a season row and on an application beside
two bystanders, a referee row booked on a played fixture and asked to confirm it, a pending and a declined registration,
another referee's and another pupil's pending address change, a pupil row corrected away from the
address, a day's counts, records they made as an administrator, though they hold no grant, and as a
seat holder. Another mailbox at their local part holds records beside them. Every case asks what is left, so a step removed from the registry
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
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.address_change.crud import end_an_emptied_change_in_session
from app.api.ban_list.services import compose_barred_until_saison_id
from app.api.identity.crud import EACH_PERSON_GROUP, ERASURE_STEPS, erase_everything
from app.api.invitations.services import compose_invitation
from app.api.registrierungen.person_router import admit
from app.api.registrierungen.schemas import FLRegistrierungAdmitPayload
from app.api.registrierungen.services import compose_ablehnung_update
from app.api.spieler.crud import erase_person_in_session
from app.api.spieler.services import build_ghost_spieler
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.db import NO_OWNER
from app.core.exceptions import DocumentNotFoundError
from app.core.logging import JSONFormatter
from app.core.security import PASSKEY_FACTOR
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID, GHOST_SPIELER_ID
from app.core.transactions import transaction_session
from app.main import create_app
from app.shared.tokens import hash_token
from tests import documents
from tests.app_client import app_client
from tests.config import ADMIN_KEY
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, on_the_seed_loop
from tests.documents import (
    SPIELER_TEXT_VERSIONS,
    ban_document,
    bericht_document,
    bewerbung_document,
    kontakte_document,
    kontaktperson_document,
    new_schule_document,
    own_einwilligung_document,
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
from tests.isolation import InterleavedCollection, outcome_of
from tests.records import record_collections
from tests.session_headers import StampedHeaders, actor_headers
from tests.whole_database import where_folded_to, where_held, where_referenced
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_funktionen_loeschung_test")

CONFIG = config_for(DATABASE_NAME)

PATH = f"/api/v{API_VERSION}/identity/account/erasure"

# A century ahead of the real clock: the TTL monitor deletes an expired tombstone, request or day's count at its next
# pass, under a case reading it back. Every seeded day moves with it.
SAISON_ID = "2026"
TODAY = "2126-04-01"
YESTERDAY = "2126-03-31"
# Injected through `get_germany_now`, and in summer, so the conversion to the log's stamp moves the clock.
NOW = datetime(2126, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# The person as a request or a pasted grant may spell them, and the fold every record the league writes stores.
TYPED = "Zorbanax.Quillfeather@Example.org"
IDENTIFIER = "zorbanax.quillfeather@example.org"
# As a hand-typed row may spell it, in capitals: the fold equates it with theirs, an equality on the stored spelling never.
PASTED = IDENTIFIER.upper()
FIRST_NAME, LAST_NAME = "Zorbanax", "Quillfeather"
PHONE = "+49 69 7771234"
BIRTH_DATE = "2008-07-14"
# The one their referee row holds, which they typed otherwise.
REFEREE_BIRTH_DATE = "1990-02-03"

# The submission digests of two applications the person holds a seat on, the second predating the confirmation block.
THEIR_DIGEST = "digest-7f3a1c-mit-block"
THEIR_BLOCKLESS_DIGEST = "digest-7f3a1c-ohne-block"
# Why they declined to officiate, in their own words.
THEIR_REASON = "Knieverletzung beim Hallenturnier"

# Distinctive, so a hit in a whole-database scan is never coincidence: every value the person holds.
THEIR_VALUES = (
    FIRST_NAME,
    LAST_NAME,
    IDENTIFIER,
    PASTED,
    "7771234",
    BIRTH_DATE,
    REFEREE_BIRTH_DATE,
    THEIR_DIGEST,
    THEIR_BLOCKLESS_DIGEST,
    THEIR_REASON,
)

# The people beside them, each asserted still present: a step taking anybody else's record with theirs fails.
BYSTANDER_VALUES = ("Quillhilde", "Bramblewick", "Wraxlington", "kraus.bernd@example.com")

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
# Their referee row's confirmation, and another referee's.
THEIR_CONFIRMATION_OID = ObjectId("6890a1b2c3d4e5f607b000a1")
OTHER_CONFIRMATION_OID = ObjectId("6890a1b2c3d4e5f607b000a3")
# Their team's open row, its link on the seat they hold, which the seat member voids.
TEAM_CONFIRMATION_OID = ObjectId("6890a1b2c3d4e5f607b000a4")
OTHER_REASON = "Dienstreise nach Hamburg"
# Every record of their own the erasure removes, each id looked for in the whole database afterwards: a reference left
# naming one names nobody.
THEIR_RECORDS = (PUPIL_OID, THEIR_SQUAD_ROW_OID, REFEREE_OID, PENDING_OID, DECLINED_OID, THEIR_CONFIRMATION_OID)

REFEREE_NAME = f"{FIRST_NAME} {LAST_NAME}"
PAYMENT = 25

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


@functools.cache
def _app() -> FastAPI:
    return create_app(CONFIG)


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Never inside a case: a build re-runs the logging `dictConfig`, which strips the handler `caplog` reads that case's records from."""

    _app()


def their_seat() -> dict[str, Any]:
    return kontaktperson_document(FIRST_NAME, confirmed_at="2126-03-21", last_name=LAST_NAME, email=IDENTIFIER, phone=PHONE)


def referee(schiedsrichter_id: ObjectId, *, email: str, name: str, **fields: Any) -> dict[str, Any]:
    return schiedsrichter_document(
        schiedsrichter_id,
        email=email,
        name=name,
        default_payment=PAYMENT,
        einwilligung=own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at="2126-03-01"),
        **fields,
    )


def a_registration(registrierung_id: ObjectId, email: str, **fields: Any) -> dict[str, Any]:
    return registrierung_document(
        registrierung_id,
        email,
        saison_id=SAISON_ID,
        team_id=HOME_TEAM_OID,
        first_name=FIRST_NAME,
        last_name=LAST_NAME,
        token=f"token-{registrierung_id}",
        submitted_at="2126-03-25",
        deadline="2126-04-08",
        **fields,
    )


# The reports a referee sent, theirs and another referee's.
THEIR_REPORT_OID = ObjectId("6890a1b2c3d4e5f607b000b1")
OTHER_REPORT_OID = ObjectId("6890a1b2c3d4e5f607b000b2")
OWED_CARRY_OID = ObjectId("6890a1b2c3d4e5f607b000d1")
THEIR_REMARKS = "Flutlicht fiel in der 70. Minute aus."


def a_report(report_id: ObjectId, schiedsrichter_id: ObjectId, *, spiel_id: ObjectId) -> dict[str, Any]:
    return spielbericht_document(
        {"_id": spiel_id, "saison_id": SAISON_ID},
        _id=report_id,
        bericht=bericht_document(submitted_by={"kind": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id}, remarks=THEIR_REMARKS),
    )


async def their_reports(database: AsyncDatabase) -> None:
    await database[Collection.SPIELBERICHTE].insert_many(
        [
            a_report(THEIR_REPORT_OID, REFEREE_OID, spiel_id=THEIR_SPIEL_OID),
            a_report(OTHER_REPORT_OID, OTHER_REFEREE_OID, spiel_id=OTHER_SPIEL_OID),
        ]
    )


async def the_one(database: AsyncDatabase, collection: Collection, db_filter: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
    """The one row a case reads, refused where none stands rather than read as a null."""

    found = await database[collection].find_one(db_filter or {})
    assert found is not None, f"{collection} holds no row matching {db_filter}"
    return found


def a_confirmation(row_id: ObjectId, party: dict[str, Any], *, spiel_id: ObjectId) -> dict[str, Any]:
    """An open, unanswered row, as the sweep mints one; a referee's holds no seats."""

    spiel = spiel_document(
        spiel_id=spiel_id,
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=SPIELTAG_OID,
        date="2126-03-15",
        time="14:00:00",
        team1={"team_id": HOME_TEAM_OID},
        team2={"team_id": OTHER_TEAM_OID},
    )

    return spielbestaetigung_document(spiel, party=party, _id=row_id, deadline="2126-03-08", asked_at="2126-03-01", kontakte=None)


def a_referee(schiedsrichter_id: ObjectId) -> dict[str, Any]:
    return {"kind": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id}


def declined(reason: str) -> dict[str, Any]:
    return {"kind": "declined", "at": "2126-03-03", "by": {"kind": "schiedsrichter"}, "vorschlag": None, "reason": reason}


async def their_confirmations(database: AsyncDatabase) -> None:
    """Their answered row, another referee's, and their team's row linking their seat."""

    await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
        [
            {
                **a_confirmation(THEIR_CONFIRMATION_OID, a_referee(REFEREE_OID), spiel_id=THEIR_SPIEL_OID),
                "answer": declined(THEIR_REASON),
                "closed": {"at": "2126-03-04", "reason": "schiedsrichter_switched"},
            },
            {
                **a_confirmation(OTHER_CONFIRMATION_OID, a_referee(OTHER_REFEREE_OID), spiel_id=OTHER_SPIEL_OID),
                "answer": declined(OTHER_REASON),
            },
            {
                **a_confirmation(TEAM_CONFIRMATION_OID, {"kind": "team", "team_id": HOME_TEAM_OID}, spiel_id=THEIR_SPIEL_OID),
                "kontakte": {"trainer": None, "ansprechperson": {"token_hashes": [hash_token("their-seats-link")]}, "stellvertretung": None},
            },
        ]
    )


async def a_person_holding_everything(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
    await database[Collection.TEAMS].insert_many(
        [team_document(HOME_TEAM_OID, "Heim-Schule", "HSX"), team_document(OTHER_TEAM_OID, "Gast-Schule", "GSX")]
    )
    await database[Collection.SAISON_TEAMS].insert_one(
        saison_team_document(
            SAISON_ID,
            HOME_TEAM_OID,
            "Heim-Schule",
            "HSX",
            kontakte=kontakte_document(
                ansprechperson=their_seat(),
                stellvertretung=kontaktperson_document("Quillhilde", confirmed_at="2126-03-21"),
                trainer=kontaktperson_document("Bramblewick", confirmed_at="2126-03-21"),
            ),
        )
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            BEWERBUNG_OID,
            SAISON_ID,
            "submitted",
            kontakte=kontakte_document(
                trainer=their_seat(),
                ansprechperson=kontaktperson_document("Quillhilde"),
                stellvertretung=kontaktperson_document("Bramblewick"),
            ),
            submitted_at="2126-03-10",
            confirmation_deadline="2126-04-10",
            schule=new_schule_document("Neue"),
            idempotency_fingerprint=THEIR_DIGEST,
        )
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            BLOCKLESS_BEWERBUNG_OID,
            SAISON_ID,
            "submitted",
            kontakte=kontakte_document(ansprechperson=their_seat()),
            submitted_at="2126-02-10",
            schule=new_schule_document("Alte"),
            idempotency_fingerprint=THEIR_BLOCKLESS_DIGEST,
        )
    )
    einwilligung = own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at="2126-03-02")
    await database[Collection.SPIELER].insert_many(
        [
            spieler_document(READDRESSED_PUPIL_OID, "Hartwig", "Hartwig-Muster", email="hartwig@example.com", einwilligung=einwilligung),
            spieler_document(PUPIL_OID, FIRST_NAME, LAST_NAME, email=IDENTIFIER, birth_date=BIRTH_DATE, einwilligung=einwilligung),
            spieler_document(OTHER_PUPIL_OID, "Wraxlington", "Wraxlington-Muster", email="wraxlington@example.com", einwilligung=einwilligung),
        ]
    )
    await database[Collection.SAISON_SPIELER].insert_many(
        [
            saison_spieler_document(PUPIL_OID, SAISON_ID, HOME_TEAM_OID, _id=THEIR_SQUAD_ROW_OID, nummer="7"),
            saison_spieler_document(OTHER_PUPIL_OID, SAISON_ID, HOME_TEAM_OID, nummer="8"),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            referee(
                REFEREE_OID,
                email=IDENTIFIER,
                name=REFEREE_NAME,
                birth_date=REFEREE_BIRTH_DATE,
                kontakt={"phone": PHONE, "email": IDENTIFIER},
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
                date="2126-03-15",
                time="14:00:00",
                # As a fixture stores its referee, naming nobody: the name is joined from the referee's row.
                schiedsrichter={"schiedsrichter_id": referee_id, "payment": PAYMENT},
                ergebnis="2:1",
            )
            for spiel_nr, (spiel_id, referee_id) in enumerate(((THEIR_SPIEL_OID, REFEREE_OID), (OTHER_SPIEL_OID, OTHER_REFEREE_OID)), start=1)
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [
            a_registration(PENDING_OID, IDENTIFIER),
            a_registration(
                DECLINED_OID,
                IDENTIFIER,
                **compose_ablehnung_update(by="quillhilde@example.com", reason=None, today="2126-03-28")["$set"],
            ),
        ]
    )
    await records_they_made_holding_no_grant(database)
    await database[Collection.SPIELER].insert_one(
        spieler_document(MOVING_PUPIL_OID, "Gwendolyn", "Gwendolyn-Muster", email="gwendolyn@example.com", einwilligung=einwilligung)
    )
    await pending_changes(
        database,
        (OTHER_REFEREE_CHANGE_OID, "kraus.bernd@example.com", IDENTIFIER, "their-new-address", "2126-03-28"),
        (MOVING_PUPIL_CHANGE_OID, "gwendolyn@example.com", IDENTIFIER, "her-new-address", "2126-03-29"),
    )
    # An account's carry still owed to them by an earlier change of theirs, ended, its record keeping the two addresses.
    await database[Collection.ADDRESS_CHANGES].insert_one(
        {
            "_id": OWED_CARRY_OID,
            **documents.address_change_document(address="vorher.zorbanax@example.org", email=IDENTIFIER, token_hash=None, day="2126-03-01"),
            "address": None,
            "email": None,
            "ended": {"kind": "effective", "at": NOW},
            "move": {"old": "vorher.zorbanax@example.org", "new": IDENTIFIER},
        }
    )

    await database[Collection.OUTBOX].insert_one(a_mail("spiel_request", to=IDENTIFIER))
    await their_confirmations(database)
    await their_reports(database)
    await a_mailbox_sharing_their_local_part(database)


def a_mail(kind: str, *, to: str) -> dict[str, Any]:
    """A settled row of the Postausgang, as a hand-out's report leaves it."""

    return {
        "key": f"{kind}/{ObjectId()}",
        "kind": kind,
        "to": to,
        "secret": None,
        "reference": None,
        "link": None,
        "state": "sent",
        "recorded_at": NOW,
        "deadline": NOW,
        # Far off, so the TTL monitor reads nothing a case is about.
        "erase_at": datetime(2199, 1, 1, tzinfo=UTC),
        "lease": None,
        "leased_until": None,
        "attempts": 1,
        "message_id": None,
        "delivery": None,
    }


async def pending_changes(database: AsyncDatabase, *changes: tuple[ObjectId, str, str, str, str]) -> None:
    """Each `(id, address on file, new address, link, day)` as a start inserts it."""

    await database[Collection.ADDRESS_CHANGES].insert_many(
        [
            {"_id": change_id, **documents.address_change_document(address=address, email=email, token_hash=hash_token(link), day=day)}
            for change_id, address, email, link, day in changes
        ]
    )


async def a_mailbox_sharing_their_local_part(database: AsyncDatabase) -> None:
    await database[Collection.REGISTRIERUNGEN].insert_one(
        registrierung_document(
            ELSEWHERE_REGISTRATION_OID,
            ELSEWHERE,
            saison_id=SAISON_ID,
            team_id=HOME_TEAM_OID,
            first_name="Quendolin",
            last_name="Anderswo",
            token="token-anderswo",
            submitted_at="2126-03-25",
            deadline="2126-04-08",
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
            einwilligung=own_einwilligung_document(text_versions=SPIELER_TEXT_VERSIONS, confirmed_at="2126-03-02"),
        )
    )
    await pending_changes(
        database,
        (REFEREE_MOVING_ELSEWHERE_CHANGE_OID, "umzug.dritter@example.com", ELSEWHERE, "to-anderswo", "2126-03-28"),
        (PUPIL_MOVING_ELSEWHERE_CHANGE_OID, "ulla@example.com", ELSEWHERE, "ulla-to-anderswo", "2126-03-29"),
    )
    await a_grant(database, ELSEWHERE_GRANT_OID, ELSEWHERE, "administration")
    await database[Collection.SAISON_TEAMS].insert_one(
        saison_team_document(
            SAISON_ID,
            OTHER_TEAM_OID,
            "Gast-Schule",
            "GSX",
            _id=ELSEWHERE_SEAT_ROW_OID,
            kontakte=kontakte_document(
                ansprechperson=kontaktperson_document("Quendolin", confirmed_at="2126-03-21", last_name="Anderswo", email=ELSEWHERE)
            ),
        )
    )


async def what_elsewhere_holds(database: AsyncDatabase) -> dict[str, int]:
    """Each record counted where it still names `ELSEWHERE`, beside the notices about its grant: one taken as the person's queues one."""

    changes = database[Collection.ADDRESS_CHANGES]

    return {
        "registration": await database[Collection.REGISTRIERUNGEN].count_documents({"_id": ELSEWHERE_REGISTRATION_OID, "email": ELSEWHERE}),
        "referee": await database[Collection.SCHIEDSRICHTER].count_documents({"_id": ELSEWHERE_REFEREE_OID, "kontakt.email": ELSEWHERE}),
        "seat": await database[Collection.SAISON_TEAMS].count_documents(
            {
                "_id": ELSEWHERE_SEAT_ROW_OID,
                "kontakte.ansprechperson.email": ELSEWHERE,
                "kontakte.ansprechperson.einwilligung.confirmed_at": {"$ne": None},
            }
        ),
        "grant": await database[Collection.GRANTS].count_documents({"_id": ELSEWHERE_GRANT_OID, "address": ELSEWHERE}),
        "notices": await database[Collection.OUTBOX].count_documents({"key": {"$regex": f"^grant/{ELSEWHERE_GRANT_OID}/"}}),
        "referee_change": await changes.count_documents({"_id": REFEREE_MOVING_ELSEWHERE_CHANGE_OID, "email": ELSEWHERE}),
        "pupil_change": await changes.count_documents({"_id": PUPIL_MOVING_ELSEWHERE_CHANGE_OID, "email": ELSEWHERE}),
    }


ELSEWHERE_HOLDS = {
    "registration": 1,
    "referee": 1,
    "seat": 1,
    "grant": 1,
    "notices": 0,
    "referee_change": 1,
    "pupil_change": 1,
}


GRANTED = datetime(2126, 1, 1, tzinfo=UTC)


async def records_they_made_holding_no_grant(database: AsyncDatabase) -> None:
    """A grant, two bans, an invitation and two decisions in their name, each typed as stored, while the address holds no grant.

    The grants step marks each: it runs in the full scope whatever the address holds.
    """

    await database[Collection.GRANTS].insert_one(
        {
            "_id": GRANTED_BY_THEM_OID,
            "address": "bramblewick.admin@example.com",
            "admin_tier": "administration",
            "granted_by": IDENTIFIER,
            "effective_from": GRANTED,
        }
    )
    await database[Collection.BAN_LIST].insert_many(
        [
            ban_document(address, until=compose_barred_until_saison_id(running_saison_id=SAISON_ID), _id=ban_id, created_by=by)
            for address, ban_id, by in (
                ("gebannt@beispiel.de", BANNED_BY_THEM_OID, IDENTIFIER),
                ("gebannt-zwei@beispiel.de", BANNED_BY_THEM_PASTED_OID, PASTED),
            )
        ]
    )
    await database[Collection.INVITATIONS].insert_one(
        {
            "_id": INVITED_BY_THEM_OID,
            **compose_invitation(
                saison_id=SAISON_ID,
                team_id=HOME_TEAM_OID,
                token_hashes=["hash-of-their-invite"],
                created_by=IDENTIFIER,
                today=TODAY,
                sent_at=None,
            ),
        }
    )
    await database[Collection.BEWERBUNGEN].insert_one(
        bewerbung_document(
            DECIDED_BY_THEM_OID,
            SAISON_ID,
            "declined",
            kontakte=kontakte_document(),
            submitted_at="2126-03-01",
            schule=new_schule_document("Abgelehnt"),
            decision={"made_at": "2126-03-10", "by": IDENTIFIER, "reason": "Keine Halle"},
        )
    )
    declined = registrierung_document(
        DECLINED_BY_THEM_OID,
        "rita@beispiel.de",
        saison_id=SAISON_ID,
        team_id=HOME_TEAM_OID,
        first_name="Rita",
        last_name="Registriert",
        token="token-rita",
        submitted_at="2126-03-20",
        deadline="2126-03-27",
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        {**declined, **compose_ablehnung_update(by=IDENTIFIER, reason=None, today="2126-03-22")["$set"]}
    )


async def a_grant(database: AsyncDatabase, grant_id: ObjectId, address: str, admin_tier: str) -> None:
    """A grant by a paste, for the cases about a grant the address holds."""

    await database[Collection.GRANTS].insert_one(
        {"_id": grant_id, "address": address, "admin_tier": admin_tier, "granted_by": "PLAYGROUND", "effective_from": GRANTED}
    )


async def everything_in(database: AsyncDatabase) -> dict[str, list[Any]]:
    """Every document of every collection, in a fixed order, so two reads compare equal only where nothing was written."""

    return {name: await database[name].find().sort("_id", 1).to_list(length=None) for name in sorted(await database.list_collection_names())}


def on_a_league(url: str, body: Body, *, mutates_schema: bool = False) -> Any:
    """The shipped indexes, and the person seeded with their whole history.

    `mutates_schema=True` where the body installs a validator (`tests/database.py :: a_clean_database`).
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            await a_person_holding_everything(database)

            return await body(database, client)

    return on_the_seed_loop(_run())


def journal_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [record for record in caplog.records if record.getMessage() == "journal.act"]


def as_person(email: str) -> StampedHeaders:
    return StampedHeaders(email, ADMIN_KEY, lane="person")


def by_passkey(email: str) -> dict[str, str]:
    """A person who confirmed with their passkey a second before the request, as the page's prompt leaves them."""

    return {**ADMIN_KEY, **actor_headers(email, signed_in_before_s=1, factor=PASSKEY_FACTOR)}


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
            changed_by=IDENTIFIER,
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
        """Catches a step removed from the registry, or a store none reaches.

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
            before = await scanned(database, *THEIR_VALUES)
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


class TestWhatStandsBesideThem:
    """What the erasure must NOT take: each a row or a value somebody else holds."""

    def test_the_bystanders_seats_stand_and_theirs_is_empty(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            row = await database[Collection.SAISON_TEAMS].find_one()
            bewerbung = await database[Collection.BEWERBUNGEN].find_one({"_id": BEWERBUNG_OID})
            return row, bewerbung

        row, bewerbung = on_a_league(mongo_replica_set_url, body)

        assert row["kontakte"]["ansprechperson"] is None
        assert (row["kontakte"]["stellvertretung"]["first_name"], row["kontakte"]["trainer"]["first_name"]) == ("Quillhilde", "Bramblewick")
        assert (bewerbung["kontakte"]["trainer"], bewerbung["confirmations"]["trainer"]) == (None, None)
        assert bewerbung["confirmations"]["ansprechperson"] is not None
        assert "idempotency_fingerprint" not in bewerbung

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

            return await the_one(database, Collection.ADDRESS_CHANGES, {"_id": change_id}), await the_one(database, collection, {"_id": row_id})

        change, row = on_a_league(mongo_replica_set_url, body)

        assert (change["ended"]["kind"], change["email"]) == ("discarded", None)
        held: Any = row
        for key in path.split("."):
            held = held[key]
        assert held == stored

    def test_their_spiel_names_the_ghost_and_no_name_and_keeps_its_fee(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return {row["_id"]: row["schiedsrichter"] async for row in database[Collection.SPIELE].find()}

        bookings = on_a_league(mongo_replica_set_url, body)

        assert bookings[THEIR_SPIEL_OID] == {"schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "payment": PAYMENT}
        assert bookings[OTHER_SPIEL_OID]["schiedsrichter_id"] == OTHER_REFEREE_OID

    def test_their_confirmations_go_and_another_referees_stands(self, mongo_replica_set_url: str):
        """Catches a member keyed on the party's kind alone, taking another referee's row and reason with theirs."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return [row["_id"] for row in await database[Collection.SPIELBESTAETIGUNGEN].find().sort("_id", 1).to_list(length=None)]

        assert on_a_league(mongo_replica_set_url, body) == [OTHER_CONFIRMATION_OID, TEAM_CONFIRMATION_OID]

    def test_their_reports_stand_naming_the_ghost(self, mongo_replica_set_url: str):
        """The report is the league's record of the match: it stays, its remarks with it, and another referee's report is theirs."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return [
                (row["_id"], row["bericht"]["submitted_by"]["schiedsrichter_id"], row["bericht"]["remarks"])
                for row in await database[Collection.SPIELBERICHTE].find().sort("_id").to_list(length=None)
            ]

        assert on_a_league(mongo_replica_set_url, body) == [
            (THEIR_REPORT_OID, GHOST_SCHIEDSRICHTER_ID, THEIR_REMARKS),
            (OTHER_REPORT_OID, OTHER_REFEREE_OID, THEIR_REMARKS),
        ]

    def test_a_mailbox_sharing_their_local_part_keeps_every_record(self, mongo_replica_set_url: str):
        """Read before as well, so a seed that stopped writing a record fails rather than agreeing with the erasure on a zero."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await what_elsewhere_holds(database)
            await erased_over_http(mongo_replica_set_url)

            return before, await what_elsewhere_holds(database)

        assert on_a_league(mongo_replica_set_url, body) == (ELSEWHERE_HOLDS, ELSEWHERE_HOLDS)


class TestTheSentinels:
    def test_the_first_loeschung_writes_a_sentinel_naming_nobody_and_recording_no_consent(self, mongo_replica_set_url: str):
        """A name here is published on every erased pupil's surviving entry; a record here is counted as a consent."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return await database[Collection.SPIELER].find_one({"_id": GHOST_SPIELER_ID})

        sentinel = on_a_league(mongo_replica_set_url, body)

        assert sentinel is not None
        assert (sentinel["first_name"], sentinel["last_name"], sentinel["einwilligung"]) == (None, None, None)


class TestTheSentinelIsNobodyToLoeschen:
    def test_the_pupil_step_handed_the_sentinel_removes_nothing(self, mongo_replica_set_url: str):
        """Catches the step keying its removals on the bare id: the sentinel would go, and every reference repointed at it dangle."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(build_ghost_spieler())

            async def erase(session: Any) -> Any:
                return await erase_person_in_session(
                    spieler_collection=database[Collection.SPIELER],
                    saison_spieler_collection=database[Collection.SAISON_SPIELER],
                    spielberichte_collection=database[Collection.SPIELBERICHTE],
                    spieler_id=GHOST_SPIELER_ID,
                    session=session,
                )

            with pytest.raises(DocumentNotFoundError):
                async with transaction_session(client) as session:
                    await session.with_transaction(erase)

            return await database[Collection.SPIELER].count_documents({"_id": GHOST_SPIELER_ID})

        assert on_a_league_of_its_own(mongo_replica_set_url, body) == 1


class TestOneTransaction:
    """A failure at a late write takes every step back: an erasure half done reports one that did not happen."""

    def test_a_refused_last_write_leaves_everything_as_it_stood(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A validator installed here refuses the deletion's own row, written after every removing step."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database.command(
                "collMod",
                Collection.ACTION_LOG.value,
                validator={"$jsonSchema": {"bsonType": "object", "properties": {"action": {"not": {"enum": ["erasure.own"]}}}}},
                validationLevel="strict",
            )

            with pytest.raises(OperationFailure) as failure:
                await erased_by_the_handler(database, client)

            return (
                failure.value.code,
                {
                    str(collection): await database[collection].count_documents({})
                    for collection in (
                        Collection.GRANTS,
                        Collection.SPIELER,
                        Collection.SAISON_SPIELER,
                        Collection.SCHIEDSRICHTER,
                        Collection.REGISTRIERUNGEN,
                    )
                },
                (
                    (await the_one(database, Collection.SAISON_TEAMS))["kontakte"]["ansprechperson"]["email"],
                    (await the_one(database, Collection.ADDRESS_CHANGES, {"_id": OTHER_REFEREE_CHANGE_OID}))["email"],
                    await database[Collection.SPIELE].count_documents({"schiedsrichter.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID}),
                ),
            )

        with caplog.at_level(logging.INFO):
            code, counts, (seat, pending, on_the_ghost) = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        # On the code, so this cannot pass because something else failed before any write.
        assert code == DOCUMENT_VALIDATION_FAILED
        assert counts == {"grants": 2, "spieler": 5, "saison_spieler": 2, "schiedsrichter": 4, "registrierungen": 4}
        assert (seat, pending, on_the_ghost) == (IDENTIFIER, IDENTIFIER, 0)
        # And no line nor warning: an erasure rolled back is no erasure a restore's step may repeat.
        assert not journal_records(caplog)
        assert NO_OWNER not in [record.getMessage() for record in caplog.records]


class TestTheGrantsLeftBehind:
    def test_an_loeschung_taking_a_grant_names_what_is_left_once_it_commits(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The floor of two holds against no erasure, so the boot's own warning names what is left: here a list holding no owner."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")

            return (await erased_over_http(mongo_replica_set_url, headers=by_passkey(TYPED))).json()["grants"]

        with caplog.at_level(logging.WARNING):
            removed = on_a_league(mongo_replica_set_url, body)

        assert removed == 1
        assert [record.getMessage() for record in caplog.records].count(NO_OWNER) == 1


class TestTheMail:
    def test_a_deletion_notice_stands_where_every_other_mail_to_the_address_goes(self, mongo_replica_set_url: str):
        """Catches the notice erased with the rest: the person would never hear of a deletion the league owes them word of."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.OUTBOX].insert_one(a_mail("deletion_notice", to=IDENTIFIER))
            await erased_over_http(mongo_replica_set_url)

            return [row["kind"] async for row in database[Collection.OUTBOX].find({"to": IDENTIFIER})]

        assert on_a_league(mongo_replica_set_url, body) == ["deletion_notice"]


class TestTheJournal:
    def test_one_line_per_loeschung_names_its_records_by_id_and_no_address(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catches the line built from the wrong rows, or holding what it outlives: it stays in the stream after the person has gone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            team_row = await the_one(database, Collection.SAISON_TEAMS, {"team_id": HOME_TEAM_OID})

            return (await erased_over_http(mongo_replica_set_url, headers=by_passkey(TYPED))).status_code, team_row["_id"]

        with caplog.at_level(logging.INFO):
            status, team_row_id = on_a_league(mongo_replica_set_url, body)

        [record] = journal_records(caplog)
        line = vars(record)
        records = {
            f"{Collection.SAISON_TEAMS}/{team_row_id}",
            f"{Collection.BEWERBUNGEN}/{BEWERBUNG_OID}",
            f"{Collection.BEWERBUNGEN}/{BLOCKLESS_BEWERBUNG_OID}",
            f"{Collection.SCHIEDSRICHTER}/{REFEREE_OID}",
            f"{Collection.SPIELER}/{PUPIL_OID}",
            f"{Collection.REGISTRIERUNGEN}/{PENDING_OID}",
            f"{Collection.REGISTRIERUNGEN}/{DECLINED_OID}",
            f"{Collection.ADDRESS_CHANGES}/{OTHER_REFEREE_CHANGE_OID}",
            f"{Collection.ADDRESS_CHANGES}/{MOVING_PUPIL_CHANGE_OID}",
            f"{Collection.GRANTS}/{THEIR_GRANT_OID}",
        }

        assert status == 200
        assert (line["act"], set(line["records"]), line["choices"], line["seats"]) == ("erasure", records, [], [])
        assert len(line["records"]) == len(records)
        assert not [value for value in THEIR_VALUES if value.lower() in JSONFormatter().format(record).lower()]


class TestTheOwner:
    """`owner_erasure`: nobody but the owner names an owner, so the owner leaves by a handover alone."""

    def test_the_owner_is_refused_and_nothing_is_written(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "owner")
            before = await everything_in(database)
            outcome = await outcome_of(erased_by_the_handler(database, client))

            return outcome, before == await everything_in(database)

        with caplog.at_level(logging.INFO):
            outcome, untouched = on_a_league(mongo_replica_set_url, body)

        assert (outcome, untouched) == (Code.OWNER_ERASURE, True)
        assert not journal_records(caplog)


class TestTheScope:
    """The season-after rule's deletion takes a pupil's data alone, every other kind at the address standing."""

    def test_the_pupil_scope_takes_what_the_address_holds_as_a_pupil_and_nothing_else(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            await erased_in_scope(database, client, frozenset({"spieler"}))

            return (
                await database[Collection.SPIELER].count_documents({"_id": PUPIL_OID}),
                await database[Collection.REGISTRIERUNGEN].count_documents({"_id": {"$in": [PENDING_OID, DECLINED_OID]}}),
                (await the_one(database, Collection.SAISON_TEAMS))["kontakte"]["ansprechperson"]["email"],
                await database[Collection.SCHIEDSRICHTER].count_documents({"_id": REFEREE_OID}),
                (await the_one(database, Collection.ADDRESS_CHANGES, {"_id": OTHER_REFEREE_CHANGE_OID}))["ended"] is None,
                await database[Collection.GRANTS].count_documents({"address": IDENTIFIER}),
                (await the_one(database, Collection.ADDRESS_CHANGES, {"_id": MOVING_PUPIL_CHANGE_OID}))["ended"] is None,
            )

        assert on_a_league(mongo_replica_set_url, body) == (0, 0, IDENTIFIER, 1, True, 1, True)


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


# The driver's own writes, which every write helper of `app/core/crud.py` ends in, so no write a step makes passes unseen.
DRIVER_WRITES = frozenset(
    {
        "bulk_write",
        "delete_many",
        "delete_one",
        "find_one_and_delete",
        "find_one_and_replace",
        "find_one_and_update",
        "insert_many",
        "insert_one",
        "replace_one",
        "update_many",
        "update_one",
    }
)


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
        """`reaches` is what each step declares; here it is held to the writes themselves.

        The seed and a grant of the person's own give every step something to write in each collection it declares.
        """

        writes: dict[str, set[str]] = {}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_grant(database, THEIR_GRANT_OID, IDENTIFIER, "administration")
            recorded: dict[str, Any] = {name: WritesRecorded(handle, writes) for name, handle in erasure_collections(database).items()}
            await erased_in_scope(database, client, EACH_PERSON_GROUP, **recorded)

        on_a_league(mongo_replica_set_url, body)

        # The whole erasure ends every change naming the address first, leaving the emptied change's step nothing: its own case.
        assert writes == {step.run.__name__: {str(collection) for collection in step.reaches} for step in ERASURE_STEPS if step != EMPTIED}

    def test_a_pupils_loeschung_ends_the_change_of_an_address_it_empties_writing_what_that_step_declares(self, mongo_replica_set_url: str):
        """Gwendolyn holds a pupil row alone, so the season's erasure of it leaves her change nothing to move."""

        writes: dict[str, set[str]] = {}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            recorded: dict[str, Any] = {name: WritesRecorded(handle, writes) for name, handle in erasure_collections(database).items()}
            await erased_in_scope(database, client, frozenset({"spieler"}), identifier="gwendolyn@example.com", **recorded)

            return await the_one(database, Collection.ADDRESS_CHANGES, {"_id": MOVING_PUPIL_CHANGE_OID})

        change = on_a_league(mongo_replica_set_url, body)

        assert writes[EMPTIED.run.__name__] == {str(collection) for collection in EMPTIED.reaches}
        # Its address on file goes too: no erasure of the address follows a pupil's to take it.
        assert (change["ended"]["kind"], change["address"], change["email"]) == ("discarded", None, None)

    def test_a_pupils_loeschung_leaves_the_change_of_an_address_still_holding_records(self, mongo_replica_set_url: str):
        """The person is a referee and a seat holder beside the pupil, so their change still has those to move."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await pending_changes(database, (THEIR_CHANGE_OID, IDENTIFIER, "neu.adresse@anderswo.org", "their-own-change", "2126-03-30"))
            await erased_in_scope(database, client, frozenset({"spieler"}))

            return await the_one(database, Collection.ADDRESS_CHANGES, {"_id": THEIR_CHANGE_OID})

        change = on_a_league(mongo_replica_set_url, body)

        assert (change["ended"], change["address"]) == (None, IDENTIFIER)


class RegistrationsAdmittedInside(InterleavedCollection):
    """`registrierungen` as the erasure reads it, an admission of the pending row committing at the first read."""

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.aggregate(*args, **kwargs)


SEAT_HOLDER = "anna@example.com"


async def an_admittable_registration(database: AsyncDatabase) -> None:
    """The person holds nothing but a registration their team's seat holder can admit: the admission is what makes them a pupil."""

    await database[Collection.SAISONS].insert_one(saison_document(SAISON_ID, "active"))
    await database[Collection.TEAMS].insert_one(team_document(HOME_TEAM_OID, "Heim-Schule", "HSX"))
    await database[Collection.SAISON_TEAMS].insert_one(
        saison_team_document(
            SAISON_ID,
            HOME_TEAM_OID,
            "Heim-Schule",
            "HSX",
            kontakte=kontakte_document(ansprechperson=kontaktperson_document("Anna", confirmed_at="2126-03-21")),
        )
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(
        a_registration(
            PENDING_OID,
            IDENTIFIER,
            confirmed={
                "birth_date": BIRTH_DATE,
                "scope": "internal",
                "media": False,
                "text_versions": SPIELER_TEXT_VERSIONS,
                "today": YESTERDAY,
                "at": "2126-03-31T08:00:00+00:00",
            },
        )
    )


class TestAnAdmissionInsideTheLoeschung:
    """The subject is read inside the transaction's callback, so the retry a conflict forces re-reads what the rival wrote."""

    def test_the_person_the_admission_made_does_not_survive_the_retry(self, mongo_replica_set_url: str):
        """Resolved outside the callback, the retry would erase the gone registration, answer zero and leave the admitted pupil."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await an_admittable_registration(database)

            async def admission() -> None:
                await admit(
                    registrierung_id=PENDING_OID,
                    aufnahme_data=FLRegistrierungAdmitPayload(spieler_id=None),
                    identifier=SEAT_HOLDER,
                    registrierungen_collection=database[Collection.REGISTRIERUNGEN],
                    saison_spieler_collection=database[Collection.SAISON_SPIELER],
                    saison_teams_collection=database[Collection.SAISON_TEAMS],
                    saisons_collection=database[Collection.SAISONS],
                    spieler_collection=database[Collection.SPIELER],
                    records=record_collections(database),
                    db=client,
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
                        "submitted",
                        kontakte=kontakte_document(trainer=their_seat(), ansprechperson=kontaktperson_document("Quillhilde")),
                        submitted_at="2126-03-10",
                        schule=new_schule_document("Neue"),
                    )
                )
            else:
                await an_admittable_registration(database)

            response = await erased_over_http(mongo_replica_set_url)

            return response.status_code, await where_held(database, FIRST_NAME)

        status, held = on_a_league_of_its_own(mongo_replica_set_url, body)

        assert (status, held) == (200, {FIRST_NAME: []})


class TestThePreview:
    """What the page shows before the press: every record of the person's own the erasure takes, by name, and no address or birthdate."""

    def test_it_counts_no_change_whose_link_has_not_reached_this_mailbox(self, mongo_replica_set_url: str):
        """A change still awaiting its address on file has told the new mailbox nothing, and neither its preview nor its answer.

        Counted, the answer would tell the erased person that somebody typed their address; the press ends it all the same.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            asked_first = documents.address_change_document(
                address="noch.gefragt@example.com", email=IDENTIFIER, token_hash=None, day="2126-03-30", way="account"
            )
            await database[Collection.ADDRESS_CHANGES].insert_one(asked_first)
            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                preview = (await http.get(f"{PATH}/view", headers=as_person(TYPED))).json()["address_change"]

            answered = (await erased_by_the_handler(database, client)).address_change
            return preview, answered, (await the_one(database, Collection.ADDRESS_CHANGES, {"_id": asked_first["_id"]}))["ended"]["kind"]

        # The seed's two changes alone; the press still ends all three, nothing of the asked one being this address's.
        assert on_a_league(mongo_replica_set_url, body) == (2, 2, "discarded")
