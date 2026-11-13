import asyncio
import logging
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timedelta
from itertools import combinations
from typing import Any, cast

import pytest
from bson import ObjectId
from pydantic import TypeAdapter
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.admin_router import decline_bewerbung, resend_einwilligung
from app.api.bewerbungen.public_router import get_einwilligung_view, post_einwilligung
from app.api.bewerbungen.schemas import FLBewerbungEinwilligungAnswerPayload, FLDeclineBewerbungPayload
from app.api.bewerbungen.services import compose_confirmation_update, confirmation_deadline_from
from app.api.bewerbungen.system_router import (
    BLOCKS_CLEARED_PER_PASS,
    REMINDERS_PER_PASS,
    get_sweep_saisons,
    sweep_saison,
)
from app.api.outbox.schemas import FLOutboxEventPayload
from app.api.outbox.system_router import post_event
from app.api.saisons.admin_router import activate_saison
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import patch_one_in_db
from app.core.exceptions import APIError, DocumentNotFoundError
from app.core.logging import FL_LOGGER_NAME
from app.core.transactions import SWEEP_PAGE
from app.shared.schemas.confirmation import FLTokenPayload
from app.shared.schemas.literals import KONTAKT_ROLLEN, FLKontaktRolle
from app.shared.tokens import hash_token
from tests import documents
from tests.acts import deletions_of
from tests.database import SEED_BOUND_S, a_clean_database, on_the_seed_loop
from tests.delivery import a_mail_that_bounced, mails_that_bounced
from tests.documents import (
    SEAT_TEXT_VERSIONS,
    kontaktperson_document,
    rules_document,
    saison_document,
    saison_team_document,
    spiel_document,
    team_document,
)
from tests.isolation import COMMITTED, InterleavedCollection, Rival, outcome_of
from tests.outbox import MAIL_NOW, drained
from tests.wire import commands_by_name
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
MAILED_ON_THE_MARK = "2026-03-29"

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
LAST_NAME = "Mustermann"


def person(first_name: str, **fields: Any) -> dict[str, Any]:
    return kontaktperson_document(first_name, last_name=f"{first_name}-{LAST_NAME}", **fields)


def kontakte() -> dict[str, Any]:
    """One person holding two seats, so the reminder's one mail a person has something to fold."""

    return {
        "trainer": person("Wraxlington"),
        "ansprechperson": person("Wraxlington"),
        "stellvertretung": person("Bramblewick"),
        "trainer_is_also": "ansprechperson",
    }


def application(
    bewerbung_id: ObjectId, *, saison_id: str = SAISON_ID, confirmation_deadline: str = "2026-04-12", **overrides: Any
) -> dict[str, Any]:
    # Each seat's first link minted from the application's id, as `first_hashes` reads it back.
    stored = documents.bewerbung_document(
        bewerbung_id,
        saison_id,
        "submitted",
        kontakte=kontakte(),
        submitted_at=MAILED_ON_THE_MARK,
        confirmation_deadline=confirmation_deadline,
        schule=documents.new_schule_document(SCHOOL_NAME, full_name=f"{SCHOOL_NAME}-Gesamtschule", schulform="gesamtschule"),
    )

    return {**stored, **overrides}


def the_corpus() -> list[dict[str, Any]]:
    """One application per clock, plus one of another season that no call for `SAISON_ID` may touch."""

    return [
        application(REMIND_OID),
        application(DELETE_OID, confirmation_deadline=YESTERDAY),
        application(DECLINED_OID, status="declined", decision={"made_at": "2026-02-15", "reason": "kein Platz"}),
        application(
            ACCEPTED_OID,
            status="accepted",
            team_id=CLUB_OID,
            schule=None,
            decision={"made_at": "2026-03-01", "reason": None},
        ),
        application(
            OTHER_SEASON_OID,
            saison_id=OTHER_SAISON_ID,
            status="declined",
            decision={"made_at": "2025-01-15", "reason": "kein Platz"},
        ),
    ]


def season(saison_id: str, status: str) -> dict[str, Any]:
    return saison_document(saison_id, status, rules=rules_document(number_of_gruppen=2, teams_per_gruppe=2))


def junction_row() -> dict[str, Any]:
    return saison_team_document(SAISON_ID, CLUB_OID, CLUB_NAME, "ADX", _id=JUNCTION_OID, gruppe="B", trikot_farbe="blau", kontakte=kontakte())


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]

# Why a case stores a row the read-back refuses: each the row a write of the pass is to fail on.
NO_SHORTHAND = "a season row without its shorthand, so the installed validator refuses the pass's write"
NO_TRIKOT = "an application without its trikot, so the installed validator refuses the pass's stamp"
UNREADABLE_DATES = "an application whose links hold a date no judge reads, so the pass passes the row over"
NO_SIDES = "a report without its sides, so the installed validator refuses the strip"
NO_DEADLINE = "a confirmation row without its deadline, so the installed validator refuses the strip"


def on_a_league(
    url: str,
    body: Body,
    *,
    next_status: str | None = "future",
    status: str = "active",
    mutates_schema: bool = False,
    stores_a_refused_shape: str | None = None,
) -> Any:
    """The SHIPPED indexes.

    `mutates_schema` for a body that installs a validator through `refuse_writes_breaking`, and `stores_a_refused_shape`
    for one storing the row it refuses.
    """

    async def _run() -> Any:
        async with a_clean_database(
            url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema, stores_a_refused_shape=stores_a_refused_shape
        ) as (client, database):
            seasons = [season(SAISON_ID, status), season(OTHER_SAISON_ID, "past")]
            if next_status is not None:
                seasons.append(season(NEXT_SAISON_ID, next_status))
            await database[Collection.SAISONS].insert_many(seasons)
            await database[Collection.TEAMS].insert_one(team_document(CLUB_OID, CLUB_NAME, "ADX", website_url=None, schulform="gymnasium_g9"))
            await database[Collection.SAISON_TEAMS].insert_one(junction_row())
            await database[Collection.BEWERBUNGEN].insert_many(the_corpus())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def sweep(
    database: AsyncDatabase, client: AsyncMongoClient, saison_id: str = SAISON_ID, today: str = TODAY, now: datetime = MAIL_NOW
) -> Any:
    """One season's pass, its mails owed on `MAIL_NOW`, the one thing its clock dates."""

    return await sweep_saison(
        saison_id=saison_id,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=today,
        germany_now=now,
    )


async def view(database: AsyncDatabase, token: str) -> Any:
    return await get_einwilligung_view(
        view_data=FLTokenPayload(token=token),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        today=TODAY,
    )


async def stored(database: AsyncDatabase, bewerbung_id: ObjectId) -> Mapping[str, Any] | None:
    return await database[Collection.BEWERBUNGEN].find_one({"_id": bewerbung_id})


async def retention_rows(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    """What the log holds of the application clocks' pages, as a deletion's row reads."""

    rows = await database[Collection.ACTION_LOG].find({"action": "retention.bewerbungen"}, sort=[("_id", 1)]).to_list(length=None)

    return [{key: row[key] for key in ("by", "team", "record_id", "label", "count")} for row in rows]


async def owed(database: AsyncDatabase, kind: str) -> list[Mapping[str, Any]]:
    """Every mail of one kind the Postausgang holds, by key: its key, its recipient and its facts."""

    rows = await database[Collection.OUTBOX].find({"kind": kind}, {"_id": 0, "key": 1, "to": 1, "data": 1}).to_list(length=None)

    return sorted(rows, key=lambda row: str(row["key"]))


async def reminded(database: AsyncDatabase) -> set[Any]:
    """The applications the reminder clock has owed a mail about."""

    rows = await database[Collection.OUTBOX].find({"kind": "bewerbung_reminder"}, {"reference.id": 1}).to_list(length=None)

    return {row["reference"]["id"] for row in rows}


async def refuse_the_ansprechpersons_address(database: AsyncDatabase, client: AsyncMongoClient, bewerbung_id: ObjectId) -> None:
    """The Ansprechperson's last mail, sent and refused by the provider: what the clocks read is what a drain and a real event leave."""

    await a_mail_that_bounced(database, client, bewerbung_id=bewerbung_id, seat="ansprechperson", to="wraxlington@example.com")


# The seats the corpus's applications mail, `kontakte`'s Trainer reading the seat it mirrors.
BOTH_MAILBOXES: Mapping[FLKontaktRolle, str] = {"ansprechperson": "wraxlington@example.com", "stellvertretung": "bramblewick@example.com"}


CONFIRMED_BIRTH_DATE = "1994-07-19"


async def confirm_the_seats(database: AsyncDatabase, bewerbung_id: ObjectId, *seats: str) -> None:
    await database[Collection.BEWERBUNGEN].update_one(
        {"_id": bewerbung_id}, {"$set": {f"kontakte.{seat}.einwilligung.confirmed_at": MAILED_ON_THE_MARK for seat in seats}}
    )


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
            birth_date=CONFIRMED_BIRTH_DATE,
            today=MAILED_ON_THE_MARK,
            text_versions=SEAT_TEXT_VERSIONS,
            whatsapp=False,
            media=False,
            at=f"{MAILED_ON_THE_MARK}T08:00:00+00:00",
            takes_the_notice_back=False,
        ),
        expected_version=None,
        return_document=ReturnDocument.BEFORE,
    )


