"""
API · a contact seat an administrator types into a team's season row is mailed its own confirmation link

The contacts save mints one link per person it newly seats, the per-seat re-send mints one for any
seat still unconfirmed, and the application's two confirmation operations answer the link on the
season row. Driven against the shipped validators, with the ban list asked at the mint and at the
press as the application's links ask it.
"""

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from http import HTTPStatus
from typing import Any, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.einwilligung_router import get_einwilligung_ansicht, post_einwilligung
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAnsichtPayload, FLBewerbungEinwilligungAntwortPayload
from app.api.bewerbungen.services import (
    BEWERBUNG_EINWILLIGUNG_GESPERRT,
    BEWERBUNG_SEAT_ALREADY_ANSWERED,
    BEWERBUNG_TOKEN_UNKNOWN,
    KONTAKT_LINK_ABGELAUFEN,
    KONTAKT_SAISON_VORBEI,
    SEAT_MIN_AGE_YEARS,
    bestaetigungsfrist_from,
    compose_bestaetigungen,
    hash_token,
)
from app.api.einwilligung.services import FASSUNG_UNZULAESSIG
from app.api.identitaet.crud import funktionen_of
from app.api.kontakte.admin_router import erase_kontaktperson
from app.api.kontakte.schemas import FLKontaktErasurePayload
from app.api.saisons.admin_router import activate_saison
from app.api.teams.admin_router import einladen_kontakt, patch_saison_team_kontakte, replace_saison_team
from app.api.teams.schemas import FLPatchSaisonTeamKontaktePayload, FLReplaceSaisonTeamPayload, kontakte_stand_of
from app.api.teams.services import (
    KONTAKT_SITZ_GESPERRT,
    KONTAKT_SITZ_OHNE_BESTAETIGUNG,
    KONTAKT_ZEILE_OHNE_SAISON,
    compose_kontakt_bestaetigung,
)
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.db import get_sperrliste_collection
from app.core.exceptions import ActorConfirmationRequiredException, DocumentNotFoundException, WriteRefusalException
from app.core.security import CONFIRMATION_REQUIRED, STEP_UP_WINDOW_S, get_step_up_check
from app.main import create_app
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from tests import documents
from tests.actor_tokens import FRESH_STEP_UP_CHECK, SignedActor, verified_actor
from tests.app_client import app_client
from tests.bans import ban_list, ban_through_the_route
from tests.config import ADMIN_KEY, ADMINISTRATORS, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.isolation import InterleavedCollection
from tests.records import record_collections
from tests.whole_database import every_collection_as_text
from tests.worker import worker_database

from .conftest import config_for

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_kontakt_bestaetigung_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
FRIST = bestaetigungsfrist_from(today=TODAY)
# The day after the deadline a link minted on `TODAY` carries.
AFTER_THE_DEADLINE = "2026-04-16"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

TEAM_OID = ObjectId("6890a1b2c3d4e5f607a50001")
ROW_OID = ObjectId("6890a1b2c3d4e5f607a50011")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607a50002")
OTHER_ROW_OID = ObjectId("6890a1b2c3d4e5f607a50012")
INCOMING_TEAM_OID = ObjectId("6890a1b2c3d4e5f607a50003")

TEAM_NAME = "Adler"
AN_ADULTS_BIRTHDATE = "1984-05-09"
ADMIN = "admin@frankfurtleague.de"

# Past the step-up window by a minute.
STALE_STEP_UP_CHECK = get_step_up_check(verified_actor("admin@example.com", signed_in_before_s=STEP_UP_WINDOW_S + 60))

TELEFON = {"Ida": "+4917010000001", "Jonas": "+4917010000002", "Klara": "+4917010000003", "Lea": "+4917010000004"}

SEATS = ("trainer", "ansprechperson", "stellvertretung")


def person(vorname: str) -> dict[str, Any]:
    """One person as the editor sends them."""

    return {
        "vorname": vorname,
        "nachname": "Musterfrau",
        "email": f"{vorname.lower()}@example.com",
        "telefon": TELEFON[vorname],
        "einwilligung": {"umfang": "kontaktdaten", "text_version": LAUFENDE_FASSUNGEN["bewerbung"], "datum": "2026-03-01"},
    }


def stored(vorname: str, *, bestaetigt_am: str | None = None) -> dict[str, Any]:
    """The same person as a row holds them, confirmed or entered administratively."""

    sent = person(vorname)

    return {
        **sent,
        "geburtsdatum": None if bestaetigt_am is None else AN_ADULTS_BIRTHDATE,
        "einwilligung": {
            **sent["einwilligung"],
            "erfasst_von": "administrativ" if bestaetigt_am is None else "person",
            "bestaetigt_am": bestaetigt_am,
        },
    }


THREE = {"trainer": person("Ida"), "ansprechperson": person("Jonas"), "stellvertretung": person("Klara"), "trainer_ist_zugleich": None}
# The Trainer holding the Stellvertretung's seat too: one person, so one link.
PAIRED = {
    "trainer": person("Ida"),
    "ansprechperson": person("Jonas"),
    "stellvertretung": person("Ida"),
    "trainer_ist_zugleich": "stellvertretung",
}

# Seats stored before links were minted: entered administratively, holding no link at all.
STORED_UNCONFIRMED = {
    "trainer": stored("Ida"),
    "ansprechperson": stored("Jonas"),
    "stellvertretung": stored("Klara"),
    "trainer_ist_zugleich": None,
}


