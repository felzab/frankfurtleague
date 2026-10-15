"""
API · a person's erasure through the registry, held against the whole database rather than against the steps

One address holds a pupil row in a live squad, a seat on a season row and on an application beside
two bystanders, a referee row booked on a played fixture, a pending and a declined registration,
another referee's pending address change, a day's counts, and log rows written as a person and as an
administrator. Every case asks what is left, so a step removed from the registry fails here.
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

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.crud import ERASURE_JOURNAL_LINE, ERASURE_STEPS, JEDE_PERSONENGRUPPE, erase_everything
from app.api.identitaet.person_router import erase_selbst
from app.api.registrierungen.person_router import aufnehmen
from app.api.registrierungen.schemas import FLRegistrierungAufnehmenPayload
from app.api.registrierungen.services import compose_ablehnung_update
from app.api.schiedsrichter.services import compose_adresswechsel, compose_einwilligung
from app.api.spieler.crud import erase_person_in_session
from app.api.spieler.services import build_ghost_spieler
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db
from app.core.exceptions import DocumentNotFoundException
from app.core.recording import ERASED_ACTOR_MARKER, Actor, PersonActor, actor_var
from app.core.security import akteur_pseudonym, loeschung_journal_hash
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID, GHOST_SPIELER_ID
from app.core.transactions import transaction_session
from app.main import create_app
from tests.actor_tokens import SignedActor
from tests.app_client import app_client
from tests.bans import ban_list
from tests.config import ADMIN_KEY
from tests.core.app_source import DRIVER_WRITES
from tests.database import DOCUMENT_VALIDATION_FAILED, a_clean_database, on_the_seed_loop
from tests.documents import (
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
    spieler_document,
    team_document,
)
from tests.isolation import InterleavedCollection
from tests.records import record_collections
from tests.whole_database import where_held
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

# The person: typed with capitals where a payload keeps them, folded where the pupil row stores it.
TYPED = "Zorbanax.Quillfeather@Example.org"
IDENTIFIER = "zorbanax.quillfeather@example.org"
VORNAME, NACHNAME = "Zorbanax", "Quillfeather"
TELEFON = "+49 69 7771234"
GEBURTSDATUM = "2008-07-14"
PSEUDONYM = akteur_pseudonym(IDENTIFIER, schluessel=CONFIG.sperrliste_schluessel)

# Distinctive, so a hit in a whole-database scan is never coincidence: every value the person holds.
THEIR_VALUES = (VORNAME, NACHNAME, IDENTIFIER, "7771234", GEBURTSDATUM, PSEUDONYM)

# The people beside them, each asserted still present so a database emptied wholesale fails.
BYSTANDER_VALUES = ("Quillhilde", "Bramblewick", "Wraxlington", "kraus.bernd@example.com")
OTHER_PSEUDONYM = akteur_pseudonym("wraxlington@example.com", schluessel=CONFIG.sperrliste_schluessel)

HOME_TEAM_OID = ObjectId("6890a1b2c3d4e5f607b00001")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607b00002")
PUPIL_OID = ObjectId("6890a1b2c3d4e5f607b00011")
OTHER_PUPIL_OID = ObjectId("6890a1b2c3d4e5f607b00012")
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607b00021")
OTHER_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607b00022")
BEWERBUNG_OID = ObjectId("6890a1b2c3d4e5f607b00031")
PENDING_OID = ObjectId("6890a1b2c3d4e5f607b00041")
DECLINED_OID = ObjectId("6890a1b2c3d4e5f607b00042")
SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f607b00051")
THEIR_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b00061")
OTHER_SPIEL_OID = ObjectId("6890a1b2c3d4e5f607b00062")

REFEREE_NAME = f"{VORNAME} {NACHNAME}"
PAYMENT = 25

# A day count of each age the TTL monitor may not have reached, under a bound far off so the monitor
# itself never takes one during a case.
COUNT_IDS = (f"kontakt:{PSEUDONYM}:{TODAY}", f"spieler:{PSEUDONYM}:{YESTERDAY}", f"schiedsrichter:{PSEUDONYM}:2026-03-02")
OTHER_COUNT_ID = f"kontakt:{OTHER_PSEUDONYM}:{TODAY}"
FAR_OFF = datetime(2099, 1, 1, tzinfo=UTC)

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


@functools.cache
def _app() -> FastAPI:
    return create_app(CONFIG)


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Never inside a case: a build re-runs the logging `dictConfig`, which strips the handler `caplog` reads that case's records from."""

    _app()


