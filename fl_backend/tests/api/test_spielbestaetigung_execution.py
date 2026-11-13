"""
API · a fixture's confirmation, answered by a club's seat holder signed in and by its referee, against the shipped indexes

The club's answer writes the row alone: the seat that pressed, the proposal judged as the administrator's save of that
date is judged, and nothing of the fixture.
"""

from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.overview import FLOverviewSpielbestaetigungRow, FLOverviewVorschlagRow
from app.api.saisons.overview_router import get_saison_overview
from app.api.saisons.schemas import FLSaisonRules
from app.api.spielbestaetigungen.admin_router import (
    adopt_spielbestaetigung,
    discard_spielbestaetigung,
    enter_spielbestaetigung,
)
from app.api.spielbestaetigungen.person_router import post_schiedsrichter_answer, post_team_answer
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnswerResponse,
    FLSpielbestaetigungEnterPayload,
    FLSpielbestaetigungSchiedsrichterAnswerPayload,
    FLSpielbestaetigungSchiedsrichterAnswerResponse,
    FLSpielbestaetigungTeamAnswerPayload,
)
from app.api.spielbestaetigungen.services import (
    build_held_filter,
)
from app.api.spiele.admin_router import patch_spiel
from app.api.spiele.crud import advance_bracket_winners
from app.api.spiele.schemas import FLPatchSpielDataPayload
from app.core import clock
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.shared.schemas.literals import KONTAKT_ROLLEN
from tests import documents
from tests.acts import acts_of
from tests.database import a_clean_database, on_the_seed_loop
from tests.erasure import erased
from tests.isolation import InterleavedCollection, outcome_of
from tests.outbox import MAIL_NOW
from tests.payloads import spiel_patch_body
from tests.records import record_collections
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_spielbestaetigung_test")

SAISON_ID = "2027"
TODAY = "2126-05-01"
DEADLINE = "2126-05-07"
DATE = "2126-05-14"
TIME = "18:30:00"


def noon(day: str) -> datetime:
    """Midday of a German day, as the request's clock reads it: well before or after any kick-off the cases hold."""

    return datetime.combine(date.fromisoformat(day), time(12), tzinfo=clock.GERMANY)


NOW = noon(TODAY)

TEAM1 = ObjectId("6890a1b2c3d4e5f607d50001")
TEAM2 = ObjectId("6890a1b2c3d4e5f607d50002")
SPIEL = ObjectId("6890a1b2c3d4e5f607d50011")
NEIGHBOUR = ObjectId("6890a1b2c3d4e5f607d50012")
SPIELTAG = ObjectId("6890a1b2c3d4e5f607d50021")
SPIELORT = ObjectId("6890a1b2c3d4e5f607d50031")
SCHIEDSRICHTER = ObjectId("6890a1b2c3d4e5f607d50041")
ROW1 = ObjectId("6890a1b2c3d4e5f607d50051")
ROW2 = ObjectId("6890a1b2c3d4e5f607d50052")

# The matchday the fixture sits on, which a proposal must stay inside.
SPAN = ("2126-05-10", "2126-05-16")

PEOPLE = {
    TEAM1: {"trainer": ("Ida", "Albers"), "ansprechperson": ("Jonas", "Brandt"), "stellvertretung": ("Klara", "Cordes")},
    TEAM2: {"trainer": ("Lea", "Dietz"), "ansprechperson": ("Mats", "Ernst"), "stellvertretung": ("Nora", "Funke")},
}
NAMES = {TEAM1: ("Adler", "ADX"), TEAM2: ("Biber", "BIX")}
REFEREE = "Otto Gruber"


def address(team_id: ObjectId, seat: str) -> str:
    return f"{PEOPLE[team_id][seat][0].lower()}@example.com"


# Each club's own row, which a seat of it answers.
ROW_OF = {TEAM1: ROW1, TEAM2: ROW2}


def holder(team_id: ObjectId, seat: str) -> tuple[ObjectId, str]:
    """Whoever holds `seat` on `team_id`, signed in, answering their club's row."""

    return team_id, seat


# As the fixture stores it, naming nothing: a club's name is joined from its season row.
def side(team_id: ObjectId) -> dict[str, Any]:
    return {"team_id": team_id, "tore": None}


def spiel(spiel_id: ObjectId = SPIEL, *, spiel_nr: int = 1, saison_id: str = SAISON_ID, **fields: Any) -> dict[str, Any]:
    """Dated, both sides seated, at the league's ground and with its referee."""

    stored = {
        "team1": side(TEAM1),
        "team2": side(TEAM2),
        "date": DATE,
        "time": TIME,
        "spielort": {"spielort_id": SPIELORT, "mietpreis": 40},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "payment": 20},
        "note": "Flutlicht",
    }

    return documents.spiel_document(spiel_id=spiel_id, saison_id=saison_id, spiel_nr=spiel_nr, spieltag_id=SPIELTAG, **{**stored, **fields})


def junction(team_id: ObjectId) -> dict[str, Any]:
    name, shorthand = NAMES[team_id]
    kontakte = documents.kontakte_document(
        **{
            # Each confirmed, so its holder answers signed in.
            seat: documents.kontaktperson_document(first_name, last_name=last_name, email=address(team_id, seat), confirmed_at="2126-04-01")
            for seat, (first_name, last_name) in PEOPLE[team_id].items()
        }
    )

    return documents.saison_team_document(SAISON_ID, team_id, name, shorthand, kontakte=kontakte)


