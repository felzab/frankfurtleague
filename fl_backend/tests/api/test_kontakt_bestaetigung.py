"""
API · a contact seat an administrator types into a team's season row is mailed its own confirmation link

The contacts save mints one link per person it newly seats, the per-seat re-send mints one for any
seat still unconfirmed, and the application's two confirmation operations answer the link on the
season row, with the ban list asked at the mint and at the press as the application's links ask it.
"""

import dataclasses
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pydantic import TypeAdapter
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.public_router import get_einwilligung_view, post_einwilligung
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAntwortPayload
from app.api.bewerbungen.services import SEAT_MIN_AGE_YEARS, bestaetigungsfrist_from
from app.api.identitaet.crud import funktionen_of
from app.api.saisons.admin_router import activate_saison
from app.api.teams.admin_router import invite_kontakt, patch_saison_team_kontakte, replace_saison_team
from app.api.teams.schemas import FLPatchSaisonTeamKontaktePayload, FLReplaceSaisonTeamPayload, kontakte_stand_of
from app.api.teams.services import (
    compose_kontakt_bestaetigung,
)
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.recording import log_stamp
from app.core.security import STEP_UP_WINDOW_S, SessionActor
from app.shared.einwilligung import LAUFENDE_FASSUNGEN
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.tokens import hash_token
from tests import documents
from tests.bans import ban_list, ban_through_the_route
from tests.config import build_test_config, grants_for_the_suite
from tests.database import a_clean_database, on_the_seed_loop
from tests.erasure import erased
from tests.isolation import InterleavedCollection
from tests.outbox import MAIL_NOW, drained
from tests.plans import plans_of_sent_reads
from tests.records import record_collections
from tests.session_headers import fresh_admin_actor, verified_actor
from tests.whole_database import where_held
from tests.worker import worker_database

from .test_bewerbung_einwilligung_execution import ReadsRecorded, leaf_paths, loaded_by_the_link

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_kontakt_bestaetigung_test")

SAISON_ID = "2026"
TODAY = "2026-04-01"
FRIST = bestaetigungsfrist_from(today=TODAY)
# The day after the deadline a link minted on `TODAY` carries.
AFTER_THE_DEADLINE = "2026-04-16"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
# Written out rather than computed from `log_stamp`, which would agree with any conversion of `NOW`.
REDACTED_AT = "2026-04-01T10:30:00+00:00"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607a50001")
ROW_OID = ObjectId("6890a1b2c3d4e5f607a50011")
OTHER_TEAM_OID = ObjectId("6890a1b2c3d4e5f607a50002")
OTHER_ROW_OID = ObjectId("6890a1b2c3d4e5f607a50012")
INCOMING_TEAM_OID = ObjectId("6890a1b2c3d4e5f607a50003")

TEAM_NAME = "Adler"
AN_ADULTS_BIRTHDATE = "1984-05-09"
ADMIN = "admin@frankfurtleague.de"

# Past the step-up window by a minute.
STALE_ADMIN_ACTOR = verified_actor("admin@example.com", signed_in_before_s=STEP_UP_WINDOW_S + 60)

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


def stored(vorname: str, *, confirmed_at: str | None = None) -> dict[str, Any]:
    """The same person as a row holds them, the league having seated them, confirmed or not."""

    sent = person(vorname)

    return documents.kontaktperson_document(
        vorname,
        confirmed_at=confirmed_at,
        einwilligung={"text_version": sent["einwilligung"]["text_version"], "datum": sent["einwilligung"]["datum"]},
        entered_by="liga",
        nachname=sent["nachname"],
        email=sent["email"],
        telefon=sent["telefon"],
        **({} if confirmed_at is None else {"geburtsdatum": AN_ADULTS_BIRTHDATE}),
    )


THREE = {"trainer": person("Ida"), "ansprechperson": person("Jonas"), "stellvertretung": person("Klara"), "trainer_is_also": None}
# The Trainer holding the Stellvertretung's seat too: one person, so one link.
PAIRED = {
    "trainer": person("Ida"),
    "ansprechperson": person("Jonas"),
    "stellvertretung": person("Ida"),
    "trainer_is_also": "stellvertretung",
}

# Three unconfirmed people on a row holding no link entry, so the link a re-send mints is the only one in play.
STORED_UNCONFIRMED = {
    "trainer": stored("Ida"),
    "ansprechperson": stored("Jonas"),
    "stellvertretung": stored("Klara"),
    "trainer_is_also": None,
}


def junction(
    row_id: ObjectId, team_id: ObjectId, kontakte: Any, *, name: str = TEAM_NAME, shorthand: str = "ADX", **fields: Any
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
            # A ban entered through its route re-judges its actor's grant.
            await database[Collection.GRANTS].insert_many(grants_for_the_suite())
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, saison_status))
            for team_id, name, shorthand in (
                (TEAM_OID, TEAM_NAME, "ADX"),
                (OTHER_TEAM_OID, "Falken", "FAX"),
                (INCOMING_TEAM_OID, "Eulen", "EUX"),
            ):
                await database[Collection.TEAMS].insert_one(
                    documents.team_document(team_id, name, shorthand, website_url=None, schulform="gymnasium_g9")
                )
            for row in rows or []:
                await database[Collection.SAISON_TEAMS].insert_one(row)
            await database[Collection.SAISON_TEAMS].insert_one(junction(ROW_OID, TEAM_OID, kontakte, **(row_fields or {})))

            return await body(database, client)

    return on_the_seed_loop(_run())


@dataclasses.dataclass(frozen=True)
class Link:
    """One link a write owed, as the Postausgang handed its mail out: where it went, what it names, and the raw link."""

    rollen: list[str]
    email: str
    token: str
    frist: str
    schule: str
    row: str


@dataclasses.dataclass(frozen=True)
class Mailed:
    """A write's answer, beside each link it owed as the mail carrying it went out, in the answer's order."""

    answer: Any
    confirmations: list[Link]

    @property
    def bestaetigung(self) -> Link:
        [link] = self.confirmations
        return link


async def mailed(database: AsyncDatabase, answer: Any, owed: list[Any]) -> Mailed:
    """The outbox drained as the frontend drains it after the write, each mail matched to the person the answer names."""

    mails = await drained(database, database.client)
    links = [
        Link(
            rollen=list(mail.data.rollen),
            email=mail.an,
            token=str(mail.token),
            frist=str(mail.data.frist),
            schule=mail.data.schule,
            row=mail.data.row,
        )
        for mail in mails
        if mail.data.art == "kontakt_confirmation"
    ]
    assert [(link.rollen, link.email) for link in links] == [(mint.rollen, mint.email) for mint in owed], "the answer and the mails part"

    return Mailed(answer=answer, confirmations=links)