def their_seat() -> dict[str, Any]:
    return kontaktperson_document(VORNAME, bestaetigt_am="2026-03-21", nachname=NACHNAME, email=TYPED, telefon=TELEFON)


def referee(schiedsrichter_id: ObjectId, *, email: str, name: str, **fields: Any) -> dict[str, Any]:
    return schiedsrichter_document(
        schiedsrichter_id,
        email=email,
        name=name,
        default_payment=PAYMENT,
        einwilligung=compose_einwilligung(umfang="kader_oeffentlich", medien=False, text_version="v1", today="2026-03-01"),
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


async def the_one(database: AsyncDatabase, collection: Collection, db_filter: Mapping[str, Any] | None = None) -> Mapping[str, Any]:
    """The one row a case reads, refused where none stands rather than read as a null."""

    found = await database[collection].find_one(db_filter or {})
    assert found is not None, f"{collection} holds no row matching {db_filter}"
    return found


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
        )
    )
    einwilligung = eigene_einwilligung_document(text_version="v1", bestaetigt_am="2026-03-02")
    await database[Collection.SPIELER].insert_many(
        [
            spieler_document(PUPIL_OID, VORNAME, NACHNAME, email=IDENTIFIER, geburtsdatum=GEBURTSDATUM, einwilligung=einwilligung),
            spieler_document(OTHER_PUPIL_OID, "Wraxlington", "Wraxlington-Muster", email="wraxlington@example.com", einwilligung=einwilligung),
        ]
    )
    their_row, other_row = ObjectId(), ObjectId()
    await database[Collection.SAISON_SPIELER].insert_many(
        [
            saison_spieler_document(PUPIL_OID, SAISON_ID, HOME_TEAM_OID, _id=their_row, nummer="7"),
            saison_spieler_document(OTHER_PUPIL_OID, SAISON_ID, HOME_TEAM_OID, _id=other_row, nummer="8"),
        ]
    )
    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            referee(REFEREE_OID, email=TYPED, name=REFEREE_NAME, geburtsdatum="1990-02-03", kontakt={"telefon": TELEFON, "email": TYPED}),
            referee(
                OTHER_REFEREE_OID,
                email="kraus.bernd@example.com",
                name="Bernd Kraus",
                adresswechsel=compose_adresswechsel(email=TYPED, token_hash=hash_token("their-new-address"), today="2026-03-28"),
            ),
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
            a_registration(PENDING_OID, TYPED),
            # Typed once more otherwise: the fold, never the spelling, says whose a row is.
            a_registration(
                DECLINED_OID,
                IDENTIFIER.upper(),
                **compose_ablehnung_update(von="quillhilde@example.com", grund=None, today="2026-03-28")["$set"],
            ),
        ]
    )
    await database[Collection.DROSSELUNG].insert_many(
        [{"_id": count_id, "n": 3, "ablauf": FAR_OFF} for count_id in (*COUNT_IDS, OTHER_COUNT_ID)]
    )

    # The history: every image the log holds of the person is one of these edits'.
    await edited(database, Collection.SAISON_TEAMS, (await the_one(database, Collection.SAISON_TEAMS))["_id"], {"$set": {"gruppe": "B"}})
    await edited(database, Collection.BEWERBUNGEN, BEWERBUNG_OID, {"$set": {"wunschgegner": "Gast-Schule"}})
    await edited(database, Collection.SAISON_SPIELER, their_row, {"$set": {"nummer": "9"}})
    await edited(database, Collection.SCHIEDSRICHTER, REFEREE_OID, {"$set": {"schule": "Carl-Schurz-Schule"}})
    await edited(database, Collection.SPIELE, THEIR_SPIEL_OID, {"$set": {"uhrzeit": "15:00:00"}})
    for registrierung_id in (PENDING_OID, DECLINED_OID):
        await edited(database, Collection.REGISTRIERUNGEN, registrierung_id, {"$set": {"nummer": "11"}})

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


async def erased_over_http(url: str, *, email: str = TYPED) -> Any:
    async with app_client(url, app=_app(), now=NOW) as http:
        return await http.post(PATH, headers=as_person(email))


def the_collections(database: AsyncDatabase, **replaced: Any) -> dict[str, Any]:
    """Every collection the registry takes, as the route hands them in, any of them replaced by name."""

    handles = {
        f"{collection}_collection": database[collection]
        for collection in (
            Collection.SPIELER,
            Collection.SAISON_SPIELER,
            Collection.SAISON_TEAMS,
            Collection.BEWERBUNGEN,
            Collection.SCHIEDSRICHTER,
            Collection.SPIELE,
            Collection.REGISTRIERUNGEN,
            Collection.DROSSELUNG,
            Collection.AKTIONEN,
        )
    }

    return {**handles, **replaced}


