import asyncio
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, MongoClient, ReturnDocument, monitoring
from pymongo.asynchronous.database import AsyncDatabase

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
    KONTAKT_SEATS,
    SWEEP_PAGE,
    compose_bestaetigungen,
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
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.recording import SYSTEM_ACTOR_EMAIL
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, BASE_AUTH, SYSTEM_AUTH, build_test_config
from tests.database import a_clean_database, a_clean_database_sync, on_the_seed_loop
from tests.documents import ADDRESS, rules_document, saison_document, saison_team_document, team_document
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_bewerbung_sweep_test")

SAISON_ID = "2026"
NEXT_SAISON_ID = "2027"
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
CLUB_OID = ObjectId("6890a1b2c3d4e5f607960011")
JUNCTION_OID = ObjectId("6890a1b2c3d4e5f607960021")

CLUB_NAME = "Adler"
SCHOOL_NAME = "Zorbanax"


def first_hashes(prefix: str) -> dict[str, str]:
    return {seat: hash_token(f"{prefix}-{seat}") for seat in KONTAKT_SEATS}


def person(vorname: str, *, email: str | None = None) -> dict[str, Any]:
    return {
        "vorname": vorname,
        "nachname": f"{vorname}-Mustermann",
        "email": email or f"{vorname.lower()}@example.com",
        "telefon": "+49 170 1234567",
        "geburtsdatum": None,
        "einwilligung": {
            "umfang": "kontaktdaten",
            "erfasst_von": "administrativ",
            "text_version": "v3",
            "datum": "2026-03-20",
            "bestaetigt_am": None,
        },
    }


def kontakte() -> dict[str, Any]:
    """One person holding two seats, so the reminder's grouping has something to group."""

    return {
        "trainer": person("Wraxlington"),
        "ansprechperson": person("Wraxlington"),
        "stellvertretung": person("Bramblewick"),
        "trainer_ist_zugleich": "ansprechperson",
    }


def application(bewerbung_id: ObjectId, *, saison_id: str = SAISON_ID, **overrides: Any) -> dict[str, Any]:
    return {
        "_id": bewerbung_id,
        "saison_id": saison_id,
        "eingereicht_am": MAILED_ON_THE_MARK,
        "status": "eingereicht",
        "team_id": None,
        "schule": {
            "team_name": SCHOOL_NAME,
            "full_name": f"{SCHOOL_NAME}-Gesamtschule",
            "shorthand": "ZX",
            "schulform": "gesamtschule",
            "address": dict(ADDRESS),
            "website_url": None,
        },
        "kontakte": kontakte(),
        "trikot": {"vorhandener_satz": "keiner", "wunschfarbe": "rot"},
        "kader": {"voraussichtliche_groesse": 14, "gute_spieler": 3},
        "wunschgegner": None,
        "entscheidung": None,
        "bestaetigungsfrist": "2026-04-12",
        "bestaetigungen": compose_bestaetigungen(hashes=first_hashes(str(bewerbung_id)), today=MAILED_ON_THE_MARK),
        **overrides,
    }


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


