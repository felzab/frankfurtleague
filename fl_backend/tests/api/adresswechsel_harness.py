"""
TESTS · one person holding every kind of record an address change moves, and every route driving a change, for the address-change suites

Each route is called as its handler, every collection it takes by its own name off one database, so a case names only
what it changes: the address, the instant, the actor.
"""

import inspect
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.adresswechsel.admin_router import (
    delete_address_change,
    get_address_change_verwaltung_view,
    invite_address_change,
    post_address_change_approval,
    post_address_change_verwaltung,
)
from app.api.adresswechsel.public_router import get_address_change_view, post_address_change_antwort, post_address_change_stop
from app.api.adresswechsel.schemas import (
    FLAddressChangeAntwortPayload,
    FLAddressChangeVerwaltungPayload,
    FLAddressChangeVerwaltungViewPayload,
    FLAdresswechselSweepParams,
)
from app.api.adresswechsel.system_router import sweep_address_change
from app.api.konto.person_router import delete_address_change as stop_on_the_account_page
from app.api.konto.person_router import get_address_change, post_address_change, post_address_change_release
from app.api.konto.schemas import FLAccountAddressChangePayload, FLAccountAddressChangeReleasePayload
from app.api.outbox.system_router import post_handout
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.core.security import PASSKEY_FACTOR, SessionActor
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.schemas.bounds import ADDRESS_CHANGE_WAITING_PERIOD_DAYS
from app.shared.schemas.confirmation import FLTokenPayload
from tests import documents
from tests.bans import ban_list
from tests.config import ADMINISTRATORS, build_test_config, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.records import record_collections
from tests.session_headers import verified_actor