async def resend(database: AsyncDatabase, seat: str) -> Any:
    return await resend_einwilligung(
        bewerbung_id=REMIND_OID,
        seat=seat,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        outbox_collection=database[Collection.OUTBOX],
        db=database.client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )


async def decline(database: AsyncDatabase, client: AsyncMongoClient, token: str, *, now: datetime) -> Any:
    return await post_einwilligung(
        answer_data=TypeAdapter(FLBewerbungEinwilligungAnswerPayload).validate_python({"token": token, "answer": "declined"}),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=TODAY,
        germany_now=now,
    )


def reminder_mail(to: str, rollen: list[str]) -> dict[str, Any]:
    """The reminder the corpus's application owes one person, as the Postausgang holds it."""

    return {
        "key": f"{Collection.BEWERBUNGEN}/{REMIND_OID}/reminder/{rollen[0]}/{TODAY}",
        "to": to,
        "data": {"kind": "bewerbung_reminder", "saison_id": SAISON_ID, "schule": SCHOOL_NAME, "rollen": rollen, "deadline": "2026-04-12"},
    }


class TestTheReminderClock:
    def test_it_stamps_every_due_seat_and_owes_one_mail_a_person(self, mongo_replica_set_url: str):
        """One mail for the double-seated person naming both seats; the deadline and the first links stand."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client, now=MAIL_NOW)

            return response, await owed(database, "bewerbung_reminder"), await stored(database, REMIND_OID)

        response, mails, document = on_a_league(mongo_replica_set_url, body)

        assert response.reminded == 1
        assert mails == [
            reminder_mail("wraxlington@example.com", ["ansprechperson", "trainer"]),
            reminder_mail("bramblewick@example.com", ["stellvertretung"]),
        ]
        assert document is not None
        first = first_hashes(str(REMIND_OID))
        for rolle in KONTAKT_ROLLEN:
            bookkeeping = document["confirmations"][rolle]
            # No link before the hand-out: the first one alone stands until the drain mints the reminder's beside it.
            assert bookkeeping["token_hashes"] == [first[rolle]]
            assert (bookkeeping["reminded_at"], bookkeeping["sent_at"]) == (TODAY, MAILED_ON_THE_MARK)
        assert document["confirmations"]["trainer"]["deadline"] == "2026-04-12"

    def test_the_reminders_link_joins_the_first_and_both_open_the_seat(self, mongo_replica_set_url: str):
        """The reader still looking at the first mail is not punished by the chase."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, now=MAIL_NOW)
            mails = await drained(database, client)
            [paired] = [mail for mail in mails if mail.data.kind == "bewerbung_reminder" and mail.to == "wraxlington@example.com"]
            assert paired.token is not None

            return (
                await view(database, f"{REMIND_OID}-trainer"),
                await view(database, paired.token),
                paired.token,
                await stored(database, REMIND_OID),
            )

        old_view, new_view, token, document = on_a_league(mongo_replica_set_url, body)

        assert (old_view.state, old_view.rolle) == ("valid", "trainer")
        assert new_view.state == "valid"
        first = first_hashes(str(REMIND_OID))
        for rolle in ("trainer", "ansprechperson"):
            assert document["confirmations"][rolle]["token_hashes"] == [first[rolle], hash_token(token)]

    def test_a_resend_after_a_reminder_voids_every_link_on_both_seats_the_person_holds(self, mongo_replica_set_url: str):
        """A re-send replaces the person's links, so nothing it replaces may still open the seat.

        Reached only through a reminded pair: a seat nobody mirrors has no second entry, and a fixture without the reminder no
        second hash.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, now=MAIL_NOW)
            reminders = {mail.to: mail.token for mail in await drained(database, client)}
            await resend(database, "trainer")
            [fresh] = await drained(database, client)
            assert fresh.token is not None

            # The reminder's shared link and BOTH first links, one of which is the mirrored seat's own copy -- the one a
            # re-send writing a single entry leaves open.
            dead = []
            for gone in (reminders["wraxlington@example.com"] or "", f"{REMIND_OID}-trainer", f"{REMIND_OID}-ansprechperson"):
                with pytest.raises(APIError) as conflict:
                    await view(database, gone)
                dead.append(conflict.value.error_code)

            return (
                dead,
                (await view(database, fresh.token)).state,
                # The Stellvertretung is nobody's pair, so its own reminder link is untouched.
                (await view(database, reminders["bramblewick@example.com"] or "")).state,
                fresh.token,
                await stored(database, REMIND_OID),
            )

        dead, state, foreign_state, fresh_token, document = on_a_league(mongo_replica_set_url, body)

        assert dead == [Code.LINK_INVALID] * 3
        assert (state, foreign_state) == ("valid", "valid")
        assert document is not None
        # One link answering both, each entry written back as the create writes it, and the reminder owed again.
        for rolle in ("trainer", "ansprechperson"):
            assert document["confirmations"][rolle] == {
                "token_hashes": [hash_token(fresh_token)],
                "sent_at": TODAY,
                "deadline": confirmation_deadline_from(today=TODAY),
                "reminded_at": None,
                "chase_closed_at": None,
                "declined_at": None,
            }


class TestTheFourteenDayClock:
    def test_the_pass_erases_the_candidate_and_owes_the_seat_that_confirmed_the_notice(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_the_seats(database, DELETE_OID, "stellvertretung")
            response = await sweep(database, client, now=MAIL_NOW)

            return response, await stored(database, DELETE_OID), await owed(database, "deletion_notice")

        response, document, notices = on_a_league(mongo_replica_set_url, body)

        assert (response.erased, document) == (1, None)
        assert notices == [
            {
                "key": f"{Collection.BEWERBUNGEN}/{DELETE_OID}/deletion/stellvertretung",
                "to": "bramblewick@example.com",
                "data": {"kind": "deletion_notice", "saison_id": SAISON_ID},
            }
        ]
        # Nothing of the people outlives the application in the notice.
        assert LAST_NAME not in str(notices)

    def test_the_erasure_takes_exactly_the_due_application_and_writes_its_one_row(self, mongo_replica_set_url: str):
        """An application still inside its deadline, or another season's, stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return (
                response,
                await stored(database, REMIND_OID),
                await stored(database, OTHER_SEASON_OID),
                await retention_rows(database),
            )

        response, kept, other, rows = on_a_league(mongo_replica_set_url, body)

        assert response.erased == 1
        assert kept is not None and other is not None
        # The decline clock's page and this one, each in its own transaction, naming nobody.
        assert rows == [{"by": "system", "team": None, "record_id": None, "label": SAISON_ID, "count": 1}] * 2

    def test_an_objections_notice_stands_as_the_deletion_notice(self, mongo_replica_set_url: str):
        """It named the deletion day to the Ansprechperson, who confirmed and is owed no second notice."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_the_seats(database, DELETE_OID, "trainer", "ansprechperson")
            await database[Collection.BEWERBUNGEN].update_one({"_id": DELETE_OID}, {"$set": {"erasure_announced_at": "2026-03-30"}})
            response = await sweep(database, client, now=MAIL_NOW)

            return response.erased, await owed(database, "deletion_notice")

        assert on_a_league(mongo_replica_set_url, body) == (1, [])

    def test_an_emptied_ansprechperson_slot_is_erased_with_nobody_told(self, mongo_replica_set_url: str):
        """No mailbox is left to tell, which is not a refused address: the application cannot complete and goes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": DELETE_OID}, {"$set": {"kontakte.ansprechperson": None, "kontakte.trainer_is_also": None}}
            )
            response = await sweep(database, client, now=MAIL_NOW)

            return response.erased, await stored(database, DELETE_OID), await owed(database, "deletion_notice")

        assert on_a_league(mongo_replica_set_url, body) == (1, None, [])


