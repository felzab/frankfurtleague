import asyncio
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient, MongoClient, ReturnDocument, monitoring
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.bewerbungen.sweep_router import get_sweep_saisons
from app.api.registrierungen import sweep_router as sweep_router_module
from app.api.registrierungen.services import SWEEP_PAGE, build_erinnerung_filter, build_unconfirmed_filter, build_wiederholung_filter
from app.api.registrierungen.sweep_router import REMINDERS_PER_PASS, sweep_registrierungen
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db
from app.core.recording import SYSTEM_ACTOR_EMAIL
from tests.app_client import app_client
from tests.config import ADMIN_AUTH, BASE_AUTH, SYSTEM_AUTH, build_test_config
from tests.database import a_clean_database, a_clean_database_sync, on_the_seed_loop
from tests.documents import rules_document, saison_document, team_document
from tests.worker import worker_database

# Module level, as the other execution suites mark theirs: every test below reaches a real mongod.
pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_registrierung_sweep_test")

SAISON_ID = "2026"
OTHER_SAISON_ID = "2025"
TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
MAILED_ON_THE_MARK = "2026-03-29"
NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))

# Fixed rather than generated, so a failure names the same row every run.
REMIND_OID = ObjectId("6890a1b2c3d4e5f607970001")
EXPIRED_OID = ObjectId("6890a1b2c3d4e5f607970002")
INSIDE_OID = ObjectId("6890a1b2c3d4e5f607970003")
CONFIRMED_OID = ObjectId("6890a1b2c3d4e5f607970004")
DECLINED_OID = ObjectId("6890a1b2c3d4e5f607970005")
OTHER_SEASON_OID = ObjectId("6890a1b2c3d4e5f607970006")
TEAM_OID = ObjectId("6890a1b2c3d4e5f607970011")
EINLADUNG_OID = ObjectId("6890a1b2c3d4e5f607970021")

TEAM_NAME = "Adler"


def einwilligung(*, bestaetigt_am: str = MAILED_ON_THE_MARK) -> dict[str, Any]:
    return {
        "umfang": "kader_oeffentlich",
        "erteilt_von": "volljaehrig",
        "datum": bestaetigt_am,
        "bestaetigt_am": bestaetigt_am,
        "text_version": "2026-09-spielerseite",
        "medien": False,
    }


def bestaetigung(registrierung_id: ObjectId, *, frist: str = "2026-04-05", **overrides: Any) -> dict[str, Any]:
    # No `zustellung` key at all, which is what a fresh mint stores: the reminder's page has to
    # admit that shape, and a term narrowing to the reported would chase nobody.
    return {
        "token_hash": hash_token(f"first-{registrierung_id}"),
        "verschickt_am": MAILED_ON_THE_MARK,
        "erinnert_am": None,
        "frist": frist,
        **overrides,
    }


def registrierung(registrierung_id: ObjectId, *, saison_id: str = SAISON_ID, **overrides: Any) -> dict[str, Any]:
    """One submitted registration whose link is due its reminder today, that each row below moves one thing of."""

    return {
        "_id": registrierung_id,
        "saison_id": saison_id,
        "team_id": TEAM_OID,
        "einladung_id": EINLADUNG_OID,
        "eingereicht_am": MAILED_ON_THE_MARK,
        "status": "eingereicht",
        "vorname": "Quillhilde",
        "nachname": "Brackenmoor",
        "email": f"{registrierung_id}@example.com",
        "position": None,
        "nummer": None,
        "stufe": "Q1",
        "geburtsdatum": None,
        "einwilligung": None,
        "bestaetigung": bestaetigung(registrierung_id),
        "entscheidung": None,
        **overrides,
    }


