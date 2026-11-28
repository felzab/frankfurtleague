import logging
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timedelta
from typing import Any, cast

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.admin_router import decline_bewerbung
from app.api.bewerbungen.schemas import FLDeclineBewerbungPayload
from app.api.bewerbungen.services import compose_confirmation_update, confirmation_deadline_from
from app.api.bewerbungen.system_router import sweep_saison
from app.api.outbox.schemas import FLOutboxEventPayload
from app.api.outbox.system_router import post_event
from app.api.saisons.system_router import get_sweep_saisons, sweep_saison_retention
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import patch_one_in_db
from app.core.exceptions import DocumentNotFoundError
from app.core.logging import FL_LOGGER_NAME
from app.shared.schemas.literals import KONTAKT_SEATS
from app.shared.tokens import hash_token
from tests import documents
from tests.acts import deletions_of
from tests.bewerbung_routes import answered, resent, viewed
from tests.database import a_clean_database
from tests.delivery import a_mail_that_bounced
from tests.documents import (
    SEAT_TEXT_VERSIONS,
    kontaktperson_document,
    rules_document,
    saison_document,
    saison_team_document,
    team_document,
)
from tests.isolation import InterleavedCollection, refused_code
from tests.outbox import MAIL_NOW, drained
from tests.passes import refuse_writes_breaking
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_bewerbung_sweep_test")

SAISON_ID = "2026"
NEXT_SAISON_ID = "2027"
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
TEAM_OID = ObjectId("6890a1b2c3d4e5f607960011")
JUNCTION_OID = ObjectId("6890a1b2c3d4e5f607960021")

TEAM_NAME = "Adler"
SCHOOL_NAME = "Zorbanax"


def first_hashes(prefix: str) -> dict[str, str]:
    return {seat: hash_token(f"{prefix}-{seat}") for seat in KONTAKT_SEATS}


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
            team_id=TEAM_OID,
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
    return saison_team_document(SAISON_ID, TEAM_OID, TEAM_NAME, "ADX", _id=JUNCTION_OID, gruppe="B", trikot_farbe="blau", kontakte=kontakte())


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]

# Why a case stores a row the read-back refuses: each the row a write of the pass is to fail on.
NO_SHORTHAND = "a season row without its shorthand, so the installed validator refuses the pass's write"
NO_TRIKOT = "an application without its trikot, so the installed validator refuses the pass's stamp"
UNREADABLE_DATES = "an application whose links hold a date no judge reads, so the pass passes the row over"
NO_SIDES = "a report without its sides, so the installed validator refuses the strip"
NO_DEADLINE = "a confirmation row without its deadline, so the installed validator refuses the strip"


async def on_a_league(
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

    async with a_clean_database(
        url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema, stores_a_refused_shape=stores_a_refused_shape
    ) as (client, database):
        seasons = [season(SAISON_ID, status), season(OTHER_SAISON_ID, "past")]
        if next_status is not None:
            seasons.append(season(NEXT_SAISON_ID, next_status))
        await database[Collection.SAISONS].insert_many(seasons)
        await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, TEAM_NAME, "ADX", website_url=None, schulform="gymnasium_g9"))
        await database[Collection.SAISON_TEAMS].insert_one(junction_row())
        await database[Collection.BEWERBUNGEN].insert_many(the_corpus())

        return await body(database, client)


async def sweep(
    database: AsyncDatabase, client: AsyncMongoClient, saison_id: str = SAISON_ID, today: str = TODAY, now: datetime = MAIL_NOW
) -> Any:
    """One season's two passes in the scheduler's order, the applications' and then its season rows', answering the rows both passed over.

    Its mails are owed on `MAIL_NOW`, the one thing its clocks date.
    """

    applications = await sweep_saison(
        saison_id=saison_id,
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
        saisons_collection=database[Collection.SAISONS],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        today=today,
        germany_now=now,
    )
    season_rows = await sweep_saison_retention(
        saison_id=saison_id,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        db=client,
        today=today,
    )

    return applications.failed + season_rows.failed


async def view(database: AsyncDatabase, token: str) -> Any:
    return await viewed(database, token, today=TODAY)


async def stored(database: AsyncDatabase, bewerbung_id: ObjectId) -> Mapping[str, Any] | None:
    return await database[Collection.BEWERBUNGEN].find_one({"_id": bewerbung_id})


async def taken_with_the_season(database: AsyncDatabase) -> tuple[bool, bool]:
    """Whether the accepted application is gone, and whether its season row's contact block is emptied, as stored."""

    row = await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})
    assert row is not None

    return await stored(database, ACCEPTED_OID) is None, row["kontakte"] is None


async def retention_rows(database: AsyncDatabase) -> list[Mapping[str, Any]]:
    """What the log holds of the application clocks' erasures, as a deletion's row reads."""

    rows = await database[Collection.ACTION_LOG].find({"action": "retention.bewerbungen"}, sort=[("_id", 1)]).to_list(length=None)

    return [{key: row[key] for key in ("by", "team", "record_id", "saison_id", "count")} for row in rows]


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
            seats=KONTAKT_SEATS,
            birth_date=CONFIRMED_BIRTH_DATE,
            today=MAILED_ON_THE_MARK,
            text_versions=SEAT_TEXT_VERSIONS,
            whatsapp=False,
            media=False,
            at=f"{MAILED_ON_THE_MARK}T08:00:00+00:00",
            takes_the_notice_back=False,
        ),
        expected_version=None,
        session=None,
        return_document=ReturnDocument.BEFORE,
    )