async def save(
    database: AsyncDatabase,
    kontakte: Any,
    *,
    actor: SessionActor | None = None,
    saison_teams: Any = None,
    today: str = TODAY,
) -> Mailed:
    """`PATCH .../kontakte`, composed against whatever the row holds now, and the links it owed."""

    row = await database[Collection.SAISON_TEAMS].find_one({"_id": ROW_OID})
    assert row is not None

    answer = await patch_saison_team_kontakte(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        kontakte_data=FLPatchSaisonTeamKontaktePayload.model_validate(
            {"kontakte": kontakte, "kontakte_stand": kontakte_stand_of(row.get("kontakte"))}
        ),
        saison_teams_collection=database[Collection.SAISON_TEAMS] if saison_teams is None else saison_teams,
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        outbox_collection=database[Collection.OUTBOX],
        sperrliste=ban_list(database),
        db=database.client,
        actor=actor or fresh_admin_actor(),
        today=today,
        germany_now=MAIL_NOW,
    )

    return await mailed(database, answer, answer.confirmations)


async def resend(database: AsyncDatabase, seat: str, *, today: str = TODAY) -> Mailed:
    answer = await invite_kontakt(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        seat=seat,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        outbox_collection=database[Collection.OUTBOX],
        sperrliste=ban_list(database),
        db=database.client,
        today=today,
        germany_now=MAIL_NOW,
    )

    return await mailed(database, answer, [answer.confirmation])


async def replace(database: AsyncDatabase) -> Any:
    """Another club takes this team's place in the season."""

    return await replace_saison_team(
        team_id=TEAM_OID,
        saison_id=SAISON_ID,
        replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=INCOMING_TEAM_OID),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        aktionen_collection=database[Collection.ACTION_LOG],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        db=database.client,
        today=TODAY,
        germany_now=NOW,
    )


async def ansicht(database: AsyncDatabase, token: str, *, today: str = TODAY, saison_teams: Any = None) -> Any:
    return await get_einwilligung_view(
        ansicht_data=FLTokenPayload(token=token),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS] if saison_teams is None else saison_teams,
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
    antwort: str = "given",
    today: str = TODAY,
    text_version: str = SAISON_SEITE,
    medien: bool = False,
    saisons: Any = None,
    saison_teams: Any = None,
) -> Any:
    body: dict[str, Any] = {"token": token, "antwort": antwort}
    if antwort == "given":
        body |= {"geburtsdatum": AN_ADULTS_BIRTHDATE, "whatsapp": True, "medien": medien, "text_version": text_version}

    return await post_einwilligung(
        antwort_data=TypeAdapter(FLBewerbungEinwilligungAntwortPayload).validate_python(body),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS] if saison_teams is None else saison_teams,
        saisons_collection=database[Collection.SAISONS] if saisons is None else saisons,
        aktionen_collection=database[Collection.ACTION_LOG],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        outbox_collection=database[Collection.OUTBOX],
        sperrliste=ban_list(database),
        db=database.client,
        config=build_test_config(),
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
    with pytest.raises((APIError, APIError)) as refusal:
        await call

    return refusal.value.error_code


async def seats_of(database: AsyncDatabase, client: AsyncMongoClient, email: str) -> list[tuple[str, str]]:
    async with client.start_session() as session:
        subjekt = await funktionen_of(email, record_collections(database), session=session)

    return [(sitz.saison_id, sitz.rolle) for sitz in subjekt.seats]


class TestTheSaveMintsForEachPersonItNewlySeats:
    def test_a_new_person_on_a_seat_is_minted_one_link_stored_as_its_hash_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, {**THREE, "ansprechperson": None, "stellvertretung": None})

            return response, await row_now(database), await where_held(database, response.confirmations[0].token)

        response, row, held = on_a_league(mongo_replica_set_url, body)

        assert [(mint.rollen, mint.email, mint.frist, mint.schule, mint.row) for mint in response.confirmations] == [
            (["trainer"], "ida@example.com", FRIST, TEAM_NAME, "open")
        ]
        token = response.confirmations[0].token
        assert row["confirmations"] == {
            "trainer": {"token_hashes": [hash_token(token)], "sent_at": TODAY, "frist": FRIST, "declined_at": None},
            "ansprechperson": None,
            "stellvertretung": None,
        }
        assert held[token] == [], "the raw link is stored somewhere, so a read of the database recovers it"

    def test_three_new_people_are_minted_three_links_each_opening_its_own_seat(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)

            return response, [await ansicht(database, mint.token) for mint in response.confirmations]

        response, views = on_a_league(mongo_replica_set_url, body)

        assert [mint.rollen for mint in response.confirmations] == [["trainer"], ["ansprechperson"], ["stellvertretung"]]
        assert [(view.quelle, view.rolle, view.state, view.schule) for view in views] == [
            ("saison", "trainer", "valid", TEAM_NAME),
            ("saison", "ansprechperson", "valid", TEAM_NAME),
            ("saison", "stellvertretung", "valid", TEAM_NAME),
        ]

    def test_a_trainer_holding_a_second_seat_is_minted_one_link_for_both(self, mongo_replica_set_url: str):
        """One link per person: two would leave the first answering for a seat the second has already answered."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, PAIRED)

            return response, await row_now(database), await ansicht(database, response.confirmations[0].token)

        response, row, view = on_a_league(mongo_replica_set_url, body)

        assert [mint.rollen for mint in response.confirmations] == [["trainer", "stellvertretung"], ["ansprechperson"]]
        assert row["confirmations"]["trainer"] == row["confirmations"]["stellvertretung"]
        assert (view.rolle, view.also_rolle) == ("trainer", "stellvertretung")

    def test_re_saving_the_same_confirmed_person_mints_nothing_and_keeps_the_stamp(self, mongo_replica_set_url: str):
        confirmed = {**STORED_UNCONFIRMED, "trainer": stored("Ida", confirmed_at="2026-03-20")}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, {**THREE, "trainer": {**person("Ida"), "telefon": "+4917099999999"}})

            return response, await row_now(database)

        response, row = on_a_league(mongo_replica_set_url, body, kontakte=confirmed)

        assert response.confirmations == []
        assert row["kontakte"]["trainer"]["telefon"] == "+4917099999999", "the edit did not land, so this case proves nothing"
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] == "2026-03-20"

    def test_re_saving_a_person_whose_link_is_out_keeps_that_link(self, mongo_replica_set_url: str):
        """A second save of the same people mails nobody twice: the link already in their inbox stays the one that works."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            again = await save(database, THREE)

            return first, again, await ansicht(database, first.confirmations[0].token)

        first, again, view = on_a_league(mongo_replica_set_url, body)

        assert len(first.confirmations) == 3
        assert again.confirmations == []
        assert view.state == "valid"

    def test_a_seat_handed_to_another_person_leaves_the_first_link_opening_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            handed = await save(database, {**THREE, "ansprechperson": person("Lea")})
            old_token = next(mint.token for mint in first.confirmations if mint.rollen == ["ansprechperson"])

            with pytest.raises(APIError) as refusal:
                await ansicht(database, old_token)

            return handed, refusal.value.error_code, await ansicht(database, handed.confirmations[0].token)

        handed, code, view = on_a_league(mongo_replica_set_url, body)

        assert [mint.rollen for mint in handed.confirmations] == [["ansprechperson"]]
        assert code == Code.LINK_INVALID
        assert view.rolle == "ansprechperson"

    def test_a_seat_the_save_empties_loses_its_link(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            await save(database, {**THREE, "stellvertretung": None})

            return await refused(ansicht(database, first.confirmations[2].token)), await row_now(database)

        code, row = on_a_league(mongo_replica_set_url, body)

        assert code == Code.LINK_INVALID
        assert row["confirmations"]["stellvertretung"] is None


class TestABarredAddressIsRefused:
    """A person the league may not mail would learn nothing of an entry, so no save seats one, as no reseat of an application does."""

    def test_a_save_seating_a_barred_address_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document("jonas@example.com", bis="2030"))
            before = await row_now(database)

            return await refused(save(database, THREE)), before, await row_now(database)

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == Code.KONTAKT_SEAT_BARRED
        assert after == before

    def test_a_save_handing_a_seat_to_a_barred_address_is_refused_and_its_link_still_opens(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            await ban(database, client, "lea@example.com")
            code = await refused(save(database, {**THREE, "ansprechperson": person("Lea")}))
            old_token = next(mint.token for mint in first.confirmations if mint.rollen == ["ansprechperson"])

            return code, await ansicht(database, old_token), await row_now(database)

        code, view, row = on_a_league(mongo_replica_set_url, body)

        assert code == Code.KONTAKT_SEAT_BARRED
        assert (view.state, view.rolle) == ("valid", "ansprechperson")
        assert row["kontakte"]["ansprechperson"]["email"] == "jonas@example.com"

    def test_a_kept_person_whose_address_was_barred_after_their_seating_is_not_refused(self, mongo_replica_set_url: str):
        """The control: the save seats nobody new, and the ban is the confirmation press's to answer."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await save(database, THREE)
            await ban(database, client, "jonas@example.com")

            return await save(database, {**THREE, "stellvertretung": None}), await row_now(database)

        response, row = on_a_league(mongo_replica_set_url, body)

        assert response.confirmations == []
        assert (row["kontakte"]["ansprechperson"]["email"], row["kontakte"]["stellvertretung"]) == ("jonas@example.com", None)

    def test_a_resend_to_a_barred_address_is_refused_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document("ida@example.com", bis="2030"))
            before = await row_now(database)

            return await refused(resend(database, "trainer")), before, await row_now(database)

        code, before, after = on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED)

        assert code == Code.KONTAKT_SEAT_BARRED
        assert after == before

    def test_a_resend_to_an_address_the_ban_list_does_not_hold_still_mints(self, mongo_replica_set_url: str):
        """The control: a check refusing every re-send would pass the case above."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(documents.ban_document("jonas@example.com", bis="2030"))

            return await resend(database, "trainer")

        assert on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED).bestaetigung.rollen == ["trainer"]