class TestAnApplicationWhoseNoticeCannotArrive:
    """The stated day holds: the people named were promised it, and a mail to the Ansprechperson that bounced changes nothing of it."""

    def test_the_pass_takes_it_and_owes_the_notice_as_for_any_address(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_the_seats(database, DELETE_OID, "trainer", "ansprechperson")
            await refuse_the_ansprechpersons_address(database, client, DELETE_OID)
            response = await sweep(database, client, now=MAIL_NOW)

            return response.erased, await stored(database, DELETE_OID), await owed(database, "deletion_notice")

        erased_count, document, notices = on_a_league(mongo_replica_set_url, body)

        assert (erased_count, document) == (1, None)
        assert [notice["to"] for notice in notices] == ["wraxlington@example.com"]

    def test_a_seat_never_mailed_is_owed_neither_a_reminder_nor_the_notice(self, mongo_replica_set_url: str):
        """The two later mails past the bound: that mailbox has heard of nothing, and the day stands for the people who have."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            unmailed = {f"confirmations.{seat}.sent_at": None for seat in KONTAKT_ROLLEN}
            await database[Collection.BEWERBUNGEN].update_many({"_id": {"$in": [REMIND_OID, DELETE_OID]}}, {"$set": unmailed})
            response = await sweep(database, client, now=MAIL_NOW)

            return (
                response,
                await stored(database, DELETE_OID),
                await owed(database, "bewerbung_reminder"),
                await owed(database, "deletion_notice"),
            )

        response, document, reminders, notices = on_a_league(mongo_replica_set_url, body)

        assert (response.erased, document, reminders, notices) == (1, None, [], [])


class TestAClosedChase:
    """A seat whose last mail did not arrive leaves the clock's read on its own stamp, and `reminded_at` keeps meaning a reminder was owed."""

    def test_only_the_seat_no_mail_reaches_is_closed(self, mongo_replica_set_url: str):
        """A row's other seat, reachable and re-sent, keeps its own reminder; the closed one, with no later mail, owes nothing on any pass."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_ansprechpersons_address(database, client, REMIND_OID)
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": REMIND_OID},
                {"$set": {"confirmations.stellvertretung.sent_at": YESTERDAY, "confirmations.stellvertretung.deadline": "2026-04-14"}},
            )
            await sweep(database, client, now=MAIL_NOW)
            closed = await stored(database, REMIND_OID)
            await sweep(database, client, today="2026-04-03", now=MAIL_NOW + timedelta(days=2))

            return closed, await owed(database, "bewerbung_reminder")

        closed, mails = on_a_league(mongo_replica_set_url, body)

        assert closed is not None
        assert closed["confirmations"]["ansprechperson"]["chase_closed_at"] == TODAY
        assert closed["confirmations"]["ansprechperson"]["reminded_at"] is None
        assert closed["confirmations"]["stellvertretung"]["chase_closed_at"] is None
        assert [mail["to"] for mail in mails] == ["bramblewick@example.com"]

    def test_a_mail_delivered_to_the_address_opens_it_and_the_next_pass_owes_the_reminder(self, mongo_replica_set_url: str):
        """The Stellvertretung's Widerspruch tells the Ansprechperson, so a mail reaches the address the link's mail bounced from."""

        declined_at = MAIL_NOW + timedelta(hours=1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_ansprechpersons_address(database, client, REMIND_OID)
            await sweep(database, client, now=MAIL_NOW)
            closed = await stored(database, REMIND_OID)
            await database[Collection.OUTBOX].delete_many({"kind": "bewerbung_reminder"})
            await decline(database, client, f"{REMIND_OID}-stellvertretung", now=declined_at)
            await drained(database, client, now=declined_at)
            notice = await database[Collection.OUTBOX].find_one({"kind": "bewerbung_objection"})
            assert notice is not None
            await post_event(
                event_data=FLOutboxEventPayload(id=notice["_id"], state="delivered", reason=None, at=declined_at),
                outbox_collection=database[Collection.OUTBOX],
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                db_client=client,
            )
            opened = await stored(database, REMIND_OID)
            await sweep(database, client, today="2026-04-02", now=MAIL_NOW + timedelta(days=1))

            return closed, opened, await owed(database, "bewerbung_reminder")

        closed, opened, mails = on_a_league(mongo_replica_set_url, body)

        assert closed is not None
        assert closed["confirmations"]["ansprechperson"]["chase_closed_at"] == TODAY
        assert opened is not None
        assert opened["confirmations"]["ansprechperson"]["chase_closed_at"] is None
        assert [(mail["to"], mail["data"]["rollen"]) for mail in mails] == [("wraxlington@example.com", ["ansprechperson", "trainer"])]

    def test_a_re_send_still_opens_it(self, mongo_replica_set_url: str):
        """The re-send replaces the entry, its stamp with it, and the seats it left reach their mark on their own day."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_ansprechpersons_address(database, client, REMIND_OID)
            await sweep(database, client, now=MAIL_NOW)
            closed = await stored(database, REMIND_OID)
            await resend(database, "trainer")
            await drained(database, client)
            await sweep(database, client, today="2026-04-04", now=MAIL_NOW + timedelta(days=3))

            return closed, await owed(database, "bewerbung_reminder")

        closed, mails = on_a_league(mongo_replica_set_url, body)

        assert closed is not None
        assert closed["confirmations"]["ansprechperson"]["chase_closed_at"] == TODAY
        assert any(mail["key"].endswith("reminder/ansprechperson/2026-04-04") for mail in mails), mails


async def served_version(database: AsyncDatabase) -> int:
    """The count the administrator's page was served at."""

    document = await stored(database, REMIND_OID)
    assert document is not None

    return int(document["version"])


async def declined_on(database: AsyncDatabase, version: int) -> Mapping[str, Any]:
    """The administrator's decline, sent on the count their page was served at, and the application it left."""

    await decline_bewerbung(
        bewerbung_id=REMIND_OID,
        decline_data=FLDeclineBewerbungPayload(reason="kein Platz", version=version),
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        teams_collection=database[Collection.TEAMS],
        outbox_collection=database[Collection.OUTBOX],
        db=database.client,
        today=TODAY,
        germany_now=MAIL_NOW,
    )
    document = await stored(database, REMIND_OID)
    assert document is not None

    return document


class TestADecisionReadBeforeAJobsMailBookkeeping:
    """A job's stamp on a seat's chase is no field a form saves, so it leaves the count: a decision read before it lands, the stamp standing."""

    def test_the_reminders_stamp(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            served = await served_version(database)
            await sweep(database, client, now=MAIL_NOW)
            assert REMIND_OID in await reminded(database)

            return await declined_on(database, served)

        document = on_a_league(mongo_replica_set_url, body)

        assert document["status"] == "declined"
        assert document["confirmations"]["stellvertretung"]["reminded_at"] == TODAY

    def test_the_chase_the_pass_closes(self, mongo_replica_set_url: str):
        """The Stellvertretung's link re-sent yesterday, so the close is the pass's one write on the row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            await refuse_the_ansprechpersons_address(database, client, REMIND_OID)
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": REMIND_OID},
                {"$set": {"confirmations.stellvertretung.sent_at": YESTERDAY, "confirmations.stellvertretung.deadline": "2026-04-14"}},
            )
            served = await served_version(database)
            await sweep(database, client, now=MAIL_NOW)
            assert REMIND_OID not in await reminded(database)

            return await declined_on(database, served)

        document = on_a_league(mongo_replica_set_url, body)

        assert document["status"] == "declined"
        assert document["confirmations"]["ansprechperson"]["chase_closed_at"] == TODAY

    def test_the_chase_a_delivered_mail_opens(self, mongo_replica_set_url: str):
        """The Stellvertretung's Widerspruch tells the Ansprechperson, whose delivered notice opens the chase the pass closed."""

        declined_at = MAIL_NOW + timedelta(hours=1)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            await refuse_the_ansprechpersons_address(database, client, REMIND_OID)
            await sweep(database, client, now=MAIL_NOW)
            await decline(database, client, f"{REMIND_OID}-stellvertretung", now=declined_at)
            await drained(database, client, now=declined_at)
            notice = await database[Collection.OUTBOX].find_one({"kind": "bewerbung_objection"})
            assert notice is not None
            closed = await stored(database, REMIND_OID)
            assert closed is not None and closed["confirmations"]["ansprechperson"]["chase_closed_at"] == TODAY
            served = await served_version(database)
            await post_event(
                event_data=FLOutboxEventPayload(id=notice["_id"], state="delivered", reason=None, at=declined_at),
                outbox_collection=database[Collection.OUTBOX],
                bewerbungen_collection=database[Collection.BEWERBUNGEN],
                db_client=client,
            )

            return await declined_on(database, served)

        document = on_a_league(mongo_replica_set_url, body)

        assert document["status"] == "declined"
        assert document["confirmations"]["ansprechperson"]["chase_closed_at"] is None


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

            return [mail.to for mail in await drained(database, client)]

        assert REFUSED_ADDRESS in on_a_league(mongo_replica_set_url, body)


# The Stellvertretung's stamp, the one seat nobody mirrors, each state the clocks' queries must read
# as `app/shared/einwilligung.py :: is_confirmed` reads it.
STELLVERTRETUNG_STAMP = "kontakte.stellvertretung.einwilligung.confirmed_at"
STAMP_STATES = [
    pytest.param({"$set": {STELLVERTRETUNG_STAMP: MAILED_ON_THE_MARK}}, False, id="confirmed, the control"),
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

    def test_one_seats_lapsed_deadline_reaches_the_query_beside_another_seats_fresh_link(self, mongo_replica_set_url: str):
        """The filter's first arm: a read judging the latest deadline never hands the predicate this row."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": DELETE_OID}, {"$set": {"confirmations.stellvertretung.deadline": "2026-04-12"}}
            )
            await sweep(database, client)

            return await stored(database, DELETE_OID) is None

        assert on_a_league(mongo_replica_set_url, body) is True

    @pytest.mark.parametrize(
        ("other_deadline", "taken"),
        [pytest.param("2026-04-12", False, id="another seat's link still runs"), pytest.param(YESTERDAY, True, id="no link runs")],
    )
    def test_a_seat_an_erasure_emptied_reaches_the_query_once_no_link_runs(self, mongo_replica_set_url: str, other_deadline: str, taken: bool):
        """The filter's second arm: the erased seat holds no deadline for the first arm to read."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, DELETE_OID)
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": DELETE_OID},
                {
                    "$set": {
                        "kontakte.stellvertretung": None,
                        "confirmations.stellvertretung": None,
                        "confirmations.trainer.deadline": other_deadline,
                        "confirmations.ansprechperson.deadline": other_deadline,
                    }
                },
            )
            await sweep(database, client)

            return await stored(database, DELETE_OID) is None

        assert on_a_league(mongo_replica_set_url, body) is taken


class TestTheDeclineClock:
    def test_a_declined_application_past_its_fourteen_days_is_erased_in_the_first_call(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, DECLINED_OID)

        response, document = on_a_league(mongo_replica_set_url, body)

        assert (response.erased_declined, document) == (1, None)


class TestTheSeasonsOwnEndClock:
    """The bound on an application nobody decided, which the fourteen-day clock drops as soon as every seat confirms."""

    def test_an_application_every_seat_confirmed_and_nobody_decided_is_erased_and_its_people_told(self, mongo_replica_set_url: str):
        """Both submitted rows go, the confirmed one and the one past its deadline; a decided one is this clock's business at all."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, REMIND_OID)
            response = await sweep(database, client, now=MAIL_NOW)

            return (
                response,
                await stored(database, REMIND_OID),
                await stored(database, DELETE_OID),
                await stored(database, ACCEPTED_OID),
                await owed(database, "deletion_notice"),
            )

        response, confirmed, past_its_deadline, accepted, notices = on_a_league(
            mongo_replica_set_url, body, status="past", next_status="active"
        )

        assert (response.erased_without_decision, confirmed, past_its_deadline) == (2, None, None)
        # The accepted one is the successor season's business, and that season still runs.
        assert accepted is not None
        # An application undecided at its season's end has not served: only the one confirmed row owes anybody the notice.
        assert [notice["to"] for notice in notices] == ["wraxlington@example.com", "bramblewick@example.com"]

    def test_nothing_goes_while_the_season_still_runs(self, mongo_replica_set_url: str):
        """The row every other clock leaves standing: confirmed by all three and decided by nobody."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, REMIND_OID)
            response = await sweep(database, client)

            return response, await stored(database, REMIND_OID)

        response, confirmed = on_a_league(mongo_replica_set_url, body)

        assert response.erased_without_decision == 0
        assert confirmed is not None

    def test_the_pass_offers_neither_a_reminder_nor_a_notice_for_a_row_this_clock_takes(self, mongo_replica_set_url: str):
        """The order is the whole of it: run after either, and the caller mails about an application this pass has erased."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client, now=MAIL_NOW)

            return response, await database[Collection.OUTBOX].count_documents({})

        response, mails = on_a_league(mongo_replica_set_url, body, status="past", next_status="active")

        assert (response.reminded, response.erased, mails) == (0, 0, 0)
        assert response.erased_without_decision == 2


class TestTheSeasonAndOneClock:
    def test_nothing_goes_while_the_next_season_runs(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, ACCEPTED_OID), await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})

        response, document, row = on_a_league(mongo_replica_set_url, body, status="past", next_status="active")

        assert (response.erased_accepted, response.kontakt_blocks_emptied) == (0, 0)
        assert document is not None and row is not None and row["kontakte"] is not None

    def test_the_application_goes_and_the_contact_block_empties_once_the_next_season_is_past(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return (
                response,
                await stored(database, ACCEPTED_OID),
                await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}),
            )

        response, document, row = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert (response.erased_accepted, response.kontakt_blocks_emptied, document) == (1, 1, None)
        assert row is not None and row["kontakte"] is None
        # The block's own keys survive around the clearing: the row is still a junction row.
        assert (row["gruppe"], row["trikot_farbe"]) == ("B", "blau")

    def test_a_pass_finding_no_block_left_writes_no_row(self, mongo_replica_set_url: str):
        """Every hourly pass reads every old season, so a row for a pass that took nothing would fill the Protokoll."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await sweep(database, client)
            await sweep(database, client)

            return await database[Collection.ACTION_LOG].count_documents({"action": "retention.kontakte"})

        assert on_a_league(mongo_replica_set_url, body, status="past", next_status="past") == 1

    @pytest.mark.parametrize("people", [pytest.param(kontakte(), id="beside their people"), pytest.param(None, id="left by an older image")])
    def test_the_rows_confirmation_links_go_too(self, mongo_replica_set_url: str, people: Any):
        """A link's entry carries a token hash, which has no clock of its own."""

        link = {"token_hashes": ["a" * 64], "sent_at": "2026-03-02", "deadline": "2026-03-16", "declined_at": None}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one(
                {"_id": JUNCTION_OID},
                {"$set": {"kontakte": people, "confirmations": {"trainer": link, "ansprechperson": None, "stellvertretung": None}}},
            )
            response = await sweep(database, client)

            return response.kontakt_blocks_emptied, await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})

        emptied, row = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert emptied == 1
        assert row is not None and (row["kontakte"], row["confirmations"]) == (None, None)

    def test_a_season_with_no_successor_yet_keeps_everything(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response.erased_accepted, response.kontakt_blocks_emptied

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

            return response.erased_accepted, response.kontakt_blocks_emptied

        assert on_a_league(mongo_replica_set_url, body, status="past", next_status=between) == (1, 1)

    def test_the_running_season_keeps_both_whatever_later_season_has_ended(self, mongo_replica_set_url: str):
        """A lower season activated once a later one had run: it needs its contact persons while it runs.

        The rule keeps its pupils for as long, and these two clocks match it.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, ACCEPTED_OID), await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})

        response, document, row = on_a_league(mongo_replica_set_url, body, status="active", next_status="past")

        assert (response.erased_accepted, response.kontakt_blocks_emptied) == (0, 0)
        assert document is not None and row is not None and row["kontakte"] is not None

    def test_a_running_season_whose_id_is_no_year_still_fails_the_pass(self, mongo_replica_set_url: str):
        """A running season reads no later one: judged inside that read, a hand-edited id would fail no pass while its season runs."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> None:
            await database[Collection.SAISONS].insert_one({**season(SKIPPED_TO_SAISON_ID, "active"), "_id": "abcd"})
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


# Far past the call's few seconds over two pages, far short of a job's own budget, and inside the seed's own bound, so a
# drain that never ends fails as one rather than as a seed cancelled for a deadlock.
DRAIN_BOUND_S = SEED_BOUND_S / 2


class TestAnActivationInsideAnEraseTransactionKeepsTheSeasonsRows:
    @pytest.mark.parametrize(
        ("collection", "clocks_read", "expected"),
        [
            pytest.param(
                Collection.BEWERBUNGEN, lambda db_filter: db_filter.get("status") == "accepted", (0, 0, True, True), id="the accepted clock's"
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

        accepted = {"status": "accepted", "decision": {"made_at": "2026-03-01", "reason": None}}
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
                    ban_list_collection=database[Collection.BAN_LIST],
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
                    spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
                    spielberichte_collection=database[Collection.SPIELBERICHTE],
                    outbox_collection=database[Collection.OUTBOX],
                    db=client,
                    today=TODAY,
                    germany_now=MAIL_NOW,
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
                    response.erased_accepted,
                    response.kontakt_blocks_emptied,
                    await stored(database, ACCEPTED_OID) is not None,
                    junction_row is not None and junction_row["kontakte"] is not None,
                ),
                (report_now, confirmation_now),
            )

        outcome, activated, kept, (report_now, confirmation_now) = on_a_league(mongo_replica_set_url, body, status="future", next_status="past")

        # The premise first: the activation committed inside the clock's transaction.
        assert (outcome, activated is not None and activated["status"]) == (COMMITTED, "active")
        assert kept == expected
        assert report_now["bericht"]["remarks"] == report["bericht"]["remarks"], "the report strip ran past the activation"
        assert confirmation_now["answer"]["reason"] == declined["answer"]["reason"], "the confirmations' strip ran past it"


SECOND_OID = ObjectId("6890a1b2c3d4e5f607960007")
SECOND_CLUB_OID = ObjectId("6890a1b2c3d4e5f607960012")
SECOND_JUNCTION_OID = ObjectId("6890a1b2c3d4e5f607960022")


async def refuse_writes_breaking(database: AsyncDatabase, collection: Collection, schema: Mapping[str, Any]) -> None:
    """How this suite forces one row's write to fail mid-pass: a `$jsonSchema` the planted row breaks and every other row keeps."""

    await database.command("collMod", str(collection), validator={"$jsonSchema": dict(schema)}, validationLevel="strict")


# What a row the validator refuses reads as on a passed-over line: the driver's type and the server's code.
REFUSED_WRITE = "OperationFailure, code 121"

# A hand-edited deadline as the reminder's facts refuse it: the field and the rule, never the value.
REFUSED_DEADLINE = (
    "ValidationError: [{'loc': 'deadline', 'type': 'string_pattern_mismatch', "
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

    def test_a_refused_contact_block(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].insert_one({**junction_row(), "_id": SECOND_JUNCTION_OID, "team_id": SECOND_CLUB_OID})
            await database[Collection.SAISON_TEAMS].update_one({"_id": JUNCTION_OID}, {"$unset": {"shorthand": ""}})
            await refuse_writes_breaking(database, Collection.SAISON_TEAMS, {"required": ["shorthand"]})
            answer = await sweep(database, client, now=MAIL_NOW)
            blocks = await database[Collection.SAISON_TEAMS].find({}, {"kontakte": 1}).sort("_id", 1).to_list(None)

            return answer, [(block["_id"], block["kontakte"] is not None) for block in blocks], await reminded(database)

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answer, blocks, chased = on_a_league(
                mongo_replica_set_url, body, status="future", next_status="past", mutates_schema=True, stores_a_refused_shape=NO_SHORTHAND
            )

        assert (answer.kontakt_blocks_emptied, answer.failed, chased) == (1, 1, {REMIND_OID})
        assert blocks == [(JUNCTION_OID, True), (SECOND_JUNCTION_OID, False)]
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Season team", str(JUNCTION_OID), "contact block", REFUSED_WRITE)]

    def test_a_reminder_the_mail_cannot_carry(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A deadline the mail's facts refuse before any stamp is written, so the row is passed over and nothing taken apart."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            seeded = application(SECOND_OID)
            # Written past the builder, which refuses a deadline its record model does not read.
            unreadable = {seat: {**entry, "deadline": "2026-04-1"} for seat, entry in seeded["confirmations"].items()}
            await database[Collection.BEWERBUNGEN].insert_one({**seeded, "confirmations": unreadable})
            # A seat of the row whose chase this pass would close, were the row not passed over whole.
            await refuse_the_ansprechpersons_address(database, client, SECOND_OID)
            answer = await sweep(database, client, now=MAIL_NOW)
            refused = await stored(database, SECOND_OID)
            assert refused is not None

            seats = refused["confirmations"].values()
            return await reminded(database), answer.failed, [seat["reminded_at"] for seat in seats], [seat["chase_closed_at"] for seat in seats]

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answered, count, stamps, closed = on_a_league(mongo_replica_set_url, body, stores_a_refused_shape=UNREADABLE_DATES)

        assert (answered, count, stamps, closed) == ({REMIND_OID}, 1, [None, None, None], [None, None, None])
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

            return await reminded(database), answer.failed, [seat["reminded_at"] for seat in refused["confirmations"].values()]

        answered, count, stamps = on_a_league(mongo_replica_set_url, body, mutates_schema=True, stores_a_refused_shape=NO_TRIKOT)

        # The refused row's mails went with its stamp: nobody is chased whose seat says they were not.
        assert (answered, count, stamps) == ({REMIND_OID}, 1, [None, None, None])
        # The stamp is an update rather than a find-and-modify, which the driver refuses as its `WriteError`.
        refusal = "WriteError, code 121"
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Application", str(SECOND_OID), "reminder", f"{refusal}")]

    def test_a_pass_whose_every_reminder_fails_counts_them(self, mongo_replica_set_url: str):
        """Every stamp refused, so no half commits: the count is all that tells this pass from a clean one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_many({}, {"$unset": {"trikot": ""}})
            await refuse_writes_breaking(database, Collection.BEWERBUNGEN, {"required": ["trikot"]})
            answer = await sweep(database, client, now=MAIL_NOW)

            return answer.reminded, answer.failed, await reminded(database)

        assert on_a_league(mongo_replica_set_url, body, mutates_schema=True, stores_a_refused_shape=NO_TRIKOT) == (0, 1, set())

    def test_a_refused_retention_row_leaves_its_rows_owes_no_notice_and_stops_no_later_clock(self, mongo_replica_set_url: str):
        """No deletion stands without its row, and nobody is told of an erasure that did not happen."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_the_seats(database, DELETE_OID, "stellvertretung")
            await refuse_writes_breaking(
                database, Collection.ACTION_LOG, {"properties": {"action": {"not": {"enum": ["retention.bewerbungen"]}}}}
            )
            answer = await sweep(database, client, now=MAIL_NOW)
            left = [await stored(database, row) is not None for row in (DECLINED_OID, DELETE_OID)]

            return answer, left, await owed(database, "deletion_notice"), await reminded(database)

        answer, left, notices, chased = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert (answer.erased_declined, answer.erased, answer.failed) == (0, 0, 2)
        assert left == [True, True]
        assert notices == []
        assert chased == {REMIND_OID}


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

    def test_the_reminder_takes_its_share_oldest_application_first_and_the_passes_reach_every_row(self, mongo_replica_set_url: str):
        overflow = REMINDERS_PER_PASS + 5
        # The later applications seeded FIRST, so natural order would take the wrong share.
        submitted_of = {position: "2026-03-20" if position < overflow - REMINDERS_PER_PASS else "2026-03-19" for position in range(overflow)}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many(
                [application(numbered(position), submitted_at=day) for position, day in submitted_of.items()]
            )

            first = await sweep(database, client, now=MAIL_NOW)
            reminded = await database[Collection.BEWERBUNGEN].find({"confirmations.trainer.reminded_at": TODAY}).to_list(length=None)
            first_days = {row["submitted_at"] for row in reminded}

            async def one_pass() -> int:
                return (await sweep(database, client, now=MAIL_NOW)).reminded

            taken = [first.reminded, *await passes_until_empty(one_pass, share=REMINDERS_PER_PASS, total=overflow - first.reminded)]

            stamped = await database[Collection.BEWERBUNGEN].count_documents({"confirmations.trainer.reminded_at": TODAY})

            return first_days, taken, stamped

        first_days, taken, stamped = on_a_league(mongo_replica_set_url, body)

        assert first_days == {"2026-03-19"}
        per_pass(taken, REMINDERS_PER_PASS, overflow)
        assert stamped == overflow

    def test_a_page_of_seats_no_mail_reaches_leaves_the_read_and_the_newer_row_is_chased(self, mongo_replica_set_url: str):
        """Oldest first, the bounced rows fill the read: left there they refuse the pass, its erasure's count with it, until their deadline."""

        bounced = [numbered(position) for position in range(SWEEP_PAGE + 1)]
        newer, lapsed = numbered(SWEEP_PAGE + 1), numbered(SWEEP_PAGE + 2)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many(
                [
                    *[application(row_id, submitted_at="2026-03-19") for row_id in bounced],
                    application(newer, submitted_at="2026-03-20"),
                    application(lapsed, confirmation_deadline=YESTERDAY),
                ]
            )
            await mails_that_bounced(database, bewerbung_ids=bounced, seats=BOTH_MAILBOXES)
            first = await sweep(database, client, now=MAIL_NOW)
            second = await sweep(database, client, now=MAIL_NOW)
            closed = await database[Collection.BEWERBUNGEN].count_documents(
                {"_id": {"$in": bounced}, **{f"confirmations.{seat}.chase_closed_at": TODAY for seat in KONTAKT_ROLLEN}}
            )

            return first.erased, first.reminded, second.reminded, await reminded(database), closed

        assert on_a_league(mongo_replica_set_url, body) == (1, 0, 1, {newer}, SWEEP_PAGE + 1)

    def test_the_contact_blocks_are_cleared_a_share_a_pass_until_none_is_left(self, mongo_replica_set_url: str):
        overflow = BLOCKS_CLEARED_PER_PASS + 5

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].delete_many({})
            await database[Collection.SAISON_TEAMS].insert_many(
                [{**junction_row(), "_id": numbered(position), "team_id": numbered(position)} for position in range(overflow)]
            )

            async def one_pass() -> int:
                return (await sweep(database, client)).kontakt_blocks_emptied

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
                [application(numbered(position), confirmation_deadline=YESTERDAY) for position in range(overflow)]
            )
            await database[Collection.BEWERBUNGEN].update_many(
                {}, {"$set": {"kontakte.stellvertretung.einwilligung.confirmed_at": MAILED_ON_THE_MARK}}
            )
            response = await sweep(database, client, now=MAIL_NOW)

            return (
                response.erased,
                await database[Collection.BEWERBUNGEN].count_documents({"saison_id": SAISON_ID}),
                await database[Collection.OUTBOX].count_documents({"kind": "deletion_notice"}),
            )

        assert on_a_league(mongo_replica_set_url, body) == (overflow, 0, overflow)


def open_confirmation(team_id: ObjectId) -> dict[str, Any]:
    """One team's open row about a fixture, asked today."""

    spiel = documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON_ID,
        spiel_nr=1,
        spieltag_id=ObjectId(),
        date="2026-04-18",
        time="14:00:00",
        team1={"team_id": team_id, "tore": None},
        team2={"team_id": CLUB_OID, "tore": None},
    )

    return documents.spielbestaetigung_document(
        spiel,
        party={"kind": "team", "team_id": team_id},
        deadline="2026-04-11",
        asked_at=TODAY,
    )


def lapsed_row(position: int, seats: tuple[str, ...]) -> dict[str, Any]:
    """A season row of three people, these seats past their day and the others still running."""

    links = documents.row_confirmations(hashes=first_hashes(f"row-{position}"), today=MAILED_ON_THE_MARK)

    return {
        **junction_row(),
        "_id": numbered(position),
        "team_id": numbered(position),
        "kontakte": {
            "trainer": person(f"Trainer{position}"),
            "ansprechperson": person(f"Ansprechperson{position}"),
            "stellvertretung": person(f"Stellvertretung{position}"),
            "trainer_is_also": None,
        },
        "confirmations": {seat: {**entry, "deadline": YESTERDAY} if seat in seats else entry for seat, entry in links.items()},
    }


class TestTheSeasonRowSeatClock:
    """A season row's seat its person never confirmed: the mail and the page promise it goes on its day."""

    @staticmethod
    async def two_lapsed_seats(database: AsyncDatabase) -> None:
        """One person confirmed as the Trainer and lapsed in the seat beside it, a second lapsed with a reason typed from their seat."""

        links = documents.row_confirmations(hashes=first_hashes("row"), today=MAILED_ON_THE_MARK)
        await database[Collection.SAISON_TEAMS].update_one(
            {"_id": JUNCTION_OID},
            {
                "$set": {
                    "kontakte": {**kontakte(), "trainer": person("Wraxlington", confirmed_at=MAILED_ON_THE_MARK)},
                    "confirmations": {seat: {**entry, "deadline": YESTERDAY} for seat, entry in links.items()},
                }
            },
        )
        confirmation = {
            **open_confirmation(CLUB_OID),
            "answer": documents.kontakt_answer_document("stellvertretung", reason="Wir sind auf Klassenfahrt"),
        }
        await database[Collection.SPIELBESTAETIGUNGEN].insert_one(confirmation)

    def test_the_first_pass_past_its_day_empties_it_and_leaves_the_confirmed_seat(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await self.two_lapsed_seats(database)
            response = await sweep(database, client)
            with pytest.raises(APIError) as refused:
                await view(database, "row-stellvertretung")
            confirmation = await database[Collection.SPIELBESTAETIGUNGEN].find_one({})
            assert confirmation is not None

            return (
                response,
                await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}),
                confirmation,
                refused.value.error_code,
                await deletions_of(database, "retention.kontakte"),
            )

        response, row, confirmation, refusal, deletions = on_a_league(mongo_replica_set_url, body)

        assert (row["kontakte"]["ansprechperson"], row["kontakte"]["stellvertretung"]) == (None, None)
        assert (row["confirmations"]["ansprechperson"], row["confirmations"]["stellvertretung"]) == (None, None)
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] == MAILED_ON_THE_MARK
        assert row["confirmations"]["trainer"] is not None
        assert response.kontakt_seats_emptied == 2
        assert deletions == [("system", SAISON_ID, 2, None)]
        assert refusal == Code.LINK_INVALID

        assert confirmation["answer"]["reason"] is None

    def test_a_past_seasons_seat_goes_on_its_day_and_a_confirmed_one_stays(self, mongo_replica_set_url: str):
        """The mail's promise holds for a link minted shortly before a rollover: only a confirmed seat is the season's record."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await self.two_lapsed_seats(database)
            response = await sweep(database, client)

            return response, await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})

        response, row = on_a_league(mongo_replica_set_url, body, status="past", next_status="active")

        assert response.kontakt_seats_emptied == 2
        assert row["kontakte"]["stellvertretung"] is None
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] == MAILED_ON_THE_MARK


class TestASeasonNobodyHas:
    def test_the_pass_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundError):
                await sweep(database, client, saison_id="1999")

            return await database[Collection.BEWERBUNGEN].count_documents({}), await retention_rows(database)

        assert on_a_league(mongo_replica_set_url, body) == (5, [])


# Under the driver's first batch, so a page read is one command however many rows it holds.
FEW = 10


class TestARefusedReminderCostsThePassNothing:
    @pytest.mark.parametrize(
        "refused",
        [
            pytest.param(
                lambda row: {
                    **row,
                    "confirmations": {seat: {**entry, "deadline": "2026-04-1"} for seat, entry in row["confirmations"].items()},
                },
                id="a deadline the answer refuses",
            ),
            pytest.param(
                lambda row: {
                    **row,
                    "confirmations": {seat: {**entry, "sent_at": "2026-03-1x"} for seat, entry in row["confirmations"].items()},
                },
                id="a send date no judge can read",
            ),
        ],
    )
    def test_it_costs_only_the_write_it_skips(self, mongo_replica_set_url: str, refused: Callable[[dict[str, Any]], dict[str, Any]]):
        """Taken apart instead, the share spends a failed attempt and its halves on the row."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(rows: list[dict[str, Any]]) -> int:
                # The first run's mails gone too: keys it owed would cost the second run no insert.
                await database[Collection.OUTBOX].delete_many({})
                await database[Collection.BEWERBUNGEN].delete_many({})
                await database[Collection.BEWERBUNGEN].insert_many(rows)

                _, names = await commands_by_name(mongo_replica_set_url, DATABASE_NAME, sweep)

                return names.total()

            rows = [application(numbered(position)) for position in range(FEW)]
            return await counted(rows), await counted([*rows[:-1], refused(rows[-1])])

        carryable, with_one_refused = on_a_league(mongo_replica_set_url, body, stores_a_refused_shape=UNREADABLE_DATES)

        assert carryable - with_one_refused == ROUND_TRIPS_A_ROW