def junction(
    row_id: ObjectId, team_id: ObjectId, kontakte: Any, *, name: str = TEAM_NAME, shorthand: str = "AD", **fields: Any
) -> dict[str, Any]:
    return {"_id": row_id, **documents.saison_team_document(SAISON_ID, team_id, name, shorthand, kontakte=kontakte, **fields)}


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(
    url: str,
    body: Body,
    *,
    kontakte: Any = None,
    rows: list[dict[str, Any]] | None = None,
    saison_status: str = "active",
    row_fields: Mapping[str, Any] | None = None,
    mutates_schema: bool = False,
) -> Any:
    """The season, its club, and the club's row holding `kontakte`; `rows` seeded FIRST, so a filter missing the row reaches them."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            # A ban entered through its route re-judges its actor's grant (`docs/backend/spec.md :: I450`).
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, saison_status))
            for team_id, name, shorthand in ((TEAM_OID, TEAM_NAME, "AD"), (OTHER_TEAM_OID, "Falken", "FA"), (INCOMING_TEAM_OID, "Eulen", "EU")):
                await database[Collection.TEAMS].insert_one(
                    documents.team_document(team_id, name, shorthand, website_url=None, schulform="gymnasium_g9")
                )
            for row in rows or []:
                await database[Collection.SAISON_TEAMS].insert_one(row)
            await database[Collection.SAISON_TEAMS].insert_one(junction(ROW_OID, TEAM_OID, kontakte, **(row_fields or {})))

            return await body(database, client)

    return on_the_seed_loop(_run())


async def save(
    database: AsyncDatabase,
    kontakte: Any,
    *,
    step_up: Any = FRESH_STEP_UP_CHECK,
    saison_teams: Any = None,
    today: str = TODAY,
) -> Any:
    """`PATCH .../kontakte`, composed against whatever the row holds now."""

    row = await database[Collection.SAISON_TEAMS].find_one({"_id": ROW_OID})
    assert row is not None

    return await patch_saison_team_kontakte(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        kontakte_data=FLPatchSaisonTeamKontaktePayload.model_validate(
            {"kontakte": kontakte, "kontakte_stand": kontakte_stand_of(row.get("kontakte"))}
        ),
        saison_teams_collection=database[Collection.SAISON_TEAMS] if saison_teams is None else saison_teams,
        saisons_collection=database[Collection.SAISONS],
        sperrliste=ban_list(database),
        db=database.client,
        refuse_unconfirmed=step_up,
        today=today,
    )


async def resend(database: AsyncDatabase, seat: str, *, today: str = TODAY) -> Any:
    return await einladen_kontakt(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        seat=seat,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        sperrliste=ban_list(database),
        db=database.client,
        today=today,
    )


async def ansicht(database: AsyncDatabase, token: str, *, today: str = TODAY) -> Any:
    return await get_einwilligung_ansicht(
        ansicht_data=FLBewerbungEinwilligungAnsichtPayload(token=token),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        sperrliste=ban_list(database),
        today=today,
    )


# A seat the contacts editor entered opens the season row's page; an application's own seat the applicant's.
SAISON_SEITE = LAUFENDE_FASSUNGEN["bestaetigung_kontakt_saison"]
BEWERBER_SEITE = LAUFENDE_FASSUNGEN["bestaetigung_kontakt"]


async def answer(
    database: AsyncDatabase,
    token: str,
    *,
    antwort: str = "erteilt",
    today: str = TODAY,
    text_version: str = SAISON_SEITE,
    medien: bool = False,
    saisons: Any = None,
) -> Any:
    erteilt = antwort == "erteilt"
    body = {
        "token": token,
        "antwort": antwort,
        "geburtsdatum": AN_ADULTS_BIRTHDATE if erteilt else None,
        "whatsapp": erteilt,
        "medien": medien,
        "text_version": text_version,
    }

    return await post_einwilligung(
        antwort_data=FLBewerbungEinwilligungAntwortPayload.model_validate(body),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS] if saisons is None else saisons,
        aktionen_collection=database[Collection.AKTIONEN],
        sperrliste=ban_list(database),
        db=database.client,
        today=today,
        germany_now=NOW,
    )


async def ban(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> Any:
    return await ban_through_the_route(database, client, email=email, grund="Wiederholte Falschangaben", von=ADMIN, today=TODAY)


class BanListRunningARivalAfterItsRead(InterleavedCollection):
    """The rival lands once the save holds its ban read inside the transaction, before the save writes.

    The actor check reads the same list outside it, where a rival is a ban committed before the save began.
    """

    def find(self, *args: Any, **kwargs: Any) -> Any:
        cursor = self._collection.find(*args, **kwargs)

        return cursor if kwargs.get("session") is None else CursorRunningARivalAfterItsRead(cursor, self)


class CursorRunningARivalAfterItsRead:
    def __init__(self, inner: Any, hook: InterleavedCollection) -> None:
        self._inner = inner
        self._hook = hook

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    def limit(self, *args: Any, **kwargs: Any) -> CursorRunningARivalAfterItsRead:
        self._inner = self._inner.limit(*args, **kwargs)

        return self

    async def to_list(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._inner.to_list(*args, **kwargs)
        await self._hook.run_the_rival()

        return found


async def _nothing() -> None:
    return None


def save_racing_a_ban(url: str, *, rival: bool) -> tuple[int, str | None, int]:
    """`THREE` saved by one administrator, Ida banned inside it by another where `rival` is set.

    Answers status, code and arrivals at the ban read.
    Through the served application: a handler called directly binds no judge, and commits Ida's seat.
    """

    async def seeded(_: AsyncDatabase, __: AsyncMongoClient) -> None:
        return None

    on_a_league(url, seeded)
    served: FastAPI = create_app(config_for(DATABASE_NAME))

    async def body() -> tuple[int, str | None, int]:
        async with app_client(url, app=served, now=NOW) as http:
            database = served.state.db_client[DATABASE_NAME]
            racing: list[BanListRunningARivalAfterItsRead] = []

            # Another administrator's request, so its own judge anchors its own grant: run as the saver, the
            # ban would conflict on the saver's grant row whatever the ban's list judgement writes.
            async def ban_ida() -> None:
                banned = await http.post(
                    f"/api/v{API_VERSION}/sperrliste",
                    json={"email": "ida@example.com", "grund": "Wiederholte Falschangaben"},
                    headers=SignedActor(ADMINISTRATORS[0], ADMIN_KEY),
                )
                assert banned.status_code == HTTPStatus.CREATED, banned.text

            async def wrapped_ban_list() -> AsyncCollection:
                # The save's request alone: the rival's own request reads the list unwrapped.
                if racing:
                    return database[Collection.SPERRLISTE]

                interleaved = BanListRunningARivalAfterItsRead(database[Collection.SPERRLISTE], ban_ida if rival else _nothing)
                racing.append(interleaved)
                # Not a subclass of the driver's collection, which the driver builds off a database handle.
                return cast(AsyncCollection, interleaved)

            # Only the request's ban list: the judge reads its own.
            served.dependency_overrides[get_sperrliste_collection] = wrapped_ban_list
            answered = await http.patch(
                f"/api/v{API_VERSION}/teams/{TEAM_OID}/saisons/{SAISON_ID}/kontakte",
                json={"kontakte": THREE, "kontakte_stand": kontakte_stand_of(None)},
                headers=SignedActor(ADMINISTRATORS[2], ADMIN_KEY),
            )

        return answered.status_code, answered.json().get("error_code"), sum(collection.passes for collection in racing)

    return asyncio.run(body())


async def row_now(database: AsyncDatabase, row_id: ObjectId = ROW_OID) -> dict[str, Any]:
    found = await database[Collection.SAISON_TEAMS].find_one({"_id": row_id})
    assert found is not None, "the seeded row is gone"

    return found


async def refused(call: Awaitable[Any]) -> str:
    with pytest.raises((WriteRefusalException, ActorConfirmationRequiredException)) as refusal:
        await call

    return refusal.value.error_code


async def seats_of(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> list[tuple[str, str]]:
    async with client.start_session() as session:
        subjekt = await funktionen_of(email, record_collections(database), session=session)

    return [(sitz.saison_id, sitz.rolle) for sitz in subjekt.sitze]


class TestTheSaveMintsForEachPersonItNewlySeats:
    def test_a_new_person_on_a_seat_is_minted_one_link_stored_as_its_hash_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, {**THREE, "ansprechperson": None, "stellvertretung": None})

            return response, await row_now(database), await every_collection_as_text(database)

        response, row, everything = on_a_league(mongo_replica_set_url, body)

        assert [(mint.rollen, mint.email, mint.frist, mint.vorname, mint.schule, mint.zeile) for mint in response.bestaetigungen] == [
            (["trainer"], "ida@example.com", FRIST, "Ida", TEAM_NAME, "offen")
        ]
        assert response.saison_team_id == ROW_OID
        token = response.bestaetigungen[0].token
        assert row["bestaetigungen"] == {
            "trainer": {"token_hash": hash_token(token), "verschickt_am": TODAY, "frist": FRIST, "abgelehnt_am": None},
            "ansprechperson": None,
            "stellvertretung": None,
        }
        assert token not in everything, "the raw link is stored somewhere, so a read of the database recovers it"

    def test_three_new_people_are_minted_three_links_each_opening_its_own_seat(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)

            return response, [await ansicht(database, mint.token) for mint in response.bestaetigungen]

        response, views = on_a_league(mongo_replica_set_url, body)

        assert [mint.rollen for mint in response.bestaetigungen] == [["trainer"], ["ansprechperson"], ["stellvertretung"]]
        assert [(view.quelle, view.rolle, view.vorname, view.zustand, view.schule) for view in views] == [
            ("saison", "trainer", "Ida", "gueltig", TEAM_NAME),
            ("saison", "ansprechperson", "Jonas", "gueltig", TEAM_NAME),
            ("saison", "stellvertretung", "Klara", "gueltig", TEAM_NAME),
        ]

    def test_a_trainer_holding_a_second_seat_is_minted_one_link_for_both(self, mongo_replica_set_url: str):
        """One link per person: two would leave the first answering for a seat the second has already answered."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, PAIRED)

            return response, await row_now(database), await ansicht(database, response.bestaetigungen[0].token)

        response, row, view = on_a_league(mongo_replica_set_url, body)

        assert [mint.rollen for mint in response.bestaetigungen] == [["trainer", "stellvertretung"], ["ansprechperson"]]
        assert row["bestaetigungen"]["trainer"] == row["bestaetigungen"]["stellvertretung"]
        assert (view.rolle, view.zugleich_rolle) == ("trainer", "stellvertretung")

    def test_re_saving_the_same_confirmed_person_mints_nothing_and_keeps_the_stamp(self, mongo_replica_set_url: str):
        confirmed = {**STORED_UNCONFIRMED, "trainer": stored("Ida", bestaetigt_am="2026-03-20")}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, {**THREE, "trainer": {**person("Ida"), "telefon": "+4917099999999"}})

            return response, await row_now(database)

        response, row = on_a_league(mongo_replica_set_url, body, kontakte=confirmed)

        assert response.bestaetigungen == []
        assert row["kontakte"]["trainer"]["telefon"] == "+4917099999999", "the edit did not land, so this case proves nothing"
        assert row["kontakte"]["trainer"]["einwilligung"]["bestaetigt_am"] == "2026-03-20"

    def test_re_saving_a_person_whose_link_is_out_keeps_that_link(self, mongo_replica_set_url: str):
        """A second save of the same people mails nobody twice: the link already in their inbox stays the one that works."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            again = await save(database, THREE)

            return first, again, await ansicht(database, first.bestaetigungen[0].token)

        first, again, view = on_a_league(mongo_replica_set_url, body)

        assert len(first.bestaetigungen) == 3
        assert again.bestaetigungen == []
        assert view.zustand == "gueltig"

    def test_a_seat_handed_to_another_person_leaves_the_first_link_opening_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            handed = await save(database, {**THREE, "ansprechperson": person("Lea")})
            old_token = next(mint.token for mint in first.bestaetigungen if mint.rollen == ["ansprechperson"])

            with pytest.raises(WriteRefusalException) as refusal:
                await ansicht(database, old_token)

            return handed, refusal.value.error_code, await ansicht(database, handed.bestaetigungen[0].token)

        handed, code, view = on_a_league(mongo_replica_set_url, body)

        assert [mint.rollen for mint in handed.bestaetigungen] == [["ansprechperson"]]
        assert code == BEWERBUNG_TOKEN_UNKNOWN
        assert (view.rolle, view.vorname) == ("ansprechperson", "Lea")

    def test_a_seat_the_save_empties_loses_its_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            await save(database, {**THREE, "stellvertretung": None})

            return await refused(ansicht(database, first.bestaetigungen[2].token)), await row_now(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == BEWERBUNG_TOKEN_UNKNOWN
        assert row["bestaetigungen"]["stellvertretung"] is None


class TestABarredAddressIsRefused:
    """A person the league may not mail would learn nothing of an entry, so no save seats one, as no reseat of an application does."""

    def test_a_save_seating_a_barred_address_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document("jonas@example.com", bis="2030"))
            before = await row_now(database)

            return await refused(save(database, THREE)), before, await row_now(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == KONTAKT_SITZ_GESPERRT
        assert after == before

    def test_a_save_handing_a_seat_to_a_barred_address_is_refused_and_its_link_still_opens(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            await ban(database, client, "lea@example.com")
            code = await refused(save(database, {**THREE, "ansprechperson": person("Lea")}))
            old_token = next(mint.token for mint in first.bestaetigungen if mint.rollen == ["ansprechperson"])

            return code, await ansicht(database, old_token), await row_now(database)

        code, view, row = on_a_league(mongo_replica_set_url, body)

        assert code == KONTAKT_SITZ_GESPERRT
        assert (view.zustand, view.rolle) == ("gueltig", "ansprechperson")
        assert row["kontakte"]["ansprechperson"]["email"] == "jonas@example.com"

    def test_a_kept_person_whose_address_was_barred_after_their_seating_is_not_refused(self, mongo_replica_set_url: str):
        """The control: the save seats nobody new, and the ban is the confirmation press's to answer (`docs/backend/spec.md :: I505`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save(database, THREE)
            await ban(database, client, "jonas@example.com")

            return await save(database, {**THREE, "stellvertretung": None}), await row_now(database)

        response, row = on_a_league(mongo_replica_set_url, body)

        assert response.bestaetigungen == []
        assert (row["kontakte"]["ansprechperson"]["email"], row["kontakte"]["stellvertretung"]) == ("jonas@example.com", None)

    def test_a_ban_committing_after_the_saves_ban_read_makes_it_retry_and_refuse(self, mongo_replica_set_url: str):
        """The save's own read is a snapshot taken before the ban, so what refuses it is the retry its judge's anchor forces."""

        status, code, arrivals = save_racing_a_ban(mongo_replica_set_url, rival=True)

        assert (status, code) == (HTTPStatus.CONFLICT, KONTAKT_SITZ_GESPERRT)
        assert arrivals == 2, "one arrival is a rival that landed outside the save, or a save that committed without a retry"

    def test_the_same_save_with_no_ban_seats_everyone(self, mongo_replica_set_url: str):
        """The control: a refusal above that the race did not cause would refuse here too."""

        status, code, arrivals = save_racing_a_ban(mongo_replica_set_url, rival=False)

        assert (status, code, arrivals) == (HTTPStatus.OK, None, 1)

    def test_a_resend_to_a_barred_address_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document("ida@example.com", bis="2030"))
            before = await row_now(database)

            return await refused(resend(database, "trainer")), before, await row_now(database)

        code, before, after = on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED)

        assert code == KONTAKT_SITZ_GESPERRT
        assert after == before

    def test_a_resend_to_an_address_the_ban_list_does_not_hold_still_mints(self, mongo_replica_set_url: str):
        """The control: a check refusing every re-send would pass the case above."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document("jonas@example.com", bis="2030"))

            return await resend(database, "trainer")

        assert on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED).bestaetigung.rollen == ["trainer"]


class TestTheResend:
    def test_a_seat_stored_before_links_existed_is_sent_its_first(self, mongo_replica_set_url: str):
        """The seats entered before this flow: never newly written, so the re-send is the one way their person is ever asked."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await resend(database, "ansprechperson")

            return response, await row_now(database), await ansicht(database, response.bestaetigung.token)

        response, row, view = on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED)

        assert (response.bestaetigung.rollen, response.bestaetigung.email, response.bestaetigung.frist) == (
            ["ansprechperson"],
            "jonas@example.com",
            FRIST,
        )
        assert (response.bestaetigung.vorname, response.bestaetigung.schule, response.saison_team_id) == ("Jonas", TEAM_NAME, ROW_OID)
        assert (row["bestaetigungen"]["trainer"], row["bestaetigungen"]["stellvertretung"]) == (None, None)
        assert (view.rolle, view.zustand) == ("ansprechperson", "gueltig")

    def test_a_resend_replaces_the_link_and_restarts_the_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            again = await resend(database, "trainer", today="2026-04-05")

            return first, again, await refused(ansicht(database, first.bestaetigungen[0].token)), await row_now(database)

        first, again, code, row = on_a_league(mongo_replica_set_url, body)

        assert code == BEWERBUNG_TOKEN_UNKNOWN
        assert row["bestaetigungen"]["trainer"]["frist"] == bestaetigungsfrist_from(today="2026-04-05") == again.bestaetigung.frist
        # The two seats the re-send did not name keep the links already in their inboxes.
        assert row["bestaetigungen"]["ansprechperson"]["token_hash"] == hash_token(first.bestaetigungen[1].token)

    def test_a_resend_for_a_trainer_holding_a_second_seat_answers_both(self, mongo_replica_set_url: str):
        paired = {**STORED_UNCONFIRMED, "stellvertretung": stored("Ida"), "trainer_ist_zugleich": "stellvertretung"}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await resend(database, "stellvertretung")

            return response, await row_now(database)

        response, row = on_a_league(mongo_replica_set_url, body, kontakte=paired)

        assert response.bestaetigung.rollen == ["trainer", "stellvertretung"]
        assert row["bestaetigungen"]["trainer"] == row["bestaetigungen"]["stellvertretung"] is not None

    @pytest.mark.parametrize(
        "kontakte",
        [
            pytest.param({**STORED_UNCONFIRMED, "trainer": stored("Ida", bestaetigt_am="2026-03-20")}, id="a seat its person has confirmed"),
            pytest.param({**STORED_UNCONFIRMED, "trainer": None}, id="a seat holding nobody"),
        ],
    )
    def test_a_seat_with_nothing_left_to_confirm_is_refused_and_writes_nothing(self, mongo_replica_set_url: str, kontakte: dict[str, Any]):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            before = await row_now(database)

            return await refused(resend(database, "trainer")), before, await row_now(database)

        code, before, after = on_a_league(mongo_replica_set_url, body, kontakte=kontakte)

        assert code == KONTAKT_SITZ_OHNE_BESTAETIGUNG
        assert after == before

    def test_a_path_naming_no_seat_is_a_404(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await resend(database, "kapitaen")

            return None

        on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED)


