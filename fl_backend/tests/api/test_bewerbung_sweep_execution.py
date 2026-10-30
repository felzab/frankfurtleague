import asyncio
import functools
import logging
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any, cast
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient, MongoClient, ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.admin_router import erneut_einwilligung
from app.api.bewerbungen.public_router import get_einwilligung_ansicht
from app.api.bewerbungen.services import SWEEP_PAGE, compose_confirmation_update
from app.api.bewerbungen.system_router import (
    BLOCKS_CLEARED_PER_PASS,
    REMINDERS_PER_PASS,
    get_sweep_saisons,
    sweep_saison,
)
from app.api.saisons.admin_router import activate_saison
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import delete_many_from_db, patch_one_in_db
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.logging import FL_LOGGER_NAME
from app.core.recording import SYSTEM_ACTOR_EMAIL
from app.main import create_app
from app.shared.schemas.bestaetigung import FLTokenPayload
from app.shared.schemas.literals import KONTAKT_ROLLEN
from app.shared.tokens import hash_token
from tests import documents
from tests.api import test_bewerbung_sweep_refusal as budget
from tests.app_client import app_client
from tests.bans import ban_list
from tests.config import ADMIN_AUTH, BASE_AUTH, SYSTEM_AUTH, build_test_config
from tests.database import a_clean_database, a_clean_database_sync, on_the_seed_loop
from tests.documents import (
    ban_document,
    kontaktperson_document,
    rules_document,
    saison_document,
    saison_team_document,
    spiel_document,
    team_document,
)
from tests.isolation import COMMITTED, InterleavedCollection, Rival, outcome_of
from tests.postausgang import MAIL_NOW, drained
from tests.wire import commands_by_name, commands_sent
from tests.worker import worker_database
from tests.zustellung import a_mail_that_bounced

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_bewerbung_sweep_test")

SAISON_ID = "2026"
NEXT_SAISON_ID = "2027"
SKIPPED_TO_SAISON_ID = "2028"
OTHER_SAISON_ID = "2025"
TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"
MAILED_ON_THE_MARK = "2026-03-29"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
REDACTED_AT = "2026-04-01T10:30:00+00:00"

# Fixed rather than generated, so a failure names the same row every run.
REMIND_OID = ObjectId("6890a1b2c3d4e5f607960001")
DELETE_OID = ObjectId("6890a1b2c3d4e5f607960002")
DECLINED_OID = ObjectId("6890a1b2c3d4e5f607960003")
ACCEPTED_OID = ObjectId("6890a1b2c3d4e5f607960004")
OTHER_SEASON_OID = ObjectId("6890a1b2c3d4e5f607960005")
CLUB_OID = ObjectId("6890a1b2c3d4e5f607960011")
JUNCTION_OID = ObjectId("6890a1b2c3d4e5f607960021")

CLUB_NAME = "Adler"
SCHOOL_NAME = "Zorbanax"


def first_hashes(prefix: str) -> dict[str, str]:
    return {seat: hash_token(f"{prefix}-{seat}") for seat in KONTAKT_ROLLEN}


# Sought by the leak search over the owed notices, so a surname reaching one is caught.
NACHNAME = "Mustermann"


def person(vorname: str, **fields: Any) -> dict[str, Any]:
    return kontaktperson_document(vorname, nachname=f"{vorname}-{NACHNAME}", **fields)


def kontakte() -> dict[str, Any]:
    """One person holding two seats, so the reminder's one mail a person has something to fold."""

    return {
        "trainer": person("Wraxlington"),
        "ansprechperson": person("Wraxlington"),
        "stellvertretung": person("Bramblewick"),
        "trainer_ist_zugleich": "ansprechperson",
    }


def application(bewerbung_id: ObjectId, *, saison_id: str = SAISON_ID, **overrides: Any) -> dict[str, Any]:
    # Each seat's first link minted from the application's id, as `first_hashes` reads it back.
    stored = documents.bewerbung_document(
        bewerbung_id,
        saison_id,
        "eingereicht",
        kontakte=kontakte(),
        eingereicht_am=MAILED_ON_THE_MARK,
        bestaetigungsfrist="2026-04-12",
        schule=documents.neue_schule_document(SCHOOL_NAME, "ZXX", full_name=f"{SCHOOL_NAME}-Gesamtschule", schulform="gesamtschule"),
    )

    return {**stored, **overrides}


def the_corpus() -> list[dict[str, Any]]:
    """One application per clock, plus one of another season that no call for `SAISON_ID` may touch."""

    return [
        application(REMIND_OID),
        application(DELETE_OID, bestaetigungsfrist=YESTERDAY),
        application(DECLINED_OID, status="abgelehnt", entscheidung={"getroffen_am": "2026-02-15", "von": "admin", "grund": "kein Platz"}),
        application(
            ACCEPTED_OID,
            status="angenommen",
            team_id=CLUB_OID,
            schule=None,
            entscheidung={"getroffen_am": "2026-03-01", "von": "admin", "grund": None},
        ),
        application(
            OTHER_SEASON_OID,
            saison_id=OTHER_SAISON_ID,
            status="abgelehnt",
            entscheidung={"getroffen_am": "2025-01-15", "von": "admin", "grund": "kein Platz"},
        ),
    ]


def season(saison_id: str, status: str) -> dict[str, Any]:
    return saison_document(saison_id, status, rules=rules_document(number_of_groups=2, teams_per_group=2))


def junction_row() -> dict[str, Any]:
    return saison_team_document(SAISON_ID, CLUB_OID, CLUB_NAME, "ADX", _id=JUNCTION_OID, trikot_farbe="blau", kontakte=kontakte())


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, next_status: str | None = "future", status: str = "active", mutates_schema: bool = False) -> Any:
    """The SHIPPED indexes, with a history on every row so the redaction has images to empty.

    `mutates_schema` for a body that installs a validator through `refuse_writes_breaking`.
    """

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            seasons = [season(SAISON_ID, status), season(OTHER_SAISON_ID, "past")]
            if next_status is not None:
                seasons.append(season(NEXT_SAISON_ID, next_status))
            await database[Collection.SAISONS].insert_many(seasons)
            await database[Collection.TEAMS].insert_one(team_document(CLUB_OID, CLUB_NAME, "ADX", website_url=None, schulform="gymnasium_g9"))
            await database[Collection.SAISON_TEAMS].insert_one(junction_row())
            await database[Collection.BEWERBUNGEN].insert_many(the_corpus())
            # One recorded write per row, so every one has a log image holding its people.
            for document in the_corpus():
                await patch_one_in_db(
                    collection=database[Collection.BEWERBUNGEN],
                    db_filter={"_id": document["_id"]},
                    update={"$set": {"kader.gute_spieler": 4}},
                    return_document=ReturnDocument.BEFORE,
                )
            await patch_one_in_db(
                collection=database[Collection.SAISON_TEAMS],
                db_filter={"_id": JUNCTION_OID},
                update={"$set": {"gruppe": "B"}},
                return_document=ReturnDocument.BEFORE,
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str = SAISON_ID, today: str = TODAY, now: datetime = NOW) -> Any:
    """One season's pass. A case reading the mails it owes passes `MAIL_NOW`, which its redaction stamps then carry."""

    return await sweep_saison(
        saison_id=saison_id,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        aktionen_collection=database[Collection.AKTIONEN],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        postausgang_collection=database[Collection.POSTAUSGANG],
        db=client,
        today=today,
        germany_now=now,
    )


async def ansicht(database: AsyncDatabase, token: str) -> Any:
    return await get_einwilligung_ansicht(
        ansicht_data=FLTokenPayload(token=token),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        sperrliste=ban_list(database),
        today=TODAY,
    )


async def stored(database: AsyncDatabase, bewerbung_id: ObjectId) -> Mapping[str, Any] | None:
    return await database[Collection.BEWERBUNGEN].find_one({"_id": bewerbung_id})


async def log_rows_naming(database: AsyncDatabase, collection: Collection, row_id: ObjectId) -> list[Mapping[str, Any]]:
    return await database[Collection.AKTIONEN].find({"collection": str(collection), "document_id": row_id}).to_list(length=None)


