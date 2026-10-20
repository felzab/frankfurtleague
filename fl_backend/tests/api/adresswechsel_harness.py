"""
TESTS · one person holding every kind of record an address change moves, and every route driving a change, for the address-change suites

Each route is called as its handler, every collection it takes by its own name off one database, so a case names only
what it changes: the address, the instant, the actor.
"""

import inspect
import time
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.adresswechsel.admin_router import (
    delete_adresswechsel,
    einladen_adresswechsel,
    get_adresswechsel_verwaltung_ansicht,
    post_adresswechsel_genehmigung,
    post_adresswechsel_verwaltung,
)
from app.api.adresswechsel.router import get_adresswechsel_ansicht, post_adresswechsel_antwort, post_adresswechsel_stopp
from app.api.adresswechsel.schemas import (
    FLAdresswechselAnsichtPayload,
    FLAdresswechselAntwortPayload,
    FLAdresswechselStoppPayload,
    FLAdresswechselSweepParams,
    FLAdresswechselVerwaltungAnsichtPayload,
    FLAdresswechselVerwaltungPayload,
)
from app.api.adresswechsel.sweep_router import sweep_adresswechsel
from app.api.konto.router import delete_adresswechsel as stop_on_the_account_page
from app.api.konto.router import get_adresswechsel, post_adresswechsel, post_adresswechsel_freigabe
from app.api.konto.schemas import FLKontoAdresswechselFreigabePayload, FLKontoAdresswechselPayload
from app.core.collections import Collection
from app.core.exceptions import WriteRefusalException
from app.shared.schemas.bounds import ADRESSWECHSEL_WARTEZEIT_TAGE
from tests import documents
from tests.bans import ban_list
from tests.config import ADMINISTRATORS, build_test_config, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.records import record_collections

SAISON_ID = "2026"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Past a step's 24 hours, past a grant's week of approval, and past a confirmed change's waiting time.
AFTER_THE_DEADLINE = NOW + timedelta(hours=25)
AFTER_THE_WEEK = NOW + timedelta(days=7, hours=1)
AFTER_THE_WAIT = NOW + timedelta(days=ADRESSWECHSEL_WARTEZEIT_TAGE, hours=2)

# One person holding a pupil row, a confirmed referee row, seats and registrations, each record in its own spelling.
EMAIL = "lenore.quastenbach@schule.example"
TYPED = "Lenore.Quastenbach@Schule.example"
NEW_EMAIL = "lenore.q@neupost.example.org"
OTHER_EMAIL = "jonte.wirbelauer@schule.example"
FOREIGN_EMAIL = "fremd@anderswo.example"
GRUND = "Postfach gelöscht, telefonisch bestätigt am 21.10.2026"

# The suite's owner and three administrators (`tests/config.py :: grants_for_the_suite`).
OWNER, ADMIN, SECOND_ADMIN, THIRD_ADMIN = ADMINISTRATORS

SPIELER_OID = ObjectId("6890a1b2c3d4e5f607850001")
OTHER_OID = ObjectId("6890a1b2c3d4e5f607850002")
REFEREE_OID = ObjectId("6890a1b2c3d4e5f607850011")
UNCONFIRMED_REFEREE_OID = ObjectId("6890a1b2c3d4e5f607850012")
TEAM_OID = ObjectId("6890a1b2c3d4e5f607850021")
SECOND_TEAM_OID = ObjectId("6890a1b2c3d4e5f607850022")
ROW_OID = ObjectId("6890a1b2c3d4e5f607850031")
PENDING_OID = ObjectId("6890a1b2c3d4e5f607850041")
ACCEPTED_OID = ObjectId("6890a1b2c3d4e5f607850042")
CONFIRMED_REG_OID = ObjectId("6890a1b2c3d4e5f607850051")
UNCONFIRMED_REG_OID = ObjectId("6890a1b2c3d4e5f607850052")
SPIEL_OID = ObjectId("6890a1b2c3d4e5f607850061")
CONFIRMATION_OID = ObjectId("6890a1b2c3d4e5f607850062")

UNCONFIRMED_REG_LINK = "the-unconfirmed-registrations-link"
REFEREE_LABEL = "2026-09-schiedsrichterseite-3"