def confirmation(row_id: ObjectId, team_id: ObjectId, **fields: Any) -> dict[str, Any]:
    """An open, asked row about `spiel()`'s Ansetzung."""

    return documents.spielbestaetigung_document(
        spiel(),
        party={"kind": "team", "team_id": team_id},
        _id=row_id,
        deadline=DEADLINE,
        asked_at=TODAY,
        **fields,
    )


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_spiel(url: str, body: Body, *, rows: list[dict[str, Any]] | None = None, mutates_schema: bool = False) -> Any:
    """The running season, its two clubs with three seats each, the fixture, its ground and referee, and one open row per club."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            for team_id, (name, shorthand) in NAMES.items():
                await database[Collection.TEAMS].insert_one(documents.team_document(team_id, name, shorthand))
                await database[Collection.SAISON_TEAMS].insert_one(junction(team_id))
            await database[Collection.SPIELTAGE].insert_one(
                {
                    "_id": SPIELTAG,
                    "start": SPAN[0],
                    "end": SPAN[1],
                    "position": 1,
                    "saison_id": SAISON_ID,
                    "saison_phase": "gruppenphase",
                    "version": 0,
                }
            )
            await database[Collection.SPIELORTE].insert_one(documents.spielort_document(SPIELORT, "Halle Ost", default_mietpreis=40))
            await database[Collection.SCHIEDSRICHTER].insert_one(
                documents.schiedsrichter_document(SCHIEDSRICHTER, email="otto@example.com", name=REFEREE, default_payment=20, einwilligung=None)
            )
            await database[Collection.SPIELE].insert_one(spiel())
            await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
                rows if rows is not None else [confirmation(ROW1, TEAM1), confirmation(ROW2, TEAM2)]
            )

            return await body(database, client)

    return on_the_seed_loop(_run())


def either(database: AsyncDatabase, collection: Collection, stand_in: Any) -> Any:
    """The collection, or the wrapper a case reaches it through."""

    return database[collection] if stand_in is None else stand_in


async def press_answer(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    who: tuple[ObjectId, str],
    *,
    row_id: ObjectId | None = None,
    answer: str = "agreed",
    vorschlag: tuple[str, str] | None = None,
    reason: str | None = None,
    now: datetime = NOW,
    spielbestaetigungen: Any = None,
    spiele: Any = None,
    saison_teams: Any = None,
    spieltage: Any = None,
) -> FLSpielbestaetigungAnswerResponse:
    """`who`'s answer, signed in at their own address, to their club's row or to `row_id`."""

    team_id, seat = who
    body = {
        "answer": answer,
        "vorschlag": None if vorschlag is None else {"date": vorschlag[0], "time": vorschlag[1]},
        "reason": reason,
    }

    return await post_team_answer(
        spielbestaetigung_id=ROW_OF[team_id] if row_id is None else row_id,
        answer_data=FLSpielbestaetigungTeamAnswerPayload.model_validate(body),
        identifier=address(team_id, seat),
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=either(database, Collection.SPIELE, spiele),
        saison_teams_collection=either(database, Collection.SAISON_TEAMS, saison_teams),
        spieltage_collection=either(database, Collection.SPIELTAGE, spieltage),
        records=record_collections(database),
        db=client,
        now=now,
    )


async def decline_as_club(
    database: AsyncDatabase, client: AsyncMongoClient, who: tuple[ObjectId, str], vorschlag: tuple[str, str], **kwargs: Any
) -> Any:
    return await press_answer(database, client, who, answer="declined", vorschlag=vorschlag, **kwargs)


async def row_now(database: AsyncDatabase, row_id: ObjectId) -> Mapping[str, Any]:
    stored = await database[Collection.SPIELBESTAETIGUNGEN].find_one({"_id": row_id})
    assert stored is not None

    return stored


class WritesRecorded:
    """The confirmations a write reaches, every filter the write was sent with kept."""

    def __init__(self, collection: Any) -> None:
        self._collection = collection
        self.filters: list[Mapping[str, Any]] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        self.filters.append(kwargs["filter"])
        return await self._collection.find_one_and_update(*args, **kwargs)


class TestTheSeatTheAnswerRecords:
    def test_the_stellvertretung_answers_and_the_trainers_press_then_finds_it_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            answered = await press_answer(database, client, holder(TEAM1, "stellvertretung"))
            second = await outcome_of(press_answer(database, client, holder(TEAM1, "trainer")))

            return answered, second, await row_now(database, ROW1), await row_now(database, ROW2)

        answered, second, row, other = on_a_spiel(mongo_replica_set_url, body)

        assert answered.answered_by.model_dump() == {"kind": "kontakt", "rolle": "stellvertretung"}
        assert row["answer"] == {
            "kind": "agreed",
            "at": TODAY,
            "by": {"kind": "kontakt", "rolle": "stellvertretung"},
            "vorschlag": None,
            "reason": None,
        }
        assert second == Code.ANSETZUNG_ANSWERED
        # The other club's row is its own question.
        assert other["answer"] is None

    @pytest.mark.parametrize(("team_id", "row_id"), [(TEAM1, ROW1), (TEAM2, ROW2)], ids=["the first club", "the second club"])
    def test_the_log_names_the_club_the_answered_row_asks(self, mongo_replica_set_url: str, team_id: ObjectId, row_id: ObjectId):
        """Both clubs of the fixture are read for the answer, and a link names neither: the name is the row's `party.team_id`'s."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await press_answer(database, client, holder(team_id, "trainer"))

            return await acts_of(database)

        assert on_a_spiel(mongo_replica_set_url, body) == [("spielbestaetigung.answered", "kontakt", NAMES[team_id][0], row_id)]

    def test_one_person_on_two_seats_answers_from_the_first_in_order(self, mongo_replica_set_url: str):
        """The Stellvertretung's holder holds the Trainer's seat too: resolved to a seat rather than to nothing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            trainer = documents.kontaktperson_document(
                "Klara", last_name="Cordes", email=address(TEAM1, "stellvertretung"), confirmed_at="2126-04-01"
            )
            await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM1}, {"$set": {"kontakte.trainer": trainer}})
            await press_answer(database, client, holder(TEAM1, "stellvertretung"))

            return await row_now(database, ROW1)

        assert on_a_spiel(mongo_replica_set_url, body)["answer"]["by"]["rolle"] == "trainer"

    def test_the_write_itself_takes_only_a_row_neither_answered_nor_closed(self, mongo_replica_set_url: str):
        """The first press binds through the write's own filter, which the in-session judgement before it does not replace."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            recorded = WritesRecorded(database[Collection.SPIELBESTAETIGUNGEN])
            await press_answer(database, client, holder(TEAM1, "trainer"), spielbestaetigungen=recorded)

            return recorded.filters

        [sent] = on_a_spiel(mongo_replica_set_url, body)

        assert sent == {"_id": ROW1, "answer": None, "closed": None}


class TestAProposalIsJudgedWhereTheAdminIsJudged:
    """The administrator's three judges, each through the route, and the standing clash the save itself accepts."""

    @pytest.mark.parametrize(
        ("vorschlag", "neighbour", "austritt", "code"),
        [
            pytest.param(("2126-05-20", "18:00:00"), None, None, Code.SPIEL_OUTSIDE_SPIELTAG, id="outside-the-matchday"),
            # Four hours apart is the buffer; two is inside it, on the referee's other booking.
            pytest.param(
                ("2126-05-15", "20:00:00"), ("2126-05-15", "18:00:00"), None, Code.SPIEL_DOUBLE_BOOKED, id="beside-the-referees-other-fixture"
            ),
            pytest.param(("2126-05-15", "18:00:00"), None, "2126-05-15", Code.ELIGIBILITY_DISQUALIFIED, id="on-a-clubs-exit"),
        ],
    )
    def test_a_refused_proposal_writes_no_row_and_no_span(
        self, mongo_replica_set_url: str, vorschlag: tuple[str, str], neighbour: tuple[str, str] | None, austritt: str | None, code: str
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if neighbour is not None:
                await database[Collection.SPIELE].insert_one(
                    spiel(NEIGHBOUR, spiel_nr=2, date=neighbour[0], time=neighbour[1], spielort=None, team1=None, team2=None)
                )
            if austritt is not None:
                exit_record = {"type": "rueckzug", "reason": "Schule zieht zurück", "date": austritt}
                await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM2}, {"$set": {"austritt": exit_record}})

            outcome = await outcome_of(decline_as_club(database, client, holder(TEAM1, "trainer"), vorschlag))

            return outcome, await row_now(database, ROW1), await database[Collection.SPIELTAGE].find_one({"_id": SPIELTAG})

        outcome, row, spieltag = on_a_spiel(mongo_replica_set_url, body)

        assert outcome == code
        assert row["answer"] is None
        assert (spieltag["start"], spieltag["end"]) == SPAN


class ConfirmationsRunningARivalBeforeTheWrite(InterleavedCollection):
    """The confirmations the answer writes, a rival run once after the answer's judgement and before its write."""

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.find_one_and_update(*args, **kwargs)


