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

from app.api.bewerbungen import sweep_router as sweep_router_module
from app.api.bewerbungen.admin_router import erneut_einwilligung
from app.api.bewerbungen.einwilligung_router import get_einwilligung_ansicht
from app.api.bewerbungen.schemas import (
    DELETIONS_LISTED_PER_PASS,
    FLBewerbungEinwilligungAnsichtPayload,
    FLBewerbungSweepAngekuendigtPayload,
    FLBewerbungSweepLoeschenPayload,
    FLBewerbungZustellungAngenommenPayload,
    FLBewerbungZustellungEreignisPayload,
)
from app.api.bewerbungen.services import (
    BEWERBUNG_TOKEN_UNKNOWN,
    SWEEP_PAGE,
    build_erinnerung_filter,
    compose_confirmation_update,
    hash_token,
)
from app.api.bewerbungen.sweep_router import (
    BLOCKS_CLEARED_PER_PASS,
    REMINDERS_PER_PASS,
    angekuendigt_bewerbungen,
    get_sweep_saisons,
    loeschen_bewerbungen,
    sweep_saison,
)
from app.api.bewerbungen.zustellung_router import angenommen_zustellung, post_zustellung
from app.api.saisons.admin_router import activate_saison
from app.api.sperrliste.services import compose_gesperrt_bis_saison_id
from app.api.teams.schemas import KONTAKT_ROLLEN
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import delete_many_from_db, patch_one_in_db
from app.core.exception_handlers import DATABASE_FAILED, STORED_DATA_INVALID
from app.core.exceptions import DocumentNotFoundException, WriteRefusalException
from app.core.logging import FL_LOGGER_NAME
from app.core.recording import SYSTEM_ACTOR_EMAIL
from app.main import create_app
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
from tests.wire import commands_by_name, commands_sent
from tests.worker import worker_database

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

# One pass an hour, as `fl_frontend/src/features/bewerbungen/sweep.ts :: SWEEP_INTERVAL_MS` sets it.
PASSES_A_DAY = 24

# Fixed rather than generated, so a failure names the same row every run.
REMIND_OID = ObjectId("6890a1b2c3d4e5f607960001")
DELETE_OID = ObjectId("6890a1b2c3d4e5f607960002")
DECLINED_OID = ObjectId("6890a1b2c3d4e5f607960003")
ACCEPTED_OID = ObjectId("6890a1b2c3d4e5f607960004")
OTHER_SEASON_OID = ObjectId("6890a1b2c3d4e5f607960005")
BARRED_OID = ObjectId("6890a1b2c3d4e5f607960006")
CLUB_OID = ObjectId("6890a1b2c3d4e5f607960011")
JUNCTION_OID = ObjectId("6890a1b2c3d4e5f607960021")

CLUB_NAME = "Adler"
SCHOOL_NAME = "Zorbanax"


def first_hashes(prefix: str) -> dict[str, str]:
    return {seat: hash_token(f"{prefix}-{seat}") for seat in KONTAKT_ROLLEN}


# Sought by the leak search over the candidates, so a surname reaching one is caught.
NACHNAME = "Mustermann"


def person(vorname: str, **fields: Any) -> dict[str, Any]:
    return kontaktperson_document(vorname, nachname=f"{vorname}-{NACHNAME}", **fields)