class TestTheLinkConfirms:
    def test_confirming_stamps_the_seat_and_the_seat_then_grants_its_panel(self, mongo_replica_set_url: str):
        """`funktionen_of` answers a seat only once its own person has confirmed it, so before the press it answers nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            before = await seats_of(database, client, "jonas@example.com")
            answered = await answer(database, response.bestaetigungen[1].token)

            return before, answered, await row_now(database), await seats_of(database, client, "jonas@example.com")

        before, answered, row, after = on_a_league(mongo_replica_set_url, body)

        assert before == []
        assert (answered.quelle, answered.ergebnis, answered.geburtsdatum, answered.whatsapp) == (
            "saison",
            "bestaetigt",
            AN_ADULTS_BIRTHDATE,
            True,
        )
        seat = row["kontakte"]["ansprechperson"]
        assert (seat["geburtsdatum"], seat["einwilligung"]["bestaetigt_am"], seat["einwilligung"].get("erfasst_von")) == (
            AN_ADULTS_BIRTHDATE,
            TODAY,
            None,
        )
        assert seat["einwilligung"]["umfang"] == "kontaktdaten_whatsapp"
        assert row["kontakte"]["trainer"]["einwilligung"]["bestaetigt_am"] is None, "the press reached a seat its link does not open"
        assert after == [(SAISON_ID, "ansprechperson")]

    def test_a_trainer_holding_a_second_seat_confirms_both_with_one_press(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, PAIRED)
            await answer(database, response.bestaetigungen[0].token)

            return await row_now(database)

        row = on_a_league(mongo_replica_set_url, body)

        assert [row["kontakte"][seat]["einwilligung"]["bestaetigt_am"] for seat in SEATS] == [TODAY, None, TODAY]

    @pytest.mark.parametrize(
        ("confirmed", "newly"),
        [
            pytest.param("trainer", "stellvertretung", id="the Trainer confirmed, the seat they come to hold not"),
            pytest.param("stellvertretung", "trainer", id="the seat they also hold confirmed, the Trainer's not"),
        ],
    )
    def test_a_half_confirmed_pair_confirms_only_the_seat_its_link_was_minted_for(self, mongo_replica_set_url: str, confirmed: str, newly: str):
        """The earlier answer stands: its stamp, its date and its scope are the person's own, given on another day."""

        before = {**STORED_UNCONFIRMED, confirmed: stored("Ida", bestaetigt_am="2026-03-20"), newly: stored("Lea")}
        spent = compose_kontakt_bestaetigung(token_hash=hash_token("the-link-already-answered"), today="2026-03-10")

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, PAIRED)
            await answer(database, response.bestaetigungen[0].token)

            return response, await row_now(database)

        response, row = on_a_league(
            mongo_replica_set_url,
            body,
            kontakte=before,
            row_fields={"bestaetigungen": {seat: spent if seat == confirmed else None for seat in SEATS}},
        )

        assert [mint.rollen for mint in response.bestaetigungen] == [[newly]]
        held = row["kontakte"][confirmed]
        assert (held["einwilligung"]["bestaetigt_am"], held["einwilligung"]["umfang"]) == ("2026-03-20", "kontaktdaten")
        assert row["kontakte"][newly]["einwilligung"]["bestaetigt_am"] == TODAY, "the press confirmed nothing, so this case proves nothing"

    @pytest.mark.parametrize(
        ("confirmed", "newly"),
        [
            pytest.param("trainer", "stellvertretung", id="the Trainer confirmed, the seat they come to hold not"),
            pytest.param("stellvertretung", "trainer", id="the seat they also hold confirmed, the Trainer's not"),
        ],
    )
    def test_a_half_confirmed_pair_s_view_offers_only_the_seat_its_link_was_minted_for(
        self, mongo_replica_set_url: str, confirmed: str, newly: str
    ):
        """The page names what the press writes: no second seat, and the floor of the one seat the link answers."""

        before = {**STORED_UNCONFIRMED, confirmed: stored("Ida", bestaetigt_am="2026-03-20"), newly: stored("Lea")}
        spent = compose_kontakt_bestaetigung(token_hash=hash_token("the-link-already-answered"), today="2026-03-10")

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, PAIRED)

            return await ansicht(database, response.bestaetigungen[0].token)

        view = on_a_league(
            mongo_replica_set_url,
            body,
            kontakte=before,
            row_fields={"bestaetigungen": {seat: spent if seat == confirmed else None for seat in SEATS}},
        )

        assert (view.rolle, view.zugleich_rolle, view.mindestalter) == (newly, None, SEAT_MIN_AGE_YEARS[newly])

    def test_a_widerspruch_empties_the_seat_records_it_and_redacts_the_rows_log(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            token = response.bestaetigungen[2].token
            answered = await answer(database, token, antwort="abgelehnt")
            log = (
                await database[Collection.AKTIONEN]
                .find({"collection": str(Collection.SAISON_TEAMS), "document_id": ROW_OID})
                .to_list(length=None)
            )

            return answered, await row_now(database), await ansicht(database, token), log

        answered, row, view, log = on_a_league(mongo_replica_set_url, body)

        assert (answered.quelle, answered.ergebnis, answered.geburtsdatum) == ("saison", "abgelehnt", None)
        assert row["kontakte"]["stellvertretung"] is None
        assert row["bestaetigungen"]["stellvertretung"]["abgelehnt_am"] == TODAY
        assert view.zustand == "abgelehnt"
        assert log, "nothing was logged, so the redaction proves nothing"
        assert all(entry["before"] is None and entry.get("redacted_at") for entry in log)

    def test_a_second_answer_on_the_link_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await answer(database, response.bestaetigungen[0].token)

            return await refused(answer(database, response.bestaetigungen[0].token))

        assert on_a_league(mongo_replica_set_url, body) == BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_a_link_opens_its_own_row_with_another_rows_link_seeded_first(self, mongo_replica_set_url: str):
        """The other club's row comes first in natural order, so a lookup that does not match on the hash lands there."""

        other = junction(
            OTHER_ROW_OID,
            OTHER_TEAM_OID,
            STORED_UNCONFIRMED,
            bestaetigungen={
                "trainer": compose_kontakt_bestaetigung(token_hash=hash_token("the-other-clubs-link"), today=TODAY),
                "ansprechperson": None,
                "stellvertretung": None,
            },
            name="Falken",
            shorthand="FA",
        )

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            view = await ansicht(database, response.bestaetigungen[0].token)
            await answer(database, response.bestaetigungen[0].token)

            return view, await row_now(database), await row_now(database, OTHER_ROW_OID)

        view, row, other_row = on_a_league(mongo_replica_set_url, body, rows=[other])

        assert (view.schule, view.vorname) == (TEAM_NAME, "Ida")
        assert row["kontakte"]["trainer"]["einwilligung"]["bestaetigt_am"] == TODAY
        assert other_row["kontakte"]["trainer"]["einwilligung"]["bestaetigt_am"] is None


class TestTheDeadline:
    def test_a_link_past_its_deadline_reads_as_over_and_takes_no_consent(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            token = response.bestaetigungen[0].token

            return (
                await ansicht(database, token, today=FRIST),
                await ansicht(database, token, today=AFTER_THE_DEADLINE),
                await refused(answer(database, token, today=AFTER_THE_DEADLINE)),
            )

        on_the_day, after, code = on_a_league(mongo_replica_set_url, body)

        assert on_the_day.zustand == "gueltig", "the deadline's own day still takes the link"
        assert after.zustand == "abgelaufen"
        assert code == KONTAKT_LINK_ABGELAUFEN

    def test_a_resend_reopens_a_seat_whose_link_ran_out(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await save(database, THREE)
            fresh = await resend(database, "trainer", today=AFTER_THE_DEADLINE)

            return await answer(database, fresh.bestaetigung.token, today=AFTER_THE_DEADLINE)

        assert on_a_league(mongo_replica_set_url, body).ergebnis == "bestaetigt"


class TestABanAfterTheMint:
    """`docs/backend/spec.md :: I505`, `:: I506`, `:: I515` and `:: I490` on a season row's link."""

    def test_the_view_answers_gesperrt_and_the_consent_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await ban(database, client, "ida@example.com")
            token = response.bestaetigungen[0].token

            return await ansicht(database, token), await refused(answer(database, token)), await row_now(database)

        view, code, row = on_a_league(mongo_replica_set_url, body)

        assert view.zustand == "gesperrt"
        assert code == BEWERBUNG_EINWILLIGUNG_GESPERRT
        assert row["kontakte"]["trainer"]["einwilligung"]["bestaetigt_am"] is None

    def test_a_widerspruch_is_still_taken(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await ban(database, client, "ida@example.com")
            answered = await answer(database, response.bestaetigungen[0].token, antwort="abgelehnt")

            return answered, await row_now(database)

        answered, row = on_a_league(mongo_replica_set_url, body)

        assert answered.ergebnis == "abgelehnt"
        assert row["kontakte"]["trainer"] is None

    def test_a_lift_inside_the_deadline_reopens_the_link(self, mongo_replica_set_url: str):
        """Nothing of the ban is written on the link's record, so lifting it is all a mistaken ban needs undone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await ban(database, client, "ida@example.com")
            await database[Collection.SPERRLISTE].delete_many({})
            token = response.bestaetigungen[0].token

            return await ansicht(database, token), await answer(database, token, medien=True)

        view, answered = on_a_league(mongo_replica_set_url, body)

        assert view.zustand == "gueltig"
        # The answer carries the media consent it stored, as the application's does.
        assert (answered.ergebnis, answered.medien) == ("bestaetigt", True)


class TestARowsPeopleLeavingTakeTheirLinks:
    def test_a_replaced_club_s_links_open_nothing_on_the_incoming_club_s_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await replace_saison_team(
                team_id=TEAM_OID,
                saison_id=SAISON_ID,
                replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=INCOMING_TEAM_OID),
                teams_collection=database[Collection.TEAMS],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                saisons_collection=database[Collection.SAISONS],
                spiele_collection=database[Collection.SPIELE],
                saison_spieler_collection=database[Collection.SAISON_SPIELER],
                db=database.client,
                today=TODAY,
            )

            return [await refused(ansicht(database, mint.token)) for mint in response.bestaetigungen], await row_now(database)

        codes, row = on_a_league(mongo_replica_set_url, body)

        assert codes == [BEWERBUNG_TOKEN_UNKNOWN] * 3
        assert (row["team_id"], row["bestaetigungen"]) == (INCOMING_TEAM_OID, None)

    def test_a_cleared_block_takes_every_link_with_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await save(database, None)

            return [await refused(ansicht(database, mint.token)) for mint in response.bestaetigungen], await row_now(database)

        codes, row = on_a_league(mongo_replica_set_url, body)

        assert codes == [BEWERBUNG_TOKEN_UNKNOWN] * 3
        assert row["bestaetigungen"] is None

    def test_an_erased_person_s_link_opens_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await erase_kontaktperson(
                erasure_data=FLKontaktErasurePayload.model_validate({"email": "jonas@example.com"}),
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                aktionen_collection=database[Collection.AKTIONEN],
                db=database.client,
                germany_now=NOW,
            )

            return await refused(ansicht(database, response.bestaetigungen[1].token))

        assert on_a_league(mongo_replica_set_url, body) == BEWERBUNG_TOKEN_UNKNOWN


class TestTheStepUp:
    def test_a_save_that_mints_from_an_old_sign_in_is_refused_and_mints_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            before = await row_now(database)

            return await refused(save(database, THREE, step_up=STALE_STEP_UP_CHECK)), before, await row_now(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == CONFIRMATION_REQUIRED
        assert after == before

    def test_a_save_emptying_a_seat_whose_link_is_live_from_an_old_sign_in_is_refused(self, mongo_replica_set_url: str):
        """Voiding a bearer link is a step-up write as minting one is: the person holding it loses their way to answer."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await save(database, THREE)
            before = await row_now(database)

            return (
                await refused(save(database, {**THREE, "stellvertretung": None}, step_up=STALE_STEP_UP_CHECK)),
                before,
                await row_now(database),
            )

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == CONFIRMATION_REQUIRED
        assert after == before

    def test_a_save_emptying_a_seat_whose_link_was_answered_takes_the_old_sign_in(self, mongo_replica_set_url: str):
        """The control: an answered link opens nothing, so dropping it voids nothing a person holds."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            await answer(database, first.bestaetigungen[0].token)
            await save(database, {**THREE, "trainer": None}, step_up=STALE_STEP_UP_CHECK)

            return await row_now(database)

        assert on_a_league(mongo_replica_set_url, body)["kontakte"]["trainer"] is None

    def test_a_save_minting_nothing_takes_the_old_sign_in(self, mongo_replica_set_url: str):
        """The control, and what keeps an edit's undo: a telephone number moved seats nobody new."""

        edited = {**{seat: person(name) for seat, name in zip(SEATS, ("Ida", "Jonas", "Klara"), strict=True)}, "trainer_ist_zugleich": None}
        edited["trainer"] = {**edited["trainer"], "telefon": "+4917099999999"}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            return await save(database, edited, step_up=STALE_STEP_UP_CHECK)

        assert on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED).bestaetigungen == []


class TestAnApplicationsLinkIsAnsweredAsBefore:
    def test_an_application_seat_link_reads_as_the_application_s(self, mongo_replica_set_url: str):
        """The application is asked first: a token a season row holds as well, which no mint can make, still reads as the application's."""

        raw = "an-applications-link"
        hashes: Mapping[str, str] = {seat: hash_token(f"{raw}-{seat}") for seat in SEATS}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            # The season row holds the application's Trainer hash too, so only the order decides which record answers.
            await database[Collection.SAISON_TEAMS].update_one(
                {"_id": ROW_OID},
                {
                    "$set": {
                        "kontakte": STORED_UNCONFIRMED,
                        "bestaetigungen": {
                            "trainer": compose_kontakt_bestaetigung(token_hash=hashes["trainer"], today=TODAY),
                            "ansprechperson": None,
                            "stellvertretung": None,
                        },
                    }
                },
            )
            await database[Collection.BEWERBUNGEN].insert_one(
                {
                    "_id": ObjectId("6890a1b2c3d4e5f607a50021"),
                    "saison_id": SAISON_ID,
                    "eingereicht_am": "2026-03-20",
                    "status": "eingereicht",
                    "team_id": TEAM_OID,
                    "schule": None,
                    "kontakte": {
                        seat: documents.kontaktperson_document(name) for seat, name in zip(SEATS, ("Ida", "Jonas", "Klara"), strict=True)
                    }
                    | {"trainer_ist_zugleich": None},
                    "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
                    "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
                    "wunschgegner": None,
                    "entscheidung": None,
                    "bestaetigungsfrist": FRIST,
                    "bestaetigungen": compose_bestaetigungen(hashes=hashes, today=TODAY),
                }
            )
            view = await ansicht(database, f"{raw}-trainer")
            answered = await answer(database, f"{raw}-trainer", text_version=BEWERBER_SEITE)

            return view, answered

        view, answered = on_a_league(mongo_replica_set_url, body)

        assert (view.quelle, view.schule, view.rolle, view.zeile) == ("bewerbung", TEAM_NAME, "trainer", None)
        assert (answered.quelle, answered.ergebnis) == ("bewerbung", "bestaetigt")


class TestARowNoLongerInTheSeason:
    """Neither a `past` season nor a withdrawn team offers a seat to confirm, so a link there takes a Widerspruch alone."""

    @pytest.mark.parametrize(
        ("saison_status", "row_fields", "zeile"),
        [
            pytest.param("past", {}, "saison_vorbei", id="a season that has ended"),
            pytest.param(
                "active",
                {"austritt": {"type": "rueckzug", "grund": "Keine Mannschaft mehr", "datum": "2026-03-01"}},
                "ausgetreten",
                id="a team that left",
            ),
            # Past as well as left: the season's end is what the mail names.
            pytest.param(
                "past",
                {"austritt": {"type": "rueckzug", "grund": "Keine Mannschaft mehr", "datum": "2026-03-01"}},
                "saison_vorbei",
                id="a team that left a season that has ended",
            ),
        ],
    )
    def test_a_person_the_save_newly_seats_is_minted_a_link_taking_their_widerspruch(
        self, mongo_replica_set_url: str, saison_status: str, row_fields: dict[str, Any], zeile: str
    ):
        """The link is how a person entered there learns of it (Art. 14 (3)(a) GDPR), so the save mints one all the same."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            token = response.bestaetigungen[0].token
            view = await ansicht(database, token)
            consent = await refused(answer(database, token))

            return response, view, consent, await answer(database, token, antwort="abgelehnt"), await row_now(database)

        response, view, consent, widerspruch, row = on_a_league(mongo_replica_set_url, body, saison_status=saison_status, row_fields=row_fields)

        assert [(mint.rollen, mint.zeile) for mint in response.bestaetigungen] == [
            (["trainer"], zeile),
            (["ansprechperson"], zeile),
            (["stellvertretung"], zeile),
        ]
        assert (view.zustand, consent, widerspruch.ergebnis) == ("saison_vorbei", KONTAKT_SAISON_VORBEI, "abgelehnt")
        assert row["kontakte"]["trainer"] is None

    @pytest.mark.parametrize(
        ("saison_status", "row_fields"),
        [
            pytest.param("past", {}, id="a season that has ended"),
            pytest.param(
                "active", {"austritt": {"type": "rueckzug", "grund": "Keine Mannschaft mehr", "datum": "2026-03-01"}}, id="a team that left"
            ),
        ],
    )
    def test_a_resend_is_refused_and_writes_nothing(self, mongo_replica_set_url: str, saison_status: str, row_fields: dict[str, Any]):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            before = await row_now(database)

            return await refused(resend(database, "trainer")), before, await row_now(database)

        code, before, after = on_a_league(
            mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED, saison_status=saison_status, row_fields=row_fields
        )

        assert code == KONTAKT_ZEILE_OHNE_SAISON
        assert after == before


ITS_TEAM_LEFT: dict[str, Any] = {"$set": {"austritt": {"type": "rueckzug", "grund": "Keine Mannschaft mehr", "datum": "2026-04-01"}}}


class TestALinkOutlivingItsSeason:
    """A link minted while the season ran asks no consent once it has ended or the team left it (`docs/backend/spec.md :: I935`)."""

    async def closed(self, database: AsyncDatabase, how: str) -> None:
        if how in ("past", "both"):
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})
        if how in ("austritt", "both"):
            await database[Collection.SAISON_TEAMS].update_one({"_id": ROW_OID}, ITS_TEAM_LEFT)

    @pytest.mark.parametrize(
        ("how", "zeile"),
        [
            pytest.param("past", "saison_vorbei", id="the season ended"),
            pytest.param("austritt", "ausgetreten", id="the team left"),
            # The season's end is what the page names: no team is still in a season that is over.
            pytest.param("both", "saison_vorbei", id="the team left a season that has since ended"),
        ],
    )
    def test_its_view_offers_a_widerspruch_alone_and_its_refused_consent_writes_nothing(self, mongo_replica_set_url: str, how: str, zeile: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await save(database, THREE)).bestaetigungen[0].token
            open_view = await ansicht(database, token)
            await self.closed(database, how)
            before = await row_now(database)

            return open_view, await ansicht(database, token), await refused(answer(database, token)), before, await row_now(database)

        open_view, view, code, before, after = on_a_league(mongo_replica_set_url, body)

        assert open_view.zeile == "offen"
        assert (view.zustand, view.zeile) == ("saison_vorbei", zeile)
        assert code == KONTAKT_SAISON_VORBEI
        assert after == before

    def test_its_deadline_passing_too_reads_as_over(self, mongo_replica_set_url: str):
        """Past its own deadline the link takes no Widerspruch either (`REQ-KONTAKT-004`), so the page offers nothing."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await save(database, THREE)).bestaetigungen[0].token
            await self.closed(database, "past")

            view = await ansicht(database, token, today=AFTER_THE_DEADLINE)

            return view, await refused(answer(database, token, antwort="abgelehnt", today=AFTER_THE_DEADLINE))

        view, code = on_a_league(mongo_replica_set_url, body)

        assert (view.zustand, code) == ("abgelaufen", KONTAKT_LINK_ABGELAUFEN)

    @pytest.mark.parametrize("how", [pytest.param("past", id="the season ended"), pytest.param("austritt", id="the team left")])
    def test_a_widerspruch_on_it_is_still_taken(self, mongo_replica_set_url: str, how: str):
        """The person may always remove themselves, whatever became of the season."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await save(database, THREE)).bestaetigungen[0].token
            await self.closed(database, how)
            answered = await answer(database, token, antwort="abgelehnt")

            return answered, await row_now(database), await ansicht(database, token)

        answered, row, reopened = on_a_league(mongo_replica_set_url, body)

        assert (answered.ergebnis, answered.medien) == ("abgelehnt", False)
        assert row["kontakte"]["trainer"] is None
        # Its answer outranks the closed row, as `gesperrt` and `bestaetigt` do.
        assert reopened.zustand == "abgelehnt"


class SeasonsRunningARivalAfterTheirRead(InterleavedCollection):
    """The rival lands once the press holds the season's status and before it writes the row."""

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._collection.find_one(*args, **kwargs)
        await self.run_the_rival()

        return found


NEXT_SAISON_ID = "2027"


class TestARolloverInsideTheConsentPress:
    """The rollover reads nothing the press writes, so a press that read `active` commits across one landing inside it.

    An anchor on the season would make it retry against every write to the season document instead.
    """

    def test_a_press_that_read_the_season_active_commits_across_a_rollover_inside_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].insert_one(documents.saison_document(NEXT_SAISON_ID, "future"))
            # What makes the next season activatable (`REQ-ACTIVATE-003`).
            await database[Collection.SPIELE].insert_one(
                documents.spiel_document(spiel_id=ObjectId(), saison_id=NEXT_SAISON_ID, spiel_nr=1, spieltag_id=ObjectId())
            )
            token = (await save(database, THREE)).bestaetigungen[0].token

            async def roll_over() -> None:
                await activate_saison(
                    saison_id=NEXT_SAISON_ID,
                    saisons_collection=database[Collection.SAISONS],
                    spiele_collection=database[Collection.SPIELE],
                    spieltage_collection=database[Collection.SPIELTAGE],
                    sperrliste_collection=database[Collection.SPERRLISTE],
                    db=client,
                )

            seasons = SeasonsRunningARivalAfterTheirRead(database[Collection.SAISONS], roll_over)
            answered = await answer(database, token, saisons=cast(AsyncCollection, seasons))
            saison = await database[Collection.SAISONS].find_one({"_id": SAISON_ID}, projection={"status": 1})

            return answered.ergebnis, seasons.passes, saison, await row_now(database)

        ergebnis, passes, saison, row = on_a_league(mongo_replica_set_url, body)

        # Both landed: the season ended under the press, and the press it read as running committed.
        assert saison is not None and saison["status"] == "past"
        assert (ergebnis, row["kontakte"]["trainer"]["einwilligung"]["bestaetigt_am"]) == ("bestaetigt", TODAY)
        assert passes == 1, "the press read the season again, so something it writes now conflicts with the rollover"


class TestTheLinkLookupWalksAnIndex:
    """Strangers drive both lookups a link press makes, so neither may scan its collection.

    Read off the server's profiler through the handler, as `tests/api/test_spieler_email_reads.py` reads
    the address lookups: a filter rebuilt without its index goes red here.
    """

    def test_every_token_lookup_plans_an_index_scan(self, mongo_replica_set_url: str):
        lookups = (Collection.BEWERBUNGEN, Collection.SAISON_TEAMS)

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await database.command("profile", 2)
            try:
                await ansicht(database, response.bestaetigungen[0].token)
            finally:
                await database.command("profile", 0)
            profiled = (
                await database["system.profile"].find({"ns": {"$in": [f"{DATABASE_NAME}.{name}" for name in lookups]}}).to_list(length=None)
            )
            await database.drop_collection("system.profile")

            return [
                (entry["ns"], str(entry.get("planSummary")))
                for entry in profiled
                if "$or" in ((entry.get("command") or {}).get("filter") or {})
            ]

        plans = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        # The premise: a lookup the profiler never saw would pass the next line vacuously.
        assert sorted(ns.rsplit(".", 1)[1] for ns, _ in plans) == sorted(str(name) for name in lookups), plans
        assert all("IXSCAN" in plan and "COLLSCAN" not in plan for _, plan in plans), plans


def angenommene_bewerbung(trainer: Mapping[str, Any]) -> dict[str, Any]:
    """The accepted application this team entered the season through, its Trainer seat holding `trainer`."""

    return {
        "_id": ObjectId("6890a1b2c3d4e5f607a50031"),
        "saison_id": SAISON_ID,
        "eingereicht_am": "2026-03-01",
        "status": "angenommen",
        "team_id": TEAM_OID,
        "schule": None,
        "kontakte": {
            "trainer": dict(trainer),
            "ansprechperson": documents.kontaktperson_document("Jonas"),
            "stellvertretung": documents.kontaktperson_document("Klara"),
            "trainer_ist_zugleich": None,
        },
        "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "wunschgegner": None,
        "entscheidung": None,
        "bestaetigungsfrist": FRIST,
        "bestaetigungen": compose_bestaetigungen(hashes={seat: hash_token(f"angenommen-{seat}") for seat in SEATS}, today=TODAY),
    }


class TestThePageASeasonRowsLinkOpens:
    """A season row's seat reads the page true for its person, and its answer is judged against that page."""

    def test_a_link_answering_a_mixed_pair_shows_and_takes_one_page(self, mongo_replica_set_url: str):
        """A Trainer the applicant named, given a second seat by the editor: one link, judged against the page the view served for both.

        Judged seat by seat, each against its own page, no label could ever confirm this person.
        """

        def eingetragen(vorname: str, von: str) -> dict[str, Any]:
            seat = stored(vorname)
            return {**seat, "einwilligung": {**seat["einwilligung"], "eingetragen_von": von}}

        paired = {
            **STORED_UNCONFIRMED,
            "trainer": eingetragen("Ida", "bewerbung"),
            "stellvertretung": eingetragen("Ida", "liga"),
            "trainer_ist_zugleich": "stellvertretung",
        }

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await resend(database, "stellvertretung")).bestaetigung.token
            view = await ansicht(database, token)
            refusal = await refused(answer(database, token, text_version=BEWERBER_SEITE))
            await answer(database, token, text_version=view.laufende_fassung)

            return view, refusal, await row_now(database)

        view, refusal, row = on_a_league(mongo_replica_set_url, body, kontakte=paired)

        assert view.laufende_fassung == SAISON_SEITE
        assert refusal == FASSUNG_UNZULAESSIG
        for seat in ("trainer", "stellvertretung"):
            assert (row["kontakte"][seat]["einwilligung"]["bestaetigt_am"], row["kontakte"][seat]["einwilligung"]["text_version"]) == (
                TODAY,
                SAISON_SEITE,
            )

    def test_a_seat_the_editor_entered_opens_the_season_rows_page_and_takes_its_label_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await save(database, THREE)).bestaetigungen[0].token
            view = await ansicht(database, token)
            refusal = await refused(answer(database, token, text_version=BEWERBER_SEITE))
            unmoved = await row_now(database)
            await answer(database, token)

            return view, refusal, unmoved, await row_now(database)

        view, refusal, unmoved, row = on_a_league(mongo_replica_set_url, body)

        assert view.laufende_fassung == SAISON_SEITE
        assert refusal == FASSUNG_UNZULAESSIG
        assert unmoved["kontakte"]["trainer"]["einwilligung"]["bestaetigt_am"] is None, "the refused answer wrote"
        einwilligung = row["kontakte"]["trainer"]["einwilligung"]
        assert (einwilligung["bestaetigt_am"], einwilligung["text_version"], einwilligung.get("erfasst_von")) == (TODAY, SAISON_SEITE, None)
        assert einwilligung["nachweis"]["umfang"]["text_version"] == SAISON_SEITE
        # The editor seated this person, and the answer leaves that standing.
        assert einwilligung["eingetragen_von"] == "liga"

    def test_a_seat_stored_before_the_field_opens_the_season_rows_page_whoever_named_its_person(self, mongo_replica_set_url: str):
        """The accepted application named this person in this seat, and the link still opens the page true of a season row's link."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(angenommene_bewerbung(documents.kontaktperson_document("Ida")))
            token = (await resend(database, "trainer")).bestaetigung.token
            view = await ansicht(database, token)
            refusal = await refused(answer(database, token, text_version=BEWERBER_SEITE))

            return view, refusal, await answer(database, token)

        view, refusal, answered = on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED)

        assert (view.laufende_fassung, refusal, answered.ergebnis) == (SAISON_SEITE, FASSUNG_UNZULAESSIG, "bestaetigt")

    def test_a_seat_carried_from_the_application_keeps_the_applicants_page(self, mongo_replica_set_url: str):
        """It names the application as who seated its person, so no application is asked and none needs to be kept."""

        carried = {
            **STORED_UNCONFIRMED,
            "trainer": {
                **STORED_UNCONFIRMED["trainer"],
                "einwilligung": {**STORED_UNCONFIRMED["trainer"]["einwilligung"], "eingetragen_von": "bewerbung"},
            },
        }

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await resend(database, "trainer")).bestaetigung.token

            return await ansicht(database, token)

        assert on_a_league(mongo_replica_set_url, body, kontakte=carried).laufende_fassung == BEWERBER_SEITE