def the_corpus() -> list[dict[str, Any]]:
    """One registration per clock, plus one of another season that no call for `SAISON_ID` may touch."""

    return [
        registrierung(REMIND_OID),
        registrierung(EXPIRED_OID, bestaetigung=bestaetigung(EXPIRED_OID, frist=YESTERDAY)),
        # Its deadline is today, which the link still answers: the pair pins the clock's own boundary.
        registrierung(INSIDE_OID, bestaetigung=bestaetigung(INSIDE_OID, frist=TODAY)),
        registrierung(CONFIRMED_OID, geburtsdatum="2008-05-09", einwilligung=einwilligung()),
        registrierung(
            DECLINED_OID,
            status="abgelehnt",
            entscheidung={"getroffen_am": "2026-02-15", "von": "admin", "grund": "kein Platz"},
        ),
        registrierung(OTHER_SEASON_OID, saison_id=OTHER_SAISON_ID, bestaetigung=bestaetigung(OTHER_SEASON_OID, frist=YESTERDAY)),
    ]


def season(saison_id: str, status: str) -> dict[str, Any]:
    return saison_document(saison_id, status, rules=rules_document(number_of_groups=2, teams_per_group=2))


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, status: str = "active") -> Any:
    """The SHIPPED validators, with a history on every row so the redaction has images to empty."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
            await database[Collection.SAISONS].insert_many([season(SAISON_ID, status), season(OTHER_SAISON_ID, "past")])
            await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, TEAM_NAME, "AD", website_url=None, schulform="gymnasium_g9"))
            await database[Collection.REGISTRIERUNGEN].insert_many(the_corpus())
            # One recorded write per row, so every one has a log image holding its person.
            for document in the_corpus():
                await patch_one_in_db(
                    collection=database[Collection.REGISTRIERUNGEN],
                    db_filter={"_id": document["_id"]},
                    update={"$set": {"nummer": "7"}},
                    return_document=ReturnDocument.BEFORE,
                )

            return await body(database, client)

    return on_the_seed_loop(_run())


async def sweep(database: AsyncDatabase, client: AsyncMongoClient, saison_id: str = SAISON_ID) -> Any:
    return await sweep_registrierungen(
        saison_id=saison_id,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        saisons_collection=database[Collection.SAISONS],
        teams_collection=database[Collection.TEAMS],
        aktionen_collection=database[Collection.AKTIONEN],
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def stored(database: AsyncDatabase, registrierung_id: ObjectId) -> Mapping[str, Any] | None:
    return await database[Collection.REGISTRIERUNGEN].find_one({"_id": registrierung_id})


async def standing(database: AsyncDatabase) -> list[ObjectId]:
    rows = await database[Collection.REGISTRIERUNGEN].find({}, {"_id": 1}).sort("_id", 1).to_list(length=None)

    return [row["_id"] for row in rows]


async def log_rows_naming(database: AsyncDatabase, row_id: ObjectId) -> list[Mapping[str, Any]]:
    return await database[Collection.AKTIONEN].find({"collection": str(Collection.REGISTRIERUNGEN), "document_id": row_id}).to_list(length=None)


class TestTheReminderClock:
    def test_it_stamps_mints_and_answers_one_message_per_registration(self, mongo_replica_set_url: str):
        """The fresh hash replaces the stored one and the first is kept live beside it.

        The deadline does not move, a reminder being no re-send (`docs/backend/spec.md :: I152`).
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await stored(database, REMIND_OID)

        response, document = on_a_league(mongo_replica_set_url, body)

        assert document is not None
        reminded = [entry for entry in response.erinnerungen if entry.registrierung_id == REMIND_OID]
        assert [(entry.email, entry.team) for entry in reminded] == [(f"{REMIND_OID}@example.com", TEAM_NAME)]
        assert reminded[0].vorname == "Quillhilde"

        bookkeeping = document["bestaetigung"]
        assert bookkeeping["token_hash"] == hash_token(reminded[0].token)
        assert bookkeeping["token_hash_zuvor"] == hash_token(f"first-{REMIND_OID}")
        assert (bookkeeping["erinnert_am"], bookkeeping["verschickt_am"]) == (TODAY, MAILED_ON_THE_MARK)
        assert bookkeeping["frist"] == "2026-04-05"

    def test_the_days_second_pass_reminds_nobody_again(self, mongo_replica_set_url: str):
        """One chase per registration, whatever the mail did after the stamp: the stamp is what spends it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            first = await sweep(database, client)
            second = await sweep(database, client)

            return sorted(entry.registrierung_id for entry in first.erinnerungen), [entry.registrierung_id for entry in second.erinnerungen]

        first, second = on_a_league(mongo_replica_set_url, body)

        # Both open links at their mark, the one whose deadline is today included: that link still
        # answers, so the chase is owed on it exactly as on a link with days left.
        assert first == sorted([REMIND_OID, INSIDE_OID])
        assert second == []

    def test_a_registration_whose_address_the_provider_refused_is_not_chased(self, mongo_replica_set_url: str):
        """Its one chase would be spent on an address already known to reject it, and registering again is the way back."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await patch_one_in_db(
                collection=database[Collection.REGISTRIERUNGEN],
                db_filter={"_id": REMIND_OID},
                update={
                    "$set": {
                        "bestaetigung.zustellung": {
                            "nachricht_id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
                            "stand": "unzustellbar",
                            "grund": "NoEmail",
                            "am": "2026-03-29T10:00:00.000000+00:00",
                        }
                    }
                },
                return_document=ReturnDocument.BEFORE,
            )

            response = await sweep(database, client)

            return [entry.registrierung_id for entry in response.erinnerungen], await stored(database, REMIND_OID)

        chased, document = on_a_league(mongo_replica_set_url, body)

        assert document is not None
        assert REMIND_OID not in chased
        # Not merely left out of the answer: a stamp without a message would spend the one chase.
        assert document["bestaetigung"]["erinnert_am"] is None