class TestTheResend:
    def test_a_seat_holding_no_link_is_sent_its_first(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await resend(database, "ansprechperson")

            return response, await row_now(database), await ansicht(database, response.bestaetigung.token)

        response, row, view = on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED)

        assert (response.bestaetigung.rollen, response.bestaetigung.email, response.bestaetigung.frist) == (
            ["ansprechperson"],
            "jonas@example.com",
            FRIST,
        )
        assert response.bestaetigung.schule == TEAM_NAME
        assert (row["confirmations"]["trainer"], row["confirmations"]["stellvertretung"]) == (None, None)
        assert (view.rolle, view.state) == ("ansprechperson", "valid")

    def test_a_resend_replaces_the_link_and_restarts_the_deadline(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            again = await resend(database, "trainer", today="2026-04-05")

            return first, again, await refused(ansicht(database, first.confirmations[0].token)), await row_now(database)

        first, again, code, row = on_a_league(mongo_replica_set_url, body)

        assert code == Code.LINK_INVALID
        assert row["confirmations"]["trainer"]["frist"] == bestaetigungsfrist_from(today="2026-04-05") == again.bestaetigung.frist
        # The two seats the re-send did not name keep the links already in their inboxes.
        assert row["confirmations"]["ansprechperson"]["token_hashes"] == [hash_token(first.confirmations[1].token)]

    def test_a_resend_for_a_trainer_holding_a_second_seat_answers_both(self, mongo_replica_set_url: str):
        paired = {**STORED_UNCONFIRMED, "stellvertretung": stored("Ida"), "trainer_is_also": "stellvertretung"}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await resend(database, "stellvertretung")

            return response, await row_now(database)

        response, row = on_a_league(mongo_replica_set_url, body, kontakte=paired)

        assert response.bestaetigung.rollen == ["trainer", "stellvertretung"]
        assert row["confirmations"]["trainer"] == row["confirmations"]["stellvertretung"] is not None

    @pytest.mark.parametrize(
        "kontakte",
        [
            pytest.param({**STORED_UNCONFIRMED, "trainer": stored("Ida", confirmed_at="2026-03-20")}, id="a seat its person has confirmed"),
            pytest.param({**STORED_UNCONFIRMED, "trainer": None}, id="a seat holding nobody"),
        ],
    )
    def test_a_seat_with_nothing_left_to_confirm_is_refused_and_writes_nothing(self, mongo_replica_set_url: str, kontakte: dict[str, Any]):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            before = await row_now(database)

            return await refused(resend(database, "trainer")), before, await row_now(database)

        code, before, after = on_a_league(mongo_replica_set_url, body, kontakte=kontakte)

        assert code == Code.KONTAKT_SEAT_WITHOUT_CONFIRMATION
        assert after == before

    def test_a_path_naming_no_seat_is_a_404(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundError):
                await resend(database, "kapitaen")

            return None

        on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED)


def _seat_paths(block: str, *leaves: str) -> set[str]:
    return {f"{block}.{seat}.{leaf}" for seat in SEATS for leaf in leaves}


# What each handler resolves off the row its token found, `_id` the answer's alone, which keys its patch on it. Neither
# holds the wording label a seat confirmed under: the page names its own, and the press records it.
SAISON_ANSICHT_RESOLVES = frozenset(
    _seat_paths("confirmations", "token_hashes", "declined_at", "frist")
    | _seat_paths("kontakte", "email", "einwilligung.confirmed_at", "einwilligung.entered_by")
    | {"kontakte.trainer_is_also", "saison_id", "name", "austritt"}
)
SAISON_ANTWORT_RESOLVES = (
    SAISON_ANSICHT_RESOLVES | _seat_paths("kontakte", "einwilligung.umfang", "einwilligung.medien", "einwilligung.nachweis") | {"_id"}
)