# The per-row loops' one command a row: the update.
ROUND_TRIPS_A_ROW = 1

# The worst call's commands beside its rows, and a past season's, whose own end leaves no reminder.
SWEEP_OTHER_COMMANDS = 39
SWEEP_PAST_LAPSED_OTHER_COMMANDS = 18


class TestTheWorstCallSendsTheCommandsItsBudgetCounts:
    """The budgets above, the rows at the per-row cost and the rest as each names them.

    A command added to either call turns its case red, so the share is judged against the deadline again.
    """

    def test_the_sweep(self, mongo_replica_set_url: str):
        """Every clock takes a page, every conditional read is made: two applications name a club.

        Two clubs' contact blocks clear. One application no mail reaches closes the chase of every seat.
        """

        link = {"token_hashes": ["a" * 64], "sent_at": "2026-03-02", "deadline": "2026-03-16", "declined_at": None}
        links = {"trainer": link, "ansprechperson": None, "stellvertretung": None}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await database[Collection.BEWERBUNGEN].update_many(
                {"_id": {"$in": [REMIND_OID, DELETE_OID]}}, {"$set": {"team_id": CLUB_OID, "schule": None}}
            )
            await database[Collection.SAISON_TEAMS].insert_many(
                [
                    {**junction_row(), "_id": numbered(1), "team_id": numbered(1), "kontakte": None, "confirmations": links},
                    {**junction_row(), "_id": numbered(2), "team_id": numbered(2), "confirmations": links},
                ]
            )
            await database[Collection.SPIELBERICHTE].insert_one(a_report(SAISON_ID))
            await database[Collection.BEWERBUNGEN].insert_one(application(numbered(3)))
            await mails_that_bounced(database, bewerbung_ids=[numbered(3)], seats=BOTH_MAILBOXES)

            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, sweep)

        answer, names = on_a_league(mongo_replica_set_url, body, status="future", next_status="past")
        rows = answer.reminded + answer.kontakt_blocks_emptied

        assert (answer.erased_declined, answer.erased_accepted, answer.erased, rows) == (1, 1, 1, 4)
        assert sum(names.values()) - ROUND_TRIPS_A_ROW * rows == SWEEP_OTHER_COMMANDS, names

    def test_the_sweep_of_a_past_season(self, mongo_replica_set_url: str):
        """The lapsed seats' side again where the season's own end runs too: it takes the open rows, and with them every reminder."""

        lapsing = [seats for size in range(1, len(KONTAKT_ROLLEN) + 1) for seats in combinations(KONTAKT_ROLLEN, size)]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await database[Collection.SAISON_TEAMS].insert_many([lapsed_row(position, seats) for position, seats in enumerate(lapsing)])

            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, sweep)

        answer, names = on_a_league(mongo_replica_set_url, body, status="past", next_status="active")

        assert (answer.reminded, answer.erased_declined, answer.kontakt_seats_emptied) == (0, 1, 12)
        assert answer.erased_without_decision > 0
        assert sum(names.values()) - ROUND_TRIPS_A_ROW * len(lapsing) == SWEEP_PAST_LAPSED_OTHER_COMMANDS, names