async def loeschung_rows(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return await database[Collection.AKTIONEN].find({"operation": "erase_many"}).sort("_id", 1).to_list(length=None)


async def owed(database: AsyncDatabase, art: str) -> list[Mapping[str, Any]]:
    """Every mail of one kind the Postausgang holds, by key: its key, its recipient and its facts."""

    rows = await database[Collection.POSTAUSGANG].find({"art": art}, {"_id": 0, "schluessel": 1, "an": 1, "daten": 1}).to_list(length=None)

    return sorted(rows, key=lambda row: str(row["schluessel"]))


async def reminded(database: AsyncDatabase) -> set[Any]:
    """The applications the reminder clock has owed a mail about."""

    rows = await database[Collection.POSTAUSGANG].find({"art": "bewerbung_erinnerung"}, {"bezug.id": 1}).to_list(length=None)

    return {row["bezug"]["id"] for row in rows}


async def refuse_the_submitters_address(database: AsyncDatabase, client: AsyncMongoClient, bewerbung_id: ObjectId) -> None:
    """The submitter's last mail, sent and refused by the provider: what the clocks read is what a drain and a real event leave."""

    await a_mail_that_bounced(database, client, bewerbung_id=bewerbung_id, sitz="ansprechperson", an="wraxlington@example.com")


CONFIRMED_GEBURTSDATUM = "1994-07-19"


async def confirm_every_seat(database: AsyncDatabase, bewerbung_id: ObjectId) -> None:
    """Every seat answered, through the production composer: an application in this state is what the fourteen-day clock stops reaching."""

    stored = await database[Collection.BEWERBUNGEN].find_one({"_id": bewerbung_id})
    assert stored is not None

    await patch_one_in_db(
        collection=database[Collection.BEWERBUNGEN],
        db_filter={"_id": bewerbung_id},
        update=compose_confirmation_update(
            kontakte=stored["kontakte"],
            seats=KONTAKT_ROLLEN,
            geburtsdatum=CONFIRMED_GEBURTSDATUM,
            today=MAILED_ON_THE_MARK,
            text_version="v3",
            whatsapp=False,
            medien=False,
            am=f"{MAILED_ON_THE_MARK}T08:00:00+00:00",
        ),
        return_document=ReturnDocument.BEFORE,
    )


async def resend(database: AsyncDatabase, seat: str) -> Any:
    return await erneut_einwilligung(
        bewerbung_id=REMIND_OID,
        seat=seat,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        postausgang_collection=database[Collection.POSTAUSGANG],
        sperrliste=ban_list(database),
        db=database.client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


def reminder_mail(an: str, rollen: list[str]) -> dict[str, Any]:
    """The reminder the corpus's application owes one person, as the Postausgang holds it."""

    return {
        "schluessel": f"{Collection.BEWERBUNGEN}/{REMIND_OID}/erinnerung/{rollen[0]}/{TODAY}",
        "an": an,
        "daten": {"art": "bewerbung_erinnerung", "saison_id": SAISON_ID, "schule": SCHOOL_NAME, "rollen": rollen, "frist": "2026-04-12"},
    }


class TestTheReminderClock:
    def test_it_stamps_every_due_seat_and_owes_one_mail_a_person(self, mongo_replica_set_url: str):
        """One mail for the double-seated person naming both seats; the deadline and the first links stand."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client, now=MAIL_NOW)

            return response, await owed(database, "bewerbung_erinnerung"), await stored(database, REMIND_OID)

        response, mails, document = on_a_league(mongo_replica_set_url, body)

        assert response.erinnert == 1
        assert mails == [
            reminder_mail("wraxlington@example.com", ["ansprechperson", "trainer"]),
            reminder_mail("bramblewick@example.com", ["stellvertretung"]),
        ]
        assert document is not None
        first = first_hashes(str(REMIND_OID))
        for rolle in KONTAKT_ROLLEN:
            bookkeeping = document["bestaetigungen"][rolle]
            # No link before the hand-out: the first one alone stands until the drain mints the reminder's beside it.
            assert bookkeeping["token_hashes"] == [first[rolle]]
            assert (bookkeeping["erinnert_am"], bookkeeping["verschickt_am"]) == (TODAY, MAILED_ON_THE_MARK)
        assert document["bestaetigungsfrist"] == "2026-04-12"

    def test_the_reminders_link_joins_the_first_and_both_open_the_seat(self, mongo_replica_set_url: str):
        """The reader still looking at the first mail is not punished by the chase."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, now=MAIL_NOW)
            mails = await drained(database, client)
            [paired] = [mail for mail in mails if mail.daten.art == "bewerbung_erinnerung" and mail.an == "wraxlington@example.com"]
            assert paired.token is not None

            return (
                await ansicht(database, f"{REMIND_OID}-trainer"),
                await ansicht(database, paired.token),
                paired.token,
                await stored(database, REMIND_OID),
            )

        old_view, new_view, token, document = on_a_league(mongo_replica_set_url, body)

        assert (old_view.zustand, old_view.rolle) == ("gueltig", "trainer")
        assert new_view.zustand == "gueltig"
        first = first_hashes(str(REMIND_OID))
        for rolle in ("trainer", "ansprechperson"):
            assert document["bestaetigungen"][rolle]["token_hashes"] == [first[rolle], hash_token(token)]

    def test_a_resend_after_a_reminder_voids_every_link_on_both_seats_the_person_holds(self, mongo_replica_set_url: str):
        """A re-send replaces the person's links, so nothing it replaces may still open the seat.

        Reached only through a reminded pair: a seat nobody mirrors has no second entry, and a fixture without the reminder no
        second hash.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, now=MAIL_NOW)
            reminders = {mail.an: mail.token for mail in await drained(database, client)}
            await resend(database, "trainer")
            [fresh] = await drained(database, client)
            assert fresh.token is not None

            # The reminder's shared link and BOTH first links, one of which is the mirrored seat's own copy -- the one a
            # re-send writing a single entry leaves open.
            tot = []
            for gone in (reminders["wraxlington@example.com"] or "", f"{REMIND_OID}-trainer", f"{REMIND_OID}-ansprechperson"):
                with pytest.raises(APIError) as conflict:
                    await ansicht(database, gone)
                tot.append(conflict.value.error_code)

            return (
                tot,
                (await ansicht(database, fresh.token)).zustand,
                # The Stellvertretung is nobody's pair, so its own reminder link is untouched.
                (await ansicht(database, reminders["bramblewick@example.com"] or "")).zustand,
                fresh.token,
                await stored(database, REMIND_OID),
            )

        tot, zustand, fremd_zustand, fresh_token, document = on_a_league(mongo_replica_set_url, body)

        assert tot == [Code.LINK_UNGUELTIG] * 3
        assert (zustand, fremd_zustand) == ("gueltig", "gueltig")
        assert document is not None
        # One link answering both, each entry written back as the create writes it, and the reminder owed again.
        for rolle in ("trainer", "ansprechperson"):
            assert document["bestaetigungen"][rolle] == {
                "token_hashes": [hash_token(fresh_token)],
                "verschickt_am": TODAY,
                "erinnert_am": None,
                "abgelehnt_am": None,
            }

    def test_a_second_run_the_same_day_reminds_nobody(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, now=MAIL_NOW)
            first = await owed(database, "bewerbung_erinnerung")
            second = await sweep(database, client, now=MAIL_NOW)

            return second.erinnert, first, await owed(database, "bewerbung_erinnerung")

        erinnert, first, after = on_a_league(mongo_replica_set_url, body)

        assert (erinnert, after) == (0, first)

    def test_no_raw_token_reaches_the_log_and_the_stamp_names_the_system(self, mongo_replica_set_url: str):
        """The stamping patch files the prior document -- hashes, never the raw tokens, which exist in the mails alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, now=MAIL_NOW)
            stamped = await log_rows_naming(database, Collection.BEWERBUNGEN, REMIND_OID)
            # The reminders' links: the fourteen-day notice beside them carries none.
            tokens = [mail.token for mail in await drained(database, client) if mail.daten.art == "bewerbung_erinnerung"]

            return tokens, stamped, await database[Collection.AKTIONEN].find({}).to_list(length=None)

        tokens, stamped, every_row = on_a_league(mongo_replica_set_url, body)

        rendered = str(every_row)
        assert tokens and not any(token is None or token in rendered for token in tokens)
        # The last row before the drain is the stamping patch; the seed's own patch sits before it.
        stamping = max(stamped, key=lambda row: row["_id"])
        assert stamping["operation"] == "patch_one"
        assert stamping["before"]["bestaetigungen"]["trainer"]["erinnert_am"] is None
        assert stamping["actor"]["email"] == SYSTEM_ACTOR_EMAIL


class TestTheFourteenDayClock:
    def test_the_pass_loescht_the_candidate_and_owes_the_submitter_the_notice_naming_who_never_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client, now=MAIL_NOW)

            return response, await stored(database, DELETE_OID), await owed(database, "bewerbung_loeschung")

        response, document, notices = on_a_league(mongo_replica_set_url, body)

        assert (response.geloescht, document) == (1, None)
        assert notices == [
            {
                "schluessel": f"{Collection.BEWERBUNGEN}/{DELETE_OID}/loeschung",
                "an": "wraxlington@example.com",
                "daten": {
                    "art": "bewerbung_loeschung",
                    "saison_id": SAISON_ID,
                    # Both seats this one person holds, so the notice names its reader by both.
                    "rollen": ["trainer", "ansprechperson"],
                    "ausstehend": [
                        {"vorname": "Wraxlington", "rollen": ["ansprechperson", "trainer"]},
                        {"vorname": "Bramblewick", "rollen": ["stellvertretung"]},
                    ],
                },
            }
        ]
        # First names alone: nothing else of the people outlives the application in the notice.
        assert NACHNAME not in str(notices)

    def test_the_loeschung_takes_exactly_the_due_application_and_redacts_its_rows(self, mongo_replica_set_url: str):
        """An application still inside its deadline, or another season's, stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return (
                response,
                await stored(database, REMIND_OID),
                await stored(database, OTHER_SEASON_OID),
                await log_rows_naming(database, Collection.BEWERBUNGEN, DELETE_OID),
                await loeschung_rows(database),
            )

        response, kept, other, rows, loeschungen = on_a_league(mongo_replica_set_url, body)

        assert response.geloescht == 1
        assert kept is not None and other is not None
        assert rows and all(row["before"] is None and row["redacted_at"] == REDACTED_AT for row in rows)
        # The erasure's own rows: no image, a filter naming the season and the ids and nothing else, the system as actor.
        # The filter is stored as text, so the id is found in it as text.
        fourteen_day = [row for row in loeschungen if str(DELETE_OID) in row["db_filter"]["_id"]]
        assert len(fourteen_day) == 1
        assert fourteen_day[0]["before"] is None
        assert set(fourteen_day[0]["db_filter"]) == {"saison_id", "_id"}
        assert fourteen_day[0]["actor"]["kind"] == "system"

    def test_a_widerspruchs_notice_stands_as_the_deletion_notice(self, mongo_replica_set_url: str):
        """It named the deletion day, so the erasure owes no second notice."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_one({"_id": DELETE_OID}, {"$set": {"loeschung_angekuendigt_am": "2026-03-30"}})
            response = await sweep(database, client, now=MAIL_NOW)

            return response.geloescht, await owed(database, "bewerbung_loeschung")

        assert on_a_league(mongo_replica_set_url, body) == (1, [])

    def test_an_emptied_ansprechperson_slot_is_geloescht_with_nobody_told(self, mongo_replica_set_url: str):
        """No mailbox is left to tell, which is not a refused address: the application cannot complete and goes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": DELETE_OID}, {"$set": {"kontakte.ansprechperson": None, "kontakte.trainer_ist_zugleich": None}}
            )
            response = await sweep(database, client, now=MAIL_NOW)

            return response.geloescht, await stored(database, DELETE_OID), await owed(database, "bewerbung_loeschung")

        assert on_a_league(mongo_replica_set_url, body) == (1, None, [])


class TestAnApplicationWhoseNoticeCannotArrive:
    """Held past the deadline for an administrator, never erased on a notice that cannot reach the submitter."""

    def test_the_pass_holds_it_and_owes_no_notice(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_submitters_address(database, client, DELETE_OID)
            response = await sweep(database, client, now=MAIL_NOW)

            return response.geloescht, await stored(database, DELETE_OID), await owed(database, "bewerbung_loeschung")

        geloescht, document, notices = on_a_league(mongo_replica_set_url, body)

        assert geloescht == 0
        assert document is not None, "an application whose deletion notice cannot be delivered was erased anyway"
        assert notices == []

    def test_a_seat_the_provider_refuses_is_not_reminded(self, mongo_replica_set_url: str):
        """The double-seated person is one mailbox: refusing it leaves the third seat as the only one due."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_submitters_address(database, client, REMIND_OID)
            await sweep(database, client, now=MAIL_NOW)

            return await owed(database, "bewerbung_erinnerung")

        assert on_a_league(mongo_replica_set_url, body) == [reminder_mail("bramblewick@example.com", ["stellvertretung"])]