class TestASpielMovedMidAnswerIsJudgedAgain:
    """The administrator moves the fixture while a club answers: the answer reads the fixture and writes none of it.

    So the move raises no conflict, and only the re-read outside the transaction sees it.
    """

    def test_the_answer_is_refused_on_the_move_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def move() -> None:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"time": "19:30:00"}})

            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], move)
            outcome = await outcome_of(press_answer(database, client, holder(TEAM1, "trainer"), spielbestaetigungen=confirmations))
            # Once: a second arrival would be a retry, which a write conflict causes and a move must not.
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, ROW1))["answer"], confirmations.passes

        outcome, answer, passes = on_a_spiel(mongo_replica_set_url, body)

        assert outcome == Code.ANSETZUNG_CHANGED
        assert answer is None
        assert passes == 1


# A decline every rival below turns into a refusal: inside the matchday, clear of the referee's other bookings, on a day
# both clubs still play.
PROPOSAL = ("2126-05-15", "18:00:00")
REASON = "Leider hat Zora an dem Tag Prüfungen"


async def narrow_the_matchday(database: AsyncDatabase) -> None:
    await database[Collection.SPIELTAGE].update_one({"_id": SPIELTAG}, {"$set": {"end": "2126-05-14"}})


async def book_the_referee_beside_it(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].insert_one(
        spiel(NEIGHBOUR, spiel_nr=2, date=PROPOSAL[0], time="19:00:00", spielort=None, team1=None, team2=None)
    )


async def book_the_ground_beside_it(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].insert_one(
        spiel(NEIGHBOUR, spiel_nr=2, date=PROPOSAL[0], time="19:00:00", schiedsrichter=None, team1=None, team2=None)
    )


async def let_a_club_leave_before_the_proposal(database: AsyncDatabase) -> None:
    exit_record = {"type": "rueckzug", "reason": "Schule zieht zurück", "date": PROPOSAL[0]}
    await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM2}, {"$set": {"austritt": exit_record}})


# Two writes after which the pass's next close shuts the fixture's rows, though neither closes one itself: a page read
# before either still offers an act on an open row.
async def call_the_spiel_off(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await save(database, client, await spiel_now(database), sonderereignis="ausgefallen")


async def let_the_opponent_leave_by_the_match_day(database: AsyncDatabase, _: AsyncMongoClient) -> None:
    exit_record = {"type": "rueckzug", "reason": "Schule zieht zurück", "date": DATE}
    await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM2}, {"$set": {"austritt": exit_record}})


OVERTAKEN_BY_THE_PASS = [
    pytest.param(call_the_spiel_off, id="an-event-saved"),
    pytest.param(let_the_opponent_leave_by_the_match_day, id="the-opponent-gone-by-its-day"),
]

Overtaking = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[None]]


class TestWhatTheProposalIsJudgedOnMovingMidAnswerIsJudgedAgain:
    """Each a write the answer's transaction reads and never writes, so none conflicts: the re-judgement outside it is all that sees them."""

    @pytest.mark.parametrize(
        ("rival", "code"),
        [
            pytest.param(narrow_the_matchday, Code.SPIEL_OUTSIDE_SPIELTAG, id="the-matchday-narrowed"),
            pytest.param(book_the_referee_beside_it, Code.SPIEL_DOUBLE_BOOKED, id="a-rival-booking-of-the-referee"),
            pytest.param(let_a_club_leave_before_the_proposal, Code.ELIGIBILITY_DISQUALIFIED, id="a-club-leaving-before-the-new-day"),
        ],
    )
    def test_the_answer_is_refused_on_what_moved_and_writes_nothing(
        self, mongo_replica_set_url: str, rival: Callable[[AsyncDatabase], Awaitable[None]], code: str
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], lambda: rival(database))
            outcome = await outcome_of(
                decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON, spielbestaetigungen=confirmations)
            )
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, ROW1))["answer"], confirmations.passes

        outcome, answer, passes = on_a_spiel(mongo_replica_set_url, body)

        assert outcome == code
        assert answer is None
        # Once: none of these conflicts, so a retry would mean the rival was caught some other way.
        assert passes == 1


class ConfirmationsCountingTheJudgements(ConfirmationsRunningARivalBeforeTheWrite):
    """`ConfirmationsRunningARivalBeforeTheWrite`, counting each time the answer reads its row to judge it."""

    def __init__(self, collection: Any, rival: Any) -> None:
        super().__init__(collection, rival)
        self.judged = 0

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        self.judged += 1
        return await self._collection.find_one(*args, **kwargs)