async def erased_by_the_handler(database: AsyncDatabase, client: AsyncMongoClient, **replaced: Any) -> Any:
    """The route's own function, outside a request: what a case needs to catch the driver's failure itself."""

    return await erase_selbst(identifier=IDENTIFIER, **the_collections(database, **replaced), db=client, config=CONFIG, germany_now=NOW)


async def erased_in_scope(database: AsyncDatabase, client: AsyncMongoClient, scope: frozenset[Any], **replaced: Any) -> Any:
    async def erase(session: Any) -> Any:
        return await erase_everything(
            IDENTIFIER,
            scope=scope,
            **the_collections(database, **replaced),
            schluessel=CONFIG.sperrliste_schluessel,
            stamp=TODAY,
            session=session,
        )

    async with transaction_session(client) as session:
        return await session.with_transaction(erase)


class TestNothingOfTheirsIsLeftAnywhere:
    """The witness for reach: the whole database rendered as text, each collection named where a value survives."""

    def test_no_value_of_theirs_survives_and_every_bystanders_does(self, mongo_replica_set_url: str):
        """Catches a step removed from the registry, and a store none of them reaches -- the pseudonym's included.

        Every value is asserted present before, so a seed that stopped writing one fails rather than passing.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await where_held(database, *THEIR_VALUES)
            response = await erased_over_http(mongo_replica_set_url)

            return before, response.status_code, await where_held(database, *THEIR_VALUES, *BYSTANDER_VALUES)

        before, status, after = on_a_league(mongo_replica_set_url, body)

        assert all(before[value] for value in THEIR_VALUES), before
        assert status == 200
        assert {value: after[value] for value in THEIR_VALUES} == dict.fromkeys(THEIR_VALUES, [])
        assert all(after[value] for value in BYSTANDER_VALUES), after

    def test_each_kind_is_counted_as_it_went(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (await erased_over_http(mongo_replica_set_url)).json()

        answer = on_a_league(mongo_replica_set_url, body)

        assert {key: value for key, value in answer.items() if key != "acknowledged"} == {
            "spieler": 1,
            "saison_spieler": 1,
            "schiedsrichter": 1,
            "spiele": 1,
            "kontakt_sitze": 2,
            "registrierungen": 2,
            "adresswechsel": 1,
            "drosselung": 3,
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

    def test_another_referees_pending_change_goes_and_their_row_stands(self, mongo_replica_set_url: str):
        """The row is the old address's person's until the change is confirmed, so the block alone goes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return await database[Collection.SCHIEDSRICHTER].find_one({"_id": OTHER_REFEREE_OID})

        row = on_a_league(mongo_replica_set_url, body)

        assert row is not None
        assert "adresswechsel" not in row
        assert row["kontakt"]["email"] == "kraus.bernd@example.com"

    def test_their_fixture_names_the_ghost_and_no_name_and_keeps_its_fee(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return {row["_id"]: row["schiedsrichter"] async for row in database[Collection.SPIELE].find()}

        bookings = on_a_league(mongo_replica_set_url, body)

        assert bookings[THEIR_SPIEL_OID] == {"schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID, "name": None, "payment": PAYMENT}
        assert bookings[OTHER_SPIEL_OID]["schiedsrichter_id"] == OTHER_REFEREE_OID

    def test_only_their_day_counts_go(self, mongo_replica_set_url: str):
        """Every day of theirs, the one the TTL monitor may not have reached included, and another person's count of today stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_over_http(mongo_replica_set_url)

            return [row["_id"] async for row in database[Collection.DROSSELUNG].find()]

        assert on_a_league(mongo_replica_set_url, body) == [OTHER_COUNT_ID]


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

        assert pupils == [{"_id": GHOST_SPIELER_ID}]
        assert referees == [{"_id": GHOST_SCHIEDSRICHTER_ID}]


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
    """A failure at the LAST write takes every step back: an erasure half done reports one that did not happen."""

    def test_a_refused_last_write_leaves_everything_as_it_stood(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The validator refuses the marker on a person's row, which only the log's step writes, after every other step."""

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
                        Collection.SPIELER,
                        Collection.SAISON_SPIELER,
                        Collection.SCHIEDSRICHTER,
                        Collection.REGISTRIERUNGEN,
                        Collection.DROSSELUNG,
                    )
                },
                (
                    (await the_one(database, Collection.SAISON_TEAMS))["kontakte"]["ansprechperson"]["email"],
                    (await the_one(database, Collection.SCHIEDSRICHTER, {"_id": OTHER_REFEREE_OID}))["adresswechsel"]["email"],
                    await database[Collection.AKTIONEN].count_documents({"actor.pseudonym": PSEUDONYM}),
                    await database[Collection.AKTIONEN].count_documents({"redacted_at": {"$ne": None}}),
                    await database[Collection.SPIELE].count_documents({"schiedsrichter.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID}),
                ),
            )

        with caplog.at_level(logging.INFO):
            code, counts, (seat, pending, their_rows, stamped, on_the_ghost) = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        # On the code, so this cannot pass because something else failed before any write.
        assert code == DOCUMENT_VALIDATION_FAILED
        assert counts == {"spieler": 2, "saison_spieler": 2, "schiedsrichter": 2, "registrierungen": 2, "drosselung": 4}
        assert (seat, pending, their_rows, stamped, on_the_ghost) == (TYPED, TYPED, 2, 0, 0)
        # And no journal line: an erasure rolled back is no erasure a replay may repeat.
        assert not [record for record in caplog.records if record.getMessage().startswith(ERASURE_JOURNAL_LINE)]


class TestTheJournal:
    def test_one_line_per_erasure_names_the_journal_hash_and_no_address(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return (await erased_over_http(mongo_replica_set_url)).status_code

        with caplog.at_level(logging.INFO):
            status = on_a_league(mongo_replica_set_url, body)

        lines = [record.getMessage() for record in caplog.records if record.getMessage().startswith(ERASURE_JOURNAL_LINE)]
        expected = loeschung_journal_hash(IDENTIFIER, schluessel=CONFIG.sperrliste_schluessel)

        assert status == 200
        assert lines == [f"{ERASURE_JOURNAL_LINE}: {expected}"]
        # Its own label: under the log's, the journal would name the very pseudonym the erasure removed.
        assert expected != PSEUDONYM


class TestTheScope:
    """The yearly deletion takes a pupil's data alone, every other kind at the address standing."""

    def test_the_pupil_scope_takes_the_pupil_and_their_registrations_and_nothing_else(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await erased_in_scope(database, client, frozenset({"spieler"}))

            return (
                await database[Collection.SPIELER].count_documents({"_id": PUPIL_OID}),
                await database[Collection.REGISTRIERUNGEN].count_documents({}),
                (await the_one(database, Collection.SAISON_TEAMS))["kontakte"]["ansprechperson"]["email"],
                await database[Collection.SCHIEDSRICHTER].count_documents({"_id": REFEREE_OID}),
                "adresswechsel" in await the_one(database, Collection.SCHIEDSRICHTER, {"_id": OTHER_REFEREE_OID}),
                await database[Collection.DROSSELUNG].count_documents({}),
                await database[Collection.AKTIONEN].count_documents({"actor.email": IDENTIFIER}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (0, 0, TYPED, 1, True, 4, 1)


# The registry's steps by the code each runs, so a write can be put down to the step it was made in.
_STEP_OF_CODE = {step.run.__code__: step.run.__name__ for step in ERASURE_STEPS}


def _running_step() -> str | None:
    frame = sys._getframe()
    while frame is not None:
        if frame.f_code in _STEP_OF_CODE:
            return _STEP_OF_CODE[frame.f_code]
        frame = frame.f_back
    return None


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

        The seed gives every step something to write in each collection it declares.
        """

        writes: dict[str, set[str]] = {}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            recorded = {name: WritesRecorded(handle, writes) for name, handle in the_collections(database).items()}
            await erased_in_scope(database, client, JEDE_PERSONENGRUPPE, **recorded)

        on_a_league(mongo_replica_set_url, body)

        assert writes == {step.run.__name__: {str(collection) for collection in step.reaches} for step in ERASURE_STEPS}


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
            TYPED,
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
    """What the page shows before the press: every kind the erasure reaches, by name, and no address or birthdate."""

    def test_it_names_every_record_the_erasure_reaches(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
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
        assert answer["bewerbungen"] == [{"saison_id": SAISON_ID, "rolle": "trainer", "vorname": VORNAME, "nachname": NACHNAME}]
        assert answer["registrierungen"] == [{"saison_id": SAISON_ID, "team_name": "Heim-Schule", "vorname": VORNAME, "nachname": NACHNAME}] * 2
        assert (answer["adresswechsel"], answer["verwaltung"]) == (1, None)
        assert "@" not in response.text and GEBURTSDATUM not in response.text