# Composed by the production helper rather than spelled, so a drifted bound cannot leave these cases passing over a lapsed row.
STANDING = compose_gesperrt_bis_saison_id(massgebliche_saison_id=SAISON_ID)


# An address today's rule refuses, its local part being no ASCII: a stored row may hold one, and no
# ban can be keyed on it.
REFUSED_ADDRESS = "müller@example.com"


class TestABarredMailbox:
    """A reminder to an address the ban list holds is owed like any other, and the drain holds it: no link reaches it."""

    def test_an_address_the_rule_refuses_is_barred_by_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": REMIND_OID}, {"$set": {"kontakte.stellvertretung.email": REFUSED_ADDRESS}}
            )
            await sweep(database, client, now=MAIL_NOW)

            return [mail.an for mail in await drained(database, client)]

        assert REFUSED_ADDRESS in on_a_league(mongo_replica_set_url, body)

    def test_the_barred_mailbox_is_handed_nothing_and_its_seat_keeps_its_first_link_alone(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(ban_document("bramblewick@example.com", bis=STANDING))
            await sweep(database, client, now=MAIL_NOW)

            reminders = [mail.an for mail in await drained(database, client) if mail.daten.art == "bewerbung_erinnerung"]

            return reminders, await stored(database, REMIND_OID)

        sent, document = on_a_league(mongo_replica_set_url, body)

        # The control beside the refusal: the unbarred mailbox on the same application is chased.
        assert sent == ["wraxlington@example.com"]
        assert document is not None
        assert document["bestaetigungen"]["stellvertretung"]["token_hashes"] == [first_hashes(str(REMIND_OID))["stellvertretung"]]


# The Stellvertretung's stamp, the one seat nobody mirrors, each state the clocks' queries must read
# as `app/shared/einwilligung.py :: is_confirmed` reads it.
STELLVERTRETUNG_STAMP = "kontakte.stellvertretung.einwilligung.bestaetigt_am"
STAMP_STATES = [
    pytest.param({"$set": {STELLVERTRETUNG_STAMP: MAILED_ON_THE_MARK}}, False, id="confirmed, the control"),
    pytest.param({"$set": {STELLVERTRETUNG_STAMP: None}}, True, id="stamped null"),
    # No stamp at all, the field missing, which the query's null term has to reach as well.
    pytest.param({"$set": {"kontakte.stellvertretung": None}}, True, id="the seat erased"),
]


class TestTheClocksQueriesReadAStampAsThePredicateDoes:
    """In the query, where a row the predicate would take is otherwise never read to be judged."""

    @pytest.mark.parametrize(("update", "outstanding"), STAMP_STATES)
    def test_the_fourteen_day_clock_takes_an_application_whose_seat_is_unconfirmed(
        self, mongo_replica_set_url: str, update: Mapping[str, Any], outstanding: bool
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, DELETE_OID)
            await database[Collection.BEWERBUNGEN].update_one({"_id": DELETE_OID}, update)
            await sweep(database, client)

            return await stored(database, DELETE_OID) is None

        assert on_a_league(mongo_replica_set_url, body) is outstanding

    @pytest.mark.parametrize(
        ("update", "due"),
        [state for state in STAMP_STATES if state.id != "the seat erased"],
    )
    def test_the_reminder_chases_a_seat_whose_stamp_is_unconfirmed(self, mongo_replica_set_url: str, update: Mapping[str, Any], due: bool):
        """An erased seat has no address to chase, so it is the fourteen-day clock's case alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, REMIND_OID)
            await database[Collection.BEWERBUNGEN].update_one({"_id": REMIND_OID}, update)
            await sweep(database, client, now=MAIL_NOW)

            return await owed(database, "bewerbung_erinnerung")

        assert on_a_league(mongo_replica_set_url, body) == ([reminder_mail("bramblewick@example.com", ["stellvertretung"])] if due else [])


class TestTheOneMonthClock:
    def test_a_declined_application_a_month_old_is_geloescht_and_its_rows_redacted_in_the_first_call(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, DECLINED_OID), await log_rows_naming(database, Collection.BEWERBUNGEN, DECLINED_OID)

        response, document, rows = on_a_league(mongo_replica_set_url, body)

        assert (response.abgelehnte_geloescht, document) == (1, None)
        assert rows and all(row["before"] is None for row in rows)

    def test_another_seasons_application_is_not_reached(self, mongo_replica_set_url: str):
        """One season per call: the other season's declined application is a month old too and stays."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await stored(database, OTHER_SEASON_OID), await loeschung_rows(database)

        other, loeschungen = on_a_league(mongo_replica_set_url, body)

        assert other is not None
        # Floored as the case above floors its own rows: `all` over an empty corpus is true, so a sweep
        # that erased nothing would pass this while proving the opposite of what it claims.
        assert loeschungen, "the sweep erased nothing, so this proves no season was spared"
        assert all(row["db_filter"]["saison_id"] == SAISON_ID for row in loeschungen)


class TestTheSeasonsOwnEndClock:
    """The bound on an application nobody decided, which the fourteen-day clock drops as soon as every seat confirms."""

    def test_an_application_every_seat_confirmed_and_nobody_decided_is_geloescht_and_its_rows_redacted(self, mongo_replica_set_url: str):
        """Both submitted rows go, the confirmed one and the one past its deadline; a decided one is this clock's business at all."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, REMIND_OID)
            response = await sweep(database, client)

            return (
                response,
                await stored(database, REMIND_OID),
                await stored(database, DELETE_OID),
                await stored(database, ACCEPTED_OID),
                await log_rows_naming(database, Collection.BEWERBUNGEN, REMIND_OID),
                await loeschung_rows(database),
            )

        response, confirmed, past_its_deadline, accepted, rows, loeschungen = on_a_league(
            mongo_replica_set_url, body, status="past", next_status="active"
        )

        assert (response.ohne_entscheidung_geloescht, confirmed, past_its_deadline) == (2, None, None)
        # The accepted one is the successor season's business, and that season still runs.
        assert accepted is not None
        assert rows and all(row["before"] is None and row["redacted_at"] == REDACTED_AT for row in rows)
        assert all(row["db_filter"]["saison_id"] == SAISON_ID for row in loeschungen)

    def test_nothing_goes_while_the_season_still_runs(self, mongo_replica_set_url: str):
        """The row every other clock leaves standing: confirmed by all three, decided by nobody, and its deadline behind it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, REMIND_OID)
            response = await sweep(database, client)

            return response, await stored(database, REMIND_OID)

        response, confirmed = on_a_league(mongo_replica_set_url, body)

        assert response.ohne_entscheidung_geloescht == 0
        assert confirmed is not None

    def test_the_pass_offers_neither_a_reminder_nor_a_notice_for_a_row_this_clock_takes(self, mongo_replica_set_url: str):
        """The order is the whole of it: run after either, and the caller mails about an application this pass has erased."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client, now=MAIL_NOW)

            return response, await database[Collection.POSTAUSGANG].count_documents({})

        response, mails = on_a_league(mongo_replica_set_url, body, status="past", next_status="active")

        assert (response.erinnert, response.geloescht, mails) == (0, 0, 0)
        assert response.ohne_entscheidung_geloescht == 2

    def test_an_application_whose_notice_the_provider_refuses_goes_with_the_season(self, mongo_replica_set_url: str):
        """The hold that has no other end: `deletion_is_due` drops a refused address, so nothing else ever reaches this row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_submitters_address(database, client, DELETE_OID)
            response = await sweep(database, client)

            return response, await stored(database, DELETE_OID)

        response, document = on_a_league(mongo_replica_set_url, body, status="past", next_status="active")

        assert (response.ohne_entscheidung_geloescht, document) == (2, None)

    def test_a_second_pass_the_same_day_finds_nothing_left(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)

            return first.ohne_entscheidung_geloescht, (await sweep(database, client)).ohne_entscheidung_geloescht

        # The first count as well as the second: a clock taking nothing at all answers zero twice.
        assert on_a_league(mongo_replica_set_url, body, status="past", next_status="active") == (2, 0)