class TestTwoSeatsPressingAtOnce:
    def test_the_second_press_landing_under_the_first_is_one_answer_and_one_refusal(self, mongo_replica_set_url: str):
        """The other seat commits between this press's judgement and its write: the write conflicts, and the retry finds the row answered.

        Driven rather than reasoned: the answer stored is the seat that committed first.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def the_other_seat_presses() -> None:
                await press_answer(database, client, holder(TEAM1, "ansprechperson"))

            confirmations = ConfirmationsCountingTheJudgements(database[Collection.SPIELBESTAETIGUNGEN], the_other_seat_presses)
            outcome = await outcome_of(press_answer(database, client, holder(TEAM1, "trainer"), spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)
            answered = await database[Collection.SPIELBESTAETIGUNGEN].count_documents({"party.team_id": TEAM1, "answer": {"$ne": None}})

            return outcome, (await row_now(database, ROW1))["answer"]["by"]["rolle"], answered, confirmations.judged

        outcome, rolle, answered, judged = on_a_spiel(mongo_replica_set_url, body)

        assert (outcome, rolle, answered) == (Code.ANSETZUNG_ANSWERED, "ansprechperson", 1)
        # The premise: the write conflicted and the press was judged afresh. Whether the judgement or the write's filter
        # then refuses it, both answer the same code.
        assert judged == 2


class TestAProposalOfAPastDayIsRefusedThroughTheRoute:
    def test_yesterday_inside_the_matchday_writes_nothing(self, mongo_replica_set_url: str):
        """A deadline of today, as a fixture inside the notice period is minted with.

        The matchday's span admits yesterday, so this rule alone refuses it.
        """

        today = "2126-05-12"

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            outcome = await outcome_of(decline_as_club(database, client, holder(TEAM1, "trainer"), ("2126-05-11", "18:00:00"), now=noon(today)))

            return outcome, await row_now(database, ROW1)

        outcome, row = on_a_spiel(
            mongo_replica_set_url, body, rows=[{**confirmation(ROW1, TEAM1), "deadline": today}, confirmation(ROW2, TEAM2)]
        )

        assert outcome == Code.ANSETZUNG_VORSCHLAG_PAST
        assert row["answer"] is None


# --- The ADMINISTRATOR's read, settle and discard, and the queue the confirmations put a fixture in.

SETTLE_REASON = "Telefonisch mit dem Trainer abgestimmt"


async def enter(database: AsyncDatabase, client: AsyncMongoClient, row_id: ObjectId, *, spielbestaetigungen: Any = None) -> None:
    return await enter_spielbestaetigung(
        spielbestaetigung_id=row_id,
        enter_data=FLSpielbestaetigungEnterPayload(reason=SETTLE_REASON),
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        db=client,
        today=TODAY,
        now=NOW,
    )


async def discard_row(database: AsyncDatabase, client: AsyncMongoClient, row_id: ObjectId, *, spielbestaetigungen: Any = None) -> None:
    return await discard_spielbestaetigung(
        spielbestaetigung_id=row_id,
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        now=NOW,
    )


class TestTheAdministratorsZusage:
    def test_it_names_nobody_and_a_seats_press_after_it_finds_the_row_answered(self, mongo_replica_set_url: str):
        """Key for key: a role or a holder on it would let a person's erasure reach the league's reason."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await enter(database, client, ROW1)
            pressed = await outcome_of(press_answer(database, client, holder(TEAM1, "trainer")))

            return (await row_now(database, ROW1))["answer"], pressed

        stored, pressed = on_a_spiel(mongo_replica_set_url, body)

        expected = {"kind": "agreed", "at": TODAY, "by": {"kind": "admin"}, "vorschlag": None, "reason": SETTLE_REASON}
        assert stored == expected
        assert pressed == Code.ANSETZUNG_ANSWERED

    def test_a_settle_after_a_seats_answer_is_refused_and_the_seats_answer_stands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await press_answer(database, client, holder(TEAM1, "stellvertretung"))
            outcome = await outcome_of(enter(database, client, ROW1))

            return outcome, (await row_now(database, ROW1))["answer"]["by"]

        assert on_a_spiel(mongo_replica_set_url, body) == (
            Code.ANSETZUNG_NOT_ENTERABLE,
            {"kind": "kontakt", "rolle": "stellvertretung"},
        )

    def test_a_seats_answer_landing_inside_the_settle_is_the_one_answer(self, mongo_replica_set_url: str):
        """The seat commits between the settle's read and its write: the write conflicts and the retry's read refuses it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def the_seat_presses() -> None:
                await press_answer(database, client, holder(TEAM1, "stellvertretung"))

            confirmations = ConfirmationsCountingTheJudgements(database[Collection.SPIELBESTAETIGUNGEN], the_seat_presses)
            outcome = await outcome_of(enter(database, client, ROW1, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, ROW1))["answer"]["by"], confirmations.judged

        outcome, by, judged = on_a_spiel(mongo_replica_set_url, body)

        assert (outcome, by) == (Code.ANSETZUNG_NOT_ENTERABLE, {"kind": "kontakt", "rolle": "stellvertretung"})
        # Driven, not reasoned: the rival surfaces as a write conflict, so the refusal is the retry's read and never the filter.
        assert judged == 2

    @pytest.mark.parametrize("overtake", OVERTAKEN_BY_THE_PASS)
    def test_a_row_the_pass_would_close_is_refused_and_keeps_no_answer(self, mongo_replica_set_url: str, overtake: Overtaking):
        """Recorded, the league's record would hold an agreement to a match called off, or against a club gone by its day."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await overtake(database, client)
            outcome = await outcome_of(enter(database, client, ROW1))

            return outcome, (await row_now(database, ROW1))["answer"]

        assert on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_NOT_ENTERABLE, None)

    def test_an_exit_landing_inside_the_settle_refuses_it(self, mongo_replica_set_url: str):
        """The settle writes no season row, so the exit raises no conflict: only the re-read outside the transaction sees it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = ConfirmationsRunningARivalBeforeTheWrite(
                database[Collection.SPIELBESTAETIGUNGEN], lambda: let_the_opponent_leave_by_the_match_day(database, client)
            )
            outcome = await outcome_of(enter(database, client, ROW1, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, ROW1))["answer"], confirmations.passes

        assert on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_NOT_ENTERABLE, None, 1)


class TestTheDiscard:
    def test_it_closes_the_decline_and_leaves_the_clubs_answer_as_given(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)
            declined = (await row_now(database, ROW1))["answer"]
            await discard_row(database, client, ROW1)
            owed = await database[Collection.OUTBOX].find({}, {"to": 1, "kind": 1, "reference": 1, "_id": 0}).to_list()

            return declined, await row_now(database, ROW1), owed

        declined, row, owed = on_a_spiel(mongo_replica_set_url, body)

        assert (row["answer"], row["closed"]) == (declined, {"reason": "discarded"})
        # Owed the club in the discard's own transaction, the fixture's day being to come: every address its seats hold.
        assert sorted((mail["to"], mail["kind"], mail["reference"]["seat"]) for mail in owed) == sorted(
            (address(TEAM1, seat), "spiel_vorschlag_discarded", seat) for seat in KONTAKT_ROLLEN
        )

    @pytest.mark.parametrize("agreed", [pytest.param(False, id="open"), pytest.param(True, id="agreed")])
    def test_a_row_no_open_decline_with_a_proposal_is_refused_and_closes_nothing(self, mongo_replica_set_url: str, agreed: bool):
        """Closed `discarded`, either would be its club's one answer to the Ansetzung."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if agreed:
                await press_answer(database, client, holder(TEAM1, "trainer"))
            outcome = await outcome_of(discard_row(database, client, ROW1))

            return outcome, (await row_now(database, ROW1))["closed"]

        assert on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_NOT_DISCARDABLE, None)

    def test_a_close_landing_inside_the_discard_keeps_its_own_reason(self, mongo_replica_set_url: str):
        """The hourly pass shuts the row for a move between the discard's read and its write: refused, the move's reason standing."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)

            async def the_pass_closes_it() -> None:
                await database[Collection.SPIELBESTAETIGUNGEN].update_one({"_id": ROW1}, {"$set": {"closed": {"reason": "ansetzung_changed"}}})

            confirmations = ConfirmationsCountingTheJudgements(database[Collection.SPIELBESTAETIGUNGEN], the_pass_closes_it)
            outcome = await outcome_of(discard_row(database, client, ROW1, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, ROW1))["closed"]["reason"], confirmations.judged

        assert on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_NOT_DISCARDABLE, "ansetzung_changed", 2)

    def test_a_decline_about_an_ansetzung_the_spiel_left_is_refused_and_closes_nothing(self, mongo_replica_set_url: str):
        """Closed `discarded`, it would spare the row the pass's `ansetzung_changed` and its club the move's notice."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)
            await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"time": "19:30:00"}})
            outcome = await outcome_of(discard_row(database, client, ROW1))

            return outcome, (await row_now(database, ROW1))["closed"]

        assert on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_NOT_DISCARDABLE, None)

    def test_a_move_landing_inside_the_discard_refuses_it(self, mongo_replica_set_url: str):
        """The discard writes no fixture, so the move raises no conflict: only the re-read outside the transaction sees it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)

            async def move() -> None:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"time": "19:30:00"}})

            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], move)
            outcome = await outcome_of(discard_row(database, client, ROW1, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, ROW1))["closed"], confirmations.passes

        assert on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_NOT_DISCARDABLE, None, 1)

    @pytest.mark.parametrize("overtake", OVERTAKEN_BY_THE_PASS)
    def test_a_proposal_the_pass_would_close_is_refused_before_it_does(self, mongo_replica_set_url: str, overtake: Overtaking):
        """Discarded, the club would be told „Termin bleibt“ of a match called off, or of one against a club gone by its day.

        Neither the save nor the exit closes a row, so a page read before either reaches a row the pass has yet to shut.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)
            await overtake(database, client)
            outcome = await outcome_of(discard_row(database, client, ROW1))

            return outcome, (await row_now(database, ROW1))["closed"], await database[Collection.OUTBOX].count_documents({})

        assert on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_NOT_DISCARDABLE, None, 0)


async def adopt(
    database: AsyncDatabase, client: AsyncMongoClient, row_id: ObjectId, *, spielbestaetigungen: Any = None, today: str = TODAY
) -> None:
    return await adopt_spielbestaetigung(
        spielbestaetigung_id=row_id,
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=database[Collection.SPIELE],
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielorte_collection=database[Collection.SPIELORTE],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
        db=client,
        today=today,
        now=MAIL_NOW,
    )


class ConfirmationsRunningARivalBeforeTheAnchor(InterleavedCollection):
    """The confirmations the adoption reads its row from, a rival run once after that read and before the row's anchor."""

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.update_many(*args, **kwargs)