def on_a_league(url: str, body: Body, *, next_status: str | None = "active", status: str = "active") -> Any:
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


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str = SAISON_ID) -> Any:
    return await sweep_saison(
        saison_id=saison_id,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=TODAY,
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
        teams_collection=database[Collection.TEAMS],
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

    await patch_one_in_db(
        collection=database[Collection.BEWERBUNGEN],
        db_filter={"_id": bewerbung_id},
        update=compose_confirmation_update(
            seats=KONTAKT_SEATS, geburtsdatum=CONFIRMED_GEBURTSDATUM, today=MAILED_ON_THE_MARK, text_version="v3", whatsapp=False
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
                bewerbung_id=REMIND_OID, seat="trainer", bewerbungen_collection=database[Collection.BEWERBUNGEN], today=TODAY
            )

            # The reminder's shared link and BOTH first links, one of which is the mirrored seat's
            # own copy -- the one a re-send writing a single entry leaves open.
            tot = []
            for gone in (erinnert, f"{REMIND_OID}-trainer", f"{REMIND_OID}-ansprechperson"):
                with pytest.raises(DocumentConflictException) as conflict:
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
        assert "token" not in rendered and "Mustermann" not in rendered

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

        response, confirmed, past_its_deadline, accepted, rows, erasures = on_a_league(mongo_replica_set_url, body, status="past")

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

        response = on_a_league(mongo_replica_set_url, body, status="past")

        assert (response.erinnerungen, response.loeschungen) == ([], [])
        assert response.ohne_entscheidung_geloescht == 2

    def test_an_application_whose_notice_the_provider_refuses_goes_with_the_season(self, mongo_replica_set_url: str):
        """The hold that has no other end: `deletion_is_due` drops a refused address, so nothing else ever reaches this row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_submitters_address(database, client, DELETE_OID)
            response = await sweep(database, client)

            return response, await stored(database, DELETE_OID)

        response, document = on_a_league(mongo_replica_set_url, body, status="past")

        assert (response.ohne_entscheidung_geloescht, document) == (2, None)

    def test_a_second_pass_the_same_day_finds_nothing_left(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)

            return first.ohne_entscheidung_geloescht, (await sweep(database, client)).ohne_entscheidung_geloescht

        # The first count as well as the second: a clock taking nothing at all answers zero twice.
        assert on_a_league(mongo_replica_set_url, body, status="past") == (2, 0)


class TestTheSeasonAndOneClock:
    def test_nothing_goes_while_the_next_season_runs(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, ACCEPTED_OID), await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})

        response, document, row = on_a_league(mongo_replica_set_url, body, next_status="active")

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

        response, document, row, junction_log = on_a_league(mongo_replica_set_url, body, next_status="past")

        assert (response.angenommene_geloescht, response.kontaktbloecke_geleert, document) == (1, 1, None)
        assert row is not None and row["kontakte"] is None
        # The block's own keys survive around the clearing: the row is still a junction row.
        assert (row["gruppe"], row["trikot_farbe"]) == ("B", "blau")
        assert junction_log and all(entry["before"] is None and entry["redacted_at"] == REDACTED_AT for entry in junction_log)

    def test_a_season_with_no_successor_yet_keeps_everything(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response.angenommene_geloescht, response.kontaktbloecke_geleert

        assert on_a_league(mongo_replica_set_url, body, next_status=None) == (0, 0)


class TestASeasonNobodyHas:
    def test_either_call_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await sweep(database, client, saison_id="1999")
            with pytest.raises(DocumentNotFoundException):
                await erase(database, client, [DELETE_OID], saison_id="1999")

            return await database[Collection.BEWERBUNGEN].count_documents({}), await erasure_rows(database)

        assert on_a_league(mongo_replica_set_url, body) == (5, [])


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
            async with app_client(url, now=NOW) as http:
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
        """`patch_many_in_db` files a row per call even where its filter matches nothing, so the guard read is what the hourly pass rests on."""

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

        taken, standing = on_a_league(mongo_replica_set_url, body, next_status="past")

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


class _Counting(monitoring.CommandListener):
    """Every command sent while it is on, each one a round trip."""

    def __init__(self) -> None:
        self.commands = 0

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        self.commands += 1

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        pass

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        pass


# Under the driver's first batch, so a page read is one command however many rows it holds.
FEW = 10

# The update and its log row: the per-row cost each share is sized at.
ROUND_TRIPS_A_ROW = 2


async def commands_sent(url: str, call: Body) -> int:
    listener = _Counting()
    counting = AsyncMongoClient(url, event_listeners=[listener])
    try:
        await call(counting[DATABASE_NAME], counting)
    finally:
        await counting.close()

    return listener.commands


class TestEachPerRowLoopCostsTheRoundTripsItsShareIsSizedAt:
    """Counted on the wire, two runs apart by `FEW` rows: `AFTER` at the call site, or a second write a row, turns a case red."""

    def test_a_reminded_application(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.BEWERBUNGEN].insert_many([application(numbered(position)) for position in range(due)])
                # Stamped already, so the run's own stamp costs both runs the same guard read.
                await database[Collection.SAISONS].update_many({}, {"$set": {"sweep_gelaufen_am": TODAY}})

                return await commands_sent(mongo_replica_set_url, sweep)

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert (twice - few) / FEW == ROUND_TRIPS_A_ROW

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

                return await commands_sent(mongo_replica_set_url, sweep)

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body, next_status="past")

        assert (twice - few) / FEW == ROUND_TRIPS_A_ROW

    def test_a_stamped_announcement(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                ids = [numbered(position) for position in range(due)]
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.BEWERBUNGEN].insert_many([application(row_id, bestaetigungsfrist=YESTERDAY) for row_id in ids])

                return await commands_sent(mongo_replica_set_url, lambda database, client: announce(database, client, ids))

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert (twice - few) / FEW == ROUND_TRIPS_A_ROW


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

        assert on_a_league(mongo_replica_set_url, body, status="past") == (overflow, 0)

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

        assert on_a_league(mongo_replica_set_url, body, next_status="past") == (overflow, 0)

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