class TestTheSeasonAndOneClock:
    def test_nothing_goes_while_the_next_season_runs(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, ACCEPTED_OID), await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})

        response, document, row = on_a_league(mongo_replica_set_url, body, status="past", next_status="active")

        assert (response.angenommene_geloescht, response.kontaktbloecke_geleert) == (0, 0)
        assert document is not None and row is not None and row["kontakte"] is not None

    def test_the_application_goes_and_the_contact_block_empties_once_the_next_season_is_past(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return (
                response,
                await stored(database, ACCEPTED_OID),
                await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}),
                await log_rows_naming(database, Collection.SAISON_TEAMS, JUNCTION_OID),
            )

        response, document, row, junction_log = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert (response.angenommene_geloescht, response.kontaktbloecke_geleert, document) == (1, 1, None)
        assert row is not None and row["kontakte"] is None
        # The block's own keys survive around the clearing: the row is still a junction row.
        assert (row["gruppe"], row["trikot_farbe"]) == ("B", "blau")
        assert junction_log and all(entry["before"]["kontakte"] is None and entry["redacted_at"] == REDACTED_AT for entry in junction_log)

    def test_the_rows_earlier_states_stay_in_its_log_with_the_block_alone_emptied(self, mongo_replica_set_url: str):
        """Restore the redaction by document and this fails: the season's own history of the row is no person's to lose."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await log_rows_naming(database, Collection.SAISON_TEAMS, JUNCTION_OID)

        images = [entry["before"] for entry in on_a_league(mongo_replica_set_url, body, status="past", next_status="past")]

        # The seeded move into group B filed the row as it stood in A; the clearing filed it in B.
        assert sorted(image["gruppe"] for image in images) == ["A", "B"]
        # Seeded before links existed, so the redaction adds no block to its images either.
        assert all((image["trikot_farbe"], image["kontakte"], "bestaetigungen" in image) == ("blau", None, False) for image in images)

    @pytest.mark.parametrize("people", [pytest.param(kontakte(), id="beside their people"), pytest.param(None, id="left by an older image")])
    def test_the_rows_confirmation_links_and_their_delivery_records_go_too(self, mongo_replica_set_url: str, people: Any):
        """A link's entry carries a token hash and the delivery record of its message, neither of which has a clock of its own."""

        link = {
            "token_hash": "a" * 64,
            "verschickt_am": "2026-03-02",
            "frist": "2026-03-16",
            "abgelehnt_am": None,
            "zustellung": {"nachricht_id": "msg-1", "stand": "zugestellt", "grund": None, "am": "2026-03-02T10:00:00+01:00"},
        }

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one(
                {"_id": JUNCTION_OID},
                {"$set": {"kontakte": people, "bestaetigungen": {"trainer": link, "ansprechperson": None, "stellvertretung": None}}},
            )
            response = await sweep(database, client)

            return (
                response.kontaktbloecke_geleert,
                await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}),
                await log_rows_naming(database, Collection.SAISON_TEAMS, JUNCTION_OID),
            )

        geleert, row, log = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert geleert == 1
        assert row is not None and (row["kontakte"], row["bestaetigungen"]) == (None, None)
        # The clearing's own image held the link, beside a person or not, and loses it with the block.
        assert "msg-1" not in str(log)

    def test_a_season_with_no_successor_yet_keeps_everything(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response.angenommene_geloescht, response.kontaktbloecke_geleert

        assert on_a_league(mongo_replica_set_url, body, status="past", next_status=None) == (0, 0)

    @pytest.mark.parametrize(
        "between",
        [
            pytest.param(None, id="a year the league skipped"),
            pytest.param("future", id="a season planned and never run"),
            pytest.param("active", id="a lower season activated once the later one had run"),
        ],
    )
    def test_any_later_season_that_has_ended_ends_both(self, mongo_replica_set_url: str, between: str | None):
        """The year after stands `between`, and the one after has ended, when the rule drops this season's pupils.

        Read off the year after, the first two hold both clocks for ever, and the third past its pupils.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].insert_one(season(SKIPPED_TO_SAISON_ID, "past"))
            response = await sweep(database, client)

            return response.angenommene_geloescht, response.kontaktbloecke_geleert

        assert on_a_league(mongo_replica_set_url, body, status="past", next_status=between) == (1, 1)

    def test_the_running_season_keeps_both_whatever_later_season_has_ended(self, mongo_replica_set_url: str):
        """A lower season activated once a later one had run: it needs its contact persons while it runs.

        The rule keeps its pupils for as long, and these two clocks match it.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, ACCEPTED_OID), await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})

        response, document, row = on_a_league(mongo_replica_set_url, body, status="active", next_status="past")

        assert (response.angenommene_geloescht, response.kontaktbloecke_geleert) == (0, 0)
        assert document is not None and row is not None and row["kontakte"] is not None

    def test_a_running_season_whose_id_is_no_year_still_fails_the_pass(self, mongo_replica_set_url: str):
        """A running season reads no later one: judged inside that read, a hand-edited id would fail no pass while its season runs."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> None:
            await database[Collection.SAISONS].insert_one(season("abcd", "active"))
            with pytest.raises(ValueError):
                await sweep(database, client, saison_id="abcd")

        on_a_league(mongo_replica_set_url, body, status="past")


class _ThenTheRival:
    """A cursor running the rival once its rows have arrived; `sort` and `limit` chain as the driver's do."""

    def __init__(self, cursor: Any, rival: Callable[[], Awaitable[None]]) -> None:
        self._cursor = cursor
        self._rival = rival

    def sort(self, *args: Any, **kwargs: Any) -> _ThenTheRival:
        self._cursor = self._cursor.sort(*args, **kwargs)
        return self

    def limit(self, *args: Any, **kwargs: Any) -> _ThenTheRival:
        self._cursor = self._cursor.limit(*args, **kwargs)
        return self

    async def to_list(self, *args: Any, **kwargs: Any) -> list[Any]:
        rows = await self._cursor.to_list(*args, **kwargs)
        await self._rival()

        return rows


class ActivatedAfterTheClocksRead(InterleavedCollection):
    """The rows a clock reads first in its transaction, the season activated once that read has answered.

    The transaction has read by then, so only the season's anchor can make the two conflict.
    """

    def __init__(self, collection: Any, rival: Rival, *, clocks_read: Callable[[Mapping[str, Any]], bool]) -> None:
        async def reported() -> None:
            self.rival_outcome = await outcome_of(rival())

        super().__init__(collection, reported)
        self.rival_outcome: str | None = None
        self._clocks_read = clocks_read

    def find(self, *args: Any, **kwargs: Any) -> Any:
        cursor = self._collection.find(*args, **kwargs)
        if kwargs.get("session") is None or not self._clocks_read(kwargs.get("filter") or {}):
            return cursor

        return _ThenTheRival(cursor, self.run_the_rival)


# Far past the call's few seconds over two pages, and far short of a job's own budget.
DRAIN_BOUND_S = 60.0


class TestAnActivationInsideAnLoeschenTransactionKeepsTheSeasonsRows:
    @pytest.mark.parametrize(
        ("collection", "clocks_read", "expected"),
        [
            pytest.param(
                Collection.BEWERBUNGEN, lambda db_filter: db_filter.get("status") == "angenommen", (0, 0, True, True), id="the accepted clock's"
            ),
            # The accepted clock committed first, so its applications went before the season ran.
            pytest.param(Collection.SAISON_TEAMS, lambda _: True, (SWEEP_PAGE + 2, 0, False, True), id="the contact block's"),
        ],
    )
    def test_the_season_activated_keeps_what_the_transaction_had_not_taken(
        self,
        mongo_replica_set_url: str,
        collection: Collection,
        clocks_read: Callable[[Mapping[str, Any]], bool],
        expected: tuple[int, int, bool, bool],
    ):
        """Remove `pull_the_season_after`'s anchor and the planned season loses what it runs on.

        Planned below a season that has ended, so the call's own read finds both clocks due.
        """

        accepted = {"status": "angenommen", "entscheidung": {"getroffen_am": "2026-03-01", "von": "admin", "grund": None}}
        report = a_report(SAISON_ID)
        declined = a_declined_confirmation(CLUB_OID, SAISON_ID)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # A page and one more: a kept page answered as read drains for ever, which `DRAIN_BOUND_S` turns into a failure.
            await database[Collection.BEWERBUNGEN].insert_many(
                [application(numbered(position), **accepted) for position in range(SWEEP_PAGE + 1)]
            )
            # What makes the planned season activatable (`activate_target_undrawn`).
            await database[Collection.SPIELE].insert_one(
                spiel_document(spiel_id=numbered(SWEEP_PAGE + 1), saison_id=SAISON_ID, spiel_nr=1, spieltag_id=numbered(SWEEP_PAGE + 2))
            )
            # Both strips run after the activation committed and judge the season again in their own transactions.
            await database[Collection.SPIELBERICHTE].insert_one(report)
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(declined)

            async def activate() -> Any:
                return await activate_saison(
                    saison_id=SAISON_ID,
                    saisons_collection=database[Collection.SAISONS],
                    spiele_collection=database[Collection.SPIELE],
                    spieltage_collection=database[Collection.SPIELTAGE],
                    sperrliste_collection=database[Collection.SPERRLISTE],
                    db=client,
                )

            interleaved = ActivatedAfterTheClocksRead(database[collection], activate, clocks_read=clocks_read)

            def reaching(name: Collection) -> AsyncCollection:
                return cast(AsyncCollection, interleaved) if name == collection else database[name]

            response = await asyncio.wait_for(
                sweep_saison(
                    saison_id=SAISON_ID,
                    bewerbungen_collection=reaching(Collection.BEWERBUNGEN),
                    saison_teams_collection=reaching(Collection.SAISON_TEAMS),
                    saisons_collection=database[Collection.SAISONS],
                    teams_collection=database[Collection.TEAMS],
                    aktionen_collection=database[Collection.AKTIONEN],
                    spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                    spielberichte_collection=database[Collection.SPIELBERICHTE],
                    postausgang_collection=database[Collection.POSTAUSGANG],
                    db=client,
                    today=TODAY,
                    germany_now=NOW,
                ),
                timeout=DRAIN_BOUND_S,
            )
            junction_row = await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})
            report_now = await database[Collection.SPIELBERICHTE].find_one({"_id": report["_id"]})
            confirmation_now = await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": declined["_id"]})

            return (
                interleaved.rival_outcome,
                await database[Collection.SAISONS].find_one({"_id": SAISON_ID}),
                (
                    response.angenommene_geloescht,
                    response.kontaktbloecke_geleert,
                    await stored(database, ACCEPTED_OID) is not None,
                    junction_row is not None and junction_row["kontakte"] is not None,
                ),
                (report_now, confirmation_now),
            )

        outcome, activated, kept, (report_now, confirmation_now) = on_a_league(mongo_replica_set_url, body, status="future", next_status="past")

        # The premise first: the activation committed inside the clock's transaction.
        assert (outcome, activated is not None and activated["status"]) == (COMMITTED, "active")
        assert kept == expected
        assert report_now["bericht"]["bemerkungen"] == report["bericht"]["bemerkungen"], "the report strip ran past the activation"
        assert confirmation_now["antwort"]["begruendung"] == declined["antwort"]["begruendung"], "the confirmations' strip ran past it"


class TestASeasonNobodyHas:
    def test_the_pass_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundError):
                await sweep(database, client, saison_id="1999")

            return await database[Collection.BEWERBUNGEN].count_documents({}), await loeschung_rows(database)

        assert on_a_league(mongo_replica_set_url, body) == (5, [])