class TestWhatASeasonRowsLinkLoads:
    """Holds the narrowing alone: a projection too short is answered by the cases driving each field either read resolves."""

    def test_the_view_never_holds_the_row_beyond_the_fields_its_answer_is_built_from(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> list[Any]:
            response = await save(database, THREE)
            recorder = ReadsRecorded(database[Collection.SAISON_TEAMS])
            await ansicht(database, response.confirmations[1].token, saison_teams=recorder)

            return loaded_by_the_link(recorder)

        loaded = on_a_league(mongo_replica_set_url, body)

        assert loaded, "the link's own read did not run"
        assert set().union(*(leaf_paths(document) for document in loaded)) <= SAISON_ANSICHT_RESOLVES

    def test_the_answer_never_holds_the_row_beyond_the_fields_it_judges_and_writes_on(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> list[Any]:
            response = await save(database, THREE)
            recorder = ReadsRecorded(database[Collection.SAISON_TEAMS])
            await answer(database, response.confirmations[1].token, saison_teams=recorder)

            return loaded_by_the_link(recorder)

        loaded = on_a_league(mongo_replica_set_url, body)

        assert loaded, "the link's own read did not run"
        assert set().union(*(leaf_paths(document) for document in loaded)) <= SAISON_ANTWORT_RESOLVES


class TestTheLinkConfirms:
    def test_confirming_stamps_the_seat_and_the_seat_then_grants_its_panel(self, mongo_replica_set_url: str):
        """`funktionen_of` answers a seat only once its own person has confirmed it, so before the press it answers nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            before = await seats_of(database, client, "jonas@example.com")
            answered = await answer(database, response.confirmations[1].token)

            return before, answered, await row_now(database), await seats_of(database, client, "jonas@example.com")

        before, answered, row, after = on_a_league(mongo_replica_set_url, body)

        assert before == []
        assert (answered.quelle, answered.ergebnis, answered.geburtsdatum, answered.whatsapp) == (
            "saison",
            "confirmed",
            AN_ADULTS_BIRTHDATE,
            True,
        )
        seat = row["kontakte"]["ansprechperson"]
        assert (seat["geburtsdatum"], seat["einwilligung"]["confirmed_at"]) == (AN_ADULTS_BIRTHDATE, TODAY)
        assert seat["einwilligung"]["umfang"] == "kontaktdaten_whatsapp"
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] is None, "the press reached a seat its link does not open"
        assert after == [(SAISON_ID, "ansprechperson")]

    def test_a_trainer_holding_a_second_seat_confirms_both_with_one_press(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, PAIRED)
            await answer(database, response.confirmations[0].token)

            return await row_now(database)

        row = on_a_league(mongo_replica_set_url, body)

        assert [row["kontakte"][seat]["einwilligung"]["confirmed_at"] for seat in SEATS] == [TODAY, None, TODAY]

    @pytest.mark.parametrize(
        ("confirmed", "newly"),
        [
            pytest.param("trainer", "stellvertretung", id="the Trainer confirmed, the seat they come to hold not"),
            pytest.param("stellvertretung", "trainer", id="the seat they also hold confirmed, the Trainer's not"),
        ],
    )
    def test_a_half_confirmed_pair_offers_and_confirms_only_the_seat_its_link_was_minted_for(
        self, mongo_replica_set_url: str, confirmed: str, newly: str
    ):
        """The page names what the press writes: no second seat, and the floor of the one seat the link answers.

        The earlier answer stands: its stamp, its date and its scope are the person's own, given on another day.
        """

        before = {**STORED_UNCONFIRMED, confirmed: stored("Ida", confirmed_at="2026-03-20"), newly: stored("Lea")}
        spent = {**compose_kontakt_bestaetigung(today="2026-03-10"), "token_hashes": [hash_token("the-link-already-answered")]}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, PAIRED)
            view = await ansicht(database, response.confirmations[0].token)
            await answer(database, response.confirmations[0].token)

            return response, view, await row_now(database)

        response, view, row = on_a_league(
            mongo_replica_set_url,
            body,
            kontakte=before,
            row_fields={"confirmations": {seat: spent if seat == confirmed else None for seat in SEATS}},
        )

        assert [mint.rollen for mint in response.confirmations] == [[newly]]
        assert (view.rolle, view.also_rolle, view.minimum_age) == (newly, None, SEAT_MIN_AGE_YEARS[newly])
        held = row["kontakte"][confirmed]
        assert (held["einwilligung"]["confirmed_at"], held["einwilligung"]["umfang"]) == ("2026-03-20", "kontaktdaten")
        assert row["kontakte"][newly]["einwilligung"]["confirmed_at"] == TODAY, "the press confirmed nothing, so this case proves nothing"

    def test_a_widerspruch_empties_the_seat_and_records_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            token = response.confirmations[2].token
            answered = await answer(database, token, antwort="declined")

            return answered, await row_now(database), await ansicht(database, token)

        answered, row, view = on_a_league(mongo_replica_set_url, body)

        assert (answered.quelle, answered.ergebnis, answered.geburtsdatum) == ("saison", "declined", None)
        assert row["kontakte"]["stellvertretung"] is None
        assert row["confirmations"]["stellvertretung"]["declined_at"] == TODAY
        assert view.state == "declined"

    def test_a_widerspruch_takes_its_seat_out_of_the_rows_log_and_leaves_the_others_earlier_states(self, mongo_replica_set_url: str):
        """Restore the redaction by document and this fails: Ida's earlier number exists in the log alone, and is hers."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await save(database, {**THREE, "trainer": {**person("Ida"), "telefon": TELEFON["Lea"]}})
            await answer(database, response.confirmations[2].token, antwort="declined")

            return (
                await database[Collection.ACTION_LOG]
                .find({"collection": str(Collection.SAISON_TEAMS), "document_id": ROW_OID})
                .sort("_id", 1)
                .to_list(length=None)
            )

        first_save, second_save, decline = on_a_league(mongo_replica_set_url, body)

        # The first save replaced a row holding nobody, so it held nothing of the person declining.
        assert (first_save["before"]["kontakte"], first_save["redacted_at"]) == (None, None)
        for entry in (second_save, decline):
            kontakte = entry["before"]["kontakte"]
            assert (kontakte["stellvertretung"], entry["redacted_at"]) == (None, REDACTED_AT)
            assert (kontakte["ansprechperson"]["vorname"], kontakte["trainer"]["vorname"]) == ("Jonas", "Ida")
            # The link stays with the seat in the image, as it does on the row, its decline recorded there.
            assert entry["before"]["confirmations"]["stellvertretung"] is not None
        assert second_save["before"]["kontakte"]["trainer"]["telefon"] == TELEFON["Ida"]

    def test_a_widerspruch_takes_the_seat_its_person_held_under_an_address_since_corrected(self, mongo_replica_set_url: str):
        """Match on the address alone and this fails: the mistyped address is in one image only, beside her name and number."""

        mistyped = {**THREE, "stellvertretung": {**person("Klara"), "email": "klara@exmaple.com"}}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await save(database, mistyped)
            corrected = await save(database, THREE)
            link = next(mint for mint in corrected.confirmations if "stellvertretung" in mint.rollen)
            await answer(database, link.token, antwort="declined")

            return (
                await database[Collection.ACTION_LOG]
                .find({"collection": str(Collection.SAISON_TEAMS), "document_id": ROW_OID})
                .sort("_id", 1)
                .to_list(length=None)
            )

        _, second_save, _ = on_a_league(mongo_replica_set_url, body)

        kontakte = second_save["before"]["kontakte"]
        assert (kontakte["stellvertretung"], second_save["redacted_at"]) == (None, REDACTED_AT)
        # Nobody else shares her name, so the two beside her keep their seats in that image.
        assert (kontakte["trainer"]["vorname"], kontakte["ansprechperson"]["vorname"]) == ("Ida", "Jonas")

    def test_a_widerspruch_is_taken_over_an_image_of_an_older_shape_in_the_rows_log(self, mongo_replica_set_url: str):
        """Read a seat without checking its shape and this answers 500: the redaction judges every image the row ever filed."""

        # The real clock: the retention index removes a row a year past `at_date`.
        recorded = datetime.now(UTC)
        older = {
            "_id": ObjectId("6890a1b2c3d4e5f607a5a001"),
            "at": log_stamp(recorded),
            "at_date": recorded,
            "actor": {"kind": "admin_session", "email": ADMIN},
            "trace_id": "0123456789abcdef",
            "request": {"method": "PATCH", "path": f"/api/v{API_VERSION}/teams/{TEAM_OID}/saisons/{SAISON_ID}/kontakte"},
            "collection": str(Collection.SAISON_TEAMS),
            "operation": "patch_one",
            "document_id": ROW_OID,
            "db_filter": None,
            # A seat held as one string, as no write today stores it.
            "before": {"_id": ROW_OID, "kontakte": {"trainer": "Ida Musterfrau", "ansprechperson": None, "stellvertretung": None}},
            "modified_count": None,
            "redacted_at": None,
            "anlass": None,
        }

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.ACTION_LOG].insert_one(older)
            response = await save(database, THREE)
            answered = await answer(database, response.confirmations[0].token, antwort="declined")

            return answered, await row_now(database), await database[Collection.ACTION_LOG].find_one({"_id": older["_id"]})

        answered, row, kept = on_a_league(mongo_replica_set_url, body)

        assert (answered.ergebnis, row["kontakte"]["trainer"]) == ("declined", None)
        # Nothing in it is an address, so nothing in it is judged theirs.
        assert (kept["before"], kept["redacted_at"]) == (older["before"], None)

    def test_a_second_answer_on_the_link_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await answer(database, response.confirmations[0].token)

            return await refused(answer(database, response.confirmations[0].token))

        assert on_a_league(mongo_replica_set_url, body) == Code.BEWERBUNG_SEAT_ALREADY_ANSWERED

    def test_a_link_opens_its_own_row_with_another_rows_link_seeded_first(self, mongo_replica_set_url: str):
        """The other club's row comes first in natural order, so a lookup that does not match on the hash lands there."""

        other = junction(
            OTHER_ROW_OID,
            OTHER_TEAM_OID,
            STORED_UNCONFIRMED,
            confirmations={
                "trainer": {**compose_kontakt_bestaetigung(today=TODAY), "token_hashes": [hash_token("the-other-clubs-link")]},
                "ansprechperson": None,
                "stellvertretung": None,
            },
            name="Falken",
            shorthand="FAX",
        )

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            view = await ansicht(database, response.confirmations[0].token)
            await answer(database, response.confirmations[0].token)

            return view, await row_now(database), await row_now(database, OTHER_ROW_OID)

        view, row, other_row = on_a_league(mongo_replica_set_url, body, rows=[other])

        assert view.schule == TEAM_NAME
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] == TODAY
        assert other_row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] is None