class TestTheDeadlineClock:
    def test_it_erases_the_day_after_the_deadline_and_not_on_it(self, mongo_replica_set_url: str):
        """The two rows part on one day: the link answers on its deadline, so the erasure waits.

        Both carry a null consent record, which is what says the page's consent term reads one.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await standing(database)

        response, left = on_a_league(mongo_replica_set_url, body)

        assert response.geloescht_unbestaetigt == 1
        assert EXPIRED_OID not in left
        assert INSIDE_OID in left
        # Nothing is mailed either way: the confirmation mail named the deadline, and the address is
        # one the league could not confirm.
        assert response.benachrichtigt == []

    def test_it_redacts_the_log_rows_that_still_hold_the_person(self, mongo_replica_set_url: str):
        """The erasure's second half: the row survives its subject, emptied (`docs/backend/spec.md :: I42`)."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response.redigierte_aktionen, await log_rows_naming(database, EXPIRED_OID)

        redacted, rows = on_a_league(mongo_replica_set_url, body)

        assert redacted >= 1
        assert rows
        assert all(row.get("redacted_at") is not None for row in rows)

    def test_a_registration_of_another_season_is_untouched(self, mongo_replica_set_url: str):
        """Every removal names this season alone.

        The filters are held to it by
        `fl_backend/tests/core/test_write_shapes.py :: TestWhatARemovalFilterMayName`, which reads
        their text where this reads what survived.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)

            return await standing(database)

        assert OTHER_SEASON_OID in on_a_league(mongo_replica_set_url, body)


class TestTheSeasonsOwnEnd:
    def test_it_takes_every_undecided_row_and_tells_the_pupils_who_confirmed(self, mongo_replica_set_url: str):
        """One note after the fact and none before it.

        A notice cannot prolong a row nobody decided, and an unconfirmed address hears neither.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await standing(database)

        response, left = on_a_league(mongo_replica_set_url, body, status="past")

        assert response.geloescht_ohne_entscheidung == 4
        assert [entry.registrierung_id for entry in response.benachrichtigt] == [CONFIRMED_OID]
        assert (response.benachrichtigt[0].email, response.benachrichtigt[0].team) == (f"{CONFIRMED_OID}@example.com", TEAM_NAME)
        # The other season's row alone: the declined one goes to the month clock in the same pass,
        # and every removal here names this season.
        assert left == [OTHER_SEASON_OID]

    def test_nothing_it_took_is_reminded_on_the_way_out(self, mongo_replica_set_url: str):
        """The clock runs AHEAD of the reminder: a fresh link minted for a row this pass erased is a credential nobody can spend."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await sweep(database, client)

        response = on_a_league(mongo_replica_set_url, body, status="past")

        assert response.erinnerungen == []


class TestTheOneMonthClock:
    def test_it_erases_a_declined_registration_a_month_after_the_decision(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            response = await sweep(database, client)

            return response, await standing(database)

        response, left = on_a_league(mongo_replica_set_url, body)

        assert response.geloescht_abgelehnt == 1
        assert DECLINED_OID not in left


class TestThePassRecordsTheDayItRan:
    def test_it_stamps_every_season_and_a_second_pass_appends_no_row(self, mongo_replica_set_url: str):
        """`patch_many_in_db` files a row per call even where its filter matches nothing, so the guard read is what the hourly pass rests on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await sweep(database, client)
            after_first = await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.SAISONS)})
            await sweep(database, client)
            after_second = await database[Collection.AKTIONEN].count_documents({"collection": str(Collection.SAISONS)})
            stamped = await database[Collection.SAISONS].find({}, {"registrierung_sweep_gelaufen_am": 1}).sort("_id", 1).to_list(length=None)

            return after_first, after_second, [row.get("registrierung_sweep_gelaufen_am") for row in stamped]

        after_first, after_second, days = on_a_league(mongo_replica_set_url, body)

        assert after_first == 1
        assert after_second == 1
        # Every season and not the one swept: one pass stamps them all, which is what makes the day
        # the run's rather than the season's.
        assert days == [TODAY, TODAY]

    def test_the_season_list_answers_the_two_days_apart(self, mongo_replica_set_url: str):
        """`docs/ops/runbooks.md` §9 reads one call: a fresh date beside a stale one is what names the pass that stopped."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await get_sweep_saisons(saisons_collection=database[Collection.SAISONS])
            await sweep(database, client)
            after = await get_sweep_saisons(saisons_collection=database[Collection.SAISONS])

            return (
                (before.sweep_gelaufen_am, before.registrierung_sweep_gelaufen_am),
                (after.sweep_gelaufen_am, after.registrierung_sweep_gelaufen_am),
            )

        before, after = on_a_league(mongo_replica_set_url, body)

        assert before == (None, None)
        # The application's pass has not run here, and its date says so while the registration's says
        # today: one date for both would report the sweep that stopped as the one that ran.
        assert after == (None, TODAY)


# A page and a short one after it. At a page plus ONE the first read takes every row, so a clock
# that stopped after one erasure would leave nothing behind and pass.
OVERFLOW = SWEEP_PAGE + 5


def overflowing(**overrides: Any) -> list[dict[str, Any]]:
    """More due rows of one season than one page holds, each an id of its own."""

    return [registrierung(ObjectId(f"6890a1b2c3d4e5f6079{position:05d}"), **overrides) for position in range(OVERFLOW)]


class TestAPageAndOneMoreIsDrainedRatherThanRefused:
    """More due rows than one page, which is the population only the erasure shrinks.

    Seeded as real rows: a page size the endpoint took as an argument would be an API this
    application has only because a test wants one.
    """

    @pytest.mark.parametrize(
        ("clock", "overrides", "status", "counted"),
        [
            pytest.param(
                "deadline", {"bestaetigung": bestaetigung(EXPIRED_OID, frist=YESTERDAY)}, "active", "geloescht_unbestaetigt", id="deadline"
            ),
            pytest.param("season's end", {}, "past", "geloescht_ohne_entscheidung", id="season's end"),
            pytest.param(
                "one month",
                {"status": "abgelehnt", "entscheidung": {"getroffen_am": "2026-02-15", "von": "admin", "grund": None}},
                "active",
                "geloescht_abgelehnt",
                id="one month",
            ),
        ],
    )
    def test_every_due_row_goes_in_one_pass(self, mongo_replica_set_url: str, clock: str, overrides: Any, status: str, counted: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.REGISTRIERUNGEN].delete_many({})
            await database[Collection.REGISTRIERUNGEN].insert_many(overflowing(**overrides))
            response = await sweep(database, client)

            return getattr(response, counted), await database[Collection.REGISTRIERUNGEN].count_documents({"saison_id": SAISON_ID})

        erased, left = on_a_league(mongo_replica_set_url, body, status=status)

        assert (erased, left) == (OVERFLOW, 0), f"the {clock} clock left rows the next pass would read into the same full page"


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


async def passes_until_empty(one_pass: Callable[[], Awaitable[int]], *, share: int, total: int) -> list[int]:
    """What each pass took, up to the first that took nothing: a clock that stops making progress fails here rather than spinning."""

    passes = -(-total // share)
    taken: list[int] = []
    for _ in range(passes + 1):
        if not (took := await one_pass()):
            return taken
        taken.append(took)

    raise AssertionError(f"{total} rows at {share} a pass take {passes} passes, and pass {passes + 1} still took rows: {taken}")


EMPTY_STAMP_OID = ObjectId("6890a1b2c3d4e5f607970031")


def stamped_empty(*, frist: str) -> dict[str, Any]:
    """A row whose consent record a hand edit stamped `""`, which `app/shared/einwilligung.py :: is_confirmed` calls unconfirmed."""

    return registrierung(EMPTY_STAMP_OID, einwilligung=einwilligung(bestaetigt_am=""), bestaetigung=bestaetigung(EMPTY_STAMP_OID, frist=frist))


class TestAnEmptyStampIsUnconfirmedToEveryFilter:
    """Each filter selecting unconfirmed rows, run by the database itself: `None` alone never matches `""`, and only a server says so."""

    def test_the_deadline_takes_a_row_stamped_empty(self, mongo_replica_set_url: str):
        assert EMPTY_STAMP_OID in selected(mongo_replica_set_url, stamped_empty(frist=YESTERDAY), build_unconfirmed_filter)

    def test_the_reminder_takes_a_row_stamped_empty(self, mongo_replica_set_url: str):
        assert EMPTY_STAMP_OID in selected(mongo_replica_set_url, stamped_empty(frist="2026-04-05"), build_erinnerung_filter)

    def test_a_replay_hands_a_row_stamped_empty_a_fresh_link(self, mongo_replica_set_url: str):
        row = stamped_empty(frist="2026-04-05")
        replay_filter = build_wiederholung_filter(registrierung_raw=row, today=TODAY)
        assert replay_filter is not None

        assert selected(mongo_replica_set_url, row, lambda **_: replay_filter) == [EMPTY_STAMP_OID]

    def test_a_null_record_and_a_confirmed_one_still_part_as_they_did(self, mongo_replica_set_url: str):
        """The control: `$in` with null still matches the corpus's null record, and a real stamp is still passed over."""

        chosen = selected(mongo_replica_set_url, stamped_empty(frist=YESTERDAY), build_unconfirmed_filter)

        assert (EXPIRED_OID in chosen, CONFIRMED_OID in chosen) == (True, False)