SECOND_OID = ObjectId("6890a1b2c3d4e5f607960007")
SECOND_CLUB_OID = ObjectId("6890a1b2c3d4e5f607960012")
SECOND_JUNCTION_OID = ObjectId("6890a1b2c3d4e5f607960022")

DECLINED = {"status": "abgelehnt", "entscheidung": {"getroffen_am": "2026-02-15", "von": "admin", "grund": "kein Platz"}}


async def refuse_writes_breaking(database: AsyncDatabase, collection: Collection, schema: Mapping[str, Any]) -> None:
    """How this suite forces one row's write to fail mid-pass: a `$jsonSchema` the planted row breaks and every other row keeps."""

    await database.command("collMod", str(collection), validator={"$jsonSchema": dict(schema)}, validationLevel="strict")


def refusing_its_redaction(collection: Collection, row: Mapping[str, Any]) -> dict[str, Any]:
    """A log image missing its `trace_id`, so the redaction's update is refused: any row a write is refused on."""

    return {
        "at": "2026-01-01T00:00:00+00:00",
        "at_date": datetime.now(UTC),
        "actor": {"kind": "system", "email": "SYSTEM"},
        "request": None,
        "collection": str(collection),
        "operation": "patch_one",
        "document_id": row["_id"],
        "db_filter": None,
        "before": dict(row),
        "modified_count": None,
        "redacted_at": None,
        "anlass": None,
    }


async def refuse_the_redaction_of(database: AsyncDatabase, collection: Collection, row_id: ObjectId) -> None:
    row = await database[collection].find_one({"_id": row_id})
    assert row is not None
    await database[Collection.AKTIONEN].insert_one(refusing_its_redaction(collection, row))
    await refuse_writes_breaking(database, Collection.AKTIONEN, {"required": ["trace_id"]})


# What the planted log image's refusal reads as on a passed-over line: the driver's type and the server's code.
REFUSED_TRACE_ID = "WriteError, code 121"

# A hand-edited deadline as the reminder's facts refuse it: the field and the rule, never the value.
REFUSED_DEADLINE = (
    "ValidationError: [{'loc': 'frist', 'type': 'string_pattern_mismatch', "
    "'msg': \"String should match pattern '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'\"}]"
)


def passed_over(caplog: pytest.LogCaptureFixture) -> list[tuple[Any, ...]]:
    return [
        (
            record.levelname,
            getattr(record, "error_code", None),
            getattr(record, "what", None),
            getattr(record, "row_id", None),
            getattr(record, "clock", None),
            getattr(record, "diagnosis", None),
        )
        for record in caplog.records
        if record.getMessage() == "transactions.row_passed_over"
    ]