class TestTheDeadline:
    def test_a_link_past_its_deadline_reads_as_over_and_takes_no_consent(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            token = response.confirmations[0].token

            return (
                await ansicht(database, token, today=FRIST),
                await ansicht(database, token, today=AFTER_THE_DEADLINE),
                await refused(answer(database, token, today=AFTER_THE_DEADLINE)),
            )

        on_the_day, after, code = on_a_league(mongo_replica_set_url, body)

        assert on_the_day.state == "valid", "the deadline's own day still takes the link"
        assert after.state == "expired"
        assert code == Code.LINK_EXPIRED

    def test_a_resend_reopens_a_seat_whose_link_ran_out(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await save(database, THREE)
            fresh = await resend(database, "trainer", today=AFTER_THE_DEADLINE)

            return await answer(database, fresh.bestaetigung.token, today=AFTER_THE_DEADLINE)

        assert on_a_league(mongo_replica_set_url, body).ergebnis == "confirmed"


class TestABanAfterTheMint:
    """On a season row's link."""

    def test_the_view_answers_gesperrt_and_the_consent_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await ban(database, client, "ida@example.com")
            token = response.confirmations[0].token

            return await ansicht(database, token), await refused(answer(database, token)), await row_now(database)

        view, code, row = on_a_league(mongo_replica_set_url, body)

        assert view.state == "barred"
        assert code == Code.LINK_BARRED
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] is None

    def test_a_widerspruch_is_still_taken(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await ban(database, client, "ida@example.com")
            answered = await answer(database, response.confirmations[0].token, antwort="declined")

            return answered, await row_now(database)

        answered, row = on_a_league(mongo_replica_set_url, body)

        assert answered.ergebnis == "declined"
        assert row["kontakte"]["trainer"] is None

    def test_a_lift_inside_the_deadline_reopens_the_link(self, mongo_replica_set_url: str):
        """Nothing of the ban is written on the link's record, so lifting it is all a mistaken ban needs undone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await ban(database, client, "ida@example.com")
            await database[Collection.SPERRLISTE].delete_many({})
            token = response.confirmations[0].token

            return await ansicht(database, token), await answer(database, token, medien=True)

        view, answered = on_a_league(mongo_replica_set_url, body)

        assert view.state == "valid"
        # The answer carries the media consent it stored, as the application's does.
        assert (answered.ergebnis, answered.medien) == ("confirmed", True)


class TestARowsPeopleLeavingTakeTheirLinks:
    def test_a_replaced_club_s_links_open_nothing_on_the_incoming_club_s_row(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await replace(database)

            return [await refused(ansicht(database, mint.token)) for mint in response.confirmations], await row_now(database)

        codes, row = on_a_league(mongo_replica_set_url, body)

        assert codes == [Code.LINK_INVALID] * 3
        assert (row["team_id"], row["confirmations"]) == (INCOMING_TEAM_OID, None)

    def test_a_cleared_block_takes_every_link_with_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await save(database, None)

            return [await refused(ansicht(database, mint.token)) for mint in response.confirmations], await row_now(database)

        codes, row = on_a_league(mongo_replica_set_url, body)

        assert codes == [Code.LINK_INVALID] * 3
        assert row["confirmations"] is None

    def test_an_geloescht_person_s_link_opens_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await erased(database, database.client, "jonas@example.com", germany_now=NOW)

            return await refused(ansicht(database, response.confirmations[1].token))

        assert on_a_league(mongo_replica_set_url, body) == Code.LINK_INVALID

    def test_a_seat_emptied_beside_its_live_link_opens_nothing(self, mongo_replica_set_url: str):
        """The state no route leaves and a hand edit can: the slot gone, its link live, no Widerspruch recorded."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, THREE)
            await database[Collection.SAISON_TEAMS].update_one({"_id": ROW_OID}, {"$set": {"kontakte.ansprechperson": None}})

            return await refused(ansicht(database, response.confirmations[1].token))

        assert on_a_league(mongo_replica_set_url, body) == Code.LINK_INVALID


class TestTheStepUp:
    def test_a_save_emptying_a_seat_whose_link_is_live_from_an_old_sign_in_is_refused(self, mongo_replica_set_url: str):
        """Voiding a bearer link is a step-up write as minting one is: the person holding it loses their way to answer."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await save(database, THREE)
            before = await row_now(database)

            return (
                await refused(save(database, {**THREE, "stellvertretung": None}, actor=STALE_ADMIN_ACTOR)),
                before,
                await row_now(database),
            )

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == Code.CONFIRMATION_REQUIRED
        assert after == before

    def test_a_save_emptying_a_seat_whose_link_was_answered_from_an_old_sign_in_is_refused(self, mongo_replica_set_url: str):
        """An answered link opens nothing, but the seat's links on the team's open match confirmations die with it, unread here."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            first = await save(database, THREE)
            await answer(database, first.confirmations[0].token)
            before = await row_now(database)

            return (
                await refused(save(database, {**THREE, "trainer": None}, actor=STALE_ADMIN_ACTOR)),
                before,
                await row_now(database),
            )

        code, before, after = on_a_league(mongo_replica_set_url, body)

        assert code == Code.CONFIRMATION_REQUIRED
        assert after == before
        assert after["kontakte"]["trainer"] is not None

    def test_a_save_minting_nothing_takes_the_old_sign_in(self, mongo_replica_set_url: str):
        """The control, and what keeps an edit's undo: a telephone number moved seats nobody new."""

        edited = {**{seat: person(name) for seat, name in zip(SEATS, ("Ida", "Jonas", "Klara"), strict=True)}, "trainer_is_also": None}
        edited["trainer"] = {**edited["trainer"], "telefon": "+4917099999999"}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            return await save(database, edited, actor=STALE_ADMIN_ACTOR)

        assert on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED).confirmations == []


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
                        "confirmations": {
                            "trainer": {**compose_kontakt_bestaetigung(today=TODAY), "token_hashes": [hashes["trainer"]]},
                            "ansprechperson": None,
                            "stellvertretung": None,
                        },
                    }
                },
            )
            await database[Collection.BEWERBUNGEN].insert_one(
                documents.bewerbung_document(
                    ObjectId("6890a1b2c3d4e5f607a50021"),
                    SAISON_ID,
                    "submitted",
                    kontakte={seat: documents.kontaktperson_document(name) for seat, name in zip(SEATS, ("Ida", "Jonas", "Klara"), strict=True)}
                    | {"trainer_is_also": None},
                    submitted_at="2026-03-20",
                    confirmation_deadline=FRIST,
                    team_id=TEAM_OID,
                    link_prefix=raw,
                    sent_at=TODAY,
                )
            )
            view = await ansicht(database, f"{raw}-trainer")
            answered = await answer(database, f"{raw}-trainer", text_version=BEWERBER_SEITE)

            return view, answered

        view, answered = on_a_league(mongo_replica_set_url, body)

        assert (view.quelle, view.schule, view.rolle, view.row) == ("bewerbung", TEAM_NAME, "trainer", None)
        assert (answered.quelle, answered.ergebnis) == ("bewerbung", "confirmed")