class TestTheAdoption:
    def test_the_spiel_moves_to_the_proposal_and_the_row_reads_the_ansetzung_left(self, mongo_replica_set_url: str):
        """Adopted, a fixture left at the slot its club declined would ask every party about a date the league gave up."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)
            await adopt(database, client, ROW1)
            spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})
            again = await outcome_of(adopt(database, client, ROW1))

            assert spiel is not None
            return (spiel["date"], spiel["time"]), (await row_now(database, ROW1))["closed"], again

        moved_to, closed, again = on_a_spiel(mongo_replica_set_url, body)

        assert moved_to == PROPOSAL
        # Left for the pass to close, which tells every party of the move alike; a second adoption finds the proposal spent.
        assert (closed, again) == (None, Code.ANSETZUNG_NOT_ADOPTABLE)

    def test_a_discard_landing_inside_the_adoption_leaves_the_spiel_where_it_stands(self, mongo_replica_set_url: str):
        """Both committing, the club would be told the date stands and every party asked about the date its proposal named."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)

            async def discard() -> None:
                await discard_row(database, client, ROW1)

            confirmations = ConfirmationsRunningARivalBeforeTheAnchor(database[Collection.SPIELBESTAETIGUNGEN], discard)
            outcome = await outcome_of(adopt(database, client, ROW1, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)
            spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})

            assert spiel is not None
            return outcome, (spiel["date"], spiel["time"]), (await row_now(database, ROW1))["closed"]["reason"]

        outcome, slot, reason = on_a_spiel(mongo_replica_set_url, body)

        assert (outcome, reason) == (Code.ANSETZUNG_NOT_ADOPTABLE, "discarded")
        assert slot != PROPOSAL

    @pytest.mark.parametrize("overtake", OVERTAKEN_BY_THE_PASS)
    def test_a_proposal_the_pass_would_close_is_refused_before_it_does(self, mongo_replica_set_url: str, overtake: Overtaking):
        """Adopted, a match called off, or one against a club gone by its day, would be moved, its rows read as a move."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Ahead of an exit on the match day, so the save's own eligibility check would take the move.
            await decline_as_club(database, client, holder(TEAM1, "trainer"), ("2126-05-12", "18:00:00"), reason=REASON)
            await overtake(database, client)
            outcome = await outcome_of(adopt(database, client, ROW1))
            spiel = await spiel_now(database)

            return outcome, (spiel["date"], spiel["time"])

        assert on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_NOT_ADOPTABLE, (DATE, TIME))

    @pytest.mark.parametrize(
        ("since", "today", "code"),
        [
            # The proposed day passing between the club's press and the administrator's.
            pytest.param(None, "2126-05-16", Code.ANSETZUNG_VORSCHLAG_PAST_AS_STORED, id="the-proposed-day-gone-by"),
            # The save's own refusal of the proposed day, which names a box of a body this request has not got.
            pytest.param(narrow_the_matchday, TODAY, Code.SPIEL_OUTSIDE_SPIELTAG, id="the-save-refusing-the-day"),
            # The save's refusals the catalogue words by their path, each under its twin for that path.
            pytest.param(book_the_ground_beside_it, TODAY, Code.SPIEL_DOUBLE_BOOKED_SPIELORT_AS_STORED, id="the-ground-booked-beside-it"),
            pytest.param(
                book_the_referee_beside_it, TODAY, Code.SPIEL_DOUBLE_BOOKED_SCHIEDSRICHTER_AS_STORED, id="the-referee-booked-beside-it"
            ),
            pytest.param(
                let_a_club_leave_before_the_proposal, TODAY, Code.ELIGIBILITY_DISQUALIFIED_TEAM2_AS_STORED, id="a-side-out-by-the-new-day"
            ),
        ],
    )
    def test_a_refused_adoption_names_no_box_and_leaves_the_spiel_where_it_stands(
        self, mongo_replica_set_url: str, since: Callable[[AsyncDatabase], Awaitable[None]] | None, today: str, code: Code
    ):
        """Moved anyway, the fixture lands on a day gone by, outside its matchday, on a booked ground or referee, or fields a club gone.

        Refused naming a box, the press has none to mark; refused under a code the catalogue words by its path, it words none.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)
            if since is not None:
                await since(database)
            with pytest.raises(APIError) as refused:
                await adopt(database, client, ROW1, today=today)
            spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})

            assert spiel is not None
            return refused.value, (spiel["date"], spiel["time"])

        refusal, slot = on_a_spiel(mongo_replica_set_url, body)

        assert (refusal.error_code, refusal.fields, refusal.bounds) == (code, (), {})
        assert slot == (DATE, TIME)


DECLINE = {
    "kind": "declined",
    "at": TODAY,
    "by": {"kind": "kontakt", "rolle": "trainer"},
    "vorschlag": {"date": PROPOSAL[0], "time": PROPOSAL[1]},
    "reason": None,
}


class TestTheQueueListsASpielItsConfirmationsPutThere:
    """The fixture lacks nothing the other conditions list, so a confirmation is the only way onto the page."""

    @pytest.mark.parametrize(
        ("row1", "today", "moved", "listed"),
        [
            pytest.param({}, TODAY, False, False, id="asked-and-still-in-time"),
            pytest.param({"answer": DECLINE}, TODAY, False, True, id="a-standing-proposal"),
            pytest.param({}, "2126-05-08", False, True, id="a-deadline-passed-unanswered"),
            pytest.param({"asked_at": DEADLINE}, DEADLINE, False, True, id="due-the-day-it-was-asked"),
            pytest.param({"asked_at": None}, DEADLINE, False, True, id="due-today-and-never-asked"),
            pytest.param({}, DEADLINE, False, False, id="due-today-and-asked-days-ago"),
            pytest.param({"answer": DECLINE}, TODAY, True, False, id="a-proposal-about-an-ansetzung-left"),
            pytest.param({"answer": DECLINE, "closed": {"reason": "discarded"}}, TODAY, False, False, id="a-discarded-proposal"),
        ],
    )
    def test_the_spiel_is_listed_where_a_clubs_row_asks_for_the_administrator(
        self, mongo_replica_set_url: str, row1: dict[str, Any], today: str, moved: bool, listed: bool
    ):
        # The other club and the referee agreed, so ROW1 alone decides; a referee's row owing its answer lists the fixture
        # as a club's does (`test_saison_overview.py :: TestEachKindLandsOnItsCard`).
        agreed = {"answer": {**DECLINE, "kind": "agreed", "vorschlag": None}}
        referee = documents.spielbestaetigung_document(
            spiel(),
            party={"kind": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER},
            deadline="2126-04-30",
            asked_at=TODAY,
            answer={"kind": "agreed", "at": TODAY, "by": {"kind": "schiedsrichter"}, "vorschlag": None, "reason": None},
        )
        rows = [{**confirmation(ROW1, TEAM1), **row1}, confirmation(ROW2, TEAM2, **agreed), referee]

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> set[Any]:
            if moved:
                await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"time": "19:30:00"}})
            overview = await get_saison_overview(
                saison_id=SAISON_ID,
                saisons_collection=database[Collection.SAISONS],
                spiele_collection=database[Collection.SPIELE],
                teams_collection=database[Collection.TEAMS],
                spielorte_collection=database[Collection.SPIELORTE],
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                now=noon(today),
            )

            return {
                row.spiel.id
                for card in overview.cards
                for row in card.rows
                if isinstance(row, FLOverviewSpielbestaetigungRow | FLOverviewVorschlagRow)
            }

        assert on_a_spiel(mongo_replica_set_url, body, rows=rows) == ({SPIEL} if listed else set())