class TestAPageAndOneMoreIsDrained:
    """A page and a short one after it.

    At a page plus ONE the first read would take every row, so a clock that stopped after its first
    erasure would leave nothing behind and pass.
    """

    def test_every_declined_application_due_goes_in_one_pass(self, mongo_replica_set_url: str):
        overflow = SWEEP_PAGE + 5
        declined = {"status": "declined", "decision": {"made_at": "2026-02-15", "reason": None}}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many([application(numbered(position), **declined) for position in range(overflow)])
            response = await sweep(database, client)

            return response.erased_declined, await database[Collection.BEWERBUNGEN].count_documents({"saison_id": SAISON_ID})

        assert on_a_league(mongo_replica_set_url, body) == (overflow, 0)

    def test_every_undecided_application_goes_in_one_pass_once_the_season_is_past(self, mongo_replica_set_url: str):
        overflow = SWEEP_PAGE + 5

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many([application(numbered(position)) for position in range(overflow)])
            response = await sweep(database, client)

            return response.erased_without_decision, await database[Collection.BEWERBUNGEN].count_documents({"saison_id": SAISON_ID})

        assert on_a_league(mongo_replica_set_url, body, status="past", next_status="active") == (overflow, 0)

    def test_every_accepted_application_goes_in_one_pass_once_the_next_season_is_past(self, mongo_replica_set_url: str):
        overflow = SWEEP_PAGE + 5
        accepted = {
            "status": "accepted",
            "team_id": CLUB_OID,
            "schule": None,
            "decision": {"made_at": "2026-03-01", "reason": None},
        }

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many([application(numbered(position), **accepted) for position in range(overflow)])
            response = await sweep(database, client)

            return response.erased_accepted, await database[Collection.BEWERBUNGEN].count_documents({"saison_id": SAISON_ID})

        assert on_a_league(mongo_replica_set_url, body, status="past", next_status="past") == (overflow, 0)

    def test_a_page_of_decisions_inside_their_days_does_not_hide_one_that_is_due(self, mongo_replica_set_url: str):
        """The fresh decisions are seeded first, so a read not narrowed to the due ones fills its page with them and refuses the pass."""

        fresh = {"status": "declined", "decision": {"made_at": "2026-03-31", "reason": None}}
        due = {"status": "declined", "decision": {"made_at": "2026-02-15", "reason": None}}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            seeded = [application(numbered(position), **fresh) for position in range(SWEEP_PAGE + 1)]
            await database[Collection.BEWERBUNGEN].delete_many({})
            await database[Collection.BEWERBUNGEN].insert_many([*seeded, application(numbered(SWEEP_PAGE + 1), **due)])

            return (await sweep(database, client)).erased_declined

        assert on_a_league(mongo_replica_set_url, body) == 1