def kontakte() -> dict[str, Any]:
    """One person holding two seats, so the reminder's grouping has something to group."""

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
        schule=documents.neue_schule_document(SCHOOL_NAME, "ZX", full_name=f"{SCHOOL_NAME}-Gesamtschule", schulform="gesamtschule"),
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
    return saison_team_document(SAISON_ID, CLUB_OID, CLUB_NAME, "AD", _id=JUNCTION_OID, trikot_farbe="blau", kontakte=kontakte())


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, next_status: str | None = "future", status: str = "active") -> Any:
    """The SHIPPED validators, with a history on every row so the redaction has images to empty."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            seasons = [season(SAISON_ID, status), season(OTHER_SAISON_ID, "past")]
            if next_status is not None:
                seasons.append(season(NEXT_SAISON_ID, next_status))
            await database[Collection.SAISONS].insert_many(seasons)
            await database[Collection.TEAMS].insert_one(team_document(CLUB_OID, CLUB_NAME, "AD", website_url=None, schulform="gymnasium_g9"))
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


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str = SAISON_ID, today: str = TODAY) -> Any:
    return await sweep_saison(
        saison_id=saison_id,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        aktionen_collection=database[Collection.AKTIONEN],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        sperrliste=ban_list(database),
        db=client,
        today=today,
        germany_now=NOW,
    )


async def announce(
    database: AsyncDatabase, client: AsyncMongoClient, ids: list[ObjectId], saison_id: str = SAISON_ID, today: str = TODAY
) -> Any:
    return await angekuendigt_bewerbungen(
        saison_id=saison_id,
        angekuendigt_data=FLBewerbungSweepAngekuendigtPayload(bewerbung_ids=ids),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saisons_collection=database[Collection.SAISONS],
        db=client,
        today=today,
    )


async def erase(database: AsyncDatabase, client: AsyncMongoClient, ids: list[ObjectId], saison_id: str = SAISON_ID) -> Any:
    return await loeschen_bewerbungen(
        saison_id=saison_id,
        loeschen_data=FLBewerbungSweepLoeschenPayload(bewerbung_ids=ids),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saisons_collection=database[Collection.SAISONS],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def ansicht(database: AsyncDatabase, token: str) -> Any:
    return await get_einwilligung_ansicht(
        ansicht_data=FLBewerbungEinwilligungAnsichtPayload(token=token),
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


async def erasure_rows(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    return await database[Collection.AKTIONEN].find({"operation": "erase_many"}).sort("_id", 1).to_list(length=None)


# One message id and the two instants around it, so the delivery state below arrives the way the
# provider's own does rather than being written into the document by hand.
MESSAGE_ID = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"
ACCEPTED_AT = "2026-03-29T10:00:00Z"
REFUSED_AT = "2026-03-29T10:05:00Z"


async def refuse_the_submitters_address(database: AsyncDatabase, client: AsyncMongoClient, bewerbung_id: ObjectId) -> None:
    """Send to the mailbox that would read the deletion notice, and have the provider refuse it.

    Through the endpoints rather than a hand-written state: what the clock reads has to be what a
    real event leaves.
    """

    seats = ["trainer", "ansprechperson"]
    await angenommen_zustellung(
        angenommen_data=FLBewerbungZustellungAngenommenPayload.model_validate(
            {"bewerbung_id": str(bewerbung_id), "rollen": seats, "nachricht_id": MESSAGE_ID, "am": ACCEPTED_AT}
        ),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        db=client,
    )
    await post_zustellung(
        ereignis_data=FLBewerbungZustellungEreignisPayload.model_validate(
            {
                "bewerbung_id": str(bewerbung_id),
                "rollen": seats,
                "nachricht_id": MESSAGE_ID,
                "stand": "unzustellbar",
                "grund": "NoEmail",
                "am": REFUSED_AT,
            }
        ),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        db=client,
    )


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


class TestTheReminderClock:
    def test_it_stamps_mints_and_answers_one_message_per_mailbox(self, mongo_replica_set_url: str):
        """One message for the double-seated person with two fresh links.

        The first hashes are kept and the deadline untouched (`docs/backend/spec.md :: I152`).
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, REMIND_OID)

        response, document = on_a_league(mongo_replica_set_url, body)

        assert document is not None
        reminders = [entry for entry in response.erinnerungen if entry.bewerbung_id == REMIND_OID]
        # ONE link for the double-seated person, naming both seats: a second one would ask one reader
        # twice over a decision `paired_seat` settles from either press, and mint a token nobody is
        # sent (`docs/backend/spec.md :: I157`).
        assert [(entry.email, [seat.rollen for seat in entry.seats]) for entry in reminders] == [
            ("wraxlington@example.com", [["trainer", "ansprechperson"]]),
            ("bramblewick@example.com", [["stellvertretung"]]),
        ]
        assert reminders[0].schule == SCHOOL_NAME and reminders[0].bestaetigungsfrist == "2026-04-12"
        assert reminders[0].seats[0].vorname == "Wraxlington"

        first = first_hashes(str(REMIND_OID))
        for entry in reminders:
            for seat in entry.seats:
                # Every seat the link answers carries it, so the stamp and the fresh hash reach both
                # halves of the pair and neither is reminded again.
                for rolle in seat.rollen:
                    bookkeeping = document["bestaetigungen"][rolle]
                    assert bookkeeping["token_hash"] == hash_token(seat.token)
                    assert bookkeeping["token_hash_zuvor"] == first[rolle]
                    assert (bookkeeping["erinnert_am"], bookkeeping["verschickt_am"]) == (TODAY, MAILED_ON_THE_MARK)
        assert document["bestaetigungsfrist"] == "2026-04-12"

        # One mint for the pair, not two: the second was a live credential with no reader.
        minted = {seat.token for entry in reminders for seat in entry.seats}
        assert len(minted) == 2

    def test_a_resend_after_a_reminder_voids_every_link_on_both_seats_the_person_holds(self, mongo_replica_set_url: str):
        """A re-send replaces the address, so nothing it replaces may still open the seat.

        Reached only through a reminded pair: the re-send suite's fixture has no second hash, and a
        seat nobody mirrors has no second entry at all.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)
            erinnert = next(
                seat.token
                for entry in response.erinnerungen
                if entry.bewerbung_id == REMIND_OID
                for seat in entry.seats
                if "trainer" in seat.rollen
            )
            frisch = await erneut_einwilligung(
                bewerbung_id=REMIND_OID,
                seat="trainer",
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                sperrliste=ban_list(database),
                db=database.client,
                today=TODAY,
            )

            # The reminder's shared link and BOTH first links, one of which is the mirrored seat's
            # own copy -- the one a re-send writing a single entry leaves open.
            tot = []
            for gone in (erinnert, f"{REMIND_OID}-trainer", f"{REMIND_OID}-ansprechperson"):
                with pytest.raises(WriteRefusalException) as conflict:
                    await ansicht(database, gone)
                tot.append(conflict.value.error_code)

            # The Stellvertretung is nobody's pair, so its own reminder link is untouched.
            fremd = next(
                seat.token
                for entry in response.erinnerungen
                if entry.bewerbung_id == REMIND_OID
                for seat in entry.seats
                if "stellvertretung" in seat.rollen
            )

            return (
                tot,
                (await ansicht(database, frisch.token)).zustand,
                (await ansicht(database, fremd)).zustand,
                frisch.token,
                await stored(database, REMIND_OID),
            )

        tot, zustand, fremd_zustand, frisch_token, document = on_a_league(mongo_replica_set_url, body)

        assert tot == [BEWERBUNG_TOKEN_UNKNOWN] * 3
        assert (zustand, fremd_zustand) == ("gueltig", "gueltig")
        assert document is not None
        # One mint answering both, each entry written back as the first mint writes it: `token_hash`
        # alone, no `token_hash_zuvor` beside it, and the reminder owed again.
        for rolle in ("trainer", "ansprechperson"):
            assert document["bestaetigungen"][rolle] == {
                "token_hash": hash_token(frisch_token),
                "verschickt_am": TODAY,
                "erinnert_am": None,
                "abgelehnt_am": None,
            }

    def test_both_links_open_the_seat_afterwards(self, mongo_replica_set_url: str):
        """The reader still looking at the first email is not punished by the chase."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)
            fresh = next(
                seat.token
                for entry in response.erinnerungen
                if entry.bewerbung_id == REMIND_OID
                for seat in entry.seats
                if "trainer" in seat.rollen
            )

            return await ansicht(database, f"{REMIND_OID}-trainer"), await ansicht(database, fresh)

        old_view, new_view = on_a_league(mongo_replica_set_url, body)

        assert (old_view.zustand, old_view.rolle) == ("gueltig", "trainer")
        assert (new_view.zustand, new_view.rolle) == ("gueltig", "trainer")

    def test_a_second_run_the_same_day_reminds_nobody(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            second = await sweep(database, client)

            return second.erinnerungen

        assert on_a_league(mongo_replica_set_url, body) == []

    def test_no_raw_token_reaches_the_log_and_the_row_names_the_system(self, mongo_replica_set_url: str):
        """The stamping patch files the prior document -- hashes, never the raw tokens that leave only in the response."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)
            rows = await log_rows_naming(database, Collection.BEWERBUNGEN, REMIND_OID)

            return [seat.token for entry in response.erinnerungen for seat in entry.seats], rows

        tokens, rows = on_a_league(mongo_replica_set_url, body)

        rendered = str(rows)
        assert tokens and not any(token in rendered for token in tokens)
        # The last row is the stamping patch; the seed's own patch sits before it.
        stamping = max(rows, key=lambda row: row["_id"])
        assert stamping["operation"] == "patch_one"
        assert stamping["before"]["bestaetigungen"]["trainer"]["erinnert_am"] is None
        assert stamping["actor"]["email"] == SYSTEM_ACTOR_EMAIL


class TestTheFourteenDayClock:
    def test_the_first_call_lists_the_candidate_with_what_the_notice_needs_and_no_hash(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, DELETE_OID)

        response, document = on_a_league(mongo_replica_set_url, body)

        assert document is not None, "the first call erased what it may only list"
        assert [entry.bewerbung_id for entry in response.loeschungen] == [DELETE_OID]
        candidate = response.loeschungen[0]
        assert (candidate.schule, candidate.bestaetigungsfrist, candidate.ansprechperson_email) == (
            SCHOOL_NAME,
            YESTERDAY,
            "wraxlington@example.com",
        )
        # Both seats this one mailbox holds, so the notice names its reader by both rather than by
        # the Ansprechperson alone, which the reader would read as the wrong person's message.
        assert candidate.ansprechperson_rollen == ["trainer", "ansprechperson"]
        assert candidate.angekuendigt is False, "a candidate nobody has been told about reads as announced"
        assert [(seat.rolle, seat.vorname) for seat in candidate.ausstehend] == [
            ("trainer", "Wraxlington"),
            ("ansprechperson", "Wraxlington"),
            ("stellvertretung", "Bramblewick"),
        ]
        # The candidates alone: the reminders beside them carry their raw tokens by design.
        rendered = str([entry.model_dump(mode="json") for entry in response.loeschungen])
        assert "token" not in rendered and NACHNAME not in rendered

    def test_the_erasure_takes_exactly_the_announced_ids_and_redacts_their_rows(self, mongo_replica_set_url: str):
        """Mail, stamp, erase: an id that does not qualify -- still inside its deadline, or another season's -- is skipped."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await announce(database, client, [DELETE_OID, REMIND_OID, OTHER_SEASON_OID])
            response = await erase(database, client, [DELETE_OID, REMIND_OID, OTHER_SEASON_OID])

            return (
                response,
                await stored(database, DELETE_OID),
                await stored(database, REMIND_OID),
                await stored(database, OTHER_SEASON_OID),
                await log_rows_naming(database, Collection.BEWERBUNGEN, DELETE_OID),
                await erasure_rows(database),
            )

        response, deleted, kept, other, rows, erasures = on_a_league(mongo_replica_set_url, body)

        assert (response.geloescht, deleted) == (1, None)
        assert kept is not None and other is not None
        assert rows and all(row["before"] is None and row["redacted_at"] == REDACTED_AT for row in rows)
        assert response.redigierte_aktionen == len(rows)
        # The erasure's own row: no image, a filter naming the season and the ids and nothing else, the system as actor.
        assert len(erasures) == 1
        assert erasures[0]["before"] is None
        assert set(erasures[0]["db_filter"]) == {"saison_id", "_id"}
        assert erasures[0]["actor"]["kind"] == "system"

    def test_an_empty_list_erases_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await erase(database, client, [])

            return response.geloescht, await database[Collection.BEWERBUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (0, 5)

    def test_an_id_nobody_was_told_about_is_skipped_rather_than_erased(self, mongo_replica_set_url: str):
        """A caller that erased without stamping would destroy an application whose three people never heard from the league."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await erase(database, client, [DELETE_OID])

            return response.geloescht, await stored(database, DELETE_OID)

        geloescht, document = on_a_league(mongo_replica_set_url, body)

        assert geloescht == 0
        assert document is not None

    def test_an_announced_candidate_whose_deadline_moved_is_skipped_rather_than_erased(self, mongo_replica_set_url: str):
        """The stamp says a notice went out, never that the application is still due.

        A re-send restarts `bestaetigungsfrist`, so erasing on the stamp alone would destroy an
        application whose people are holding a live link.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await announce(database, client, [DELETE_OID])
            # What a re-send does to this row, written directly: the deadline restarts and the
            # application stops being a deletion candidate while its stamp stays where it is.
            await patch_one_in_db(
                collection=database[Collection.BEWERBUNGEN],
                db_filter={"_id": DELETE_OID},
                update={"$set": {"bestaetigungsfrist": TOMORROW}},
                return_document=ReturnDocument.BEFORE,
            )
            response = await erase(database, client, [DELETE_OID])

            return response.geloescht, await stored(database, DELETE_OID)

        geloescht, document = on_a_league(mongo_replica_set_url, body)

        assert geloescht == 0
        assert document is not None
        # The stamp survives: the notice really did go out, and a later pass past the new deadline
        # erases without mailing a second one.
        assert document["loeschung_angekuendigt_am"] == TODAY

    def test_a_failed_erasure_does_not_send_the_notice_a_second_time(self, mongo_replica_set_url: str):
        """Without the stamp the hourly pass mails „wird gelöscht“ again every hour until the erasure finally goes through."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            erster = await sweep(database, client)
            gestempelt = await announce(database, client, [DELETE_OID])
            # The erasure is simply never made, which is what a crashed container or a dropped
            # connection leaves behind between the two calls.
            zweiter = await sweep(database, client)
            erased = await erase(database, client, [DELETE_OID])

            return erster, gestempelt, zweiter, erased, await stored(database, DELETE_OID)

        erster, gestempelt, zweiter, erased, document = on_a_league(mongo_replica_set_url, body)

        assert [entry.angekuendigt for entry in erster.loeschungen] == [False]
        assert gestempelt.angekuendigt == 1
        # The candidate is still listed, so the erasure can be retried -- and now marked announced,
        # which is what stops the caller composing a second message.
        assert [(entry.bewerbung_id, entry.angekuendigt) for entry in zweiter.loeschungen] == [(DELETE_OID, True)]
        assert (erased.geloescht, document) == (1, None)

    def test_a_second_stamp_keeps_the_day_the_notice_actually_went_out(self, mongo_replica_set_url: str):
        """The stamp is the day of the message, so a later pass over the same candidate must not move it to its own day."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await announce(database, client, [DELETE_OID])
            spaeter = await announce(database, client, [DELETE_OID], today="2026-04-05")
            document = await stored(database, DELETE_OID)

            return spaeter.angekuendigt, document["loeschung_angekuendigt_am"] if document else None

        assert on_a_league(mongo_replica_set_url, body) == (0, TODAY)


class TestAnApplicationWhoseNoticeCannotArrive:
    """Held past the deadline for an administrator, never erased on a notice the provider skipped.

    Without the delivery state the stamp says a message went out, the erasure follows, and the school
    hears nothing.
    """

    def test_the_pass_offers_it_to_nobody_and_neither_call_takes_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_submitters_address(database, client, DELETE_OID)
            pass_response = await sweep(database, client)
            stamped = await announce(database, client, [DELETE_OID])
            erased = await erase(database, client, [DELETE_OID])

            return pass_response, stamped.angekuendigt, erased.geloescht, await stored(database, DELETE_OID)

        pass_response, stamped, erased, document = on_a_league(mongo_replica_set_url, body)

        assert [entry.bewerbung_id for entry in pass_response.loeschungen] == []
        assert (stamped, erased) == (0, 0)
        assert document is not None, "an application whose deletion notice cannot be delivered was erased anyway"
        assert document.get("loeschung_angekuendigt_am") is None

    def test_a_notice_that_bounced_after_it_was_stamped_stops_the_erasure(self, mongo_replica_set_url: str):
        """The stamp lands as soon as the provider accepts, and the refusal arrives minutes later.

        Re-judging on every call makes that harmless: the id is skipped rather than erased.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            stamped = await announce(database, client, [DELETE_OID])
            await refuse_the_submitters_address(database, client, DELETE_OID)
            erased = await erase(database, client, [DELETE_OID])

            return stamped.angekuendigt, erased.geloescht, await stored(database, DELETE_OID)

        stamped, erased, document = on_a_league(mongo_replica_set_url, body)

        assert (stamped, erased) == (1, 0)
        assert document is not None
        # The stamp stands: a message really was accepted, and a later pass must not compose a second.
        assert document["loeschung_angekuendigt_am"] == TODAY

    def test_a_seat_the_provider_refuses_is_not_reminded(self, mongo_replica_set_url: str):
        """The double-seated person is one mailbox: refusing it leaves the third seat as the only one due."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_submitters_address(database, client, REMIND_OID)
            response = await sweep(database, client)

            return [(entry.email, [seat.rollen for seat in entry.seats]) for entry in response.erinnerungen]

        assert on_a_league(mongo_replica_set_url, body) == [("bramblewick@example.com", [["stellvertretung"]])]


# Composed by the production helper rather than spelled, so a drifted bound cannot leave these cases passing over a lapsed row.
STANDING = compose_gesperrt_bis_saison_id(massgebliche_saison_id=SAISON_ID)


# An address today's rule refuses, its local part being no ASCII: a stored row may hold one, and no
# ban can be keyed on it.
REFUSED_ADDRESS = "müller@example.com"


class TestABarredMailboxIsNotChased:
    """No reminder carries a fresh link to an address the ban list holds: the seat is sent nothing, stores nothing, and is counted."""

    def test_an_address_the_rule_refuses_is_barred_by_nothing_and_the_pass_goes_on(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": REMIND_OID}, {"$set": {"kontakte.stellvertretung.email": REFUSED_ADDRESS}}
            )
            response = await sweep(database, client)

            return [(entry.email, [seat.rollen for seat in entry.seats]) for entry in response.erinnerungen if entry.bewerbung_id == REMIND_OID]

        assert (REFUSED_ADDRESS, [["stellvertretung"]]) in on_a_league(mongo_replica_set_url, body)

    def test_the_barred_seat_is_sent_nothing_and_stores_nothing_and_the_other_mailbox_is_chased(self, mongo_replica_set_url: str, caplog):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(ban_document("bramblewick@example.com", bis=STANDING))
            # Both passes inside: the level outside is whatever an earlier test on this worker left.
            with caplog.at_level(logging.INFO, logger=FL_LOGGER_NAME):
                response = await sweep(database, client)
                # Still in the read: nothing of the ban is stored, so the next pass asks it again.
                still_read = await database[Collection.BEWERBUNGEN].find_one(
                    {"_id": REMIND_OID, **build_erinnerung_filter(saison_id=SAISON_ID, today=TODAY)}
                )
                second = await sweep(database, client)

            reminded = [
                (entry.email, [seat.rollen for seat in entry.seats]) for entry in response.erinnerungen if entry.bewerbung_id == REMIND_OID
            ]
            return reminded, second.erinnerungen, await stored(database, REMIND_OID), still_read

        reminded, second, document, still_read = on_a_league(mongo_replica_set_url, body)

        assert still_read is not None

        # The control beside the refusal: the unbarred mailbox on the same application is chased.
        assert reminded == [("wraxlington@example.com", [["trainer", "ansprechperson"]])]
        assert document is not None
        stellvertretung = document["bestaetigungen"]["stellvertretung"]
        # Nothing written: no fresh hash nobody is sent, no `erinnert_am` for a reminder that never
        # went out, and no key recording the ban beside the person's address.
        assert stellvertretung["erinnert_am"] is None
        assert "erinnerung_gesperrt_am" not in stellvertretung
        assert stellvertretung["token_hash"] == first_hashes(str(REMIND_OID))["stellvertretung"]
        assert second == []

        withheld = [record.getMessage() for record in caplog.records if "withheld" in record.getMessage()]
        # A count, never an id: a line naming the application would tie it to the ban. One per pass,
        # each having asked the ban afresh.
        assert withheld == [f"Reminders withheld from barred addresses in season {SAISON_ID}: 1 mailbox(es)"] * 2
        assert not any("bramblewick" in record.getMessage() or str(REMIND_OID) in record.getMessage() for record in caplog.records)

    def test_a_barred_application_takes_no_place_in_the_share(self, mongo_replica_set_url: str, monkeypatch: pytest.MonkeyPatch):
        """Skipped before the share is cut: it stays due, so taken first it would fill the share on every pass."""

        monkeypatch.setattr(sweep_router_module, "REMINDERS_PER_PASS", 1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Due first, its deadline the earlier, and every seat at one barred address.
            barred = {seat: person("Quorral") for seat in ("trainer", "ansprechperson", "stellvertretung")}
            await database[Collection.BEWERBUNGEN].insert_one(
                application(BARRED_OID, bestaetigungsfrist="2026-04-05", kontakte={**barred, "trainer_ist_zugleich": None})
            )
            await database[Collection.SPERRLISTE].insert_one(ban_document("quorral@example.com", bis=STANDING))

            return {entry.bewerbung_id for entry in (await sweep(database, client)).erinnerungen}

        assert on_a_league(mongo_replica_set_url, body) == {REMIND_OID}

    def test_a_later_day_asks_the_ban_again_and_a_lifted_one_lets_the_reminder_go(self, mongo_replica_set_url: str):
        """Withheld once more while the ban stands, and chased on the first pass after it is lifted."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPERRLISTE].insert_one(ban_document("bramblewick@example.com", bis=STANDING))
            await sweep(database, client)
            still_barred = await sweep(database, client, today=TOMORROW)
            await database[Collection.SPERRLISTE].delete_many({})
            lifted = await sweep(database, client, today="2026-04-03")

            def seats(response: Any) -> list[list[str]]:
                return [seat.rollen for entry in response.erinnerungen if entry.bewerbung_id == REMIND_OID for seat in entry.seats]

            return seats(still_barred), seats(lifted), await stored(database, REMIND_OID)

        still_barred, lifted, document = on_a_league(mongo_replica_set_url, body)

        assert still_barred == []
        assert lifted == [["stellvertretung"]]
        assert document is not None
        assert document["bestaetigungen"]["stellvertretung"]["erinnert_am"] == "2026-04-03"


# The Stellvertretung's stamp, the one seat nobody mirrors, each state the clocks' queries must read
# as `app/shared/einwilligung.py :: is_confirmed` reads it (`docs/backend/spec.md :: I387`).
STELLVERTRETUNG_STAMP = "kontakte.stellvertretung.einwilligung.bestaetigt_am"
STAMP_STATES = [
    pytest.param({"$set": {STELLVERTRETUNG_STAMP: MAILED_ON_THE_MARK}}, False, id="confirmed, the control"),
    pytest.param({"$set": {STELLVERTRETUNG_STAMP: ""}}, True, id="stamped empty"),
    pytest.param({"$set": {STELLVERTRETUNG_STAMP: None}}, True, id="stamped null"),
    # No stamp at all, the field missing, which the query's null term has to reach as well.
    pytest.param({"$set": {"kontakte.stellvertretung": None}}, True, id="the seat erased"),
]


class TestTheClocksQueriesReadAStampAsThePredicateDoes:
    """In the query, where a row the predicate would take is otherwise never read to be judged."""

    @pytest.mark.parametrize(("update", "outstanding"), STAMP_STATES)
    def test_the_fourteen_day_clock_lists_an_application_whose_seat_is_unconfirmed(
        self, mongo_replica_set_url: str, update: Mapping[str, Any], outstanding: bool
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, DELETE_OID)
            await database[Collection.BEWERBUNGEN].update_one({"_id": DELETE_OID}, update)
            response = await sweep(database, client)

            return [entry.bewerbung_id for entry in response.loeschungen]

        assert on_a_league(mongo_replica_set_url, body) == ([DELETE_OID] if outstanding else [])

    @pytest.mark.parametrize(
        ("update", "owed"),
        [state for state in STAMP_STATES if state.id != "the seat erased"],
    )
    def test_the_reminder_chases_a_seat_whose_stamp_is_unconfirmed(self, mongo_replica_set_url: str, update: Mapping[str, Any], owed: bool):
        """An erased seat has no address to chase, so it is the fourteen-day clock's case alone."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, REMIND_OID)
            await database[Collection.BEWERBUNGEN].update_one({"_id": REMIND_OID}, update)
            response = await sweep(database, client)

            return [(entry.email, [seat.rollen for seat in entry.seats]) for entry in response.erinnerungen if entry.bewerbung_id == REMIND_OID]

        assert on_a_league(mongo_replica_set_url, body) == ([("bramblewick@example.com", [["stellvertretung"]])] if owed else [])


class TestTheOneMonthClock:
    def test_a_declined_application_a_month_old_is_erased_and_its_rows_redacted_in_the_first_call(self, mongo_replica_set_url: str):
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

            return await stored(database, OTHER_SEASON_OID), await erasure_rows(database)

        other, erasures = on_a_league(mongo_replica_set_url, body)

        assert other is not None
        # Floored as the case above floors its own rows: `all` over an empty corpus is true, so a sweep
        # that erased nothing would pass this while proving the opposite of what it claims.
        assert erasures, "the sweep erased nothing, so this proves no season was spared"
        assert all(row["db_filter"]["saison_id"] == SAISON_ID for row in erasures)


class TestTheSeasonsOwnEndClock:
    """The bound on an application nobody decided, which the fourteen-day clock drops as soon as every seat confirms."""

    def test_an_application_every_seat_confirmed_and_nobody_decided_is_erased_and_its_rows_redacted(self, mongo_replica_set_url: str):
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
                await erasure_rows(database),
            )

        response, confirmed, past_its_deadline, accepted, rows, erasures = on_a_league(
            mongo_replica_set_url, body, status="past", next_status="active"
        )

        assert (response.ohne_entscheidung_geloescht, confirmed, past_its_deadline) == (2, None, None)
        # The accepted one is the successor season's business, and that season still runs.
        assert accepted is not None
        assert rows and all(row["before"] is None and row["redacted_at"] == REDACTED_AT for row in rows)
        assert all(row["db_filter"]["saison_id"] == SAISON_ID for row in erasures)

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
            return await sweep(database, client)

        response = on_a_league(mongo_replica_set_url, body, status="past", next_status="active")

        assert (response.erinnerungen, response.loeschungen) == ([], [])
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
        """The year after stands `between`, and the one after has ended, when `docs/backend/spec.md :: I715` drops this season's pupils.

        Read off the year after, the first two hold both clocks for ever, and the third past its pupils.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].insert_one(season(SKIPPED_TO_SAISON_ID, "past"))
            response = await sweep(database, client)

            return response.angenommene_geloescht, response.kontaktbloecke_geleert

        assert on_a_league(mongo_replica_set_url, body, status="past", next_status=between) == (1, 1)

    def test_the_running_season_keeps_both_whatever_later_season_has_ended(self, mongo_replica_set_url: str):
        """A lower season activated once a later one had run: it needs its contact persons while it runs.

        `docs/backend/spec.md :: I715` keeps its pupils for as long, and these two clocks match it.
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


class TestAnActivationInsideAnErasingTransactionKeepsTheSeasonsRows:
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
        """`docs/backend/spec.md :: I154`: remove `pull_the_season_after`'s anchor and the planned season loses what it runs on.

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
            # What makes the planned season activatable (`REQ-ACTIVATE-003`).
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
                    sperrliste=ban_list(database),
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
    def test_either_call_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await sweep(database, client, saison_id="1999")
            with pytest.raises(DocumentNotFoundException):
                await erase(database, client, [DELETE_OID], saison_id="1999")

            return await database[Collection.BEWERBUNGEN].count_documents({}), await erasure_rows(database)

        assert on_a_league(mongo_replica_set_url, body) == (5, [])


SECOND_OID = ObjectId("6890a1b2c3d4e5f607960007")
SECOND_CLUB_OID = ObjectId("6890a1b2c3d4e5f607960012")
SECOND_JUNCTION_OID = ObjectId("6890a1b2c3d4e5f607960022")

DECLINED = {"status": "abgelehnt", "entscheidung": {"getroffen_am": "2026-02-15", "von": "admin", "grund": "kein Platz"}}


def refusing_its_redaction(collection: Collection, row: Mapping[str, Any]) -> dict[str, Any]:
    """A log image missing the `trace_id` its validator requires, so the redaction's update is refused: any row a write is refused on."""

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
    await database[Collection.AKTIONEN].insert_one(refusing_its_redaction(collection, row), bypass_document_validation=True)


# What the planted log image's refusal reads as on a passed-over line: the property its validator requires.
REFUSED_TRACE_ID = "WriteError, code 121: [{'loc': 'trace_id', 'type': 'required', 'msg': 'property is missing'}]"

# A hand-edited deadline as the answer's model refuses it: the field and the rule, never the value.
REFUSED_DEADLINE = (
    "ValidationError: [{'loc': 'bestaetigungsfrist', 'type': 'string_pattern_mismatch', "
    "'msg': \"String should match pattern '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'\"}]"
)


def passed_over(caplog: pytest.LogCaptureFixture) -> list[tuple[str, str | None, str]]:
    return [
        (record.levelname, getattr(record, "error_code", None), record.getMessage())
        for record in caplog.records
        if "passed over" in record.getMessage()
    ]


def reminded(answer: Any) -> set[ObjectId]:
    return {erinnerung.bewerbung_id for erinnerung in answer.erinnerungen}


class TestOneRowHoldsBackNoOther:
    """`docs/backend/spec.md :: I720`, one case per write the call makes: with the site's isolation gone the whole call raises, every hour."""

    def test_a_refused_erasure_at_the_seasons_end(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_redaction_of(database, Collection.BEWERBUNGEN, REMIND_OID)
            answer = await sweep(database, client)

            return (
                (answer.ohne_entscheidung_geloescht, answer.abgelehnte_geloescht, answer.fehlgeschlagen),
                await stored(database, REMIND_OID),
                await stored(database, DELETE_OID),
            )

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            counts, refused, other = on_a_league(mongo_replica_set_url, body, status="past")

        # The decline clock after it ran too.
        assert counts == (1, 1, 1)
        assert (refused is not None, other) == (True, None)
        assert passed_over(caplog) == [
            ("ERROR", DATABASE_FAILED, f"Application {REMIND_OID} was passed over by the season's end clock: {REFUSED_TRACE_ID}")
        ]

    def test_a_refused_erasure_by_the_decline_clock(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(application(SECOND_OID, **DECLINED))
            await refuse_the_redaction_of(database, Collection.BEWERBUNGEN, DECLINED_OID)
            answer = await sweep(database, client)

            return answer, await stored(database, DECLINED_OID), await stored(database, SECOND_OID)

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answer, refused, other = on_a_league(mongo_replica_set_url, body)

        assert (answer.abgelehnte_geloescht, answer.fehlgeschlagen) == (1, 1)
        assert (refused is not None, other) == (True, None)
        # The clocks after it ran: the drive at the fork found the reminder unstamped and the call raising every pass.
        assert (reminded(answer), [loeschung.bewerbung_id for loeschung in answer.loeschungen]) == ({REMIND_OID}, [DELETE_OID])
        assert passed_over(caplog) == [
            ("ERROR", DATABASE_FAILED, f"Application {DECLINED_OID} was passed over by the decline clock: {REFUSED_TRACE_ID}")
        ]

    def test_a_refused_erasure_by_the_acceptance_clock(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
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
            counts, refused, other = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert counts == (1, 1, 1)
        assert (refused is not None, other) == (True, None)
        assert passed_over(caplog) == [
            ("ERROR", DATABASE_FAILED, f"Application {ACCEPTED_OID} was passed over by the acceptance clock: {REFUSED_TRACE_ID}")
        ]

    def test_a_refused_contact_block(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].insert_one({**junction_row(), "_id": SECOND_JUNCTION_OID, "team_id": SECOND_CLUB_OID})
            await refuse_the_redaction_of(database, Collection.SAISON_TEAMS, JUNCTION_OID)
            answer = await sweep(database, client)
            blocks = await database[Collection.SAISON_TEAMS].find({}, {"kontakte": 1}).sort("_id", 1).to_list(None)

            return answer, [(block["_id"], block["kontakte"] is not None) for block in blocks]

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answer, blocks = on_a_league(mongo_replica_set_url, body, status="future", next_status="past")

        assert (answer.kontaktbloecke_geleert, answer.fehlgeschlagen, reminded(answer)) == (1, 1, {REMIND_OID})
        assert blocks == [(JUNCTION_OID, True), (SECOND_JUNCTION_OID, False)]
        assert passed_over(caplog) == [
            ("ERROR", DATABASE_FAILED, f"Season team {JUNCTION_OID} was passed over by the contact block clock: {REFUSED_TRACE_ID}")
        ]

    def test_a_candidate_the_answer_cannot_carry(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A deadline a hand edit left malformed: the validator stores any string, and the answer's model refuses it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(application(SECOND_OID, bestaetigungsfrist="2026-03-1"))

            return await sweep(database, client)

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answer = on_a_league(mongo_replica_set_url, body)

        assert ([loeschung.bewerbung_id for loeschung in answer.loeschungen], reminded(answer), answer.fehlgeschlagen) == (
            [DELETE_OID],
            {REMIND_OID},
            1,
        )
        assert passed_over(caplog) == [
            ("ERROR", STORED_DATA_INVALID, f"Application {SECOND_OID} was passed over by the deletion clock: {REFUSED_DEADLINE}")
        ]

    def test_a_reminder_the_answer_cannot_carry(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A deadline the answer's model refuses before any stamp is written, so the row is passed over and nothing taken apart."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(application(SECOND_OID, bestaetigungsfrist="2026-04-1"))
            answer = await sweep(database, client)
            refused = await stored(database, SECOND_OID)
            assert refused is not None

            return reminded(answer), answer.fehlgeschlagen, [seat["erinnert_am"] for seat in refused["bestaetigungen"].values()]

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answered, count, stamps = on_a_league(mongo_replica_set_url, body)

        assert (answered, count, stamps) == ({REMIND_OID}, 1, [None, None, None])
        assert passed_over(caplog) == [
            ("ERROR", STORED_DATA_INVALID, f"Application {SECOND_OID} was passed over by the reminder clock: {REFUSED_DEADLINE}")
        ]

    def test_a_refused_reminder_stamp(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """An application stored before a field its validator requires: the reminder's stamp is refused under strict validation.

        Both carry a barred mailbox, which the share leaves out: its count stays the whole page's once the share is taken apart.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            invalid = {key: value for key, value in application(SECOND_OID).items() if key != "trikot"}
            await database[Collection.BEWERBUNGEN].insert_one(invalid, bypass_document_validation=True)
            await database[Collection.SPERRLISTE].insert_one(ban_document("bramblewick@example.com", bis=STANDING))
            # Inside: the level outside is whatever an earlier test on this worker left.
            with caplog.at_level(logging.INFO, logger=FL_LOGGER_NAME):
                answer = await sweep(database, client)
            refused = await stored(database, SECOND_OID)
            assert refused is not None

            return reminded(answer), answer.fehlgeschlagen, [seat["erinnert_am"] for seat in refused["bestaetigungen"].values()]

        answered, count, stamps = on_a_league(mongo_replica_set_url, body)

        assert (answered, count, stamps) == ({REMIND_OID}, 1, [None, None, None])
        refusal = "OperationFailure, code 121: [{'loc': 'trikot', 'type': 'required', 'msg': 'property is missing'}]"
        assert passed_over(caplog) == [("ERROR", DATABASE_FAILED, f"Application {SECOND_OID} was passed over by the reminder clock: {refusal}")]
        assert [record.getMessage() for record in caplog.records if "withheld" in record.getMessage()] == [
            f"Reminders withheld from barred addresses in season {SAISON_ID}: 2 mailbox(es)"
        ]

    def test_a_pass_whose_every_reminder_fails_records_its_day_and_counts_them(self, mongo_replica_set_url: str):
        """Every stamp refused, so no half commits and the day is stamped alone: the count is all that tells this pass from a clean one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_many({}, {"$unset": {"trikot": ""}}, bypass_document_validation=True)
            answer = await sweep(database, client)

            return (
                answer.erinnerungen,
                answer.fehlgeschlagen,
                (await get_sweep_saisons(saisons_collection=database[Collection.SAISONS])).sweep_gelaufen_am,
            )

        assert on_a_league(mongo_replica_set_url, body) == ([], 1, TODAY)

    def test_a_refused_announcement(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """An application stored before a field its validator requires: the stamp's update is refused under strict validation."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            invalid = {key: value for key, value in application(SECOND_OID, bestaetigungsfrist=YESTERDAY).items() if key != "trikot"}
            await database[Collection.BEWERBUNGEN].insert_one(invalid, bypass_document_validation=True)
            answer = await announce(database, client, [DELETE_OID, SECOND_OID])

            return (answer.angekuendigt, answer.fehlgeschlagen), [
                (await stored(database, row_id) or {}).get("loeschung_angekuendigt_am") for row_id in (DELETE_OID, SECOND_OID)
            ]

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            stamped, stamps = on_a_league(mongo_replica_set_url, body)

        assert (stamped, stamps) == ((1, 1), [TODAY, None])
        # `OperationFailure` rather than `WriteError`: the stamp is a `findAndModify`, which answers a refusal as a command error.
        refusal = "OperationFailure, code 121: [{'loc': 'trikot', 'type': 'required', 'msg': 'property is missing'}]"
        assert passed_over(caplog) == [
            ("ERROR", DATABASE_FAILED, f"Application {SECOND_OID} was passed over by the announcement clock: {refusal}")
        ]

    def test_a_refused_erasure_of_the_announced(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].insert_one(application(SECOND_OID, bestaetigungsfrist=YESTERDAY))
            await announce(database, client, [DELETE_OID, SECOND_OID])
            await refuse_the_redaction_of(database, Collection.BEWERBUNGEN, DELETE_OID)
            answer = await erase(database, client, [DELETE_OID, SECOND_OID])

            return (answer.geloescht, answer.fehlgeschlagen), await stored(database, DELETE_OID), await stored(database, SECOND_OID)

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            erased, refused, other = on_a_league(mongo_replica_set_url, body)

        assert (erased, refused is not None, other) == ((1, 1), True, None)
        assert passed_over(caplog) == [
            ("ERROR", DATABASE_FAILED, f"Application {DELETE_OID} was passed over by the fourteen-day clock: {REFUSED_TRACE_ID}")
        ]


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
        # Announced already: the erasure takes an announced candidate alone, and this case is about
        # what the guard and the binder record rather than about the two calls before it.
        database[Collection.BEWERBUNGEN].insert_one(application(DELETE_OID, bestaetigungsfrist=YESTERDAY, loeschung_angekuendigt_am=YESTERDAY))

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

    def test_the_erasure_records_the_system_actor_and_the_route_template(self, mongo_replica_set_url: str):
        """What `bind_system_actor` buys: the row names the machine and the endpoint, not an invented person or a raw path."""

        status, rows = through_the_app(
            mongo_replica_set_url, f"/bewerbungen/sweep/{SAISON_ID}/loeschen", {"bewerbung_ids": [str(DELETE_OID)]}, auth=SYSTEM_AUTH
        )

        assert status == 200
        assert len(rows) == 1
        assert rows[0]["actor"] == {"kind": "system", "email": SYSTEM_ACTOR_EMAIL}
        assert rows[0]["request"] == {"method": "POST", "path": f"/api/v{API_VERSION}/bewerbungen/sweep/{{saison_id}}/loeschen"}

    @pytest.mark.parametrize("auth", [BASE_AUTH, ADMIN_AUTH], ids=("base", "admin"))
    def test_neither_other_key_reaches_it(self, mongo_replica_set_url: str, auth: Mapping[str, str]):
        """The other two keys are refused as the wrong credential before any body is read, so nothing is erased."""

        status, rows = through_the_app(
            mongo_replica_set_url, f"/bewerbungen/sweep/{SAISON_ID}/loeschen", {"bewerbung_ids": [str(DELETE_OID)]}, auth=auth
        )

        assert status == 401
        assert rows == []


class TestTheSeasonList:
    def test_every_season_is_listed_oldest_first_whatever_its_status(self, mongo_replica_set_url: str):
        """`docs/backend/spec.md :: I47` keeps a `future` season off the base tier, and that is the season the clocks run over."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            return await get_sweep_saisons(saisons_collection=database[Collection.SAISONS])

        response = on_a_league(mongo_replica_set_url, body, next_status="future")

        assert response.saison_ids == [OTHER_SAISON_ID, SAISON_ID, NEXT_SAISON_ID]

    def test_it_answers_the_day_the_last_pass_stored(self, mongo_replica_set_url: str):
        """Null before any pass and the day after one, which is what parts an unarmed sweep from a quiet one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await get_sweep_saisons(saisons_collection=database[Collection.SAISONS])
            await sweep(database, client, saison_id=NEXT_SAISON_ID)
            after = await get_sweep_saisons(saisons_collection=database[Collection.SAISONS])

            return before.sweep_gelaufen_am, after.sweep_gelaufen_am

        assert on_a_league(mongo_replica_set_url, body) == (None, TODAY)

    def test_the_read_stamps_nothing_of_its_own(self, mongo_replica_set_url: str):
        """A read that stamped would answer `it ran` to the operator asking whether it had."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            before = await database[Collection.AKTIONEN].count_documents({})
            response = await get_sweep_saisons(saisons_collection=database[Collection.SAISONS])
            after = await database[Collection.AKTIONEN].count_documents({})

            return response.saison_ids, after - before

        assert on_a_league(mongo_replica_set_url, body) == ([OTHER_SAISON_ID, SAISON_ID, NEXT_SAISON_ID], 0)


class TestThePassRecordsTheDayItRan:
    def test_a_pass_that_reminded_nobody_and_deleted_nothing_still_records_the_day(self, mongo_replica_set_url: str):
        """Over the season holding no application at all, so the day is the whole of what the pass wrote."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await database[Collection.AKTIONEN].count_documents({})
            response = await sweep(database, client, saison_id=NEXT_SAISON_ID)
            after = await database[Collection.AKTIONEN].count_documents({})
            stamped = await database[Collection.SAISONS].find({}, {"sweep_gelaufen_am": 1}).sort("_id", 1).to_list(length=None)

            return response, after - before, [row.get("sweep_gelaufen_am") for row in stamped]

        response, appended, days = on_a_league(mongo_replica_set_url, body)

        assert (response.erinnerungen, response.loeschungen) == ([], [])
        assert (response.abgelehnte_geloescht, response.angenommene_geloescht, response.kontaktbloecke_geleert) == (0, 0, 0)
        assert appended == 1
        # Every season and not the one swept: one pass stamps them all, which is what makes the day
        # the run's rather than the season's.
        assert days == [TODAY, TODAY, TODAY]

    def test_the_days_second_pass_appends_no_row_at_all(self, mongo_replica_set_url: str):
        """The stamp reaches only a season not yet stamped today, and a fan-out that changed nothing logs nothing: one row a day."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, saison_id=NEXT_SAISON_ID)
            after_first = await database[Collection.AKTIONEN].count_documents({})
            await sweep(database, client, saison_id=NEXT_SAISON_ID)
            after_second = await database[Collection.AKTIONEN].count_documents({})

            return after_second - after_first

        assert on_a_league(mongo_replica_set_url, body) == 0

    def test_a_whole_days_passes_over_every_season_cost_one_row(self, mongo_replica_set_url: str):
        """The arithmetic the shape stands on: a row per season per pass would bury the administrative history the page can reach."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            for _ in range(PASSES_A_DAY):
                for saison_id in (OTHER_SAISON_ID, SAISON_ID, NEXT_SAISON_ID):
                    await sweep(database, client, saison_id=saison_id)

            return await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.SAISONS)})

        assert on_a_league(mongo_replica_set_url, body) == 1


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

            first = await sweep(database, client)

            async def one_pass() -> int:
                return len({entry.bewerbung_id for entry in (await sweep(database, client)).erinnerungen})

            already = len({entry.bewerbung_id for entry in first.erinnerungen})
            taken = [already, *await passes_until_empty(one_pass, share=REMINDERS_PER_PASS, total=overflow - already)]

            stamped = await database[Collection.BEWERBUNGEN].count_documents({"bestaetigungen.trainer.erinnert_am": TODAY})

            return {entry.bestaetigungsfrist for entry in first.erinnerungen}, taken, stamped

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

    def test_the_deletion_list_takes_its_share_and_the_passes_reach_every_candidate(self, mongo_replica_set_url: str):
        """Driven as the caller drives it: every listed candidate announced and erased before the next pass."""

        overflow = DELETIONS_LISTED_PER_PASS + 5

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many(
                [application(numbered(position), bestaetigungsfrist=YESTERDAY) for position in range(overflow)]
            )

            async def one_pass() -> int:
                ids = [entry.bewerbung_id for entry in (await sweep(database, client)).loeschungen]
                if ids:
                    await announce(database, client, ids)
                    await erase(database, client, ids)

                return len(ids)

            taken = await passes_until_empty(one_pass, share=DELETIONS_LISTED_PER_PASS, total=overflow)

            return taken, await database[Collection.BEWERBUNGEN].count_documents({"saison_id": SAISON_ID})

        taken, standing = on_a_league(mongo_replica_set_url, body)

        per_pass(taken, DELETIONS_LISTED_PER_PASS, overflow)
        assert standing == 0


# Under the driver's first batch, so a page read is one command however many rows it holds.
FEW = 10


class TestEachPerRowLoopCostsTheRoundTripsItsShareIsSizedAt:
    """Counted on the wire, two runs apart by `FEW` rows: `AFTER` at the call site, or a second write a row, turns a case red."""

    def test_a_reminded_application(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.BEWERBUNGEN].insert_many([application(numbered(position)) for position in range(due)])
                # Stamped already, so the run's own stamp costs both runs the same guard read.
                await database[Collection.SAISONS].update_many({}, {"$set": {"sweep_gelaufen_am": TODAY}})

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
        """Taken apart instead, the share spends a failed attempt and its halves on the row (`docs/backend/spec.md :: I728`)."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(rows: list[dict[str, Any]]) -> int:
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.BEWERBUNGEN].insert_many(rows)
                await database[Collection.SAISONS].update_many({}, {"$set": {"sweep_gelaufen_am": TODAY}})

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, sweep)

            rows = [application(numbered(position)) for position in range(FEW)]
            return await counted(rows), await counted([*rows[:-1], refused(rows[-1])])

        carryable, with_one_refused = on_a_league(mongo_replica_set_url, body)

        assert carryable - with_one_refused == budget.ROUND_TRIPS_A_ROW

    def test_a_decision_date_no_judge_can_read_costs_its_clock_no_command(self, mongo_replica_set_url: str):
        """Every command a drain spends taking a page apart is one the reminder share after it has not got."""

        unreadable = application(SECOND_OID, status="abgelehnt", entscheidung={"getroffen_am": "2026-02-1x", "von": "admin", "grund": None})

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int, Mapping[str, Any] | None, Mapping[str, Any] | None]:
            async def counted(rows: list[dict[str, Any]]) -> int:
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.BEWERBUNGEN].insert_many(rows)
                await database[Collection.SAISONS].update_many({}, {"$set": {"sweep_gelaufen_am": TODAY}})

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, sweep)

            without, beside = await counted(the_corpus()), await counted([*the_corpus(), unreadable])
            return without, beside, await stored(database, SECOND_OID), await stored(database, DECLINED_OID)

        without, beside, kept, erased = on_a_league(mongo_replica_set_url, body)

        assert (beside, kept is not None, erased) == (without, True, None)

    def test_a_cleared_contact_block(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                # No application at all, so the accepted clock erases nothing in either run.
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.SAISON_TEAMS].delete_many({})
                await database[Collection.SAISON_TEAMS].insert_many(
                    [{**junction_row(), "_id": numbered(position), "team_id": numbered(position)} for position in range(due)]
                )
                await database[Collection.SAISONS].update_many({}, {"$set": {"sweep_gelaufen_am": TODAY}})

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, sweep)

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert (twice - few) / FEW == budget.ROUND_TRIPS_A_ROW

    def test_a_stamped_announcement(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                ids = [numbered(position) for position in range(due)]
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.BEWERBUNGEN].insert_many([application(row_id, bestaetigungsfrist=YESTERDAY) for row_id in ids])

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, lambda database, client: announce(database, client, ids))

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert (twice - few) / FEW == budget.ROUND_TRIPS_A_ROW


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
        rows = len(reminded(answer)) + answer.kontaktbloecke_geleert

        assert (answer.abgelehnte_geloescht, answer.angenommene_geloescht, len(answer.loeschungen), rows) == (1, 1, 1, 4)
        assert sum(names.values()) - budget.ROUND_TRIPS_A_ROW * rows == budget.SWEEP_OTHER_COMMANDS, names

    def test_angekuendigt(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            ids = [numbered(position) for position in range(FEW)]
            await database[Collection.BEWERBUNGEN].insert_many([application(row_id, bestaetigungsfrist=YESTERDAY) for row_id in ids])

            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, lambda database, client: announce(database, client, ids))

        answer, names = on_a_league(mongo_replica_set_url, body)

        assert answer.angekuendigt == FEW
        assert sum(names.values()) - budget.ROUND_TRIPS_A_ROW * FEW == budget.ANGEKUENDIGT_OTHER_COMMANDS, names


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
        """A report the validator refuses once stripped: the report strip alone meets it, in its own transaction."""

        refused = a_report(SAISON_ID)
        del refused["bericht"]["seiten"]
        declined = a_declined_confirmation(CLUB_OID, SAISON_ID)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBERICHTE].insert_one(refused, bypass_document_validation=True)
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(declined)
            with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
                response = await sweep(database, client)
            return (
                response,
                await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}),
                await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": declined["_id"]}),
                await database[Collection.SPIELBERICHTE].find_one({"_id": refused["_id"]}),
            )

        response, junction, confirmation, report = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert (response.kontaktbloecke_geleert, response.fehlgeschlagen, junction["kontakte"]) == (1, 1, None)
        assert confirmation["antwort"]["begruendung"] is None, "the confirmations' strip fell with the reports'"
        assert report["bericht"]["bemerkungen"] == refused["bericht"]["bemerkungen"], "the failed strip left a write behind"
        assert [(level, message.split(":")[0]) for level, _, message in passed_over(caplog)] == [
            ("ERROR", f"Season {SAISON_ID} was passed over by the report strip clock")
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
        """A replaced club's row the validator refuses, which no block clearing writes: the strip alone meets it."""

        refused = {key: value for key, value in a_declined_confirmation(REPLACED_CLUB_OID, SAISON_ID).items() if key != "frist"}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(refused, bypass_document_validation=True)
            with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
                response = await sweep(database, client)
            return response, await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})

        response, junction = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert (response.kontaktbloecke_geleert, response.fehlgeschlagen, junction["kontakte"]) == (1, 1, None)
        assert [(level, message.split(":")[0]) for level, _, message in passed_over(caplog)] == [
            ("ERROR", f"Season {SAISON_ID} was passed over by the confirmation strip clock")
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