class TestOneRowHoldsBackNoOther:
    """One case per write the call makes: with the site's isolation gone the whole call raises, every hour."""

    def test_a_refused_loeschung_at_the_seasons_end(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_redaction_of(database, Collection.BEWERBUNGEN, REMIND_OID)
            answer = await sweep(database, client)

            return (
                (answer.ohne_entscheidung_geloescht, answer.abgelehnte_geloescht, answer.fehlgeschlagen),
                await stored(database, REMIND_OID),
                await stored(database, DELETE_OID),
            )

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            counts, refused, other = on_a_league(mongo_replica_set_url, body, status="past", mutates_schema=True)

        # The decline clock after it ran too.
        assert counts == (1, 1, 1)
        assert (refused is not None, other) == (True, None)
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Application", str(REMIND_OID), "season's end", f"{REFUSED_TRACE_ID}")]

    def test_a_refused_loeschung_by_the_decline_clock(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(application(SECOND_OID, **DECLINED))
            await refuse_the_redaction_of(database, Collection.BEWERBUNGEN, DECLINED_OID)
            answer = await sweep(database, client, now=MAIL_NOW)

            return answer, await stored(database, DECLINED_OID), await stored(database, SECOND_OID), await reminded(database)

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answer, refused, other, chased = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert (answer.abgelehnte_geloescht, answer.fehlgeschlagen) == (1, 1)
        assert (refused is not None, other) == (True, None)
        # The clocks after it ran: the drive at the fork found the reminder unstamped and the call raising every pass.
        assert (chased, answer.geloescht) == ({REMIND_OID}, 1)
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Application", str(DECLINED_OID), "decline", f"{REFUSED_TRACE_ID}")]

    def test_a_refused_loeschung_by_the_acceptance_clock(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(
                application(SECOND_OID, status="angenommen", entscheidung={"getroffen_am": "2026-03-01", "von": "admin", "grund": None})
            )
            await refuse_the_redaction_of(database, Collection.BEWERBUNGEN, ACCEPTED_OID)
            answer = await sweep(database, client)

            return (
                (answer.angenommene_geloescht, answer.kontaktbloecke_geleert, answer.fehlgeschlagen),
                await stored(database, ACCEPTED_OID),
                await stored(database, SECOND_OID),
            )

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            counts, refused, other = on_a_league(mongo_replica_set_url, body, status="past", next_status="past", mutates_schema=True)

        assert counts == (1, 1, 1)
        assert (refused is not None, other) == (True, None)
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Application", str(ACCEPTED_OID), "acceptance", f"{REFUSED_TRACE_ID}")]

    def test_a_refused_contact_block(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].insert_one({**junction_row(), "_id": SECOND_JUNCTION_OID, "team_id": SECOND_CLUB_OID})
            await refuse_the_redaction_of(database, Collection.SAISON_TEAMS, JUNCTION_OID)
            answer = await sweep(database, client, now=MAIL_NOW)
            blocks = await database[Collection.SAISON_TEAMS].find({}, {"kontakte": 1}).sort("_id", 1).to_list(None)

            return answer, [(block["_id"], block["kontakte"] is not None) for block in blocks], await reminded(database)

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answer, blocks, chased = on_a_league(mongo_replica_set_url, body, status="future", next_status="past", mutates_schema=True)

        assert (answer.kontaktbloecke_geleert, answer.fehlgeschlagen, chased) == (1, 1, {REMIND_OID})
        assert blocks == [(JUNCTION_OID, True), (SECOND_JUNCTION_OID, False)]
        assert passed_over(caplog) == [
            ("ERROR", Code.DATABASE_FAILED, "Season team", str(JUNCTION_OID), "contact block", f"{REFUSED_TRACE_ID}")
        ]

    def test_a_refused_fourteen_day_loeschung(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(application(SECOND_OID, bestaetigungsfrist=YESTERDAY))
            await refuse_the_redaction_of(database, Collection.BEWERBUNGEN, DELETE_OID)
            answer = await sweep(database, client, now=MAIL_NOW)
            notices = await owed(database, "bewerbung_loeschung")

            return (answer.geloescht, answer.fehlgeschlagen), await stored(database, DELETE_OID), await stored(database, SECOND_OID), notices

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            geloeschte, refused, other, notices = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert (geloeschte, refused is not None, other) == ((1, 1), True, None)
        # The refused row's notice went with its transaction: nobody is told of an erasure that did not happen.
        assert [notice["schluessel"] for notice in notices] == [f"{Collection.BEWERBUNGEN}/{SECOND_OID}/loeschung"]
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Application", str(DELETE_OID), "fourteen-day", f"{REFUSED_TRACE_ID}")]

    def test_a_reminder_the_mail_cannot_carry(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A deadline the mail's facts refuse before any stamp is written, so the row is passed over and nothing taken apart."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(application(SECOND_OID, bestaetigungsfrist="2026-04-1"))
            answer = await sweep(database, client, now=MAIL_NOW)
            refused = await stored(database, SECOND_OID)
            assert refused is not None

            return await reminded(database), answer.fehlgeschlagen, [seat["erinnert_am"] for seat in refused["bestaetigungen"].values()]

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answered, count, stamps = on_a_league(mongo_replica_set_url, body)

        assert (answered, count, stamps) == ({REMIND_OID}, 1, [None, None, None])
        assert passed_over(caplog) == [("ERROR", Code.STORED_DATA_INVALID, "Application", str(SECOND_OID), "reminder", f"{REFUSED_DEADLINE}")]

    def test_a_refused_reminder_stamp(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """An application stored before a field it now requires: the reminder's stamp is refused under strict validation."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            invalid = {key: value for key, value in application(SECOND_OID).items() if key != "trikot"}
            await database[Collection.BEWERBUNGEN].insert_one(invalid)
            await refuse_writes_breaking(database, Collection.BEWERBUNGEN, {"required": ["trikot"]})
            # Inside: the level outside is whatever an earlier test on this worker left.
            with caplog.at_level(logging.INFO, logger=FL_LOGGER_NAME):
                answer = await sweep(database, client, now=MAIL_NOW)
            refused = await stored(database, SECOND_OID)
            assert refused is not None

            return await reminded(database), answer.fehlgeschlagen, [seat["erinnert_am"] for seat in refused["bestaetigungen"].values()]

        answered, count, stamps = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        # The refused row's mails went with its stamp: nobody is chased whose seat says they were not.
        assert (answered, count, stamps) == ({REMIND_OID}, 1, [None, None, None])
        refusal = "OperationFailure, code 121"
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Application", str(SECOND_OID), "reminder", f"{refusal}")]

    def test_a_pass_whose_every_reminder_fails_counts_them(self, mongo_replica_set_url: str):
        """Every stamp refused, so no half commits: the count is all that tells this pass from a clean one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_many({}, {"$unset": {"trikot": ""}})
            await refuse_writes_breaking(database, Collection.BEWERBUNGEN, {"required": ["trikot"]})
            answer = await sweep(database, client, now=MAIL_NOW)

            return answer.erinnert, answer.fehlgeschlagen, await reminded(database)

        assert on_a_league(mongo_replica_set_url, body, mutates_schema=True) == (0, 1, set())


@functools.cache
def _served() -> FastAPI:
    """One app for every case serving through it: building one costs more than the request a case sends through it.

    Built on first use rather than at import, which every xdist worker pays at collection.
    """

    return create_app(build_test_config())


def through_the_app(url: str, path: str, body: Mapping[str, Any] | None, *, auth: Mapping[str, str]) -> tuple[int, list[Mapping[str, Any]]]:
    """One call over the wire, so the guard, the system binder and the route template all run."""

    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, database_name)
        database[Collection.SAISONS].insert_many([season(SAISON_ID, "active"), season(OTHER_SAISON_ID, "past")])
        database[Collection.BEWERBUNGEN].insert_one(application(DELETE_OID, bestaetigungsfrist=YESTERDAY))

        async def _called() -> int:
            async with app_client(url, app=_served(), now=NOW) as http:
                response = await http.post(f"/api/v{API_VERSION}{path}", json=body, headers=dict(auth))
                return response.status_code

        status = asyncio.run(_called())

        return status, list(database[Collection.AKTIONEN].find({"operation": "erase_many"}))
    finally:
        client.close()


class TestTheSystemTierOverTheWire:
    """On the replica set: the erasure runs in a transaction, which a standalone mongod refuses outright."""

    def test_the_loeschung_records_the_system_actor_and_the_route_template(self, mongo_replica_set_url: str):
        """What `bind_system_actor` buys: the row names the machine and the endpoint, not an invented person or a raw path."""

        status, rows = through_the_app(mongo_replica_set_url, f"/bewerbungen/sweep/{SAISON_ID}", None, auth=SYSTEM_AUTH)

        assert status == 200
        assert len(rows) == 1
        assert rows[0]["actor"] == {"kind": "system", "email": SYSTEM_ACTOR_EMAIL}
        assert rows[0]["request"] == {"method": "POST", "path": f"/api/v{API_VERSION}/bewerbungen/sweep/{{saison_id}}"}

    @pytest.mark.parametrize("auth", [BASE_AUTH, ADMIN_AUTH], ids=("base", "admin"))
    def test_neither_other_key_reaches_it(self, mongo_replica_set_url: str, auth: Mapping[str, str]):
        """The other two keys are refused as the wrong credential before any body is read, so nothing is erased."""

        status, rows = through_the_app(mongo_replica_set_url, f"/bewerbungen/sweep/{SAISON_ID}", None, auth=auth)

        assert status == 401
        assert rows == []


class TestTheSeasonList:
    def test_every_season_is_listed_oldest_first_whatever_its_status(self, mongo_replica_set_url: str):
        """The rule keeps a `future` season off the base tier, and that is the season the clocks run over."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            return await get_sweep_saisons(saisons_collection=database[Collection.SAISONS])

        response = on_a_league(mongo_replica_set_url, body, next_status="future")

        assert response.saison_ids == [OTHER_SAISON_ID, SAISON_ID, NEXT_SAISON_ID]


def numbered(position: int) -> ObjectId:
    """One id per seeded row, clear of the fixed ids above."""

    return ObjectId(f"6890a1b2c3d4e5f6078{position:05d}")


def per_pass(taken: list[int], share: int, total: int) -> None:
    """Every pass takes its whole share until the last one, which takes the rest."""

    whole, rest = divmod(total, share)
    assert taken == [share] * whole + ([rest] if rest else [])


async def passes_until_empty(one_pass: Callable[[], Awaitable[int]], *, share: int, total: int) -> list[int]:
    """What each pass took, up to the first that took nothing: a clock that stops making progress fails here rather than spinning."""

    passes = -(-total // share)
    taken: list[int] = []
    for _ in range(passes + 1):
        if not (took := await one_pass()):
            return taken
        taken.append(took)

    raise AssertionError(f"{total} rows at {share} a pass take {passes} passes, and pass {passes + 1} still took rows: {taken}")


class TestEachCappedClockMakesProgressAcrossPasses:
    """More due rows than one share: a clock that took its share from the same page every pass would stall for ever."""

    def test_the_reminder_takes_its_share_earliest_deadline_first_and_the_passes_reach_every_row(self, mongo_replica_set_url: str):
        overflow = REMINDERS_PER_PASS + 5
        # The later deadlines seeded FIRST, so natural order would take the wrong share.
        frist_of = {position: "2026-04-12" if position < overflow - REMINDERS_PER_PASS else "2026-04-05" for position in range(overflow)}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many(
                [application(numbered(position), bestaetigungsfrist=frist) for position, frist in frist_of.items()]
            )

            first = await sweep(database, client, now=MAIL_NOW)
            first_deadlines = {mail["daten"]["frist"] for mail in await owed(database, "bewerbung_erinnerung")}

            async def one_pass() -> int:
                return (await sweep(database, client, now=MAIL_NOW)).erinnert

            taken = [first.erinnert, *await passes_until_empty(one_pass, share=REMINDERS_PER_PASS, total=overflow - first.erinnert)]

            stamped = await database[Collection.BEWERBUNGEN].count_documents({"bestaetigungen.trainer.erinnert_am": TODAY})

            return first_deadlines, taken, stamped

        first_deadlines, taken, stamped = on_a_league(mongo_replica_set_url, body)

        assert first_deadlines == {"2026-04-05"}
        per_pass(taken, REMINDERS_PER_PASS, overflow)
        assert stamped == overflow

    def test_the_contact_blocks_are_cleared_a_share_a_pass_until_none_is_left(self, mongo_replica_set_url: str):
        overflow = BLOCKS_CLEARED_PER_PASS + 5

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].delete_many({})
            await database[Collection.SAISON_TEAMS].insert_many(
                [{**junction_row(), "_id": numbered(position), "team_id": numbered(position)} for position in range(overflow)]
            )

            async def one_pass() -> int:
                return (await sweep(database, client)).kontaktbloecke_geleert

            taken = await passes_until_empty(one_pass, share=BLOCKS_CLEARED_PER_PASS, total=overflow)

            return taken, await database[Collection.SAISON_TEAMS].count_documents({"kontakte": {"$ne": None}})

        taken, standing = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        per_pass(taken, BLOCKS_CLEARED_PER_PASS, overflow)
        assert standing == 0

    def test_the_fourteen_day_clock_takes_a_page_and_one_more_in_one_pass_each_owed_its_notice(self, mongo_replica_set_url: str):
        """A drain rather than a share: the population filling a page is the one only the erasure shrinks."""

        overflow = SWEEP_PAGE + 1

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many(
                [application(numbered(position), bestaetigungsfrist=YESTERDAY) for position in range(overflow)]
            )
            response = await sweep(database, client, now=MAIL_NOW)

            return (
                response.geloescht,
                await database[Collection.BEWERBUNGEN].count_documents({"saison_id": SAISON_ID}),
                await database[Collection.POSTAUSGANG].count_documents({"art": "bewerbung_loeschung"}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (overflow, 0, overflow)


# Under the driver's first batch, so a page read is one command however many rows it holds.
FEW = 10


class TestEachPerRowLoopCostsTheRoundTripsItsShareIsSizedAt:
    """Counted on the wire, two runs apart by `FEW` rows: `AFTER` at the call site, or a second write a row, turns a case red."""

    def test_a_reminded_application(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.BEWERBUNGEN].insert_many([application(numbered(position)) for position in range(due)])

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, sweep)

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert (twice - few) / FEW == budget.ROUND_TRIPS_A_ROW

    @pytest.mark.parametrize(
        "refused",
        [
            pytest.param(lambda row: {**row, "bestaetigungsfrist": "2026-04-1"}, id="a deadline the answer refuses"),
            pytest.param(
                lambda row: {
                    **row,
                    "bestaetigungen": {seat: {**entry, "verschickt_am": "2026-03-1x"} for seat, entry in row["bestaetigungen"].items()},
                },
                id="a send date no judge can read",
            ),
        ],
    )
    def test_a_reminder_the_code_refuses_costs_only_the_write_it_skips(
        self, mongo_replica_set_url: str, refused: Callable[[dict[str, Any]], dict[str, Any]]
    ):
        """Taken apart instead, the share spends a failed attempt and its halves on the row."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(rows: list[dict[str, Any]]) -> int:
                # The first run's mails gone too: keys it owed would cost the second run no insert.
                await database[Collection.POSTAUSGANG].delete_many({})
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.BEWERBUNGEN].insert_many(rows)

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, sweep)

            rows = [application(numbered(position)) for position in range(FEW)]
            return await counted(rows), await counted([*rows[:-1], refused(rows[-1])])

        carryable, with_one_refused = on_a_league(mongo_replica_set_url, body)

        assert carryable - with_one_refused == budget.ROUND_TRIPS_A_ROW

    def test_a_cleared_contact_block(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                # No application at all, so the accepted clock erases nothing in either run.
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.SAISON_TEAMS].delete_many({})
                await database[Collection.SAISON_TEAMS].insert_many(
                    [{**junction_row(), "_id": numbered(position), "team_id": numbered(position)} for position in range(due)]
                )

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, sweep)

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert (twice - few) / FEW == budget.ROUND_TRIPS_A_ROW

    def test_an_geloescht_application_costs_nothing_a_row(self, mongo_replica_set_url: str):
        """The fourteen-day clock writes a page in its commands, never a command a row: no share bounds it."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.BEWERBUNGEN].insert_many(
                    [application(numbered(position), bestaetigungsfrist=YESTERDAY) for position in range(due)]
                )

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, sweep)

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert twice == few


def open_confirmation(team_id: ObjectId) -> dict[str, Any]:
    """One team's open row about a fixture, every seat holding the link it was mailed."""

    fixture = documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=None,
        datum="2026-04-18",
        uhrzeit="14:00:00",
        team1={"team_id": team_id},
        team2={"team_id": CLUB_OID},
    )

    return documents.spielbestaetigung_document(
        fixture,
        partei={"art": "team", "team_id": team_id},
        frist="2026-04-11",
        angefragt_am=TODAY,
        kontakte={seat: {"token_hashes": ["b" * 64], "zustellung": None} for seat in KONTAKT_ROLLEN},
    )


class TestTheWorstCallSendsTheCommandsItsBudgetCounts:
    """`tests/api/test_bewerbung_sweep_refusal.py`'s budget, its rows at the per-row cost and the rest as it names them.

    A command added to either call turns its case red, so the share is judged against the deadline again.
    """

    def test_the_sweep(self, mongo_replica_set_url: str):
        """Every clock takes a page, every conditional read is made: two applications name a club, the images take all three shapes.

        Two cleared clubs hold open confirmations, the void at its widest; the strip meets its worst images.
        """

        link = {"token_hash": "a" * 64, "verschickt_am": "2026-03-02", "frist": "2026-03-16", "abgelehnt_am": None, "zustellung": None}
        links = {"trainer": link, "ansprechperson": None, "stellvertretung": None}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await database[Collection.BEWERBUNGEN].update_many(
                {"_id": {"$in": [REMIND_OID, DELETE_OID]}}, {"$set": {"team_id": CLUB_OID, "schule": None}}
            )
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    {**junction_row(), "_id": numbered(1), "team_id": numbered(1), "kontakte": None, "bestaetigungen": links},
                    {**junction_row(), "_id": numbered(2), "team_id": numbered(2), "bestaetigungen": links},
                ]
            )
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many([open_confirmation(CLUB_OID), open_confirmation(numbered(2))])
            await images_of_every_strip_edit_set(database, client)
            await report_images_of_every_shape(database, client)

            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, sweep)

        answer, names = on_a_league(mongo_replica_set_url, body, status="future", next_status="past")
        rows = answer.erinnert + answer.kontaktbloecke_geleert

        assert (answer.abgelehnte_geloescht, answer.angenommene_geloescht, answer.geloescht, rows) == (1, 1, 1, 4)
        assert sum(names.values()) - budget.ROUND_TRIPS_A_ROW * rows == budget.SWEEP_OTHER_COMMANDS, names