# A club the season replaced: its season row went to the incoming club, so no block clearing names its rows.
REPLACED_CLUB_OID = ObjectId("6890a1b2c3d4e5f6079600f1")


def a_declined_confirmation(team_id: ObjectId, saison_id: str) -> dict[str, Any]:
    """A team row its Trainer declined with a reason, closed since."""

    spiel = documents.spiel_document(
        spiel_id=ObjectId(),
        saison_id=saison_id,
        spiel_nr=1,
        spieltag_id=ObjectId(),
        date=f"{saison_id}-04-18",
        time="14:00:00",
        team1={"team_id": team_id, "tore": None},
        team2={"team_id": CLUB_OID, "tore": None},
    )
    return documents.spielbestaetigung_document(
        spiel,
        party={"kind": "team", "team_id": team_id},
        asked_at=f"{saison_id}-04-01",
        answer=documents.kontakt_answer_document("trainer", reason="Wir sind auf Klassenfahrt"),
        closed={"reason": "spiel_past"},
    )


class TestTheReportStripStandsApart:
    def test_a_strip_failing_holds_back_neither_the_confirmations_nor_a_block_and_is_passed_over_under_the_season(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """A report the installed validator refuses once stripped: the report strip alone meets it, in its own transaction."""

        refused = a_report(SAISON_ID)
        del refused["bericht"]["sides"]
        declined = a_declined_confirmation(CLUB_OID, SAISON_ID)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBERICHTE].insert_one(refused)
            await refuse_writes_breaking(database, Collection.SPIELBERICHTE, {"properties": {"bericht": {"required": ["sides"]}}})
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
            mongo_replica_set_url, body, status="past", next_status="past", mutates_schema=True, stores_a_refused_shape=NO_SIDES
        )

        assert (response.kontakt_blocks_emptied, response.failed, junction["kontakte"]) == (1, 1, None)
        assert confirmation["answer"]["reason"] is None, "the confirmations' strip fell with the reports'"
        assert report["bericht"]["remarks"] == refused["bericht"]["remarks"], "the failed strip left a write behind"
        assert [(level, what, row_id, clock) for level, _, what, row_id, clock, _ in passed_over(caplog)] == [
            ("ERROR", "Season", SAISON_ID, "report strip")
        ]