async def resend(database: AsyncDatabase, seat: str) -> Any:
    return await resent(database, REMIND_OID, seat, today=TODAY, germany_now=MAIL_NOW)


async def decline(database: AsyncDatabase, client: AsyncMongoClient, token: str, *, now: datetime) -> Any:
    return await answered(database, client, {"token": token, "answer": "declined"}, today=TODAY, germany_now=now)


def reminder_mail(to: str, seats: list[str]) -> dict[str, Any]:
    """The reminder the corpus's application owes one person, as the Postausgang holds it."""

    return {
        "key": f"{Collection.BEWERBUNGEN}/{REMIND_OID}/reminder/{seats[0]}/{TODAY}",
        "to": to,
        "data": {"kind": "bewerbung_reminder", "saison_id": SAISON_ID, "seats": seats, "deadline": "2026-04-12"},
    }


class TestTheReminderClock:
    async def test_it_stamps_every_due_seat_and_owes_one_mail_a_person(self, mongo_replica_set_url: str):
        """One mail for the double-seated person naming both seats; the deadline and the first links stand."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, now=MAIL_NOW)

            return await reminded(database), await owed(database, "bewerbung_reminder"), await stored(database, REMIND_OID)

        chased, mails, document = await on_a_league(mongo_replica_set_url, body)

        assert chased == {REMIND_OID}
        assert mails == [
            reminder_mail("wraxlington@example.com", ["ansprechperson", "trainer"]),
            reminder_mail("bramblewick@example.com", ["stellvertretung"]),
        ]
        assert document is not None
        first = first_hashes(str(REMIND_OID))
        for seat in KONTAKT_SEATS:
            bookkeeping = document["confirmations"][seat]
            # No link before the hand-out: the first one alone stands until the drain mints the reminder's beside it.
            assert bookkeeping["token_hashes"] == [first[seat]]
            assert (bookkeeping["reminded_at"], bookkeeping["sent_at"]) == (TODAY, MAILED_ON_THE_MARK)
        assert document["confirmations"]["trainer"]["deadline"] == "2026-04-12"

    async def test_the_reminders_link_joins_the_first_and_both_open_the_seat(self, mongo_replica_set_url: str):
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

        old_view, new_view, token, document = await on_a_league(mongo_replica_set_url, body)

        assert (old_view.state, old_view.seat) == ("valid", "trainer")
        assert new_view.state == "valid"
        first = first_hashes(str(REMIND_OID))
        for seat in ("trainer", "ansprechperson"):
            assert document["confirmations"][seat]["token_hashes"] == [first[seat], hash_token(token)]

    async def test_a_resend_after_a_reminder_voids_every_link_on_both_seats_the_person_holds(self, mongo_replica_set_url: str):
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
                dead.append(await refused_code(view(database, gone)))

            return (
                dead,
                (await view(database, fresh.token)).state,
                # The Stellvertretung is nobody's pair, so its own reminder link is untouched.
                (await view(database, reminders["bramblewick@example.com"] or "")).state,
                fresh.token,
                await stored(database, REMIND_OID),
            )

        dead, state, foreign_state, fresh_token, document = await on_a_league(mongo_replica_set_url, body)

        assert dead == [Code.LINK_INVALID] * 3
        assert (state, foreign_state) == ("valid", "valid")
        assert document is not None
        # One link answering both, each entry written back as the create writes it, and the reminder owed again.
        for seat in ("trainer", "ansprechperson"):
            assert document["confirmations"][seat] == {
                "token_hashes": [hash_token(fresh_token)],
                "sent_at": TODAY,
                "deadline": confirmation_deadline_from(today=TODAY),
                "reminded_at": None,
                "confirmed_on": None,
                "declined_at": None,
            }


class TestTheFourteenDayClock:
    async def test_the_pass_erases_the_candidate_and_owes_the_seat_that_confirmed_the_notice(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_the_seats(database, DELETE_OID, "stellvertretung")
            await sweep(database, client, now=MAIL_NOW)

            return await stored(database, DELETE_OID), await owed(database, "deletion_notice")

        document, notices = await on_a_league(mongo_replica_set_url, body)

        assert document is None
        assert notices == [
            {
                "key": f"{Collection.BEWERBUNGEN}/{DELETE_OID}/deletion/stellvertretung",
                "to": "bramblewick@example.com",
                "data": {"kind": "deletion_notice", "saison_id": SAISON_ID},
            }
        ]
        # Nothing of the people outlives the application in the notice.
        assert LAST_NAME not in str(notices)

    async def test_the_erasure_takes_exactly_the_due_application_and_writes_its_one_row(self, mongo_replica_set_url: str):
        """An application still inside its deadline, or another season's, stands."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return (
                await stored(database, DELETE_OID),
                await stored(database, REMIND_OID),
                await stored(database, OTHER_SEASON_OID),
                await retention_rows(database),
            )

        due, kept, other, rows = await on_a_league(mongo_replica_set_url, body)

        assert due is None
        assert kept is not None and other is not None
        # The decline clock's one write and this application's, each in its own transaction, naming nobody.
        assert rows == [{"by": "system", "team": None, "record_id": None, "saison_id": SAISON_ID, "count": 1}] * 2

    async def test_an_objections_notice_stands_as_the_deletion_notice(self, mongo_replica_set_url: str):
        """It named the deletion day to the Ansprechperson, who confirmed and is owed no second notice."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_the_seats(database, DELETE_OID, "trainer", "ansprechperson")
            await database[Collection.BEWERBUNGEN].update_one({"_id": DELETE_OID}, {"$set": {"erasure_announced_at": "2026-03-30"}})
            await sweep(database, client, now=MAIL_NOW)

            return await stored(database, DELETE_OID), await owed(database, "deletion_notice")

        assert await on_a_league(mongo_replica_set_url, body) == (None, [])

    async def test_an_emptied_ansprechperson_seat_is_erased_with_nobody_told(self, mongo_replica_set_url: str):
        """No mailbox is left to tell, which is not a refused address: the application cannot complete and goes."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": DELETE_OID}, {"$set": {"kontakte.ansprechperson": None, "kontakte.trainer_is_also": None}}
            )
            await sweep(database, client, now=MAIL_NOW)

            return await stored(database, DELETE_OID), await owed(database, "deletion_notice")

        assert await on_a_league(mongo_replica_set_url, body) == (None, [])

    async def test_an_application_confirmed_after_the_pass_read_it_stays(self, mongo_replica_set_url: str):
        """The pass reads its applications before any application's own transaction, so it judges each again there.

        Read as lapsed and erased all the same, an application whose every seat confirmed in the last moment is gone.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def confirm_in_between() -> None:
                await confirm_every_seat(database, DELETE_OID)

            # On a running season the clock's own transaction is the first to read one application: the confirmation
            # commits after the clock's read of its applications and before that transaction's snapshot.
            applications = InterleavedCollection(database[Collection.BEWERBUNGEN], confirm_in_between, before="find_one")
            await sweep_saison(
                saison_id=SAISON_ID,
                bewerbungen_collection=cast(Any, applications),
                saisons_collection=database[Collection.SAISONS],
                outbox_collection=database[Collection.OUTBOX],
                db=client,
                today=TODAY,
                germany_now=MAIL_NOW,
            )

            return await stored(database, DELETE_OID), await owed(database, "deletion_notice")

        document, notices = await on_a_league(mongo_replica_set_url, body)

        assert document is not None
        assert notices == []


class TestAnApplicationWhoseNoticeCannotArrive:
    """The stated day holds: the people named were promised it, and a mail to the Ansprechperson that bounced changes nothing of it."""

    async def test_the_pass_takes_it_and_owes_the_notice_as_for_any_address(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_the_seats(database, DELETE_OID, "trainer", "ansprechperson")
            await refuse_the_ansprechpersons_address(database, client, DELETE_OID)
            await sweep(database, client, now=MAIL_NOW)

            return await stored(database, DELETE_OID), await owed(database, "deletion_notice")

        document, notices = await on_a_league(mongo_replica_set_url, body)

        assert document is None
        assert [notice["to"] for notice in notices] == ["wraxlington@example.com"]

    async def test_a_seat_never_mailed_is_owed_neither_a_reminder_nor_the_notice(self, mongo_replica_set_url: str):
        """The two later mails past the bound: that mailbox has heard of nothing, and the day stands for the people who have."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            unmailed = {f"confirmations.{seat}.sent_at": None for seat in KONTAKT_SEATS}
            await database[Collection.BEWERBUNGEN].update_many({"_id": {"$in": [REMIND_OID, DELETE_OID]}}, {"$set": unmailed})
            await sweep(database, client, now=MAIL_NOW)

            return (
                await stored(database, DELETE_OID),
                await owed(database, "bewerbung_reminder"),
                await owed(database, "deletion_notice"),
            )

        document, reminders, notices = await on_a_league(mongo_replica_set_url, body)

        assert (document, reminders, notices) == (None, [], [])