class TestAPageAndOneMoreIsDrained:
    """A page and a short one after it.

    At a page plus ONE the first read would take every row, so a clock that stopped after its first
    erasure would leave nothing behind and pass.
    """

    def test_every_declined_application_due_goes_in_one_pass(self, mongo_replica_set_url: str):
        overflow = SWEEP_PAGE + 5
        declined = {"status": "abgelehnt", "entscheidung": {"getroffen_am": "2026-02-15", "von": "admin", "grund": None}}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many([application(numbered(position), **declined) for position in range(overflow)])
            response = await sweep(database, client)

            return response.abgelehnte_geloescht, await database[Collection.BEWERBUNGEN].count_documents({"saison_id": SAISON_ID})

        assert on_a_league(mongo_replica_set_url, body) == (overflow, 0)

    def test_every_undecided_application_goes_in_one_pass_once_the_season_is_past(self, mongo_replica_set_url: str):
        overflow = SWEEP_PAGE + 5

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many([application(numbered(position)) for position in range(overflow)])
            response = await sweep(database, client)

            return response.ohne_entscheidung_geloescht, await database[Collection.BEWERBUNGEN].count_documents({"saison_id": SAISON_ID})

        assert on_a_league(mongo_replica_set_url, body, status="past", next_status="active") == (overflow, 0)

    def test_every_accepted_application_goes_in_one_pass_once_the_next_season_is_past(self, mongo_replica_set_url: str):
        overflow = SWEEP_PAGE + 5
        accepted = {
            "status": "angenommen",
            "team_id": CLUB_OID,
            "schule": None,
            "entscheidung": {"getroffen_am": "2026-03-01", "von": "admin", "grund": None},
        }

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many([application(numbered(position), **accepted) for position in range(overflow)])
            response = await sweep(database, client)

            return response.angenommene_geloescht, await database[Collection.BEWERBUNGEN].count_documents({"saison_id": SAISON_ID})

        assert on_a_league(mongo_replica_set_url, body, status="past", next_status="past") == (overflow, 0)

    def test_a_page_of_decisions_inside_their_month_does_not_hide_one_that_is_due(self, mongo_replica_set_url: str):
        """The fresh decisions are seeded first, so a read not narrowed to the due ones fills its page with them and refuses the pass."""

        fresh = {"status": "abgelehnt", "entscheidung": {"getroffen_am": "2026-03-31", "von": "admin", "grund": None}}
        due = {"status": "abgelehnt", "entscheidung": {"getroffen_am": "2026-02-15", "von": "admin", "grund": None}}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            seeded = [application(numbered(position), **fresh) for position in range(SWEEP_PAGE + 1)]
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many([*seeded, application(numbered(SWEEP_PAGE + 1), **due)])

            return (await sweep(database, client)).abgelehnte_geloescht

        assert on_a_league(mongo_replica_set_url, body) == 1


# A club the season replaced: its season row went to the incoming club, so no block clearing names its rows.
REPLACED_CLUB_OID = ObjectId("6890a1b2c3d4e5f6079600f1")


def a_declined_confirmation(team_id: ObjectId, saison_id: str) -> dict[str, Any]:
    """A team row its Trainer declined with a reason, closed since, every seat holding a link and the delivery record of its mail."""

    fixture = documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=saison_id,
        spiel_nr=1,
        spieltag_id=None,
        datum=f"{saison_id}-04-18",
        uhrzeit="14:00:00",
        team1={"team_id": team_id},
        team2={"team_id": CLUB_OID},
    )
    delivered = {"nachricht_id": "msg-1", "stand": "zugestellt", "grund": None, "am": f"{saison_id}-04-02T09:00:00+00:00"}

    return documents.spielbestaetigung_document(
        fixture,
        partei={"art": "team", "team_id": team_id},
        angefragt_am=f"{saison_id}-04-01",
        kontakte={seat: {"token_hashes": ["b" * 64], "zustellung": delivered} for seat in KONTAKT_ROLLEN},
        antwort=documents.kontakt_antwort_document("trainer", "trainer@example.com", begruendung="Wir sind auf Klassenfahrt"),
        geschlossen={"am": f"{saison_id}-04-19", "grund": "spiel_vergangen"},
    )


# The server's first batch for a cursor naming no size: one imaged row more takes the strip's image read a `getMore`.
IMAGES_A_FIRST_BATCH = 101


def a_strip_edit_set(mask: int, begruendung: bool, halter: bool) -> dict[str, Any]:
    """A row holding the seats `mask` names and, where asked, a reason and a holder digest: one set of fields the strip nulls."""

    row = a_declined_confirmation(CLUB_OID, SAISON_ID)
    row["kontakte"] = {seat: row["kontakte"][seat] if mask >> bit & 1 else None for bit, seat in enumerate(KONTAKT_ROLLEN)}
    antwort = row["antwort"]
    row["antwort"] = (
        {
            **antwort,
            "begruendung": antwort["begruendung"] if begruendung else None,
            "von": {**antwort["von"], "halter": antwort["von"]["halter"] if halter else None},
        }
        if begruendung or halter
        else None
    )

    return row


async def images_of_every_strip_edit_set(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """An image for each set of fields the strip can null, single images past the read's first batch, and an undraw's list.

    A reason and a digest apart: an administrator's settle reason holds no digest, a Zusage no reason.
    """

    edit_sets = [
        (mask, begruendung, halter)
        for mask in range(2 ** len(KONTAKT_ROLLEN))
        for begruendung in (False, True)
        for halter in (False, True)
        if mask or begruendung or halter
    ]
    confirmations = database[Collection.SPIELBESTAETIGUNGEN]
    for position in range(IMAGES_A_FIRST_BATCH + 1):
        row = a_strip_edit_set(*edit_sets[position % len(edit_sets)])
        await confirmations.insert_one(row)
        await patch_one_in_db(
            collection=confirmations, db_filter={"_id": row["_id"]}, update={"$set": {"erinnert_am": []}}, return_document=ReturnDocument.BEFORE
        )

    # An undraw's removal, whose one log row holds every removed row's image in a list.
    undrawn = [a_strip_edit_set(1, True, True), a_strip_edit_set(2, False, True)]
    await confirmations.insert_many(undrawn)
    async with client.start_session() as session:
        await session.with_transaction(
            lambda session: delete_many_from_db(
                collection=confirmations, db_filter={"_id": {"$in": [row["_id"] for row in undrawn]}}, session=session
            )
        )


async def report_images_of_every_shape(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    """Report images whose reasons sit at different card positions, remarks or none, and an undraw's list of two.

    One update serves every single image: a set per card index would grow the call with the data.
    """

    berichte = database[Collection.SPIELBERICHTE]
    singles = [a_report(SAISON_ID), a_report(SAISON_ID, bemerkungen=None), a_report(SAISON_ID, rot_grund=None)]
    singles[1]["bericht"]["karten"].reverse()
    for report in singles:
        await berichte.insert_one(report)
        await patch_one_in_db(
            collection=berichte,
            db_filter={"_id": report["_id"]},
            update={"$inc": {"bericht.version": 1}},
            return_document=ReturnDocument.BEFORE,
        )

    undrawn = [a_report(SAISON_ID), a_report(SAISON_ID, bemerkungen=None)]
    await berichte.insert_many(undrawn)
    async with client.start_session() as session:
        await session.with_transaction(
            lambda session: delete_many_from_db(
                collection=berichte, db_filter={"_id": {"$in": [row["_id"] for row in undrawn]}}, session=session
            )
        )


class TestTheReportStripStandsApart:
    def test_a_strip_failing_holds_back_neither_the_confirmations_nor_a_block_and_is_passed_over_under_the_season(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """A report the installed validator refuses once stripped: the report strip alone meets it, in its own transaction."""

        refused = a_report(SAISON_ID)
        del refused["bericht"]["seiten"]
        declined = a_declined_confirmation(CLUB_OID, SAISON_ID)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBERICHTE].insert_one(refused)
            await refuse_writes_breaking(database, Collection.SPIELBERICHTE, {"properties": {"bericht": {"required": ["seiten"]}}})
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(declined)
            with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
                response = await sweep(database, client)
            return (
                response,
                await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}),
                await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": declined["_id"]}),
                await database[Collection.SPIELBERICHTE].find_one({"_id": refused["_id"]}),
            )

        response, junction, confirmation, report = on_a_league(
            mongo_replica_set_url, body, status="past", next_status="past", mutates_schema=True
        )

        assert (response.kontaktbloecke_geleert, response.fehlgeschlagen, junction["kontakte"]) == (1, 1, None)
        assert confirmation["antwort"]["begruendung"] is None, "the confirmations' strip fell with the reports'"
        assert report["bericht"]["bemerkungen"] == refused["bericht"]["bemerkungen"], "the failed strip left a write behind"
        assert [(level, what, row_id, clock) for level, _, what, row_id, clock, _ in passed_over(caplog)] == [
            ("ERROR", "Season", SAISON_ID, "report strip")
        ]