# The answering Trainer's address, and the clock their erasure runs on.
IDA = "ida@example.com"
ERASED_AT = datetime(2126, 5, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))


class SeasonRowsRunningARivalBeforeTheAnchor(InterleavedCollection):
    """The season rows the answer anchors the seat it was judged from on, a rival run once ahead of that anchor."""

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.update_many(*args, **kwargs)


class SeasonRowsRunningARivalBeforeTheClearing(InterleavedCollection):
    """The season rows an erasure empties its person's seats on, a rival run once ahead of the first of those writes."""

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.find_one_and_update(*args, **kwargs)


class TestAnAnswerAndItsWritersErasureCross:
    """The answer anchors the season row its seat was judged off, and the erasure empties that seat on it, so one retries.

    Without that conflict a reason stored under an erasure's snapshot would stand until the season's end.
    """

    def test_an_erasure_landing_inside_the_answer_leaves_it_refused_and_nothing_stored(self, mongo_replica_set_url: str):
        """The answer run again finds the person holding no seat on the row's club."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def erase_the_trainer() -> None:
                await erased(database, client, IDA, germany_now=ERASED_AT)

            season_rows = SeasonRowsRunningARivalBeforeTheAnchor(database[Collection.SAISON_TEAMS], erase_the_trainer)
            outcome = await outcome_of(
                decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON, saison_teams=season_rows)
            )

            return outcome, season_rows.passes, await row_now(database, ROW1)

        outcome, passes, row = on_a_spiel(mongo_replica_set_url, body)

        # The premise: the erasure ran once, inside the answer's transaction, ahead of its anchor; the retry is refused before it.
        assert passes == 1
        assert (outcome, row["answer"]) == (Code.ANSETZUNG_FOREIGN_ROW, None)

    def test_an_answer_landing_inside_the_erasure_has_its_reason_taken(self, mongo_replica_set_url: str):
        """The erasure run again finds the reason the answer stored from the seat, and nulls it; the way and the role stay."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def answer_as_the_trainer() -> None:
                await decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)

            season_rows = SeasonRowsRunningARivalBeforeTheClearing(database[Collection.SAISON_TEAMS], answer_as_the_trainer)
            await erased(database, client, IDA, germany_now=ERASED_AT, saison_teams_collection=season_rows)

            return season_rows, await row_now(database, ROW1)

        season_rows, row = on_a_spiel(mongo_replica_set_url, body)

        # Serially, the one clearing of Ida's seat: a second arrival is the clearing run again after the conflict.
        season_rows.assert_landed_inside(serially=1)
        assert (row["answer"]["kind"], row["answer"]["by"], row["answer"]["reason"]) == (
            "declined",
            {"kind": "kontakt", "rolle": "trainer"},
            None,
        )