class TestASeatNoMailReaches:
    """A seat whose last mail did not arrive is passed over on every pass, judged anew from its last mail each time."""

    async def test_only_the_seat_no_mail_reaches_is_passed_over(self, mongo_replica_set_url: str):
        """A row's other seat, reachable and re-sent, keeps its own reminder; the refused one, with no later mail, owes nothing on any pass."""

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

        closed, mails = await on_a_league(mongo_replica_set_url, body)

        assert closed is not None
        assert closed["confirmations"]["ansprechperson"]["reminded_at"] is None
        assert [mail["to"] for mail in mails] == ["bramblewick@example.com"]

    async def test_a_mail_delivered_to_the_address_makes_the_next_pass_owe_the_reminder(self, mongo_replica_set_url: str):
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
            )
            await sweep(database, client, today="2026-04-02", now=MAIL_NOW + timedelta(days=1))

            return closed, await owed(database, "bewerbung_reminder")

        closed, mails = await on_a_league(mongo_replica_set_url, body)

        assert closed is not None
        assert closed["confirmations"]["ansprechperson"]["reminded_at"] is None
        assert [(mail["to"], mail["data"]["seats"]) for mail in mails] == [("wraxlington@example.com", ["ansprechperson", "trainer"])]

    async def test_a_re_send_makes_it_due_on_its_own_day(self, mongo_replica_set_url: str):
        """The re-send replaces the entry and its last mail, and the seats it left reach their mark on their own day."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await refuse_the_ansprechpersons_address(database, client, REMIND_OID)
            await sweep(database, client, now=MAIL_NOW)
            closed = await stored(database, REMIND_OID)
            await resend(database, "trainer")
            await drained(database, client)
            await sweep(database, client, today="2026-04-04", now=MAIL_NOW + timedelta(days=3))

            return closed, await owed(database, "bewerbung_reminder")

        closed, mails = await on_a_league(mongo_replica_set_url, body)

        assert closed is not None
        assert closed["confirmations"]["ansprechperson"]["reminded_at"] is None
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
    """A job's reminder stamp is no field a form saves, so it leaves the count: a decision read before it lands, the stamp standing."""

    async def test_the_reminders_stamp(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Mapping[str, Any]:
            served = await served_version(database)
            await sweep(database, client, now=MAIL_NOW)
            assert REMIND_OID in await reminded(database)

            return await declined_on(database, served)

        document = await on_a_league(mongo_replica_set_url, body)

        assert document["status"] == "declined"
        assert document["confirmations"]["stellvertretung"]["reminded_at"] == TODAY


# An address today's rule refuses, its local part being no ASCII: a stored row may hold one, and no
# ban can be keyed on it.
REFUSED_ADDRESS = "müller@example.com"


class TestABarredMailbox:
    """A reminder to an address the ban list holds is owed like any other, and the drain holds it: no link reaches it."""

    async def test_an_address_the_rule_refuses_is_barred_by_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": REMIND_OID}, {"$set": {"kontakte.stellvertretung.email": REFUSED_ADDRESS}}
            )
            await sweep(database, client, now=MAIL_NOW)

            return [mail.to for mail in await drained(database, client)]

        assert REFUSED_ADDRESS in await on_a_league(mongo_replica_set_url, body)