class TestTheSeasonsEndStripsItsConfirmations:
    def test_its_team_rows_and_their_images_keep_the_answer_alone_and_another_season_keeps_everything(self, mongo_replica_set_url: str):
        """The club's own row, a replaced club's no clearing names, and the next season's row as the control; each with an image."""

        rows = {
            "own": a_declined_confirmation(CLUB_OID, SAISON_ID),
            "replaced": a_declined_confirmation(REPLACED_CLUB_OID, SAISON_ID),
            "next season": a_declined_confirmation(CLUB_OID, NEXT_SAISON_ID),
        }

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            await confirmations.insert_many([dict(row) for row in rows.values()])
            for row in rows.values():
                await patch_one_in_db(
                    collection=confirmations,
                    db_filter={"_id": row["_id"]},
                    update={"$set": {"erinnert_am": []}},
                    return_document=ReturnDocument.BEFORE,
                )
            response = await sweep(database, client)
            stored = {name: await confirmations.find_one({"_id": row["_id"]}) for name, row in rows.items()}
            images = {
                name: (await database[Collection.AKTIONEN].find_one({"document_id": row["_id"], "before": {"$ne": None}}) or {})["before"]
                for name, row in rows.items()
            }

            return response, stored, images

        response, stored, images = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        # The premise: the pass cleared the season's one block, which is what owes the strip.
        assert response.kontaktbloecke_geleert == 1
        kept = rows["own"]["antwort"]
        stripped = {**kept, "begruendung": None, "von": {**kept["von"], "halter": None}}
        for name in ("own", "replaced"):
            for left in (stored[name], images[name]):
                assert (left["antwort"], left["kontakte"]) == (stripped, dict.fromkeys(KONTAKT_ROLLEN)), name
        for left in (stored["next season"], images["next season"]):
            assert (left["antwort"], left["kontakte"]) == (rows["next season"]["antwort"], rows["next season"]["kontakte"])

    def test_a_season_with_no_block_left_to_clear_is_stripped_all_the_same(self, mongo_replica_set_url: str):
        """The club entered no contacts, as a replacement's incoming side holds none: no pass clears a block of the season."""

        row = a_declined_confirmation(CLUB_OID, SAISON_ID)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"_id": JUNCTION_OID}, {"$set": {"kontakte": None, "bestaetigungen": None}})
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(row)
            response = await sweep(database, client)
            return response, await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": row["_id"]})

        response, stripped = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert (response.kontaktbloecke_geleert, response.fehlgeschlagen) == (0, 0)
        assert (stripped["antwort"]["begruendung"], stripped["antwort"]["von"]["halter"], stripped["kontakte"]) == (
            None,
            None,
            dict.fromkeys(KONTAKT_ROLLEN),
        )

    def test_a_strip_failing_holds_back_no_block_and_is_passed_over_under_the_season(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """A replaced club's row the installed validator refuses, which no block clearing writes: the strip alone meets it."""

        refused = {key: value for key, value in a_declined_confirmation(REPLACED_CLUB_OID, SAISON_ID).items() if key != "frist"}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(refused)
            await refuse_writes_breaking(database, Collection.SPIELBESTAETIGUNGEN, {"required": ["frist"]})
            with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
                response = await sweep(database, client)
            return response, await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})

        response, junction = on_a_league(mongo_replica_set_url, body, status="past", next_status="past", mutates_schema=True)

        assert (response.kontaktbloecke_geleert, response.fehlgeschlagen, junction["kontakte"]) == (1, 1, None)
        assert [(level, what, row_id, clock) for level, _, what, row_id, clock, _ in passed_over(caplog)] == [
            ("ERROR", "Season", SAISON_ID, "confirmation strip")
        ]

    def test_an_administrators_settle_reason_goes_and_their_answer_gains_no_holder(self, mongo_replica_set_url: str):
        settled = {
            **a_declined_confirmation(CLUB_OID, SAISON_ID),
            "antwort": {"art": "abgelehnt", "am": "2026-04-03", "von": {"art": "admin"}, "vorschlag": None, "begruendung": "Platz gesperrt"},
        }

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(settled)
            await sweep(database, client)
            return await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": settled["_id"]})

        stripped = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert stripped["antwort"] == {**settled["antwort"], "begruendung": None}

    def test_a_referee_rows_reason_goes_and_its_answer_stays(self, mongo_replica_set_url: str):
        """Settled for the referee with a reason, the next season's twin the control; each patched once, so the log holds its image."""

        def referee_row(saison_id: str) -> dict[str, Any]:
            return {
                **a_declined_confirmation(CLUB_OID, saison_id),
                "partei": {"art": "schiedsrichter", "schiedsrichter_id": ObjectId()},
                "kontakte": None,
                "antwort": {
                    "art": "zugesagt",
                    "am": f"{saison_id}-04-03",
                    "von": {"art": "admin"},
                    "vorschlag": None,
                    "begruendung": "Telefonisch",
                },
            }

        rows = {"this season": referee_row(SAISON_ID), "next season": referee_row(NEXT_SAISON_ID)}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            await confirmations.insert_many([dict(row) for row in rows.values()])
            for row in rows.values():
                await patch_one_in_db(
                    collection=confirmations,
                    db_filter={"_id": row["_id"]},
                    update={"$set": {"erinnert_am": []}},
                    return_document=ReturnDocument.BEFORE,
                )
            await sweep(database, client)
            stored = {name: await confirmations.find_one({"_id": row["_id"]}) for name, row in rows.items()}
            images = {
                name: (await database[Collection.AKTIONEN].find_one({"document_id": row["_id"], "before": {"$ne": None}}) or {})["before"]
                for name, row in rows.items()
            }

            return stored, images

        stored, images = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        # Never an object of three nulls: a referee row holds no seat to strip.
        for left in (stored["this season"], images["this season"]):
            assert (left["antwort"], left["kontakte"]) == ({**rows["this season"]["antwort"], "begruendung": None}, None)
        for left in (stored["next season"], images["next season"]):
            assert left["antwort"] == rows["next season"]["antwort"]


def a_report(
    saison_id: str, *, bemerkungen: str | None = "Starker Regen ab der Pause.", rot_grund: str | None = "taetlichkeit"
) -> dict[str, Any]:
    """A report with a named scorer and two cards, a caution with its reason and a red card with or without one."""

    karten = [
        {"seite": "team2", "spieler_id": ObjectId(), "minute": "45+2", "farbe": "gelb", "grund": "foulspiel"},
        {"seite": "team1", "spieler_id": ObjectId(), "minute": "80", "farbe": "rot", "grund": rot_grund},
    ]

    return documents.spielbericht_document(
        {"_id": ObjectId(), "saison_id": saison_id}, bericht=documents.bericht_document(bemerkungen=bemerkungen, karten=karten)
    )


class TestTheSeasonsEndStripsItsReports:
    def test_the_remarks_and_card_reasons_go_from_reports_and_images_and_another_season_keeps_them(self, mongo_replica_set_url: str):
        """The scorers, the cards and the proposed result stay: the record of the match."""

        reports = {
            "this season": a_report(SAISON_ID),
            # No remarks, and a card already without a reason: what a filter on a null reason passes over.
            "this season, no remarks": a_report(SAISON_ID, bemerkungen=None, rot_grund=None),
            "next season": a_report(NEXT_SAISON_ID),
        }
        # Removed in one write, so their images sit in one log row's list, as a referee erasure's repoint of several reports
        # leaves them: the shape a path naming no index cannot reach.
        undrawn = [a_report(SAISON_ID), a_report(SAISON_ID, bemerkungen=None)]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            berichte = database[Collection.SPIELBERICHTE]
            await berichte.insert_many([dict(report) for report in (*reports.values(), *undrawn)])
            async with client.start_session() as session:
                await session.with_transaction(
                    lambda session: delete_many_from_db(
                        collection=berichte, db_filter={"_id": {"$in": [report["_id"] for report in undrawn]}}, session=session
                    )
                )
            for report in reports.values():
                # A logged write, so an image holds the remarks and reasons too.
                await patch_one_in_db(
                    collection=berichte,
                    db_filter={"_id": report["_id"]},
                    update={"$inc": {"bericht.version": 1}},
                    return_document=ReturnDocument.BEFORE,
                )
            response = await sweep(database, client)
            redacted = {
                kind: await database[Collection.AKTIONEN].count_documents({"redacted_at": {"$ne": None}, "collection": selector})
                for kind, selector in (("reports", "spielberichte"), ("others", {"$ne": "spielberichte"}))
            }
            stored = {name: (await berichte.find_one({"_id": report["_id"]}) or {})["bericht"] for name, report in reports.items()}
            images = {
                name: (await database[Collection.AKTIONEN].find_one({"document_id": report["_id"], "before": {"$ne": None}}) or {})["before"][
                    "bericht"
                ]
                for name, report in reports.items()
            }
            removal = await database[Collection.AKTIONEN].find_one({"collection": "spielberichte", "operation": "delete_many"})

            return response, stored, images, (removal or {})["before"], redacted

        response, stored, images, removed, redacted = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert response.fehlgeschlagen == 0
        # The three log rows this season's strip redacted, the undraw's among them, join the pass's count beside every
        # other clock's.
        assert redacted["reports"] == 3
        assert [(image["bericht"]["bemerkungen"], [karte["grund"] for karte in image["bericht"]["karten"]]) for image in removed] == [
            (None, [None, None])
        ] * len(undrawn)
        assert response.redigierte_aktionen == redacted["reports"] + redacted["others"]
        for name in ("this season", "this season, no remarks"):
            kept = reports[name]["bericht"]
            for left in (stored[name], images[name]):
                assert left["bemerkungen"] is None, name
                assert left["karten"] == [{**karte, "grund": None} for karte in kept["karten"]], name
                assert (left["torschuetzen"], left["ergebnis_vorschlag"]) == (kept["torschuetzen"], kept["ergebnis_vorschlag"]), name
        for left in (stored["next season"], images["next season"]):
            assert (left["bemerkungen"], left["karten"]) == (
                reports["next season"]["bericht"]["bemerkungen"],
                reports["next season"]["bericht"]["karten"],
            )