class TestARowNoLongerInTheSeason:
    """Neither a `past` season nor a withdrawn team offers a seat to confirm, so a link there takes a Widerspruch alone."""

    @pytest.mark.parametrize(
        ("saison_status", "row_fields", "zeile"),
        [
            pytest.param("past", {}, "saison_past", id="a season that has ended"),
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
                "saison_past",
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
            token = response.confirmations[0].token
            view = await ansicht(database, token)
            consent = await refused(answer(database, token))

            return response, view, consent, await answer(database, token, antwort="declined"), await row_now(database)

        response, view, consent, widerspruch, row = on_a_league(mongo_replica_set_url, body, saison_status=saison_status, row_fields=row_fields)

        assert [(mint.rollen, mint.row) for mint in response.confirmations] == [
            (["trainer"], zeile),
            (["ansprechperson"], zeile),
            (["stellvertretung"], zeile),
        ]
        assert (view.state, consent, widerspruch.ergebnis) == ("saison_past", Code.KONTAKT_SAISON_PAST, "declined")
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

        assert code == Code.KONTAKT_ROW_WITHOUT_SAISON
        assert after == before


ITS_TEAM_LEFT: dict[str, Any] = {"$set": {"austritt": {"type": "rueckzug", "grund": "Keine Mannschaft mehr", "datum": "2026-04-01"}}}


class TestALinkOutlivingItsSeason:
    """A link minted while the season ran asks no consent once it has ended or the team left it."""

    async def closed(self, database: AsyncDatabase, how: str) -> None:
        if how in ("past", "both"):
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})
        if how in ("austritt", "both"):
            await database[Collection.SAISON_TEAMS].update_one({"_id": ROW_OID}, ITS_TEAM_LEFT)

    @pytest.mark.parametrize(
        ("how", "row"),
        [
            pytest.param("past", "saison_past", id="the season ended"),
            pytest.param("austritt", "ausgetreten", id="the team left"),
            # The season's end is what the page names: no team is still in a season that is over.
            pytest.param("both", "saison_past", id="the team left a season that has since ended"),
        ],
    )
    def test_its_view_offers_a_widerspruch_alone_and_its_refused_consent_writes_nothing(self, mongo_replica_set_url: str, how: str, row: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await save(database, THREE)).confirmations[0].token
            open_view = await ansicht(database, token)
            await self.closed(database, how)
            before = await row_now(database)

            return open_view, await ansicht(database, token), await refused(answer(database, token)), before, await row_now(database)

        open_view, view, code, before, after = on_a_league(mongo_replica_set_url, body)

        assert open_view.row == "open"
        assert (view.state, view.row) == ("saison_past", row)
        assert code == Code.KONTAKT_SAISON_PAST
        assert after == before

    def test_its_deadline_passing_too_reads_as_over(self, mongo_replica_set_url: str):
        """Past its own deadline the link takes no Widerspruch either (`link_expired`), so the page offers nothing."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await save(database, THREE)).confirmations[0].token
            await self.closed(database, "past")

            view = await ansicht(database, token, today=AFTER_THE_DEADLINE)

            return view, await refused(answer(database, token, antwort="declined", today=AFTER_THE_DEADLINE))

        view, code = on_a_league(mongo_replica_set_url, body)

        assert (view.state, code) == ("expired", Code.LINK_EXPIRED)

    @pytest.mark.parametrize("how", [pytest.param("past", id="the season ended"), pytest.param("austritt", id="the team left")])
    def test_a_widerspruch_on_it_is_still_taken(self, mongo_replica_set_url: str, how: str):
        """The person may always remove themselves, whatever became of the season."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await save(database, THREE)).confirmations[0].token
            await self.closed(database, how)
            answered = await answer(database, token, antwort="declined")

            return answered, await row_now(database), await ansicht(database, token)

        answered, row, reopened = on_a_league(mongo_replica_set_url, body)

        assert (answered.ergebnis, answered.medien) == ("declined", False)
        assert row["kontakte"]["trainer"] is None
        # Its answer outranks the closed row, as `barred` and `confirmed` do.
        assert reopened.state == "declined"


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
            # What makes the next season activatable (`activate_target_undrawn`).
            await database[Collection.SPIELE].insert_one(
                documents.spiel_document(spiel_id=ObjectId(), saison_id=NEXT_SAISON_ID, spiel_nr=1, spieltag_id=ObjectId())
            )
            token = (await save(database, THREE)).confirmations[0].token

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
        assert (ergebnis, row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"]) == ("confirmed", TODAY)
        assert passes == 1, "the press read the season again, so something it writes now conflicts with the rollover"


class TestTheLinkLookupWalksAnIndex:
    """Strangers drive both lookups a link press makes, so neither may scan its collection.

    Each lookup the handler sends is explained by the server (`tests/plans.py`): a filter rebuilt
    without its index goes red here.
    """

    def test_every_token_lookup_plans_an_index_scan(self, mongo_replica_set_url: str):
        lookups = (Collection.BEWERBUNGEN, Collection.SAISON_TEAMS)

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await save(database, THREE)).confirmations[0].token
            _, plans = await plans_of_sent_reads(
                mongo_replica_set_url,
                database,
                lambda watched, _client: ansicht(watched, token),
                lambda collection, command: collection in lookups and "$or" in (command.get("filter") or {}),
            )

            return plans

        plans = on_a_league(mongo_replica_set_url, body)

        # The premise: a lookup the handler never sent would pass the next line vacuously.
        assert sorted(collection for collection, _ in plans) == sorted(str(name) for name in lookups), plans
        assert all("IXSCAN" in plan and "COLLSCAN" not in plan for _, plan in plans), plans