# The Stellvertretung's stamp, the one seat nobody mirrors, each state the clocks' queries must read
# as `app/shared/einwilligung.py :: is_confirmed` reads it.
STELLVERTRETUNG_STAMP = "kontakte.stellvertretung.einwilligung.confirmed_at"
STAMP_STATES = [
    pytest.param({"$set": {STELLVERTRETUNG_STAMP: MAILED_ON_THE_MARK}}, False, id="confirmed, the control"),
    # No stamp at all, the field missing, which the query's null term has to reach as well.
    pytest.param({"$set": {"kontakte.stellvertretung": None}}, True, id="the seat erased"),
]


class TestTheFourteenDayClocksTerms:
    """Its rule is its query alone (`build_deletion_filter`), so each of its terms is pinned here."""

    @pytest.mark.parametrize(("update", "outstanding"), STAMP_STATES)
    async def test_the_fourteen_day_clock_takes_an_application_whose_seat_is_unconfirmed(
        self, mongo_replica_set_url: str, update: Mapping[str, Any], outstanding: bool
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, DELETE_OID)
            await database[Collection.BEWERBUNGEN].update_one({"_id": DELETE_OID}, update)
            await sweep(database, client)

            return await stored(database, DELETE_OID) is None

        assert await on_a_league(mongo_replica_set_url, body) is outstanding

    async def test_an_application_on_its_deadlines_own_day_stands(self, mongo_replica_set_url: str):
        """Strictly past: the link still answers on its deadline's own day."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            on_the_day = {f"confirmations.{seat}.deadline": TODAY for seat in KONTAKT_SEATS}
            await database[Collection.BEWERBUNGEN].update_one({"_id": DELETE_OID}, {"$set": on_the_day})
            await sweep(database, client)

            return await stored(database, DELETE_OID) is None

        assert await on_a_league(mongo_replica_set_url, body) is False

    async def test_an_accepted_application_whose_links_have_lapsed_stands(self, mongo_replica_set_url: str):
        """The acceptance empties the seats and its links pass their day, so the status alone keeps it off this clock."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            lapsed = {
                **{f"kontakte.{seat}": None for seat in KONTAKT_SEATS},
                **{f"confirmations.{seat}.deadline": YESTERDAY for seat in KONTAKT_SEATS},
            }
            await database[Collection.BEWERBUNGEN].update_one({"_id": ACCEPTED_OID}, {"$set": lapsed})
            await sweep(database, client)

            return await stored(database, ACCEPTED_OID) is None

        assert await on_a_league(mongo_replica_set_url, body) is False

    async def test_one_seats_lapsed_deadline_reaches_the_query_beside_another_seats_fresh_link(self, mongo_replica_set_url: str):
        """The filter's first arm, each seat its own: a read judging the latest deadline would wait on the fresh link."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_one(
                {"_id": DELETE_OID}, {"$set": {"confirmations.stellvertretung.deadline": "2026-04-12"}}
            )
            await sweep(database, client)

            return await stored(database, DELETE_OID) is None

        assert await on_a_league(mongo_replica_set_url, body) is True

    @pytest.mark.parametrize(
        ("other_deadline", "taken"),
        [pytest.param(TODAY, False, id="another seat's link runs its last day"), pytest.param(YESTERDAY, True, id="no link runs")],
    )
    async def test_a_seat_an_erasure_emptied_reaches_the_query_once_no_link_runs(
        self, mongo_replica_set_url: str, other_deadline: str, taken: bool
    ):
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

        assert await on_a_league(mongo_replica_set_url, body) is taken


class TestTheDeclineClock:
    """Its rule is its query alone, so its boundary is pinned here."""

    @pytest.mark.parametrize(
        ("made_at", "erased"),
        [pytest.param("2026-03-19", False, id="decided thirteen days ago"), pytest.param("2026-03-18", True, id="decided fourteen days ago")],
    )
    async def test_a_declined_application_goes_on_the_fourteenth_day_after_its_decision(
        self, mongo_replica_set_url: str, made_at: str, erased: bool
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_one({"_id": DECLINED_OID}, {"$set": {"decision.made_at": made_at}})
            await sweep(database, client)

            return await stored(database, DECLINED_OID) is None

        assert await on_a_league(mongo_replica_set_url, body) is erased


class TestTheSeasonsOwnEndClock:
    """The bound on an application nobody decided, which the fourteen-day clock drops as soon as every seat confirms."""

    async def test_an_application_every_seat_confirmed_and_nobody_decided_is_erased_and_its_people_told(self, mongo_replica_set_url: str):
        """Both submitted rows go, the confirmed one and the one past its deadline; a decided one is this clock's business at all."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, REMIND_OID)
            await sweep(database, client, now=MAIL_NOW)

            return (
                await stored(database, REMIND_OID),
                await stored(database, DELETE_OID),
                await stored(database, ACCEPTED_OID),
                await owed(database, "deletion_notice"),
            )

        confirmed, past_its_deadline, accepted, notices = await on_a_league(mongo_replica_set_url, body, status="past", next_status="active")

        assert (confirmed, past_its_deadline) == (None, None)
        # The accepted one is the successor season's business, and that season still runs.
        assert accepted is not None
        # An application undecided at its season's end has not served: only the one confirmed row owes anybody the notice.
        assert [notice["to"] for notice in notices] == ["wraxlington@example.com", "bramblewick@example.com"]

    async def test_nothing_goes_while_the_season_still_runs(self, mongo_replica_set_url: str):
        """The row every other clock leaves standing: confirmed by all three and decided by nobody."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_every_seat(database, REMIND_OID)
            await sweep(database, client)

            return await stored(database, REMIND_OID)

        assert await on_a_league(mongo_replica_set_url, body) is not None

    async def test_the_pass_offers_neither_a_reminder_nor_a_notice_for_a_row_this_clock_takes(self, mongo_replica_set_url: str):
        """The order is the whole of it: run after either, and the caller mails about an application this pass has erased."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client, now=MAIL_NOW)

            return (
                await reminded(database),
                await stored(database, REMIND_OID),
                await stored(database, DELETE_OID),
                await database[Collection.OUTBOX].count_documents({}),
            )

        # Both undecided rows go by this clock, the one the reminder would chase and the one the fourteen days would take.
        assert await on_a_league(mongo_replica_set_url, body, status="past", next_status="active") == (set(), None, None, 0)