class TestADiscardAndASeatHoldersErasureCross:
    """The discard anchors the season row its mailboxes were read off, and the erasure empties a seat on it, so one retries.

    Without that conflict the discard's notice would go to the mailbox of a person who had just erased themselves.
    """

    def test_an_erasure_landing_inside_the_discard_leaves_its_mailbox_untold(self, mongo_replica_set_url: str):
        """The Ansprechperson is erased between the discard's read of the seats and its write: the discard run again mails the rest."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_club(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)

            async def erase_the_ansprechperson() -> None:
                await erased(database, client, address(TEAM1, "ansprechperson"), germany_now=ERASED_AT)

            # Ahead of the row's write rather than the anchor, so the race stands whether or not the anchor is there; the
            # erasure writes the season row and never this row, whose answer came from another seat.
            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], erase_the_ansprechperson)
            # The stand-in delegates every call, which the endpoint's collection type cannot say.
            stand_in: Any = confirmations
            # Not refused: the proposal still stands once the erasure has committed, so the run again closes it.
            await discard_spielbestaetigung(
                spielbestaetigung_id=ROW1,
                spielbestaetigungen_collection=stand_in,
                spiele_collection=database[Collection.SPIELE],
                saison_teams_collection=database[Collection.SAISON_TEAMS],
                outbox_collection=database[Collection.OUTBOX],
                db=client,
                now=NOW,
            )
            confirmations.assert_landed_inside(serially=0)
            told = await database[Collection.OUTBOX].find({"kind": "spiel_vorschlag_discarded"}, {"to": 1, "_id": 0}).to_list()

            return (await row_now(database, ROW1))["closed"], sorted(mail["to"] for mail in told)

        closed, told = on_a_spiel(mongo_replica_set_url, body)

        assert closed == {"reason": "discarded"}
        assert told == sorted(address(TEAM1, seat) for seat in KONTAKT_ROLLEN if seat != "ansprechperson")


# --- A REFEREE'S OWN ROWS: the referee's answer, signed in on the person lane.

OTTO = "otto@example.com"
# A second referee, booked nowhere, so whatever row they reach is somebody else's.
UTE = ObjectId("6890a1b2c3d4e5f607d50042")
UTE_ADDRESS = "ute@example.com"
REFEREE_ROW = ObjectId("6890a1b2c3d4e5f607d50061")
NO_SUCH_ROW = ObjectId("6890a1b2c3d4e5f607d50069")
DECLINE_REASON = "An dem Abend habe ich Prüfungen"

# After the club rows' deadline and before the fixture's day: a club's answer is late here, a referee's is not.
PAST_THE_DEADLINE = "2126-05-10"
# The fixture's own evening, two hours after its kick-off.
REPORTED_THAT_EVENING = datetime.combine(date.fromisoformat(DATE), time(20, 30), tzinfo=clock.GERMANY)

# A knockout pair beside the fixture: the quarter-final is played and its winner not yet carried into the semi-final, so a
# resolution of the season would write the semi-final.
VIERTELFINALE = ObjectId("6890a1b2c3d4e5f607d50014")
HALBFINALE = ObjectId("6890a1b2c3d4e5f607d50015")
DUE_RESOLUTION = [
    spiel(
        VIERTELFINALE,
        spiel_nr=21,
        saison_phase="viertelfinale",
        schiedsrichter=None,
        ergebnis="2:1",
        team1={**side(TEAM1), "tore": 2},
        team2={**side(TEAM2), "tore": 1},
    ),
    spiel(
        HALBFINALE,
        spiel_nr=22,
        saison_phase="halbfinale",
        schiedsrichter=None,
        team1=None,
        team1_quelle={"type": "spiel", "spiel_nr": 21, "ausgang": "sieger"},
    ),
]


def confirmed_consent() -> dict[str, Any]:
    return documents.own_einwilligung_document(text_versions=documents.SCHIEDSRICHTER_TEXT_VERSIONS, confirmed_at="2126-04-01")


def referee_row(row_id: ObjectId = REFEREE_ROW, *, schiedsrichter_id: ObjectId = SCHIEDSRICHTER, **fields: Any) -> dict[str, Any]:
    """The open, mailed row the pass minted for the fixture's referee about `spiel()`'s Ansetzung."""

    return documents.spielbestaetigung_document(
        spiel(),
        party={"kind": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id},
        _id=row_id,
        deadline=DEADLINE,
        asked_at=TODAY,
        **fields,
    )


def on_a_refereed_spiel(url: str, body: Body, *, rows: list[dict[str, Any]] | None = None, spiele: Sequence[dict[str, Any]] = ()) -> Any:
    """`on_a_spiel` with its referee confirmed, Ute confirmed and booked nowhere, and the referee's row beside the clubs'."""

    async def seeded(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": {"einwilligung": confirmed_consent()}})
        await database[Collection.SCHIEDSRICHTER].insert_one(
            documents.schiedsrichter_document(UTE, email=UTE_ADDRESS, name="Ute Lang", default_payment=20, einwilligung=confirmed_consent())
        )
        if spiele:
            await database[Collection.SPIELE].insert_many(list(spiele))

        return await body(database, client)

    return on_a_spiel(url, seeded, rows=rows if rows is not None else [confirmation(ROW1, TEAM1), confirmation(ROW2, TEAM2), referee_row()])


async def einsatz_answer(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    row_id: ObjectId = REFEREE_ROW,
    *,
    answer: str = "agreed",
    reason: str | None = None,
    identifier: str = OTTO,
    now: datetime = NOW,
    spielbestaetigungen: Any = None,
) -> FLSpielbestaetigungSchiedsrichterAnswerResponse:
    return await post_schiedsrichter_answer(
        spielbestaetigung_id=row_id,
        answer_data=FLSpielbestaetigungSchiedsrichterAnswerPayload.model_validate({"answer": answer, "reason": reason}),
        identifier=identifier,
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        records=record_collections(database),
        db=client,
        now=now,
    )


async def decline_as_referee(database: AsyncDatabase, client: AsyncMongoClient, **kwargs: Any) -> Any:
    return await einsatz_answer(database, client, answer="declined", reason=DECLINE_REASON, **kwargs)


async def spiel_now(database: AsyncDatabase, spiel_id: ObjectId = SPIEL) -> Mapping[str, Any]:
    stored = await database[Collection.SPIELE].find_one({"_id": spiel_id})
    assert stored is not None

    return stored


class TestARefereesDeclineReturnsTheSpiel:
    def test_the_slot_alone_empties_and_the_season_is_resolved_by_nobody(self, mongo_replica_set_url: str):
        """The semi-final's due winner is the case: a decline running the season's resolution would write it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await spiel_now(database)
            await decline_as_referee(database, client)
            after, halbfinale = await spiel_now(database), await spiel_now(database, HALBFINALE)

            # The premise: the resolution is due, so a decline that ran it would have filled the semi-final.
            async def resolve(session: Any) -> Any:
                rules = FLSaisonRules.model_validate(documents.rules_document())
                return await advance_bracket_winners(database[Collection.SPIELE], database[Collection.TEAMS], SAISON_ID, rules, session)

            async with client.start_session() as session:
                await session.with_transaction(resolve)

            return (
                before,
                after,
                halbfinale,
                await spiel_now(database, HALBFINALE),
                await row_now(database, REFEREE_ROW),
                await acts_of(database),
            )

        before, after, halbfinale, resolved, row, acts = on_a_refereed_spiel(mongo_replica_set_url, body, spiele=DUE_RESOLUTION)

        assert acts == [("spielbestaetigung.answered", "schiedsrichter", None, REFEREE_ROW)]
        # Seeded without a version, so the one write leaves it at 1.
        assert after == {**before, "schiedsrichter": None, "version": 1}
        assert halbfinale["team1"] is None and resolved["team1"]["team_id"] == TEAM1
        assert row["answer"] == {
            "kind": "declined",
            "at": TODAY,
            "by": {"kind": "schiedsrichter"},
            "vorschlag": None,
            "reason": DECLINE_REASON,
        }
        assert row["closed"] == {"reason": "schiedsrichter_declined"}

    def test_booking_the_same_referee_again_leaves_them_unheld(self, mongo_replica_set_url: str):
        """Held, the declined row would keep the next pass from asking them about the booking at all."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_referee(database, client)
            await database[Collection.SPIELE].update_one(
                {"_id": SPIEL}, {"$set": {"schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "payment": 20}}}
            )

            return await database[Collection.SPIELBESTAETIGUNGEN].count_documents(
                {**build_held_filter(saison_id=SAISON_ID, spiel_ids=[SPIEL]), "party.kind": "schiedsrichter"}
            )

        assert on_a_refereed_spiel(mongo_replica_set_url, body) == 0


async def book_ute(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter": {"schiedsrichter_id": UTE, "payment": 20}}})


class TestAReassignmentLandingMidAnswer:
    def test_an_acceptance_is_refused_on_the_re_read(self, mongo_replica_set_url: str):
        """The acceptance writes no fixture, so the reassignment raises no conflict: the re-read outside it alone refuses."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], lambda: book_ute(database))
            outcome = await outcome_of(einsatz_answer(database, client, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await row_now(database, REFEREE_ROW))["answer"], confirmations.passes

        assert on_a_refereed_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_CHANGED, None, 1)

    def test_a_decline_never_takes_the_new_referee_off(self, mongo_replica_set_url: str):
        """The decline writes the fixture the reassignment wrote, so it is retried and judged afresh rather than emptying Ute's slot."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], lambda: book_ute(database))
            outcome = await outcome_of(decline_as_referee(database, client, spielbestaetigungen=confirmations))
            confirmations.assert_landed_inside(serially=0)

            return outcome, (await spiel_now(database))["schiedsrichter"]["schiedsrichter_id"], await row_now(database, REFEREE_ROW)

        outcome, booked, row = on_a_refereed_spiel(mongo_replica_set_url, body)

        assert (outcome, booked) == (Code.ANSETZUNG_CHANGED, UTE)
        assert (row["answer"], row["closed"]) == (None, None)


async def save(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    loaded: Mapping[str, Any],
    *,
    spiele: Any = None,
    dry_run: bool = False,
    **overrides: Any,
) -> Any:
    """The administrator's save from an editor that loaded `loaded`, changing what `overrides` names, or its dry run."""

    return await patch_spiel(
        spiel_id=SPIEL,
        spiel_data=FLPatchSpielDataPayload.model_validate(spiel_patch_body(loaded, **overrides)),
        db=client,
        spiele_collection=either(database, Collection.SPIELE, spiele),
        teams_collection=database[Collection.TEAMS],
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        spieltage_collection=database[Collection.SPIELTAGE],
        spielorte_collection=database[Collection.SPIELORTE],
        schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
        spielberichte_collection=database[Collection.SPIELBERICHTE],
        aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        now=NOW,
        dry_run=dry_run,
    )


class TestASaveFromAnEditorOpenedBeforeTheDecline:
    """`version_stale`: the decline raises the fixture's version, so a wholesale save from before it never books a decliner again unasked."""

    def test_a_save_keeping_the_referee_who_declined_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            loaded = await spiel_now(database)
            await decline_as_referee(database, client)
            outcome = await outcome_of(save(database, client, loaded, note="Halle umgebucht"))

            return outcome, await spiel_now(database)

        outcome, stored = on_a_refereed_spiel(mongo_replica_set_url, body)

        assert (outcome, stored["schiedsrichter"], stored["note"]) == (Code.VERSION_STALE, None, "Flutlicht")


# As the dry run serves each party: by the name its own record holds, a club's season row and a referee's.
CLUB1, CLUB2, OTTOS = (
    {"kind": "team", "team_id": str(TEAM1), "name": "Adler"},
    {"kind": "team", "team_id": str(TEAM2), "name": "Biber"},
    {"kind": "schiedsrichter", "schiedsrichter_id": str(SCHIEDSRICHTER), "name": REFEREE},
)