class TestTheSeasonsEndStripsItsConfirmations:
    def test_its_team_rows_keep_the_answer_alone_and_another_season_keeps_everything(self, mongo_replica_set_url: str):
        """The club's own row, a replaced club's no clearing names, and the next season's row as the control."""

        rows = {
            "own": a_declined_confirmation(CLUB_OID, SAISON_ID),
            "replaced": a_declined_confirmation(REPLACED_CLUB_OID, SAISON_ID),
            "next season": a_declined_confirmation(CLUB_OID, NEXT_SAISON_ID),
        }

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            await confirmations.insert_many([dict(row) for row in rows.values()])
            response = await sweep(database, client)
            stored = {name: await confirmations.find_one({"_id": row["_id"]}) for name, row in rows.items()}

            return response, stored, await deletions_of(database, "retention.spielbestaetigungen")

        response, stored, deletions = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        # The premise: the pass cleared the season's one block, which is what owes the strip.
        assert response.kontakt_blocks_emptied == 1
        # Both rows' reasons, the replaced club's among them.
        assert deletions == [("system", SAISON_ID, 2, None)]
        kept = rows["own"]["answer"]
        stripped = {**kept, "reason": None}
        for name in ("own", "replaced"):
            assert stored[name]["answer"] == stripped, name
        assert stored["next season"]["answer"] == rows["next season"]["answer"]

    def test_a_season_with_no_block_left_to_clear_is_stripped_all_the_same(self, mongo_replica_set_url: str):
        """The club entered no contacts, as a replacement's incoming side holds none: no pass clears a block of the season."""

        row = a_declined_confirmation(CLUB_OID, SAISON_ID)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"_id": JUNCTION_OID}, {"$set": {"kontakte": None, "confirmations": None}})
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(row)
            response = await sweep(database, client)
            return response, await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": row["_id"]})

        response, stripped = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert (response.kontakt_blocks_emptied, response.failed) == (0, 0)
        assert stripped["answer"]["reason"] is None

    def test_a_strip_failing_holds_back_no_block_and_is_passed_over_under_the_season(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """A replaced club's row the installed validator refuses, which no block clearing writes: the strip alone meets it."""

        refused = {key: value for key, value in a_declined_confirmation(REPLACED_CLUB_OID, SAISON_ID).items() if key != "deadline"}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(refused)
            await refuse_writes_breaking(database, Collection.SPIELBESTAETIGUNGEN, {"required": ["deadline"]})
            with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
                response = await sweep(database, client)
            return (
                response,
                await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}),
            )

        response, junction = on_a_league(
            mongo_replica_set_url, body, status="past", next_status="past", mutates_schema=True, stores_a_refused_shape=NO_DEADLINE
        )

        assert (response.kontakt_blocks_emptied, response.failed, junction["kontakte"]) == (1, 1, None)
        assert [(level, what, row_id, clock) for level, _, what, row_id, clock, _ in passed_over(caplog)] == [
            ("ERROR", "Season", SAISON_ID, "confirmation strip")
        ]

    def test_an_administrators_settle_reason_goes_and_their_answer_gains_no_holder(self, mongo_replica_set_url: str):
        settled = {
            **a_declined_confirmation(CLUB_OID, SAISON_ID),
            "answer": {"kind": "declined", "at": "2026-04-03", "by": {"kind": "admin"}, "vorschlag": None, "reason": "Platz gesperrt"},
        }

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(settled)
            await sweep(database, client)
            return await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": settled["_id"]})

        stripped = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert stripped["answer"] == {**settled["answer"], "reason": None}

    def test_a_referee_rows_reason_goes_and_its_answer_stays(self, mongo_replica_set_url: str):
        """Settled for the referee with a reason, the next season's twin the control."""

        def referee_row(saison_id: str) -> dict[str, Any]:
            return {
                **a_declined_confirmation(CLUB_OID, saison_id),
                "party": {"kind": "schiedsrichter", "schiedsrichter_id": ObjectId()},
                "answer": {
                    "kind": "agreed",
                    "at": f"{saison_id}-04-03",
                    "by": {"kind": "admin"},
                    "vorschlag": None,
                    "reason": "Telefonisch",
                },
            }

        rows = {"this season": referee_row(SAISON_ID), "next season": referee_row(NEXT_SAISON_ID)}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            await confirmations.insert_many([dict(row) for row in rows.values()])
            await sweep(database, client)

            return {name: await confirmations.find_one({"_id": row["_id"]}) for name, row in rows.items()}

        stored = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert stored["this season"]["answer"] == {**rows["this season"]["answer"], "reason": None}
        assert stored["next season"]["answer"] == rows["next season"]["answer"]