class TestTheSeasonAndOneClock:
    async def test_nothing_goes_while_the_next_season_runs(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await taken_with_the_season(database)

        assert await on_a_league(mongo_replica_set_url, body, status="past", next_status="active") == (False, False)

    async def test_the_application_goes_and_the_contact_block_empties_once_the_next_season_is_past(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return (
                await stored(database, ACCEPTED_OID),
                await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}),
            )

        document, row = await on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert document is None
        assert row is not None and row["kontakte"] is None
        # The block's own keys survive around the clearing: the row is still a junction row.
        assert (row["gruppe"], row["trikot_farbe"]) == ("B", "blau")

    async def test_a_pass_finding_no_block_left_writes_no_row(self, mongo_replica_set_url: str):
        """Every hourly pass reads every old season, so a row for a pass that took nothing would fill the Protokoll."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await sweep(database, client)
            await sweep(database, client)

            return await database[Collection.ACTION_LOG].count_documents({"action": "retention.kontakte"})

        assert await on_a_league(mongo_replica_set_url, body, status="past", next_status="past") == 1

    @pytest.mark.parametrize("people", [pytest.param(kontakte(), id="beside their people"), pytest.param(None, id="left by an older image")])
    async def test_the_rows_confirmation_links_go_too(self, mongo_replica_set_url: str, people: Any):
        """A link's entry carries a token hash, which has no clock of its own."""

        link = {"token_hashes": ["a" * 64], "sent_at": "2026-03-02", "deadline": "2026-03-16", "declined_at": None}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one(
                {"_id": JUNCTION_OID},
                {"$set": {"kontakte": people, "confirmations": {"trainer": link, "ansprechperson": None, "stellvertretung": None}}},
            )
            await sweep(database, client)

            return await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID})

        row = await on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert row is not None and (row["kontakte"], row["confirmations"]) == (None, None)

    async def test_a_season_with_no_successor_yet_keeps_everything(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await taken_with_the_season(database)

        assert await on_a_league(mongo_replica_set_url, body, status="past", next_status=None) == (False, False)


SECOND_OID = ObjectId("6890a1b2c3d4e5f607960007")
SECOND_TEAM_OID = ObjectId("6890a1b2c3d4e5f607960012")
SECOND_JUNCTION_OID = ObjectId("6890a1b2c3d4e5f607960022")


# What a write the validator refuses reads as on a passed-over line: the driver's type and the server's code. Each write
# it refuses is an update rather than a find-and-modify, which the driver raises as its `WriteError`.
REFUSED_WRITE = "WriteError, code 121"

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

    async def test_a_refused_contact_block(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """The blocks clear in one write, so the refused one keeps the season's other block too, and no later clock."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].insert_one({**junction_row(), "_id": SECOND_JUNCTION_OID, "team_id": SECOND_TEAM_OID})
            await database[Collection.SAISON_TEAMS].update_one({"_id": JUNCTION_OID}, {"$unset": {"shorthand": ""}})
            await refuse_writes_breaking(database, Collection.SAISON_TEAMS, {"required": ["shorthand"]})
            answer = await sweep(database, client, now=MAIL_NOW)
            blocks = await database[Collection.SAISON_TEAMS].find({}, {"kontakte": 1}).sort("_id", 1).to_list(None)

            return answer, [(block["_id"], block["kontakte"] is not None) for block in blocks], await reminded(database)

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answer, blocks, chased = await on_a_league(
                mongo_replica_set_url, body, status="future", next_status="past", mutates_schema=True, stores_a_refused_shape=NO_SHORTHAND
            )

        assert (answer, chased) == (1, {REMIND_OID})
        assert blocks == [(JUNCTION_OID, True), (SECOND_JUNCTION_OID, True)]
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Season", SAISON_ID, "contact block", REFUSED_WRITE)]

    async def test_a_reminder_the_mail_cannot_carry(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A deadline the mail's facts refuse before any stamp is written, so the row is passed over and nothing taken apart."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            seeded = application(SECOND_OID)
            # Written past the builder, which refuses a deadline its record model does not read.
            unreadable = {seat: {**entry, "deadline": "2026-04-1"} for seat, entry in seeded["confirmations"].items()}
            await database[Collection.BEWERBUNGEN].insert_one({**seeded, "confirmations": unreadable})
            answer = await sweep(database, client, now=MAIL_NOW)
            refused = await stored(database, SECOND_OID)
            assert refused is not None

            return await reminded(database), answer, [seat["reminded_at"] for seat in refused["confirmations"].values()]

        with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
            answered, count, stamps = await on_a_league(mongo_replica_set_url, body, stores_a_refused_shape=UNREADABLE_DATES)

        assert (answered, count, stamps) == ({REMIND_OID}, 1, [None, None, None])
        assert passed_over(caplog) == [("ERROR", Code.STORED_DATA_INVALID, "Application", str(SECOND_OID), "reminder", f"{REFUSED_DEADLINE}")]

    async def test_a_refused_reminder_stamp(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
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

            return await reminded(database), answer, [seat["reminded_at"] for seat in refused["confirmations"].values()]

        answered, count, stamps = await on_a_league(mongo_replica_set_url, body, mutates_schema=True, stores_a_refused_shape=NO_TRIKOT)

        # The refused row's mails went with its stamp: nobody is chased whose seat says they were not.
        assert (answered, count, stamps) == ({REMIND_OID}, 1, [None, None, None])
        assert passed_over(caplog) == [("ERROR", Code.DATABASE_FAILED, "Application", str(SECOND_OID), "reminder", REFUSED_WRITE)]

    async def test_a_pass_whose_every_reminder_fails_counts_them(self, mongo_replica_set_url: str):
        """Every stamp refused: the count is all that tells this pass from a clean one."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.BEWERBUNGEN].update_many({}, {"$unset": {"trikot": ""}})
            await refuse_writes_breaking(database, Collection.BEWERBUNGEN, {"required": ["trikot"]})
            answer = await sweep(database, client, now=MAIL_NOW)

            return answer, await reminded(database)

        assert await on_a_league(mongo_replica_set_url, body, mutates_schema=True, stores_a_refused_shape=NO_TRIKOT) == (1, set())

    async def test_a_refused_retention_row_leaves_its_rows_owes_no_notice_and_stops_no_later_clock(self, mongo_replica_set_url: str):
        """No deletion stands without its row, and nobody is told of an erasure that did not happen."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await confirm_the_seats(database, DELETE_OID, "stellvertretung")
            await refuse_writes_breaking(
                database, Collection.ACTION_LOG, {"properties": {"action": {"not": {"enum": ["retention.bewerbungen"]}}}}
            )
            answer = await sweep(database, client, now=MAIL_NOW)
            left = [await stored(database, row) is not None for row in (DECLINED_OID, DELETE_OID)]

            return answer, left, await owed(database, "deletion_notice"), await reminded(database)

        answer, left, notices, chased = await on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert answer == 2
        assert left == [True, True]
        assert notices == []
        assert chased == {REMIND_OID}


class TestTheSeasonList:
    async def test_every_season_is_listed_oldest_first_whatever_its_status(self, mongo_replica_set_url: str):
        """The rule keeps a `future` season off the base tier, and that is the season the clocks run over."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            return await get_sweep_saisons(saisons_collection=database[Collection.SAISONS], status=None)

        response = await on_a_league(mongo_replica_set_url, body, next_status="future")

        assert response.saison_ids == [OTHER_SAISON_ID, SAISON_ID, NEXT_SAISON_ID]


def numbered(position: int) -> ObjectId:
    """One id per seeded row, clear of the fixed ids above."""

    return ObjectId(f"6890a1b2c3d4e5f6078{position:05d}")


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
        team2={"team_id": TEAM_OID, "tore": None},
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
            **open_confirmation(TEAM_OID),
            "answer": documents.kontakt_answer_document("stellvertretung", reason="Wir sind auf Klassenfahrt"),
        }
        await database[Collection.SPIELBESTAETIGUNGEN].insert_one(confirmation)

    async def test_the_first_pass_past_its_day_empties_it_and_leaves_the_confirmed_seat(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await self.two_lapsed_seats(database)
            await sweep(database, client)
            code = await refused_code(view(database, "row-stellvertretung"))
            confirmation = await database[Collection.SPIELBESTAETIGUNGEN].find_one({})
            assert confirmation is not None

            return (
                await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}),
                confirmation,
                code,
                await deletions_of(database, "retention.kontakte"),
            )

        row, confirmation, refusal, deletions = await on_a_league(mongo_replica_set_url, body)

        assert (row["kontakte"]["ansprechperson"], row["kontakte"]["stellvertretung"]) == (None, None)
        assert (row["confirmations"]["ansprechperson"], row["confirmations"]["stellvertretung"]) == (None, None)
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] == MAILED_ON_THE_MARK
        assert row["confirmations"]["trainer"] is not None
        # The two seats emptied, in one row naming nobody.
        assert deletions == [("system", SAISON_ID, 2, None)]
        assert refusal == Code.LINK_INVALID

        assert confirmation["answer"]["reason"] is None

    async def test_a_past_seasons_seat_goes_on_its_day_and_a_confirmed_one_stays(self, mongo_replica_set_url: str):
        """The mail's promise holds for a link minted shortly before a rollover: only a confirmed seat is the season's record."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await self.two_lapsed_seats(database)
            await sweep(database, client)

            return await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}), await deletions_of(database, "retention.kontakte")

        row, deletions = await on_a_league(mongo_replica_set_url, body, status="past", next_status="active")

        assert deletions == [("system", SAISON_ID, 2, None)]
        assert (row["kontakte"]["ansprechperson"], row["kontakte"]["stellvertretung"]) == (None, None)
        assert row["kontakte"]["trainer"]["einwilligung"]["confirmed_at"] == MAILED_ON_THE_MARK


class TestASeasonNobodyHas:
    async def test_the_pass_is_a_404_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundError):
                await sweep(database, client, saison_id="1999")

            return await database[Collection.BEWERBUNGEN].count_documents({}), await retention_rows(database)

        assert await on_a_league(mongo_replica_set_url, body) == (5, [])


# A club the season replaced: its season row went to the incoming club, so no block clearing names its rows.
REPLACED_TEAM_OID = ObjectId("6890a1b2c3d4e5f6079600f1")


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
        team2={"team_id": TEAM_OID, "tore": None},
    )
    return documents.spielbestaetigung_document(
        spiel,
        party={"kind": "team", "team_id": team_id},
        asked_at=f"{saison_id}-04-01",
        answer=documents.kontakt_answer_document("trainer", reason="Wir sind auf Klassenfahrt"),
        closed={"reason": "spiel_past"},
    )


class TestTheReportStripStandsApart:
    async def test_a_strip_failing_holds_back_neither_the_confirmations_nor_a_block_and_is_passed_over_under_the_season(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """A report the installed validator refuses once stripped: the report strip alone meets it, in its own transaction."""

        refused = a_report(SAISON_ID)
        del refused["bericht"]["sides"]
        declined = a_declined_confirmation(TEAM_OID, SAISON_ID)

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

        response, junction, confirmation, report = await on_a_league(
            mongo_replica_set_url, body, status="past", next_status="past", mutates_schema=True, stores_a_refused_shape=NO_SIDES
        )

        assert (response, junction["kontakte"]) == (1, None)
        assert confirmation["answer"]["reason"] is None, "the confirmations' strip fell with the reports'"
        assert report["bericht"]["remarks"] == refused["bericht"]["remarks"], "the failed strip left a write behind"
        assert [(level, what, row_id, clock) for level, _, what, row_id, clock, _ in passed_over(caplog)] == [
            ("ERROR", "Season", SAISON_ID, "report strip")
        ]


class TestTheSeasonsEndStripsItsConfirmations:
    async def test_its_team_rows_keep_the_answer_alone_and_another_season_keeps_everything(self, mongo_replica_set_url: str):
        """The club's own row, a replaced club's no clearing names, and the next season's row as the control."""

        rows = {
            "own": a_declined_confirmation(TEAM_OID, SAISON_ID),
            "replaced": a_declined_confirmation(REPLACED_TEAM_OID, SAISON_ID),
            "next season": a_declined_confirmation(TEAM_OID, NEXT_SAISON_ID),
        }

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            await confirmations.insert_many([dict(row) for row in rows.values()])
            await sweep(database, client)
            stored = {name: await confirmations.find_one({"_id": row["_id"]}) for name, row in rows.items()}

            return await deletions_of(database, "retention.kontakte"), stored, await deletions_of(database, "retention.spielbestaetigungen")

        blocks, stored, deletions = await on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        # The premise: the pass cleared the season's one block, which is what owes the strip.
        assert blocks == [("system", SAISON_ID, 1, None)]
        # Both rows' reasons, the replaced club's among them.
        assert deletions == [("system", SAISON_ID, 2, None)]
        kept = rows["own"]["answer"]
        stripped = {**kept, "reason": None}
        for name in ("own", "replaced"):
            assert stored[name]["answer"] == stripped, name
        assert stored["next season"]["answer"] == rows["next season"]["answer"]

    async def test_a_season_with_no_block_left_to_clear_is_stripped_all_the_same(self, mongo_replica_set_url: str):
        """The club entered no contacts, as a replacement's incoming side holds none: no pass clears a block of the season."""

        row = a_declined_confirmation(TEAM_OID, SAISON_ID)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"_id": JUNCTION_OID}, {"$set": {"kontakte": None, "confirmations": None}})
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(row)
            response = await sweep(database, client)
            return (
                response,
                await deletions_of(database, "retention.kontakte"),
                await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": row["_id"]}),
            )

        response, blocks, stripped = await on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert (blocks, response) == ([], 0)
        assert stripped["answer"]["reason"] is None

    async def test_a_strip_failing_holds_back_no_block_and_is_passed_over_under_the_season(
        self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture
    ):
        """A replaced club's row the installed validator refuses, which no block clearing writes: the strip alone meets it."""

        refused = {key: value for key, value in a_declined_confirmation(REPLACED_TEAM_OID, SAISON_ID).items() if key != "deadline"}

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(refused)
            await refuse_writes_breaking(database, Collection.SPIELBESTAETIGUNGEN, {"required": ["deadline"]})
            with caplog.at_level(logging.ERROR, logger=FL_LOGGER_NAME):
                response = await sweep(database, client)
            return (
                response,
                await database[Collection.SAISON_TEAMS].find_one({"_id": JUNCTION_OID}),
            )

        response, junction = await on_a_league(
            mongo_replica_set_url, body, status="past", next_status="past", mutates_schema=True, stores_a_refused_shape=NO_DEADLINE
        )

        assert (response, junction["kontakte"]) == (1, None)
        assert [(level, what, row_id, clock) for level, _, what, row_id, clock, _ in passed_over(caplog)] == [
            ("ERROR", "Season", SAISON_ID, "confirmation strip")
        ]

    async def test_an_administrators_settle_reason_goes_and_their_answer_gains_no_holder(self, mongo_replica_set_url: str):
        settled = {
            **a_declined_confirmation(TEAM_OID, SAISON_ID),
            "answer": {"kind": "declined", "at": "2026-04-03", "by": {"kind": "admin"}, "vorschlag": None, "reason": "Platz gesperrt"},
        }

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBESTAETIGUNGEN].insert_one(settled)
            await sweep(database, client)
            return await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": settled["_id"]})

        stripped = await on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert stripped["answer"] == {**settled["answer"], "reason": None}

    async def test_a_referee_rows_reason_goes_and_its_answer_stays(self, mongo_replica_set_url: str):
        """Settled for the referee with a reason, the next season's twin the control."""

        def referee_row(saison_id: str) -> dict[str, Any]:
            return {
                **a_declined_confirmation(TEAM_OID, saison_id),
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

        stored = await on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert stored["this season"]["answer"] == {**rows["this season"]["answer"], "reason": None}
        assert stored["next season"]["answer"] == rows["next season"]["answer"]


def a_report(saison_id: str, *, remarks: str | None = "Starker Regen ab der Pause.") -> dict[str, Any]:
    """A report with a named scorer and a caution."""

    return documents.spielbericht_document({"_id": ObjectId(), "saison_id": saison_id}, bericht=documents.bericht_document(remarks=remarks))


class TestTheSeasonsEndStripsItsReports:
    async def test_the_remarks_go_and_another_season_keeps_them(self, mongo_replica_set_url: str):
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

        response, stored, strip_rows = await on_a_league(mongo_replica_set_url, body, status="past", next_status="past")

        assert response == 0
        # One row for the strip, counting this season's report holding remarks alone, the next season's left standing.
        assert [(row["saison_id"], row["count"]) for row in strip_rows] == [(SAISON_ID, 1)]
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