class TestTheDryRunNamesWhomTheSaveHasThePassMail:
    """The match editor's warning reads the dry run's `recipients`: a copy of the pass's rules on the page would drift from them."""

    @pytest.mark.parametrize(
        ("overrides", "told"),
        [
            pytest.param({"time": "19:30:00"}, [CLUB1, CLUB2, OTTOS], id="a-move-tells-every-party-asked"),
            pytest.param({"schiedsrichter": None}, [OTTOS], id="the-referee-taken-off-is-told-alone"),
            pytest.param({"note": "Halle umgebucht"}, [], id="a-note-tells-nobody"),
            pytest.param({"sonderereignis": "ausgefallen"}, [CLUB1, CLUB2, OTTOS], id="a-call-off-tells-every-party-asked"),
        ],
    )
    def test_the_dry_run_names_the_parties_the_pass_tells(
        self, mongo_replica_set_url: str, overrides: dict[str, Any], told: list[dict[str, Any]]
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            preview = await save(database, client, await spiel_now(database), dry_run=True, **overrides)

            return preview.recipients, (await spiel_now(database))["time"]

        recipients, time = on_a_refereed_spiel(mongo_replica_set_url, body)

        assert sorted((party.model_dump() for party in recipients), key=str) == sorted(told, key=str)
        assert time == TIME, "the dry run wrote the fixture"

    def test_a_party_no_read_of_the_editor_holds_is_named_by_its_own_record(self, mongo_replica_set_url: str):
        """A referee no list of the editor holds is still named in the question naming the save's mails.

        The harm: a referee retired since their booking, taken off by this save, mailed that their Einteilung is lifted and
        left out of that question.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": {"inactive_since": "2126-04-20"}})
            preview = await save(database, client, await spiel_now(database), dry_run=True, schiedsrichter=None)

            return preview.recipients

        assert [party.model_dump() for party in on_a_refereed_spiel(mongo_replica_set_url, body)] == [OTTOS]


class TestARowAnswersOnlyToItsOwnReferee:
    """`role_not_held` and `ansetzung_foreign_row` apart: holding no referee Funktion, and holding one this row does not name."""

    @pytest.mark.parametrize(
        ("identifier", "row_id"),
        [
            pytest.param(UTE_ADDRESS, REFEREE_ROW, id="another referee's row"),
            pytest.param(OTTO, NO_SUCH_ROW, id="an id naming no row"),
            pytest.param(OTTO, ROW1, id="a club's row"),
        ],
    )
    def test_a_row_naming_none_of_the_addresss_records_is_refused(self, mongo_replica_set_url: str, identifier: str, row_id: ObjectId):
        """Every row compared whole, the one the press named among them: watching one row alone would miss a write to another."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            before = await confirmations.find().sort("_id", 1).to_list(length=None)
            outcome = await outcome_of(einsatz_answer(database, client, row_id, identifier=identifier))

            return outcome, await confirmations.find().sort("_id", 1).to_list(length=None) == before

        assert on_a_refereed_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_FOREIGN_ROW, True)

    def test_a_row_of_a_season_ended_since_is_refused_as_none_of_theirs(self, mongo_replica_set_url: str):
        """The panel lists the active seasons' rows alone: answered, a decline would empty a slot of the archive."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})
            outcome = await outcome_of(decline_as_referee(database, client))

            return outcome, (await row_now(database, REFEREE_ROW))["answer"], (await spiel_now(database))["schiedsrichter"] is not None

        assert on_a_refereed_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_FOREIGN_ROW, None, True)

    @pytest.mark.parametrize(
        "record",
        [
            pytest.param({"einwilligung": None}, id="their record unconfirmed"),
            pytest.param({"inactive_since": "2126-04-20"}, id="their record retired"),
        ],
    )
    def test_the_referee_named_holding_no_role_is_refused_first(self, mongo_replica_set_url: str, record: dict[str, Any]):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": record})
            outcome = await outcome_of(einsatz_answer(database, client))

            return outcome, (await row_now(database, REFEREE_ROW))["answer"]

        assert on_a_refereed_spiel(mongo_replica_set_url, body) == (Code.ROLE_NOT_HELD, None)


class TestARowAnswersOnlyToItsOwnClubsSeats:
    """`ansetzung_foreign_row`, one answer whether the id names no row or a row the signed-in person holds no seat on."""

    @pytest.mark.parametrize(
        ("who", "row_id", "unconfirmed"),
        [
            pytest.param(holder(TEAM2, "trainer"), ROW1, False, id="the other club's row"),
            pytest.param(holder(TEAM1, "trainer"), NO_SUCH_ROW, False, id="an id naming no row"),
            pytest.param(holder(TEAM1, "trainer"), REFEREE_ROW, False, id="the referee's row"),
            pytest.param(holder(TEAM1, "trainer"), ROW1, True, id="their own club's row from a seat they never confirmed"),
        ],
    )
    def test_a_row_of_no_seat_the_person_holds_is_refused_and_nothing_written(
        self, mongo_replica_set_url: str, who: tuple[ObjectId, str], row_id: ObjectId, unconfirmed: bool
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if unconfirmed:
                await database[Collection.SAISON_TEAMS].update_one(
                    {"team_id": TEAM1}, {"$set": {"kontakte.trainer.einwilligung.confirmed_at": None}}
                )
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            before = await confirmations.find().sort("_id", 1).to_list(length=None)
            outcome = await outcome_of(press_answer(database, client, who, row_id=row_id))

            return outcome, await confirmations.find().sort("_id", 1).to_list(length=None) == before

        rows = [confirmation(ROW1, TEAM1), confirmation(ROW2, TEAM2), referee_row()]

        assert on_a_spiel(mongo_replica_set_url, body, rows=rows) == (Code.ANSETZUNG_FOREIGN_ROW, True)


class TestARefereeAnswersUntilTheKickOffNotTheDeadline:
    """The Einteilung names no deadline: a club row of the same fixture is late where the referee's is not."""

    def test_past_the_rows_deadline_the_referee_still_answers(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await einsatz_answer(database, client, now=noon(PAST_THE_DEADLINE))
            # The control: the club's row, the same deadline stored, refuses on the same day.
            club = await outcome_of(press_answer(database, client, holder(TEAM1, "trainer"), now=noon(PAST_THE_DEADLINE)))

            return (await row_now(database, REFEREE_ROW))["answer"]["kind"], club

        assert on_a_refereed_spiel(mongo_replica_set_url, body) == ("agreed", Code.ANSETZUNG_DEADLINE_PAST)

    def test_a_decline_once_the_match_was_played_and_reported_is_refused_and_keeps_the_booking(self, mongo_replica_set_url: str):
        """Taken, it would empty the slot of the match just played, its report standing with nobody booked to have written it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBERICHTE].insert_one(documents.spielbericht_document(spiel()))
            outcome = await outcome_of(decline_as_referee(database, client, now=REPORTED_THAT_EVENING))

            return outcome, (await spiel_now(database))["schiedsrichter"], (await row_now(database, REFEREE_ROW))["answer"]

        outcome, booked, answer = on_a_refereed_spiel(mongo_replica_set_url, body)

        assert outcome == Code.ANSETZUNG_DEADLINE_PAST
        assert (booked["schiedsrichter_id"], answer) == (SCHIEDSRICHTER, None)
