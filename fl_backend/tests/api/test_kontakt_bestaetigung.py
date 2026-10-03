"""
API · a contact seat an administrator types into a team's season row is mailed its own confirmation link

The contacts save mints one link per person it newly seats, the per-seat re-send mints one for any
seat still unconfirmed, and the application's two confirmation operations answer the link on the
season row. Driven against the shipped validators, with the ban list asked at the mint and at the
press as the application's links ask it.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.einwilligung_router import get_einwilligung_ansicht, post_einwilligung
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAnsichtPayload, FLBewerbungEinwilligungAntwortPayload
from app.api.bewerbungen.services import (
    BEWERBUNG_EINWILLIGUNG_GESPERRT,
    BEWERBUNG_SEAT_ALREADY_ANSWERED,
    BEWERBUNG_TOKEN_UNKNOWN,
    KONTAKT_LINK_ABGELAUFEN,
    bestaetigungsfrist_from,
    compose_bestaetigungen,
    hash_token,
)
from app.api.identitaet.crud import funktionen_of
from app.api.kontakte.admin_router import erase_kontaktperson
from app.api.kontakte.schemas import FLKontaktErasurePayload
from app.api.teams.admin_router import einladen_kontakt, patch_saison_team_kontakte, replace_saison_team
from app.api.teams.schemas import FLPatchSaisonTeamKontaktePayload, FLReplaceSaisonTeamPayload, kontakte_stand_of
from app.api.teams.services import KONTAKT_SITZ_GESPERRT, KONTAKT_SITZ_OHNE_BESTAETIGUNG, compose_kontakt_bestaetigung
from app.core.collections import Collection
from app.core.exceptions import ActorConfirmationRequiredException, DocumentNotFoundException, WriteRefusalException
from app.core.security import CONFIRMATION_REQUIRED, STEP_UP_WINDOW_S, get_step_up_check
from tests import documents
from tests.actor_tokens import FRESH_STEP_UP_CHECK, verified_actor
from tests.bans import ban_list, ban_through_the_route
from tests.config import grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.isolation import InterleavedCollection
from tests.worker import worker_database

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
        "einwilligung": {"umfang": "kontaktdaten", "text_version": "v1", "datum": "2026-03-01"},
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


def on_a_league(url: str, body: Body, *, kontakte: Any = None, rows: list[dict[str, Any]] | None = None) -> Any:
    """The running season, its club, and the club's row holding `kontakte`; `rows` seeded FIRST, so a filter missing the row reaches them."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            # A ban entered through its route re-judges its actor's grant (`docs/backend/spec.md :: I450`).
            await database[Collection.BERECHTIGUNGEN].insert_many(grants_for_the_suite())
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            for team_id, name, shorthand in ((TEAM_OID, TEAM_NAME, "AD"), (OTHER_TEAM_OID, "Falken", "FA"), (INCOMING_TEAM_OID, "Eulen", "EU")):
                await database[Collection.TEAMS].insert_one(
                    documents.team_document(team_id, name, shorthand, website_url=None, schulform="gymnasium_g9")
                )
            for row in rows or []:
                await database[Collection.SAISON_TEAMS].insert_one(row)
            await database[Collection.SAISON_TEAMS].insert_one(junction(ROW_OID, TEAM_OID, kontakte))

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
        sperrliste=ban_list(database),
        db=database.client,
        today=today,
    )


async def ansicht(database: AsyncDatabase, token: str, *, today: str = TODAY) -> Any:
    return await get_einwilligung_ansicht(
        ansicht_data=FLBewerbungEinwilligungAnsichtPayload(token=token),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        teams_collection=database[Collection.TEAMS],
        sperrliste=ban_list(database),
        today=today,
    )


async def answer(database: AsyncDatabase, token: str, *, antwort: str = "erteilt", today: str = TODAY) -> Any:
    erteilt = antwort == "erteilt"
    body = {
        "token": token,
        "antwort": antwort,
        "geburtsdatum": AN_ADULTS_BIRTHDATE if erteilt else None,
        "whatsapp": erteilt,
        "text_version": "v4",
    }

    return await post_einwilligung(
        antwort_data=FLBewerbungEinwilligungAntwortPayload.model_validate(body),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        aktionen_collection=database[Collection.AKTIONEN],
        sperrliste=ban_list(database),
        db=database.client,
        today=today,
        germany_now=NOW,
    )