def selected(url: str, row: dict[str, Any], build: Callable[..., Mapping[str, Any]]) -> list[ObjectId]:
    """The ids a filter selects from the corpus plus `row`, asked of the server rather than of a matcher."""

    async def body(database: AsyncDatabase, _: AsyncMongoClient) -> list[ObjectId]:
        await database[Collection.REGISTRIERUNGEN].insert_one(row)
        rows = await database[Collection.REGISTRIERUNGEN].find(build(saison_id=SAISON_ID, today=TODAY), {"_id": 1}).to_list(length=None)

        return sorted(found["_id"] for found in rows)

    return on_a_league(url, body)


class TestTheReminderClockTakesAShareEachCall:
    def test_each_pass_stamps_its_share_and_the_passes_reach_every_row(self, mongo_replica_set_url: str):
        """A whole page in one transaction could outrun the request's deadline, and a transaction that times out stamps nothing, every pass."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[int], int]:
            await database[Collection.REGISTRIERUNGEN].delete_many({})
            await database[Collection.REGISTRIERUNGEN].insert_many(overflowing())

            async def one_pass() -> int:
                return len((await sweep(database, client)).erinnerungen)

            per_pass = await passes_until_empty(one_pass, share=REMINDERS_PER_PASS, total=OVERFLOW)

            return per_pass, await database[Collection.REGISTRIERUNGEN].count_documents({"bestaetigung.erinnert_am": TODAY})

        per_pass, stamped = on_a_league(mongo_replica_set_url, body)
        whole, rest = divmod(OVERFLOW, REMINDERS_PER_PASS)

        assert per_pass == [REMINDERS_PER_PASS] * whole + ([rest] if rest else [])
        assert stamped == OVERFLOW

    def test_the_share_goes_to_the_earliest_deadlines(self, mongo_replica_set_url: str):
        """The later deadlines are seeded FIRST, so natural order would remind the pupils the deadline clock takes last."""

        later = [registrierung(row["_id"], bestaetigung=bestaetigung(row["_id"], frist="2026-04-06")) for row in overflowing()[:5]]
        earlier = overflowing()[5:]

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> set[str]:
            await database[Collection.REGISTRIERUNGEN].delete_many({})
            await database[Collection.REGISTRIERUNGEN].insert_many([*later, *earlier])
            response = await sweep(database, client)
            reminded = {entry.registrierung_id for entry in response.erinnerungen}

            rows = await database[Collection.REGISTRIERUNGEN].find({"_id": {"$in": list(reminded)}}, {"bestaetigung.frist": 1}).to_list(None)
            return {row["bestaetigung"]["frist"] for row in rows}

        assert on_a_league(mongo_replica_set_url, body) == {"2026-04-05"}

    def test_a_reminded_row_costs_the_round_trips_its_share_is_sized_at(self, mongo_replica_set_url: str):
        """Counted on the wire, two passes apart by `FEW` rows: `AFTER` at the call site, or a second write a row, turns this red."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                await database[Collection.REGISTRIERUNGEN].delete_many({})
                await database[Collection.REGISTRIERUNGEN].insert_many(overflowing()[:due])
                # Stamped already, so the run's own stamp costs both passes the same guard read.
                await database[Collection.SAISONS].update_many({}, {"$set": {"registrierung_sweep_gelaufen_am": TODAY}})

                return await commands_sent(mongo_replica_set_url, sweep)

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert (twice - few) / FEW == ROUND_TRIPS_A_ROW