A_BOUNCE: Mapping[str, Any] = {"nachricht_id": "m-1", "stand": "unzustellbar", "grund": "NoEmail", "am": "2026-03-21T10:00:00.000000+00:00"}


def _seat(email: str, *, confirmed: bool) -> dict[str, Any]:
    seat = documents.kontaktperson_document("Lenore", bestaetigt_am="2026-03-21" if confirmed else None)
    return {**seat, "nachname": "Quastenbach", "email": email}


def registration(registrierung_id: ObjectId, team_id: ObjectId, *, confirmed: bool, token: str) -> dict[str, Any]:
    return documents.registrierung_document(
        registrierung_id,
        TYPED,
        saison_id=SAISON_ID,
        team_id=team_id,
        vorname="Lenore",
        nachname="Quastenbach",
        token=token,
        eingereicht_am="2026-03-30",
        frist="2026-04-06",
        bestaetigt=documents.registrierung_bestaetigt(
            "bestaetigung_spieler",
            geburtsdatum="2009-05-04",
            today="2026-03-31",
            am="2026-03-31T08:00:00+00:00",
            umfang="intern",
            medien=False,
        )
        if confirmed
        else None,
    )


async def _seed(database: AsyncDatabase, *, pupil: bool, records: bool) -> None:
    await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
    await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
    await database[Collection.TEAMS].insert_many(
        [documents.team_document(TEAM_OID, "Zorbanax", "ZO"), documents.team_document(SECOND_TEAM_OID, "Quellbrunn", "QB")]
    )
    pupils = [documents.spieler_document(OTHER_OID, "Jonte", "Wirbelauer", email=OTHER_EMAIL)]
    if pupil:
        pupils.append(documents.spieler_document(SPIELER_OID, "Lenore", "Quastenbach", email=EMAIL, geburtsdatum="2009-05-04"))
    await database[Collection.SPIELER].insert_many(pupils)
    if not records:
        return

    await database[Collection.SCHIEDSRICHTER].insert_many(
        [
            documents.schiedsrichter_document(
                REFEREE_OID,
                email=TYPED,
                name="Lenore Quastenbach",
                default_payment=20,
                einwilligung=documents.eigene_einwilligung_document(text_version=REFEREE_LABEL, bestaetigt_am="2026-03-02"),
                bestaetigung={
                    "token_hash": "c" * 64,
                    "verschickt_am": "2026-03-01",
                    "erinnert_am": None,
                    "frist": "2026-03-15",
                    "zustellung": dict(A_BOUNCE),
                },
            ),
            # Entered by an administrator under the same address and never confirmed: not this person's record yet.
            documents.schiedsrichter_document(UNCONFIRMED_REFEREE_OID, email=EMAIL, name="Lenore Q.", default_payment=20, einwilligung=None),
        ]
    )
    await database[Collection.SAISON_TEAMS].insert_one(
        {
            **documents.saison_team_document(
                SAISON_ID,
                TEAM_OID,
                "Zorbanax",
                "ZO",
                kontakte=documents.kontakte_document(
                    ansprechperson=_seat(TYPED, confirmed=True), stellvertretung=_seat(EMAIL, confirmed=False)
                ),
            ),
            "_id": ROW_OID,
            "bestaetigungen": {
                "trainer": None,
                "ansprechperson": {
                    "token_hash": "a" * 64,
                    "verschickt_am": "2026-03-20",
                    "frist": "2026-04-03",
                    "abgelehnt_am": None,
                    "zustellung": dict(A_BOUNCE),
                },
                "stellvertretung": None,
            },
        }
    )
    spiel = documents.spiel_document(
        spiel_id=SPIEL_OID,
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=None,
        datum="2026-04-18",
        uhrzeit="14:00:00",
        team1={"team_id": TEAM_OID},
        team2={"team_id": SECOND_TEAM_OID},
    )
    await database[Collection.SPIELBESTAETIGUNGEN].insert_one(
        documents.spielbestaetigung_document(
            spiel,
            partei={"art": "team", "team_id": TEAM_OID},
            _id=CONFIRMATION_OID,
            angefragt_am="2026-03-30",
            kontakte={seat: {"token_hashes": ["b" * 64], "zustellung": None} for seat in ("trainer", "ansprechperson", "stellvertretung")},
        )
    )
    await database[Collection.BEWERBUNGEN].insert_many(
        [
            documents.bewerbung_document(
                PENDING_OID,
                SAISON_ID,
                "eingereicht",
                kontakte=documents.kontakte_document(trainer=_seat(TYPED, confirmed=True)),
                eingereicht_am="2026-03-10",
                bestaetigungsfrist="2026-04-15",
                team_id=SECOND_TEAM_OID,
            ),
            documents.bewerbung_document(
                ACCEPTED_OID,
                SAISON_ID,
                "angenommen",
                kontakte=documents.kontakte_document(ansprechperson=_seat(TYPED, confirmed=True)),
                eingereicht_am="2026-02-10",
                team_id=TEAM_OID,
            ),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [
            registration(CONFIRMED_REG_OID, TEAM_OID, confirmed=True, token="the-confirmed-registrations-link"),
            registration(UNCONFIRMED_REG_OID, SECOND_TEAM_OID, confirmed=False, token=UNCONFIRMED_REG_LINK),
        ]
    )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_person(url: str, database_name: str, body: Body, *, pupil: bool = True, records: bool = True) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, database_name, constraints=True) as (client, database):
            await _seed(database, pupil=pupil, records=records)
            return await body(database, client)

    return on_the_seed_loop(_run())


