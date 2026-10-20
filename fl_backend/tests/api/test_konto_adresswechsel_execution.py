"""
API · an address change across every record its address holds, driven end to end against the shipped validators

The person starts it on their own account page, an administrator for a person who cannot sign in, and the new mailbox's
confirmation, or the hourly pass at the end of a waiting time, moves every record the replaced address holds as its
person's own in one write. Each lane's link and its refusals are `tests/api/test_spieler_adresswechsel_execution.py`'s
and `tests/api/test_schiedsrichter_adresswechsel_execution.py`'s.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.router import get_anmeldung
from app.api.identitaet.schemas import FLSubjektPayload
from app.api.identitaet.services import FUNKTION_NICHT_GEHALTEN
from app.api.konto.router import delete_adresswechsel, get_adresswechsel, post_adresswechsel, post_adresswechsel_freigabe
from app.api.konto.schemas import FLKontoAdresswechselPayload
from app.api.registrierungen.einwilligung_router import get_bestaetigung_ansicht
from app.api.registrierungen.schemas import FLRegistrierungBestaetigungAnsichtPayload
from app.api.registrierungen.services import REGISTRIERUNG_TOKEN_UNKNOWN, compose_ablehnung_update, erinnerung_is_due
from app.api.schiedsrichter.admin_router import delete_adresswechsel as discard_for_a_referee
from app.api.schiedsrichter.admin_router import post_adresswechsel as start_for_a_referee
from app.api.schiedsrichter.schemas import FLAdresswechselSweepParams, FLSchiedsrichterAdresswechselPayload
from app.api.schiedsrichter.services import SCHIEDSRICHTER_ADRESSE_UNVERAENDERT, SCHIEDSRICHTER_TOKEN_EXPIRED
from app.api.schiedsrichter.sweep_router import sweep_adresswechsel
from app.api.spielbestaetigungen.services import halter_of
from app.api.spieler.admin_router import delete_adresswechsel as discard_for_a_pupil
from app.api.spieler.admin_router import post_adresswechsel as start_for_a_pupil
from app.api.spieler.adresswechsel_router import get_adresswechsel_ansicht, post_adresswechsel_antwort, post_adresswechsel_stopp
from app.api.spieler.schemas import (
    FLSpielerAdresswechselAnsichtPayload,
    FLSpielerAdresswechselAntwortPayload,
    FLSpielerAdresswechselPayload,
    FLSpielerAdresswechselStoppPayload,
)
from app.api.spieler.services import (
    SPIELER_ADRESSE_UNVERAENDERT,
    SPIELER_ADRESSWECHSEL_FELD,
    SPIELER_TOKEN_EXPIRED,
    SPIELER_TOKEN_UNKNOWN,
    build_spieler_filter,
)
from app.core.adressanker import adressanker_id
from app.core.collections import Collection
from app.core.crud import ANCHOR_FIELD, patch_one_in_db
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.core.journal import JOURNAL_TOKEN, parse_line
from app.core.recording import PersonActor, actor_var
from app.core.security import akteur_pseudonym, loeschung_journal_hash
from app.shared.schemas.bounds import ADRESSWECHSEL_WARTEZEIT_TAGE
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

DATABASE_NAME = worker_database("fl_konto_adresswechsel_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Past a step's 24 hours, and past a confirmed change's waiting time.
AFTER_THE_DEADLINE = NOW + timedelta(hours=25)
AFTER_THE_WAIT = NOW + timedelta(days=ADRESSWECHSEL_WARTEZEIT_TAGE, hours=2)

# One person holding a pupil row, a confirmed referee row, seats and registrations, each record in its own spelling.
EMAIL = "lenore.quastenbach@schule.example"
TYPED = "Lenore.Quastenbach@Schule.example"
NEW_EMAIL = "lenore.q@neupost.example.org"
OTHER_EMAIL = "jonte.wirbelauer@schule.example"
FOREIGN_EMAIL = "fremd@anderswo.example"

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


def _registration(registrierung_id: ObjectId, team_id: ObjectId, *, confirmed: bool, token: str) -> dict[str, Any]:
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


async def _seed(database: AsyncDatabase, *, pupil: bool) -> None:
    await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
    await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
    await database[Collection.TEAMS].insert_many(
        [documents.team_document(TEAM_OID, "Zorbanax", "ZO"), documents.team_document(SECOND_TEAM_OID, "Quellbrunn", "QB")]
    )
    pupils = [documents.spieler_document(OTHER_OID, "Jonte", "Wirbelauer", email=OTHER_EMAIL)]
    if pupil:
        pupils.append(documents.spieler_document(SPIELER_OID, "Lenore", "Quastenbach", email=EMAIL, geburtsdatum="2009-05-04"))
    await database[Collection.SPIELER].insert_many(pupils)
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
            _registration(CONFIRMED_REG_OID, TEAM_OID, confirmed=True, token="the-confirmed-registrations-link"),
            _registration(UNCONFIRMED_REG_OID, SECOND_TEAM_OID, confirmed=False, token=UNCONFIRMED_REG_LINK),
        ]
    )


def on_a_person(url: str, body: Any, *, pupil: bool = True) -> Any:
    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await _seed(database, pupil=pupil)
            return await body(database, client)

    return on_the_seed_loop(_run())


async def read(database: AsyncDatabase, identifier: str = EMAIL) -> Any:
    return await get_adresswechsel(
        identifier=identifier,
        records=record_collections(database),
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        sperrliste=ban_list(database),
    )


async def start(
    database: AsyncDatabase, client: AsyncMongoClient, *, email: str = NEW_EMAIL, identifier: str = EMAIL, now: datetime = NOW
) -> Any:
    return await post_adresswechsel(
        identifier=identifier,
        adresswechsel_data=FLKontoAdresswechselPayload(email=email),
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        adressanker_collection=database[Collection.ADRESSANKER],
        db=client,
        config=build_test_config(),
        germany_now=now,
    )


async def approve(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime = NOW) -> Any:
    return await post_adresswechsel_freigabe(
        identifier=EMAIL,
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        db=client,
        germany_now=now,
    )


async def stop_here(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    return await delete_adresswechsel(
        identifier=EMAIL,
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
        sperrliste=ban_list(database),
        db=client,
        config=build_test_config(),
        germany_now=NOW,
    )


async def administrator_starts(database: AsyncDatabase, client: AsyncMongoClient, *, grund: str | None) -> Any:
    return await start_for_a_pupil(
        spieler_id=SPIELER_OID,
        adresswechsel_data=FLSpielerAdresswechselPayload.model_validate({"email": NEW_EMAIL, "grund": grund}),
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        germany_now=NOW,
    )


async def answer(database: AsyncDatabase, client: AsyncMongoClient, token: str, antwort: str = "bestaetigt", *, now: datetime = NOW) -> Any:
    return await post_adresswechsel_antwort(
        antwort_data=FLSpielerAdresswechselAntwortPayload.model_validate({"token": token, "antwort": antwort}),
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
        config=build_test_config(),
        germany_now=now,
    )


async def stop_by_link(database: AsyncDatabase, client: AsyncMongoClient, token: str) -> Any:
    return await post_adresswechsel_stopp(
        stopp_data=FLSpielerAdresswechselStoppPayload(token=token),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        config=build_test_config(),
        germany_now=NOW,
    )


async def view(database: AsyncDatabase, token: str, *, now: datetime = NOW) -> Any:
    return await get_adresswechsel_ansicht(
        ansicht_data=FLSpielerAdresswechselAnsichtPayload(token=token),
        spieler_collection=database[Collection.SPIELER],
        sperrliste=ban_list(database),
        germany_now=now,
    )


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, *, now: datetime) -> Any:
    return await sweep_adresswechsel(
        params=FLAdresswechselSweepParams(),
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
        config=build_test_config(),
        germany_now=now,
    )


async def refused_code(call: Awaitable[Any]) -> str:
    with pytest.raises(WriteRefusalException) as refused:
        await call

    return refused.value.error_code


async def row(database: AsyncDatabase, collection: Collection, row_id: ObjectId) -> Mapping[str, Any]:
    found = await database[collection].find_one({"_id": row_id})
    assert found is not None, f"the {collection} row this case seeded is gone"

    return found


async def holds_an_account_record(database: AsyncDatabase, email: str) -> bool:
    answered = await get_anmeldung(
        anmeldung_data=FLSubjektPayload(email=email),
        records=record_collections(database),
        sperrliste=ban_list(database),
        berechtigungen_collection=database[Collection.BERECHTIGUNGEN],
    )

    return answered.konto


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


class TestTheAccountPagesRead:
    def test_it_offers_the_change_and_names_the_grant_that_stays(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.BERECHTIGUNGEN].insert_one({**grants_for_the_suite()[0], "_id": ObjectId(), "adresse": EMAIL})

            return await read(database), await read(database, OTHER_EMAIL), await read(database, "nobody@schule.example")

        lenore, jonte, nobody = on_a_person(mongo_replica_set_url, body)

        assert (lenore.moeglich, lenore.bleibt_verwaltung, lenore.offen) == (True, True, None)
        assert (jonte.moeglich, jonte.bleibt_verwaltung) == (True, False)
        assert (nobody.moeglich, nobody.offen) == (False, None)

    def test_a_pending_change_is_served_by_its_step_and_never_by_its_address(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await administrator_starts(database, client, grund=None)
            return await read(database)

        seen = on_a_person(mongo_replica_set_url, body)

        assert seen.offen is not None
        assert (seen.offen.weg, seen.offen.wartet_auf) == ("freigabe", "freigabe")
        assert NEW_EMAIL not in seen.model_dump_json()


class TestThePersonsStart:
    def test_the_pupil_row_carries_it_with_both_links(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await start(database, client), await everything(database)

        minted, rows = on_a_person(mongo_replica_set_url, body)

        assert (minted.art, minted.id, minted.email, minted.bisherige_email, minted.vorname) == (
            "spieler",
            SPIELER_OID,
            NEW_EMAIL,
            EMAIL,
            "Lenore",
        )
        block = rows["pupil"][SPIELER_ADRESSWECHSEL_FELD]
        assert (block["weg"], block["token_hash"], block["stopp_hash"]) == ("konto", hash_token(minted.token), hash_token(minted.stopp_token))
        assert (block["freigegeben_am"], block["grund"], block["bestaetigt_am"], block["wirksam_ab"]) == (None, None, None, None)
        assert rows["pupil"]["email"] == EMAIL
        # Nothing else of the person moves at the start.
        assert SPIELER_ADRESSWECHSEL_FELD not in rows["referee"]

    def test_with_no_pupil_row_the_confirmed_referee_row_carries_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await start(database, client), await row(database, Collection.SCHIEDSRICHTER, REFEREE_OID)

        minted, referee = on_a_person(mongo_replica_set_url, body, pupil=False)

        assert (minted.art, minted.id, minted.bisherige_email, minted.vorname) == ("schiedsrichter", REFEREE_OID, TYPED, "Lenore")
        assert referee[SPIELER_ADRESSWECHSEL_FELD]["token_hash"] == hash_token(minted.token)

    @pytest.mark.parametrize("held_by", ["nobody", "the-ban-list", "another-pupil"])
    def test_it_answers_alike_whatever_the_new_address_holds(self, mongo_replica_set_url: str, held_by: str):
        """The confirmation judges the new address; a start judging it would tell the signed-in person what a stranger's address holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if held_by == "the-ban-list":
                await ban_through_the_route(
                    database, client, email=NEW_EMAIL, grund="Falschangaben", von="admin@frankfurtleague.de", today=TODAY
                )
            elif held_by == "another-pupil":
                await database[Collection.SPIELER].update_one({"_id": OTHER_OID}, {"$set": {"email": NEW_EMAIL}})
            minted = await start(database, client)

            return sorted(minted.model_dump()), (await row(database, Collection.SPIELER, SPIELER_OID))[SPIELER_ADRESSWECHSEL_FELD]["email"]

        assert on_a_person(mongo_replica_set_url, body) == (
            ["acknowledged", "art", "bisherige_email", "email", "gueltig_bis", "id", "stopp_token", "token", "vorname"],
            NEW_EMAIL,
        )

    @pytest.mark.parametrize(("pupil", "code"), [(True, SPIELER_ADRESSE_UNVERAENDERT), (False, SCHIEDSRICHTER_ADRESSE_UNVERAENDERT)])
    def test_the_address_signed_in_on_is_refused_in_any_spelling(self, mongo_replica_set_url: str, pupil: bool, code: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await refused_code(start(database, client, email=TYPED.upper()))

        assert on_a_person(mongo_replica_set_url, body, pupil=pupil) == code

    def test_an_address_holding_no_pupil_and_no_confirmed_referee_row_is_refused(self, mongo_replica_set_url: str):
        """A contact seat alone carries no change: the administration corrects a seat in the contacts editor."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].delete_one({"_id": REFEREE_OID})
            return await refused_code(start(database, client))

        assert on_a_person(mongo_replica_set_url, body, pupil=False) == FUNKTION_NICHT_GEHALTEN

    def test_it_ends_an_administrators_change_on_another_row_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str):
        """A sign-in at the address on file proves the mailbox is not lost, so its own start replaces a change asked without it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start_for_a_referee(
                schiedsrichter_id=REFEREE_OID,
                adresswechsel_data=FLSchiedsrichterAdresswechselPayload.model_validate(
                    {"email": FOREIGN_EMAIL, "grund": "Postfach gelöscht, telefonisch bestätigt am 21.10.2026"}
                ),
                records=record_collections(database),
                spieler_collection=database[Collection.SPIELER],
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                sperrliste=ban_list(database),
                adressanker_collection=database[Collection.ADRESSANKER],
                aktionen_collection=database[Collection.AKTIONEN],
                db=client,
                germany_now=NOW,
            )
            minted = await start(database, client)

            return minted, await everything(database), await where_held(database, FOREIGN_EMAIL, folded=True)

        minted, rows, held = on_a_person(mongo_replica_set_url, body)

        assert rows["pupil"][SPIELER_ADRESSWECHSEL_FELD]["token_hash"] == hash_token(minted.token)
        assert SPIELER_ADRESSWECHSEL_FELD not in rows["referee"]
        assert held == {FOREIGN_EMAIL: []}


class TestTheApproval:
    def test_it_mints_the_new_mailbox_its_link_only_now(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund=None)
            before = (await row(database, Collection.SPIELER, SPIELER_OID))[SPIELER_ADRESSWECHSEL_FELD]
            approved = await approve(database, client)

            return started, before, approved, (await row(database, Collection.SPIELER, SPIELER_OID))[SPIELER_ADRESSWECHSEL_FELD]

        started, before, approved, after = on_a_person(mongo_replica_set_url, body)

        assert (started.adresswechsel.weg, started.adresswechsel.token, before["token_hash"]) == ("freigabe", None, None)
        assert (approved.art, approved.id, approved.email) == ("spieler", SPIELER_OID, NEW_EMAIL)
        assert after["token_hash"] == hash_token(approved.token)
        assert after["freigegeben_am"] is not None
        # The address on file's stop link stays the one it was mailed.
        assert after["stopp_hash"] == before["stopp_hash"]

    def test_with_no_change_awaiting_approval_it_answers_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await start(database, client)
            with pytest.raises(DocumentNotFoundException):
                await approve(database, client)
            return "not found"

        assert on_a_person(mongo_replica_set_url, body) == "not found"

    @pytest.mark.parametrize(("pupil", "code"), [(True, SPIELER_TOKEN_EXPIRED), (False, SCHIEDSRICHTER_TOKEN_EXPIRED)])
    def test_past_its_deadline_it_is_refused(self, mongo_replica_set_url: str, pupil: bool, code: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if pupil:
                await administrator_starts(database, client, grund=None)
            else:
                await database[Collection.SCHIEDSRICHTER].update_one(
                    {"_id": REFEREE_OID},
                    {
                        "$set": {
                            SPIELER_ADRESSWECHSEL_FELD: {
                                "email": NEW_EMAIL,
                                "weg": "freigabe",
                                "token_hash": None,
                                "stopp_hash": "e" * 64,
                                "verschickt_am": TODAY,
                                "gueltig_bis": NOW,
                                "freigegeben_am": None,
                                "grund": None,
                                "bestaetigt_am": None,
                                "wirksam_ab": None,
                            }
                        }
                    },
                )
            return await refused_code(approve(database, client, now=AFTER_THE_DEADLINE))

        assert on_a_person(mongo_replica_set_url, body, pupil=pupil) == code


class TestTheStopOnTheAccountPage:
    def test_it_ends_the_change_and_leaves_its_address_nowhere(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            answered = await stop_here(database, client)

            return answered, await refused_code(view(database, minted.token)), await where_held(database, NEW_EMAIL, folded=True)

        answered, link, held = on_a_person(mongo_replica_set_url, body)

        assert answered.offen is None
        assert link == SPIELER_TOKEN_UNKNOWN
        assert held == {NEW_EMAIL: []}

    def test_with_nothing_pending_it_answers_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await stop_here(database, client)
            return "not found"

        assert on_a_person(mongo_replica_set_url, body) == "not found"


class TestTheEffect:
    """The confirmation moves every record the replaced address holds as its person's own, and nothing else."""

    def test_every_own_record_moves_and_every_other_stays(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await everything(database)
            minted = await start(database, client)
            answered = await answer(database, client, minted.token)

            return before, answered, await everything(database)

        before, answered, after = on_a_person(mongo_replica_set_url, body)

        assert answered.mitteilung is not None
        assert (answered.mitteilung.bisherige_email, answered.mitteilung.vorname, answered.wirksam_ab) == (EMAIL, "Lenore", None)
        assert after["pupil"] == {**before["pupil"], "email": NEW_EMAIL}
        # The confirmed referee row moves, its consent link's delivery state with the address it described.
        referee = {**before["referee"], "kontakt": {**before["referee"]["kontakt"], "email": NEW_EMAIL}}
        referee["bestaetigung"] = {key: value for key, value in before["referee"]["bestaetigung"].items() if key != "zustellung"}
        assert after["referee"] == referee
        assert after["unconfirmed referee"] == before["unconfirmed referee"]

        seats = after["season row"]
        assert (seats["kontakte"]["ansprechperson"]["email"], seats["kontakte"]["stellvertretung"]["email"]) == (NEW_EMAIL, EMAIL)
        assert "zustellung" not in seats["bestaetigungen"]["ansprechperson"]
        assert seats["kontakte"]["ansprechperson"]["einwilligung"] == before["season row"]["kontakte"]["ansprechperson"]["einwilligung"]
        # The moved seat's links on the team's match confirmations die; the pass mints its new address fresh ones.
        assert after["confirmation"]["kontakte"]["ansprechperson"] is None
        assert after["confirmation"]["kontakte"]["stellvertretung"] == before["confirmation"]["kontakte"]["stellvertretung"]

        assert after["pending application"]["kontakte"]["trainer"]["email"] == NEW_EMAIL
        assert after["accepted application"]["kontakte"]["ansprechperson"]["email"] == NEW_EMAIL
        assert (after["confirmed registration"]["email"], after["unconfirmed registration"]["email"]) == (NEW_EMAIL, NEW_EMAIL)

    def test_the_old_mailbox_s_registration_link_confirms_nothing_afterwards(self, mongo_replica_set_url: str):
        """An unanswered registration moves too, or its admission makes a second person; its link stayed in the replaced mailbox."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await get_bestaetigung_ansicht(
                ansicht_data=FLRegistrierungBestaetigungAnsichtPayload(token=UNCONFIRMED_REG_LINK),
                registrierungen_collection=database[Collection.REGISTRIERUNGEN],
                teams_collection=database[Collection.TEAMS],
                spieler_collection=database[Collection.SPIELER],
                sperrliste=ban_list(database),
                today=TODAY,
            )
            minted = await start(database, client)
            await answer(database, client, minted.token)

            return before, await refused_code(
                get_bestaetigung_ansicht(
                    ansicht_data=FLRegistrierungBestaetigungAnsichtPayload(token=UNCONFIRMED_REG_LINK),
                    registrierungen_collection=database[Collection.REGISTRIERUNGEN],
                    teams_collection=database[Collection.TEAMS],
                    spieler_collection=database[Collection.SPIELER],
                    sperrliste=ban_list(database),
                    today=TODAY,
                )
            )

        before, after = on_a_person(mongo_replica_set_url, body)

        assert before.zustand == "gueltig"
        assert after == REGISTRIERUNG_TOKEN_UNKNOWN

    def test_one_sign_in_holds_the_person_afterwards(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            await answer(database, client, minted.token)

            return {email: await holds_an_account_record(database, email) for email in (EMAIL, NEW_EMAIL)}

        assert on_a_person(mongo_replica_set_url, body) == {EMAIL: False, NEW_EMAIL: True}


class TestTheWaitingTime:
    """A change an administrator started with a reason waits after its confirmation, and the hourly pass makes it take effect."""

    def test_the_confirmation_moves_nothing_and_the_pass_moves_everything_after_the_wait(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund="Postfach gelöscht, telefonisch bestätigt am 21.10.2026")
            confirmed = await answer(database, client, started.adresswechsel.token)
            waiting = await everything(database)
            early = await sweep(database, client, now=NOW + timedelta(days=1))
            late = await sweep(database, client, now=AFTER_THE_WAIT)

            return started, confirmed, waiting, early, late, await everything(database)

        started, confirmed, waiting, early, late, after = on_a_person(mongo_replica_set_url, body)

        assert started.adresswechsel.weg == "wartezeit"
        assert (confirmed.mitteilung, confirmed.wirksam_ab is not None) == (None, True)
        assert (waiting["pupil"]["email"], waiting["referee"]["kontakt"]["email"]) == (EMAIL, TYPED)
        assert waiting["pupil"][SPIELER_ADRESSWECHSEL_FELD]["token_hash"] is None
        assert (early.entfernt, early.verworfen, early.wirksam) == (0, 0, [])
        assert [(entry.bisherige_email, entry.vorname) for entry in late.wirksam] == [(EMAIL, "Lenore")]
        assert (after["pupil"]["email"], after["referee"]["kontakt"]["email"]) == (NEW_EMAIL, NEW_EMAIL)
        assert SPIELER_ADRESSWECHSEL_FELD not in after["pupil"]

    def test_the_stop_link_ends_it_during_the_wait(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund="Postfach gelöscht, telefonisch bestätigt am 21.10.2026")
            await answer(database, client, started.adresswechsel.token)
            seen = await view(database, started.adresswechsel.stopp_token, now=NOW + timedelta(days=3))
            await stop_by_link(database, client, started.adresswechsel.stopp_token)

            return seen, await sweep(database, client, now=AFTER_THE_WAIT), await everything(database)

        seen, swept, after = on_a_person(mongo_replica_set_url, body)

        assert (seen.ansicht.seite, seen.ansicht.zustand) == ("bisherig", "wartezeit")
        assert swept.wirksam == []
        assert (after["pupil"]["email"], SPIELER_ADRESSWECHSEL_FELD in after["pupil"]) == (EMAIL, False)

    def test_a_ban_entered_during_the_wait_refuses_the_effect(self, mongo_replica_set_url: str):
        """Judged again at the end, as the confirmation judged it: a barred person moves no record off the address the ban keys on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            started = await administrator_starts(database, client, grund="Postfach gelöscht, telefonisch bestätigt am 21.10.2026")
            await answer(database, client, started.adresswechsel.token)
            await ban_through_the_route(database, client, email=EMAIL, grund="Falschangaben", von="admin@frankfurtleague.de", today=TODAY)

            return (
                await sweep(database, client, now=AFTER_THE_WAIT),
                await everything(database),
                await where_held(database, NEW_EMAIL, folded=True),
            )

        swept, after, held = on_a_person(mongo_replica_set_url, body)

        assert (swept.verworfen, swept.wirksam) == (1, [])
        assert (after["pupil"]["email"], SPIELER_ADRESSWECHSEL_FELD in after["pupil"]) == (EMAIL, False)
        assert held == {NEW_EMAIL: []}


GRUND = "Postfach gelöscht, telefonisch bestätigt am 21.10.2026"


async def _discarded_for_the_pupil(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await administrator_starts(database, client, grund=GRUND)
    await discard_for_a_pupil(
        spieler_id=SPIELER_OID,
        spieler_collection=database[Collection.SPIELER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        config=build_test_config(),
        germany_now=NOW,
    )


async def _started_for_the_referee(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await start_for_a_referee(
        schiedsrichter_id=REFEREE_OID,
        adresswechsel_data=FLSchiedsrichterAdresswechselPayload.model_validate({"email": NEW_EMAIL, "grund": GRUND}),
        records=record_collections(database),
        spieler_collection=database[Collection.SPIELER],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        sperrliste=ban_list(database),
        adressanker_collection=database[Collection.ADRESSANKER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        germany_now=NOW,
    )


async def _discarded_for_the_referee(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await _started_for_the_referee(database, client)
    await discard_for_a_referee(
        schiedsrichter_id=REFEREE_OID,
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        config=build_test_config(),
        germany_now=NOW,
    )


async def _replaced_by_the_person(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await _started_for_the_referee(database, client)
    await start(database, client, email=FOREIGN_EMAIL)


async def _replaced_by_an_administrator(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await start(database, client)
    await administrator_starts(database, client, grund=None)


async def _refused_at_its_due_date(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    started = await administrator_starts(database, client, grund=GRUND)
    await answer(database, client, started.adresswechsel.token)
    await ban_through_the_route(database, client, email=EMAIL, grund="Falschangaben", von="admin@frankfurtleague.de", today=TODAY)
    await sweep(database, client, now=AFTER_THE_WAIT)


# Every way a change ends that a restore could undo, and the row whose change it ended.
ENDINGS: Mapping[str, tuple[Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[None]], Collection, ObjectId]] = {
    "an administrator's discard of a pupil's": (_discarded_for_the_pupil, Collection.SPIELER, SPIELER_OID),
    "an administrator's discard of a referee's": (_discarded_for_the_referee, Collection.SCHIEDSRICHTER, REFEREE_OID),
    "the person's start ending an administrator's on another row": (_replaced_by_the_person, Collection.SCHIEDSRICHTER, REFEREE_OID),
    "an administrator's start replacing the person's": (_replaced_by_an_administrator, Collection.SPIELER, SPIELER_OID),
    "the pass refusing it at its due date": (_refused_at_its_due_date, Collection.SPIELER, SPIELER_OID),
}


class TestEveryEndingIsJournalled:
    @pytest.mark.parametrize("ending", ENDINGS)
    def test_it_writes_one_discard_line_naming_the_change_it_ended(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture, ending: str
    ):
        """A restore bringing the change back would leave a confirmed one in its waiting time to take effect with nobody pressing."""
        act, collection, record_id = ENDINGS[ending]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> None:
            with caplog.at_level(logging.INFO):
                await act(database, client)

        on_a_person(mongo_replica_set_url, body)
        lines = [parse_line(record.getMessage()) for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]

        assert [(line.collection, line.record_id, line.person_hash) for line in lines if line and line.art == "adresswechsel_verworfen"] == [
            (collection, record_id, loeschung_journal_hash(NEW_EMAIL, schluessel=build_test_config().sperrliste_schluessel))
        ]


KEY = build_test_config().sperrliste_schluessel
DECLINED_REG_OID = ObjectId("6890a1b2c3d4e5f607850053")
ANSWERED_OID = ObjectId("6890a1b2c3d4e5f607850063")


async def _confirmed_and_moved(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    minted = await start(database, client)
    await answer(database, client, minted.token)


class TestWhatTheEffectLeavesTheErasure:
    """Everything of the person the replaced address keyed, within reach of an erasure of the new one."""

    def test_a_registration_whose_reminder_went_out_is_owed_one_at_the_new_address(self, mongo_replica_set_url: str):
        """The reminder alone mints a moved registration a link, and it is owed once: spent, the row waits for its sweep."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].update_one({"_id": UNCONFIRMED_REG_OID}, {"$set": {"bestaetigung.erinnert_am": TODAY}})
            await _confirmed_and_moved(database, client)
            return await row(database, Collection.REGISTRIERUNGEN, UNCONFIRMED_REG_OID)

        moved = on_a_person(mongo_replica_set_url, body)

        assert (moved["email"], moved["bestaetigung"]["erinnert_am"]) == (NEW_EMAIL, None)
        assert erinnerung_is_due(registrierung_raw=moved, today="2026-04-02")

    def test_a_declined_registration_moves_too(self, mongo_replica_set_url: str):
        """Left behind, it holds the pupil's name and data where an erasure of the new address never looks, until its month is out."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            declined = _registration(DECLINED_REG_OID, SECOND_TEAM_OID, confirmed=False, token="the-declined-registrations-link")
            declined.update(compose_ablehnung_update(von="admin@frankfurtleague.de", grund=None, today=TODAY)["$set"])
            await database[Collection.REGISTRIERUNGEN].insert_one(declined)
            await _confirmed_and_moved(database, client)
            return await row(database, Collection.REGISTRIERUNGEN, DECLINED_REG_OID)

        assert on_a_person(mongo_replica_set_url, body)["email"] == NEW_EMAIL

    def test_the_log_s_pseudonym_and_an_answer_s_holder_digest_follow_the_person(self, mongo_replica_set_url: str):
        """Both are keyed on the address; left on the replaced one, an erasure of the new one never finds them."""

        spiel = documents.spiel_document(
            spiel_id=ObjectId(),
            saison_id=SAISON_ID,
            spiel_nr=2,
            spieltag_id=None,
            datum="2026-04-25",
            uhrzeit="14:00:00",
            team1={"team_id": TEAM_OID},
            team2={"team_id": SECOND_TEAM_OID},
        )
        answered = documents.spielbestaetigung_document(
            spiel,
            partei={"art": "team", "team_id": TEAM_OID},
            _id=ANSWERED_OID,
            angefragt_am="2026-03-30",
            antwort=documents.kontakt_antwort_document("ansprechperson", TYPED, begruendung="Wir sind auf Klassenfahrt"),
        )

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(answered)
            # A write of theirs while signed in, which files a log row under their pseudonym holding the answer's image.
            token = actor_var.set(PersonActor(pseudonym=akteur_pseudonym(EMAIL, schluessel=KEY), funktion="kontakt"))
            try:
                await patch_one_in_db(
                    collection=database[Collection.SPIELBESTAETIGUNGEN],
                    db_filter={"_id": ANSWERED_OID},
                    update={"$set": {"angefragt_am": "2026-03-31"}},
                    return_document=ReturnDocument.BEFORE,
                )
            finally:
                actor_var.reset(token)
            await _confirmed_and_moved(database, client)

            log = database[Collection.AKTIONEN]
            return (
                (await row(database, Collection.SPIELBESTAETIGUNGEN, ANSWERED_OID))["antwort"],
                {
                    address: (
                        await log.count_documents({"actor.pseudonym": akteur_pseudonym(address, schluessel=KEY)}),
                        await log.count_documents({"before.antwort.von.halter": halter_of(address, schluessel=KEY)}),
                    )
                    for address in (EMAIL, NEW_EMAIL)
                },
            )

        antwort, log = on_a_person(mongo_replica_set_url, body)

        assert (antwort["von"]["halter"], antwort["begruendung"]) == (halter_of(NEW_EMAIL, schluessel=KEY), "Wir sind auf Klassenfahrt")
        assert log == {EMAIL: (0, 0), NEW_EMAIL: (1, 1)}

    def test_it_anchors_the_address_it_replaces(self, mongo_replica_set_url: str):
        """A registration submitted there while the effect runs meets it on the anchor, so the retry moves it rather than leaving it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            minted = await start(database, client)
            anchor = {"_id": adressanker_id(EMAIL, schluessel=KEY)}
            before = await database[Collection.ADRESSANKER].find_one(anchor)
            await answer(database, client, minted.token)
            after = await database[Collection.ADRESSANKER].find_one(anchor)
            return (before or {}).get(ANCHOR_FIELD, 0), (after or {}).get(ANCHOR_FIELD, 0)

        before, after = on_a_person(mongo_replica_set_url, body)

        assert after == before + 1


class _HeldAfterItsRead(HeldCollection):
    """A start held after its first read of its carrier until a rival start has committed, counting its attempts."""

    MISSED = "the start answered without reading its carrier, so nothing held it across the rival's commit"

    def __init__(self, collection: Any, committed: asyncio.Event, *, read: Mapping[str, Any]) -> None:
        super().__init__(collection, committed)
        self._read = read
        self.reads = 0

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._collection.find_one(*args, **kwargs)
        if kwargs.get("filter", args[0] if args else {}) == self._read:
            self.reads += 1
            await self.hold()

        return found


class TestTwoStartsAtOnce:
    def test_starts_on_two_rows_of_one_address_leave_it_one_change(self, mongo_replica_set_url: str):
        """Disjoint rows share no document but the address's anchor, so the start committing second runs again and ends the first's."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            committed = asyncio.Event()
            held = _HeldAfterItsRead(database[Collection.SPIELER], committed, read=build_spieler_filter(SPIELER_OID))
            pupils = start_for_a_pupil(
                spieler_id=SPIELER_OID,
                # Another new address than the rival's, so the two meet on the address on file's anchor alone.
                adresswechsel_data=FLSpielerAdresswechselPayload.model_validate({"email": FOREIGN_EMAIL, "grund": GRUND}),
                records=record_collections(database),
                spieler_collection=held,
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                sperrliste=ban_list(database),
                adressanker_collection=database[Collection.ADRESSANKER],
                aktionen_collection=database[Collection.AKTIONEN],
                db=client,
                germany_now=NOW,
            )
            task = asyncio.ensure_future(pupils)
            await held.until_held(task)
            try:
                await _started_for_the_referee(database, client)
            except BaseException:
                await held.abandon(task)
                raise
            committed.set()
            await task

            rows = await everything(database)
            return held.reads, [name for name in ("pupil", "referee") if SPIELER_ADRESSWECHSEL_FELD in rows[name]]

        reads, carrying = on_a_person(mongo_replica_set_url, body)

        assert reads == 2
        assert carrying == ["pupil"]