async def ban(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> Any:
    return await ban_through_the_route(database, client, email=email, grund="Wiederholte Falschangaben", von=ADMIN, today=TODAY)


async def row_now(database: AsyncDatabase, row_id: ObjectId = ROW_OID) -> dict[str, Any]:
    found = await database[Collection.SAISON_TEAMS].find_one({"_id": row_id})
    assert found is not None, "the seeded row is gone"

    return found


async def refused(call: Awaitable[Any]) -> str:
    with pytest.raises((WriteRefusalException, ActorConfirmationRequiredException)) as refusal:
        await call

    return refusal.value.error_code


async def every_collection_as_text(database: AsyncDatabase) -> str:
    return "".join([str(await database[name].find({}).to_list(length=None)) for name in await database.list_collection_names()])


async def seats_of(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> list[tuple[str, str]]:
    async with client.start_session() as session:
        subjekt = await funktionen_of(
            email,
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            saisons_collection=database[Collection.SAISONS],
            spieler_collection=database[Collection.SPIELER],
            schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
            session=session,
        )

    return [(sitz.saison_id, sitz.rolle) for sitz in subjekt.sitze]


class TestTheSaveMintsForEachPersonItNewlySeats:
    def test_a_new_person_on_a_seat_is_minted_one_link_stored_as_its_hash_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, {**THREE, "ansprechperson": None, "stellvertretung": None})

            return response, await row_now(database), await every_collection_as_text(database)

        response, row, everything = on_a_league(mongo_replica_set_url, body)

        assert [(mint.rollen, mint.email, mint.frist, mint.vorname, mint.schule) for mint in response.bestaetigungen] == [
            (["trainer"], "ida@example.com", FRIST, "Ida", TEAM_NAME)
        ]
        assert response.saison_team_id == ROW_OID
        assert response.gesperrt == []
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


class TestABarredAddressIsMintedNoLink:
    def test_a_barred_address_entered_on_a_seat_is_stored_and_minted_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document("jonas@example.com", bis="2030"))
            response = await save(database, THREE)

            return response, await row_now(database)

        response, row = on_a_league(mongo_replica_set_url, body)

        assert response.gesperrt == ["ansprechperson"]
        assert [mint.rollen for mint in response.bestaetigungen] == [["trainer"], ["stellvertretung"]]
        assert row["kontakte"]["ansprechperson"]["email"] == "jonas@example.com"
        assert row["bestaetigungen"]["ansprechperson"] is None

    def test_a_ban_entered_beside_the_save_is_read_by_it(self, mongo_replica_set_url: str):
        """The ban committed once the editor was open and before the save landed: the mint asks it in its own transaction."""

        class JunctionBanningFirst(InterleavedCollection):
            async def find_one(self, *args: Any, **kwargs: Any) -> Any:
                await self.run_the_rival()

                return await self._collection.find_one(*args, **kwargs)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            junction_collection = JunctionBanningFirst(database[Collection.SAISON_TEAMS], lambda: ban(database, client, "ida@example.com"))
            response = await save(database, THREE, saison_teams=junction_collection)
            junction_collection.assert_landed_inside(serially=0)

            return response

        response = on_a_league(mongo_replica_set_url, body)

        assert response.gesperrt == ["trainer"]
        assert [mint.rollen for mint in response.bestaetigungen] == [["ansprechperson"], ["stellvertretung"]]

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
        assert (seat["geburtsdatum"], seat["einwilligung"]["bestaetigt_am"], seat["einwilligung"]["erfasst_von"]) == (
            AN_ADULTS_BIRTHDATE,
            TODAY,
            "person",
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

            return await ansicht(database, token), await answer(database, token)

        view, answered = on_a_league(mongo_replica_set_url, body)

        assert view.zustand == "gueltig"
        assert answered.ergebnis == "bestaetigt"


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

    def test_a_save_handing_a_live_link_s_seat_to_a_barred_address_from_an_old_sign_in_is_refused(self, mongo_replica_set_url: str):
        """It mints nothing, the address being barred, and still voids the link the seat's last person holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save(database, THREE)
            await ban(database, client, "lea@example.com")
            before = await row_now(database)
            code = await refused(save(database, {**THREE, "ansprechperson": person("Lea")}, step_up=STALE_STEP_UP_CHECK))

            return code, before, await row_now(database)

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
        """The application is asked first, so a token both could hold, which none can, would still read as the application's."""

        raw = "an-applications-link"
        hashes: Mapping[str, str] = {seat: hash_token(f"{raw}-{seat}") for seat in SEATS}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
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
            answered = await answer(database, f"{raw}-trainer")

            return view, answered

        view, answered = on_a_league(mongo_replica_set_url, body)

        assert (view.quelle, view.schule, view.rolle) == ("bewerbung", TEAM_NAME, "trainer")
        assert (answered.quelle, answered.ergebnis) == ("bewerbung", "bestaetigt")