SAISON_ID = "2026"
# A century ahead of the real clock: the TTL monitor deletes an expired tombstone or day's count at its next pass,
# under a case reading it back. Every seeded day moves with it.
TODAY = "2126-04-01"
NOW = datetime(2126, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Past a step's 24 hours, past a grant's week of approval, and past a confirmed change's waiting time.
AFTER_THE_DEADLINE = NOW + timedelta(hours=25)
AFTER_THE_WEEK = NOW + timedelta(days=7, hours=1)
AFTER_THE_WAIT = NOW + timedelta(days=ADDRESS_CHANGE_WAITING_PERIOD_DAYS, hours=2)

# One person holding a pupil row, a confirmed referee row, seats and registrations, each stored folded; and a spelling they may type.
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
REFEREE_LABEL = LAUFENDE_FASSUNGEN["bestaetigung_schiedsrichter"]

A_BOUNCE: Mapping[str, Any] = {"message_id": "m-1", "stand": "undeliverable", "grund": "NoEmail", "am": "2126-03-21T10:00:00.000000+00:00"}


def _seat(email: str, *, confirmed: bool) -> dict[str, Any]:
    seat = documents.kontaktperson_document("Lenore", confirmed_at="2126-03-21" if confirmed else None)
    return {**seat, "nachname": "Quastenbach", "email": email}


def registration(registrierung_id: ObjectId, team_id: ObjectId, *, confirmed: bool, token: str) -> dict[str, Any]:
    return documents.registrierung_document(
        registrierung_id,
        EMAIL,
        saison_id=SAISON_ID,
        team_id=team_id,
        vorname="Lenore",
        nachname="Quastenbach",
        token=token,
        submitted_at="2126-03-30",
        frist="2126-04-06",
        confirmed=documents.registrierung_confirmed(
            "bestaetigung_spieler",
            geburtsdatum="2009-05-04",
            today="2126-03-31",
            am="2126-03-31T08:00:00+00:00",
            umfang="intern",
            medien=False,
        )
        if confirmed
        else None,
    )


async def _seed(database: AsyncDatabase, *, pupil: bool, records: bool) -> None:
    await database[Collection.GRANTS].insert_many(grants_for_the_suite())
    await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
    await database[Collection.TEAMS].insert_many(
        [documents.team_document(TEAM_OID, "Zorbanax", "ZOX"), documents.team_document(SECOND_TEAM_OID, "Quellbrunn", "QBX")]
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
                email=EMAIL,
                name="Lenore Quastenbach",
                default_payment=20,
                einwilligung=documents.own_einwilligung_document(text_version=REFEREE_LABEL, confirmed_at="2126-03-02"),
                confirmation={
                    "token_hash": "c" * 64,
                    "sent_at": "2126-03-01",
                    "reminded_at": None,
                    "frist": "2126-03-15",
                    "delivery": dict(A_BOUNCE),
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
                "ZOX",
                kontakte=documents.kontakte_document(
                    ansprechperson=_seat(EMAIL, confirmed=True), stellvertretung=_seat(EMAIL, confirmed=False)
                ),
            ),
            "_id": ROW_OID,
            "confirmations": {
                "trainer": None,
                "ansprechperson": {
                    "token_hash": "a" * 64,
                    "sent_at": "2126-03-20",
                    "frist": "2126-04-03",
                    "declined_at": None,
                    "delivery": dict(A_BOUNCE),
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
        datum="2126-04-18",
        uhrzeit="14:00:00",
        team1={"team_id": TEAM_OID},
        team2={"team_id": SECOND_TEAM_OID},
    )
    await database[Collection.SPIELBESTAETIGUNGEN].insert_one(
        documents.spielbestaetigung_document(
            spiel,
            party={"art": "team", "team_id": TEAM_OID},
            _id=CONFIRMATION_OID,
            asked_at="2126-03-30",
            kontakte={seat: {"token_hashes": ["b" * 64], "delivery": None} for seat in ("trainer", "ansprechperson", "stellvertretung")},
        )
    )
    await database[Collection.BEWERBUNGEN].insert_many(
        [
            documents.bewerbung_document(
                PENDING_OID,
                SAISON_ID,
                "submitted",
                kontakte=documents.kontakte_document(trainer=_seat(EMAIL, confirmed=True)),
                submitted_at="2126-03-10",
                confirmation_deadline="2126-04-15",
                team_id=SECOND_TEAM_OID,
            ),
            documents.bewerbung_document(
                ACCEPTED_OID,
                SAISON_ID,
                "accepted",
                kontakte=documents.kontakte_document(ansprechperson=_seat(EMAIL, confirmed=True)),
                submitted_at="2126-02-10",
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
    await database[Collection.GRANTS].insert_one({**grants_for_the_suite()[1], "_id": grant_id, "adresse": adresse, "verwaltung": verwaltung})

    return grant_id


def person_actor(*, factor: str | None) -> SessionActor:
    """The person's session, made a minute ago, by passkey or, with `factor` None, by code."""

    return verified_actor(EMAIL, factor=PASSKEY_FACTOR if factor == PASSKEY_FACTOR else "code")


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
        elif name in ("germany_now", "now"):
            supplied[name] = NOW
        elif name == "operator":
            supplied[name] = ADMIN
        elif name == "auth_time":
            supplied[name] = int(time.time()) - 60
        elif name == "identifier":
            supplied[name] = EMAIL
        elif name == "actor":
            supplied[name] = person_actor(factor=PASSKEY_FACTOR)

    return handler(**supplied)


def read(database: AsyncDatabase, client: AsyncMongoClient, identifier: str = EMAIL, **given: Any) -> Awaitable[Any]:
    return call(get_address_change, database, client, identifier=identifier, **given)


# The kinds whose hand-out mints a change's link, and which link each mints.
_LINKS = {"address_change_link": "token", "address_change_hinweis": "stopp_token"}


@dataclass(frozen=True)
class Minted:
    """A write's answer, and the raw links the Postausgang's hand-out minted for the mails it owed, as the drain receives them.

    `None` where the write owed no such mail.
    """

    answer: Any
    token: str | None
    stopp_token: str | None

    def __getattr__(self, name: str) -> Any:
        return getattr(self.answer, name)


async def handed_out(database: AsyncDatabase, client: AsyncMongoClient, answer: Any, *, now: datetime = NOW) -> Minted:
    """The links owed at `now`, minted by the real hand-out and settled as sent; any other mail it claimed is left owed and free."""

    # Claim after claim until one holds nothing, each holding its rows past the next: a page of older mail comes first.
    mails = []
    while (
        claim := await post_handout(
            outbox_collection=database[Collection.OUTBOX], sperrliste=ban_list(database), db=database, db_client=client, now=now
        )
    ).mails:
        mails += claim.mails
    links = {_LINKS[mail.data.art]: mail.token for mail in mails if mail.data.art in _LINKS}
    held = [mail.id for mail in mails if mail.data.art in _LINKS]
    others = [mail.id for mail in mails if mail.data.art not in _LINKS]
    if held:
        await database[Collection.OUTBOX].update_many({"_id": {"$in": held}}, {"$set": {"stand": "sent"}})
    if others:
        await database[Collection.OUTBOX].update_many(
            {"_id": {"$in": others}}, {"$set": {"lease": None, "leased_until": None}, "$inc": {"attempts": -1}}
        )

    return Minted(answer=answer, token=links.get("token"), stopp_token=links.get("stopp_token"))


async def start(database: AsyncDatabase, client: AsyncMongoClient, *, email: str = NEW_EMAIL, **given: Any) -> Minted:
    answer = await call(post_address_change, database, client, adresswechsel_data=FLAccountAddressChangePayload(email=email), **given)
    return await handed_out(database, client, answer, now=given.get("germany_now", NOW))


async def approve_as_the_address(database: AsyncDatabase, client: AsyncMongoClient, address_change_id: ObjectId, **given: Any) -> Minted:
    payload = FLAccountAddressChangeReleasePayload(id=address_change_id)
    return await handed_out(
        database,
        client,
        await call(post_address_change_release, database, client, freigabe_data=payload, **given),
        now=given.get("germany_now", NOW),
    )


def stop_here(database: AsyncDatabase, client: AsyncMongoClient, **given: Any) -> Awaitable[Any]:
    return call(stop_on_the_account_page, database, client, **given)


async def administrator_starts(
    database: AsyncDatabase, client: AsyncMongoClient, *, grund: str | None, adresse: str = EMAIL, email: str = NEW_EMAIL, **given: Any
) -> Minted:
    payload = FLAddressChangeVerwaltungPayload.model_validate({"adresse": adresse, "email": email, "grund": grund})
    return await handed_out(
        database,
        client,
        await call(post_address_change_verwaltung, database, client, adresswechsel_data=payload, **given),
        now=given.get("germany_now", NOW),
    )


def tool_read(database: AsyncDatabase, client: AsyncMongoClient, *, operator: str = ADMIN, **key: Any) -> Awaitable[Any]:
    payload = FLAddressChangeVerwaltungViewPayload.model_validate(key)
    return call(get_address_change_verwaltung_view, database, client, ansicht_data=payload, operator=operator)


async def resend(database: AsyncDatabase, client: AsyncMongoClient, address_change_id: ObjectId, **given: Any) -> Minted:
    return await handed_out(
        database,
        client,
        await call(invite_address_change, database, client, address_change_id=address_change_id, **given),
        now=given.get("germany_now", NOW),
    )


def discard(database: AsyncDatabase, client: AsyncMongoClient, address_change_id: ObjectId, **given: Any) -> Awaitable[Any]:
    return call(delete_address_change, database, client, address_change_id=address_change_id, **given)


def approve(database: AsyncDatabase, client: AsyncMongoClient, address_change_id: ObjectId, **given: Any) -> Awaitable[Any]:
    return call(post_address_change_approval, database, client, address_change_id=address_change_id, **given)


def _handed(token: str | None) -> str:
    """A link a hand-out minted: `None` here is a case pressing a link the write never owed."""

    assert token is not None, "no hand-out minted this link"
    return token


def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str | None, antwort: str = "confirmed", **given: Any) -> Awaitable[Any]:
    payload = FLAddressChangeAntwortPayload.model_validate({"token": _handed(token), "antwort": antwort})
    return call(post_address_change_antwort, database, client, antwort_data=payload, **given)


def stop_by_link(database: AsyncDatabase, client: AsyncMongoClient, token: str | None, **given: Any) -> Awaitable[Any]:
    return call(post_address_change_stop, database, client, stopp_data=FLTokenPayload(token=_handed(token)), **given)


def view(database: AsyncDatabase, client: AsyncMongoClient, token: str | None, **given: Any) -> Awaitable[Any]:
    return call(get_address_change_view, database, client, ansicht_data=FLTokenPayload(token=_handed(token)), **given)


def sweep(database: AsyncDatabase, client: AsyncMongoClient, *, nach: Any = None, **given: Any) -> Awaitable[Any]:
    return call(sweep_address_change, database, client, params=FLAdresswechselSweepParams(nach=nach), **given)


async def refused_code(call: Awaitable[Any]) -> str:
    with pytest.raises(APIError) as refused:
        await call

    return refused.value.error_code


async def row(database: AsyncDatabase, collection: Collection, row_id: ObjectId) -> Mapping[str, Any]:
    found = await database[collection].find_one({"_id": row_id})
    assert found is not None, f"the {collection} row this case seeded is gone"

    return found


async def change(database: AsyncDatabase, address_change_id: ObjectId) -> Mapping[str, Any]:
    return await row(database, Collection.ADDRESS_CHANGES, address_change_id)


async def owed(database: AsyncDatabase) -> list[dict[str, Any]]:
    """The notices the ends owe, in the order the drain hands them out: their kind, their recipient and whom they greet."""

    rows = database[Collection.OUTBOX].find(
        {"art": {"$in": ["address_change_effective", "address_change_discarded"]}, "stand": "open"}, sort=[("recorded_at", 1), ("_id", 1)]
    )
    return [
        {
            "art": row["art"].removeprefix("address_change_"),
            "an": row["an"],
            **({"vorname": row["data"]["vorname"]} if "vorname" in row["data"] else {}),
        }
        async for row in rows
    ]


async def carries(database: AsyncDatabase) -> list[tuple[str, str]]:
    """The sign-in accounts the ended changes still owe to carry, from where to where, in the changes' order."""

    return [
        (row["move"]["von"], row["move"]["nach"])
        async for row in database[Collection.ADDRESS_CHANGES].find({"move": {"$type": "object"}}, sort=[("_id", 1)])
    ]


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