async def granted(database: AsyncDatabase, adresse: str = EMAIL, *, verwaltung: str = "administration") -> ObjectId:
    """A grant at `adresse`, written as the Playground writes one, before the clock's first sight of it."""

    grant_id = ObjectId()
    await database[Collection.BERECHTIGUNGEN].insert_one(
        {**grants_for_the_suite()[1], "_id": grant_id, "adresse": adresse, "verwaltung": verwaltung}
    )

    return grant_id


def call(handler: Callable[..., Awaitable[Any]], database: AsyncDatabase, client: AsyncMongoClient, **given: Any) -> Awaitable[Any]:
    """The handler with every collection it names taken off `database` by its parameter's spelling, and the rest defaulted.

    An administrator's call acts as the suite's first administrator, signed in a minute ago, unless the case names another.
    """

    supplied: dict[str, Any] = {}
    for name in inspect.signature(handler).parameters:
        if name in given:
            supplied[name] = given[name]
        elif name.endswith("_collection"):
            supplied[name] = database[Collection(name.removesuffix("_collection"))]
        elif name == "records":
            supplied[name] = record_collections(database)
        elif name == "sperrliste":
            supplied[name] = ban_list(database)
        elif name == "db":
            supplied[name] = client
        elif name == "config":
            supplied[name] = build_test_config()
        elif name == "germany_now":
            supplied[name] = NOW
        elif name == "operator":
            supplied[name] = ADMIN
        elif name == "auth_time":
            supplied[name] = int(time.time()) - 60
        elif name == "identifier":
            supplied[name] = EMAIL

    return handler(**supplied)


def read(database: AsyncDatabase, client: AsyncMongoClient, identifier: str = EMAIL) -> Awaitable[Any]:
    return call(get_adresswechsel, database, client, identifier=identifier)


def start(database: AsyncDatabase, client: AsyncMongoClient, *, email: str = NEW_EMAIL, **given: Any) -> Awaitable[Any]:
    return call(post_adresswechsel, database, client, adresswechsel_data=FLKontoAdresswechselPayload(email=email), **given)


def approve_as_the_address(database: AsyncDatabase, client: AsyncMongoClient, adresswechsel_id: ObjectId, **given: Any) -> Awaitable[Any]:
    return call(post_adresswechsel_freigabe, database, client, freigabe_data=FLKontoAdresswechselFreigabePayload(id=adresswechsel_id), **given)


def stop_here(database: AsyncDatabase, client: AsyncMongoClient, **given: Any) -> Awaitable[Any]:
    return call(stop_on_the_account_page, database, client, **given)