class TestAnswerAndMessagesCommitTogether:
    """What the answer hands back is committed by the call's LAST transaction (`docs/backend/spec.md :: I323`)."""

    def test_a_page_owing_notices_ends_the_call_and_the_next_call_takes_the_rest(self, mongo_replica_set_url: str):
        """Every row confirmed, so each page owes a message: nobody erased is left out of an answer."""

        confirmed = overflowing(geburtsdatum="2008-05-09", einwilligung=einwilligung())

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[list[int], int, int]:
            await database[Collection.REGISTRIERUNGEN].delete_many({})
            await database[Collection.REGISTRIERUNGEN].insert_many(confirmed)

            async def one_pass() -> int:
                return len((await sweep(database, client)).benachrichtigt)

            # A page and its one row past are erased together, so each pass takes `SWEEP_PAGE + 1`.
            told = await passes_until_empty(one_pass, share=SWEEP_PAGE + 1, total=len(confirmed))

            return told, await database[Collection.REGISTRIERUNGEN].count_documents({"saison_id": SAISON_ID}), len(confirmed)

        told, standing, seeded = on_a_league(mongo_replica_set_url, body, status="past")

        assert told == [SWEEP_PAGE + 1, seeded - SWEEP_PAGE - 1]
        assert standing == 0

    def test_a_clock_failing_before_the_last_transaction_erases_nobody_owed_a_notice(self, mongo_replica_set_url: str):
        """The declined clock stalls on a page it takes none of, BEFORE the season's end erases: the pupils owed a message still stand."""

        fresh_decisions = overflowing(status="abgelehnt", entscheidung={"getroffen_am": "2026-03-31", "von": "admin", "grund": None})

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[type[BaseException], Mapping[str, Any] | None]:
            await database[Collection.REGISTRIERUNGEN].insert_many(fresh_decisions)
            # The filter narrows to due decisions, so the stall is forced: the cutoff is widened to
            # admit the fresh ones and the predicate then takes none of them.
            with pytest.MonkeyPatch.context() as patched:
                patched.setattr(
                    sweep_router_module, "build_decline_filter", lambda *, saison_id, today: {"saison_id": saison_id, "status": "abgelehnt"}
                )
                with pytest.raises(ValueError) as stalled:
                    await sweep(database, client)

            return stalled.type, await stored(database, CONFIRMED_OID)

        raised, confirmed = on_a_league(mongo_replica_set_url, body, status="past")

        assert raised is ValueError
        assert confirmed is not None