def a_report(saison_id: str, *, remarks: str | None = "Starker Regen ab der Pause.") -> dict[str, Any]:
    """A report with a named scorer and a caution."""

    return documents.spielbericht_document({"_id": ObjectId(), "saison_id": saison_id}, bericht=documents.bericht_document(remarks=remarks))


class TestTheSeasonsEndStripsItsReports:
    def test_the_remarks_go_and_another_season_keeps_them(self, mongo_replica_set_url: str):
        """The scorers, the cards and the proposed result stay: the record of the match."""

        reports = {
            "this season": a_report(SAISON_ID),
            # What the strip writes nothing on, so its row counts the one report it changed.
            "this season, no remarks": a_report(SAISON_ID, remarks=None),
            "next season": a_report(NEXT_SAISON_ID),
        }

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            berichte = database[Collection.SPIELBERICHTE]
            await berichte.insert_many([dict(report) for report in reports.values()])
            response = await sweep(database, client)
            stored = {name: (await berichte.find_one({"_id": report["_id"]}) or {})["bericht"] for name, report in reports.items()}
            strip_rows = await database[Collection.ACTION_LOG].find({"action": "retention.spielberichte"}).to_list(length=None)

            return response, stored, strip_rows

        response, stored, strip_rows = on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert response.failed == 0
        # One row for the strip's page, counting this season's report holding remarks alone, the next season's left standing.
        assert [(row["label"], row["count"]) for row in strip_rows] == [(SAISON_ID, 1)]
        for name in ("this season", "this season, no remarks"):
            kept = reports[name]["bericht"]
            left = stored[name]
            assert left["remarks"] is None, name
            assert (left["scorers"], left["cards"], left["ergebnis_vorschlag"]) == (
                kept["scorers"],
                kept["cards"],
                kept["ergebnis_vorschlag"],
            ), name
        assert (stored["next season"]["remarks"], stored["next season"]["cards"]) == (
            reports["next season"]["bericht"]["remarks"],
            reports["next season"]["bericht"]["cards"],
        )