def administrator_starts(
    database: AsyncDatabase, client: AsyncMongoClient, *, grund: str | None, adresse: str = EMAIL, email: str = NEW_EMAIL, **given: Any
) -> Awaitable[Any]:
    payload = FLAdresswechselVerwaltungPayload.model_validate({"adresse": adresse, "email": email, "grund": grund})
    return call(post_adresswechsel_verwaltung, database, client, adresswechsel_data=payload, **given)


def tool_read(database: AsyncDatabase, client: AsyncMongoClient, **key: Any) -> Awaitable[Any]:
    payload = FLAdresswechselVerwaltungAnsichtPayload.model_validate(key)
    return call(get_adresswechsel_verwaltung_ansicht, database, client, ansicht_data=payload)


def resend(database: AsyncDatabase, client: AsyncMongoClient, adresswechsel_id: ObjectId, **given: Any) -> Awaitable[Any]:
    return call(einladen_adresswechsel, database, client, adresswechsel_id=adresswechsel_id, **given)


def discard(database: AsyncDatabase, client: AsyncMongoClient, adresswechsel_id: ObjectId, **given: Any) -> Awaitable[Any]:
    return call(delete_adresswechsel, database, client, adresswechsel_id=adresswechsel_id, **given)


def approve(database: AsyncDatabase, client: AsyncMongoClient, adresswechsel_id: ObjectId, **given: Any) -> Awaitable[Any]:
    return call(post_adresswechsel_genehmigung, database, client, adresswechsel_id=adresswechsel_id, **given)


def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, antwort: str = "bestaetigt", **given: Any) -> Awaitable[Any]:
    payload = FLAdresswechselAntwortPayload.model_validate({"token": token, "antwort": antwort})
    return call(post_adresswechsel_antwort, database, client, antwort_data=payload, **given)


def stop_by_link(database: AsyncDatabase, client: AsyncMongoClient, token: str, **given: Any) -> Awaitable[Any]:
    return call(post_adresswechsel_stopp, database, client, stopp_data=FLAdresswechselStoppPayload(token=token), **given)


def view(database: AsyncDatabase, client: AsyncMongoClient, token: str, **given: Any) -> Awaitable[Any]:
    return call(get_adresswechsel_ansicht, database, client, ansicht_data=FLAdresswechselAnsichtPayload(token=token), **given)


def sweep(database: AsyncDatabase, client: AsyncMongoClient, *, nach: Any = None, **given: Any) -> Awaitable[Any]:
    return call(sweep_adresswechsel, database, client, params=FLAdresswechselSweepParams(nach=nach), **given)


async def refused_code(call: Awaitable[Any]) -> str:
    with pytest.raises(WriteRefusalException) as refused:
        await call

    return refused.value.error_code


async def row(database: AsyncDatabase, collection: Collection, row_id: ObjectId) -> Mapping[str, Any]:
    found = await database[collection].find_one({"_id": row_id})
    assert found is not None, f"the {collection} row this case seeded is gone"

    return found


async def change(database: AsyncDatabase, adresswechsel_id: ObjectId) -> Mapping[str, Any]:
    return await row(database, Collection.ADRESSWECHSEL, adresswechsel_id)


async def everything(database: AsyncDatabase) -> dict[str, Mapping[str, Any]]:
    """Every record the seed wrote for the person, by what it is."""

    return {
        "pupil": await row(database, Collection.SPIELER, SPIELER_OID),
        "referee": await row(database, Collection.SCHIEDSRICHTER, REFEREE_OID),
        "unconfirmed referee": await row(database, Collection.SCHIEDSRICHTER, UNCONFIRMED_REFEREE_OID),
        "season row": await row(database, Collection.SAISON_TEAMS, ROW_OID),
        "confirmation": await row(database, Collection.SPIELBESTAETIGUNGEN, CONFIRMATION_OID),
        "pending application": await row(database, Collection.BEWERBUNGEN, PENDING_OID),
        "accepted application": await row(database, Collection.BEWERBUNGEN, ACCEPTED_OID),
        "confirmed registration": await row(database, Collection.REGISTRIERUNGEN, CONFIRMED_REG_OID),
        "unconfirmed registration": await row(database, Collection.REGISTRIERUNGEN, UNCONFIRMED_REG_OID),
    }