def through_the_app(url: str, path: str, *, auth: Mapping[str, str]) -> tuple[int, list[Mapping[str, Any]]]:
    """One call over the wire, so the guard, the system binder and the route template all run."""

    database_name = build_test_config().db_base_name

    client = MongoClient(url)
    try:
        database = a_clean_database_sync(client, url, database_name)
        database[Collection.SAISONS].insert_many([season(SAISON_ID, "active"), season(OTHER_SAISON_ID, "past")])
        database[Collection.REGISTRIERUNGEN].insert_one(registrierung(EXPIRED_OID, bestaetigung=bestaetigung(EXPIRED_OID, frist=YESTERDAY)))

        async def _called() -> int:
            async with app_client(url, now=NOW) as http:
                response = await http.post(f"/api/v{API_VERSION}{path}", json=None, headers=dict(auth))
                return response.status_code

        status = asyncio.run(_called())

        return status, list(database[Collection.AKTIONEN].find({"operation": "erase_many"}))
    finally:
        client.close()


class TestTheSystemTierOverTheWire:
    """On the replica set: the erasure runs in a transaction, which a standalone mongod refuses outright."""

    def test_the_erasure_records_the_system_actor_and_the_route_template(self, mongo_replica_set_url: str):
        """What `bind_system_actor` buys: the row names the machine and the endpoint, not an invented person or a raw path."""

        status, rows = through_the_app(mongo_replica_set_url, f"/registrierungen/sweep/{SAISON_ID}", auth=SYSTEM_AUTH)

        assert status == 200
        assert len(rows) == 1
        assert rows[0]["actor"] == {"kind": "system", "email": SYSTEM_ACTOR_EMAIL}
        assert rows[0]["request"] == {"method": "POST", "path": f"/api/v{API_VERSION}/registrierungen/sweep/{{saison_id}}"}

    @pytest.mark.parametrize("auth", [BASE_AUTH, ADMIN_AUTH], ids=("base", "admin"))
    def test_neither_other_key_reaches_it(self, mongo_replica_set_url: str, auth: Mapping[str, str]):
        """The other two keys are refused as the wrong credential before any body is read, so nothing is erased."""

        status, rows = through_the_app(mongo_replica_set_url, f"/registrierungen/sweep/{SAISON_ID}", auth=auth)

        assert status == 401
        assert rows == []