def angenommene_bewerbung(trainer: Mapping[str, Any]) -> dict[str, Any]:
    """The accepted application this team entered the season through, its Trainer seat holding `trainer`."""

    return documents.bewerbung_document(
        ObjectId("6890a1b2c3d4e5f607a50031"),
        SAISON_ID,
        "accepted",
        kontakte={
            "trainer": dict(trainer),
            "ansprechperson": documents.kontaktperson_document("Jonas"),
            "stellvertretung": documents.kontaktperson_document("Klara"),
            "trainer_is_also": None,
        },
        submitted_at="2026-03-01",
        confirmation_deadline=FRIST,
        team_id=TEAM_OID,
        link_prefix="accepted",
        sent_at=TODAY,
    )


class TestThePageASeasonRowsLinkOpens:
    """A season row's seat reads the page true for its person, and its answer is judged against that page."""

    def test_a_link_answering_a_mixed_pair_shows_and_takes_one_page(self, mongo_replica_set_url: str):
        """A Trainer the applicant named, given a second seat by the editor: one link, judged against the page the view served for both.

        Judged seat by seat, each against its own page, no label could ever confirm this person.
        """

        def eingetragen(vorname: str, von: str) -> dict[str, Any]:
            seat = stored(vorname)
            return {**seat, "einwilligung": {**seat["einwilligung"], "entered_by": von}}

        paired = {
            **STORED_UNCONFIRMED,
            "trainer": eingetragen("Ida", "bewerbung"),
            "stellvertretung": eingetragen("Ida", "liga"),
            "trainer_is_also": "stellvertretung",
        }

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await resend(database, "stellvertretung")).bestaetigung.token
            view = await ansicht(database, token)
            refusal = await refused(answer(database, token, text_version=BEWERBER_SEITE))
            await answer(database, token, text_version=view.running_wording)

            return view, refusal, await row_now(database)

        view, refusal, row = on_a_league(mongo_replica_set_url, body, kontakte=paired)

        assert view.running_wording == SAISON_SEITE
        assert refusal == Code.WORDING_NOT_ALLOWED
        for seat in ("trainer", "stellvertretung"):
            assert (row["kontakte"][seat]["einwilligung"]["confirmed_at"], row["kontakte"][seat]["einwilligung"]["text_version"]) == (
                TODAY,
                SAISON_SEITE,
            )

    def test_a_seat_the_editor_entered_opens_the_season_rows_page_and_takes_its_label_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await save(database, THREE)).confirmations[0].token
            view = await ansicht(database, token)
            refusal = await refused(answer(database, token, text_version=BEWERBER_SEITE))
            unmoved = await row_now(database)
            await answer(database, token)

            return view, refusal, unmoved, await row_now(database)

        view, refusal, unmoved, row = on_a_league(mongo_replica_set_url, body)

        assert view.running_wording == SAISON_SEITE
        assert refusal == Code.WORDING_NOT_ALLOWED
        assert unmoved["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] is None, "the refused answer wrote"
        einwilligung = row["kontakte"]["trainer"]["einwilligung"]
        assert (einwilligung["confirmed_at"], einwilligung["text_version"]) == (TODAY, SAISON_SEITE)
        assert einwilligung["nachweis"]["umfang"]["text_version"] == SAISON_SEITE
        # The editor seated this person, and the answer leaves that standing.
        assert einwilligung["entered_by"] == "liga"

    def test_a_seat_stored_before_the_field_opens_the_season_rows_page_whoever_named_its_person(self, mongo_replica_set_url: str):
        """The accepted application named this person in this seat, and the link still opens the page true of a season row's link."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(angenommene_bewerbung(documents.kontaktperson_document("Ida")))
            token = (await resend(database, "trainer")).bestaetigung.token
            view = await ansicht(database, token)
            refusal = await refused(answer(database, token, text_version=BEWERBER_SEITE))

            return view, refusal, await answer(database, token)

        view, refusal, answered = on_a_league(mongo_replica_set_url, body, kontakte=STORED_UNCONFIRMED)

        assert (view.running_wording, refusal, answered.ergebnis) == (SAISON_SEITE, Code.WORDING_NOT_ALLOWED, "confirmed")

    def test_a_seat_carried_from_the_application_keeps_the_applicants_page(self, mongo_replica_set_url: str):
        """It names the application as who seated its person, so no application is asked and none needs to be kept."""

        carried = {
            **STORED_UNCONFIRMED,
            "trainer": {
                **STORED_UNCONFIRMED["trainer"],
                "einwilligung": {**STORED_UNCONFIRMED["trainer"]["einwilligung"], "entered_by": "bewerbung"},
            },
        }

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            token = (await resend(database, "trainer")).bestaetigung.token

            return await ansicht(database, token)

        assert on_a_league(mongo_replica_set_url, body, kontakte=carried).running_wording == BEWERBER_SEITE


ACCEPTED_OID = ObjectId("6890a1b2c3d4e5f607a50041")


def carried(vorname: str) -> dict[str, Any]:
    """A seat its own person confirmed on the application, carried onto the row with who seated them."""

    seat = stored(vorname, confirmed_at="2026-03-20")

    return {**seat, "einwilligung": {**seat["einwilligung"], "entered_by": "bewerbung"}}


def accepted(kontakte: Mapping[str, Any]) -> dict[str, Any]:
    """The application this team entered the season through, decided and kept for its retention."""

    return documents.bewerbung_document(
        ACCEPTED_OID,
        SAISON_ID,
        "accepted",
        kontakte=dict(kontakte),
        submitted_at="2026-03-01",
        team_id=TEAM_OID,
        decision={"made_at": "2026-03-25", "von": ADMIN, "grund": None},
    )


async def the_application(database: AsyncDatabase) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The accepted application and its log, oldest first."""

    application = await database[Collection.BEWERBUNGEN].find_one({"_id": ACCEPTED_OID})
    assert application is not None
    log = database[Collection.ACTION_LOG].find({"collection": str(Collection.BEWERBUNGEN), "document_id": ACCEPTED_OID}).sort("_id", 1)

    return application, await log.to_list(length=None)


class TestTheReplacementTakesThemOffTheApplication:
    """The row's page promises its people deletion at once when another club takes the place, and the application seated them first."""

    def test_people_the_editor_reseated_leave_the_application_with_the_row(self, mongo_replica_set_url: str):
        """Keep the application as it was and this fails: the page Ida was shown promised her deletion, and her number stays."""

        copied = {
            "trainer": carried("Ida"),
            "ansprechperson": carried("Jonas"),
            "stellvertretung": carried("Klara"),
            "trainer_is_also": None,
        }

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(accepted(copied))
            # Ida and Klara swap seats, so each is seated afresh and Ida's link opens the row's page.
            swapped = {
                "trainer": person("Klara"),
                "ansprechperson": person("Jonas"),
                "stellvertretung": person("Ida"),
                "trainer_is_also": None,
            }
            response = await save(database, swapped)
            link = next(mint for mint in response.confirmations if "stellvertretung" in mint.rollen)
            view = await ansicht(database, link.token)
            await replace(database)

            return view, *await the_application(database)

        view, application, log = on_a_league(mongo_replica_set_url, body, kontakte=copied)

        assert view.running_wording == SAISON_SEITE
        assert [seat for seat in SEATS if application["kontakte"][seat] is not None] == []
        assert log, "the clearing filed no image, so the log's assertion below proves nothing"
        assert [vorname for vorname in ("ida", "jonas", "klara") if f"{vorname}@example.com" in str((application, log))] == []

    def test_a_seat_whose_address_the_editor_corrected_leaves_it_by_name(self, mongo_replica_set_url: str):
        """Match the application on the address alone and this fails: it still spells Ida's address as the club first typed it."""

        applied = {
            "trainer": {**carried("Ida"), "email": "ida@exmaple.com"},
            "ansprechperson": carried("Jonas"),
            "stellvertretung": carried("Klara"),
            "trainer_is_also": None,
        }
        # The row as the editor left it: Ida's address corrected, and Jonas handed his seat to Lea.
        row = {"trainer": carried("Ida"), "ansprechperson": carried("Lea"), "stellvertretung": carried("Klara"), "trainer_is_also": None}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(accepted(applied))
            await replace(database)

            return await the_application(database)

        application, log = on_a_league(mongo_replica_set_url, body, kontakte=row)

        kontakte = application["kontakte"]
        assert (kontakte["trainer"], kontakte["stellvertretung"]) == (None, None)
        # Jonas left the row before the replacement, so he is nobody it takes out, there or in the log.
        assert kontakte["ansprechperson"]["vorname"] == "Jonas"
        assert [image["before"]["kontakte"]["ansprechperson"]["vorname"] for image in log] == ["Jonas"]
        assert "ida@exmaple.com" not in str(log)

    def test_a_seat_the_application_names_otherwise_leaves_its_log_by_address(self, mongo_replica_set_url: str):
        """Redact the application's images by name alone and this fails: they spell Ida's name as the club first typed it."""

        applied = {
            "trainer": {**carried("Ida"), "vorname": "Ida-Marie"},
            "ansprechperson": carried("Jonas"),
            "stellvertretung": carried("Klara"),
            "trainer_is_also": None,
        }
        row = {"trainer": carried("Ida"), "ansprechperson": carried("Jonas"), "stellvertretung": carried("Klara"), "trainer_is_also": None}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(accepted(applied))
            await replace(database)

            return await the_application(database)

        application, log = on_a_league(mongo_replica_set_url, body, kontakte=row)

        assert application["kontakte"]["trainer"] is None
        assert log, "the clearing filed no image, so the log's assertion below proves nothing"
        assert "ida@example.com" not in str(log)


class TestAConfirmedPersonMovedToANewMailbox:
    def test_is_linked_there_unconfirmed(self, mongo_replica_set_url: str):
        """The league's route for a person holding contact seats alone: the new mailbox confirms afresh."""

        confirmed = {**STORED_UNCONFIRMED, "trainer": stored("Ida", confirmed_at="2026-03-20")}

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            response = await save(database, {**THREE, "trainer": {**person("Ida"), "email": "ida@neu.example.com"}})

            return response, await row_now(database)

        response, row = on_a_league(mongo_replica_set_url, body, kontakte=confirmed)

        assert [(mint.rollen, mint.email) for mint in response.confirmations] == [(["trainer"], "ida@neu.example.com")]
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] is None
