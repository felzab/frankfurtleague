"""
API · a fixture's confirmation, answered by a club's seat holder signed in and by its referee, against the shipped indexes

The club's answer writes the row alone: the seat that pressed, the proposal judged as the administrator's save of that
date is judged, and nothing of the fixture.
"""

from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import date, datetime, time
from http import HTTPStatus
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.saisons.admin_router import get_saison_overview
from app.api.saisons.overview import FLOverviewSpielbestaetigungRow, FLOverviewVorschlagRow
from app.api.saisons.schemas import FLSaisonRules
from app.api.spielbestaetigungen.admin_router import (
    adopt_spielbestaetigung,
    discard_spielbestaetigung,
    enter_spielbestaetigung,
)
from app.api.spielbestaetigungen.person_router import post_schiedsrichter_answer, post_team_answer
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungEnterPayload,
    FLSpielbestaetigungSchiedsrichterAnswerPayload,
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
from app.core.exceptions import APIError, Subject
from app.shared.schemas.literals import KONTAKT_SEATS
from tests import documents
from tests.acts import acts_of
from tests.database import a_clean_database
from tests.erasure import erased
from tests.isolation import COMMITTED, InterleavedCollection, Rival, outcome_of
from tests.outbox import MAIL_NOW
from tests.payloads import spiel_patch_body
from tests.records import record_collections
from tests.stored import the_row
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


async def on_a_spiel(url: str, body: Body, *, rows: list[dict[str, Any]] | None = None) -> Any:
    """The running season, its two clubs with three seats each, the fixture, its ground and referee, and one open row per club."""

    async with a_clean_database(url, DATABASE_NAME) as (client, database):
        await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
        for team_id, (name, shorthand) in NAMES.items():
            await database[Collection.TEAMS].insert_one(documents.team_document(team_id, name, shorthand))
            await database[Collection.SAISON_TEAMS].insert_one(junction(team_id))
        await database[Collection.SPIELTAGE].insert_one(documents.spieltag_document(SPIELTAG, SAISON_ID, 1, start=SPAN[0], end=SPAN[1]))
        await database[Collection.SPIELORTE].insert_one(documents.spielort_document(SPIELORT, "Halle Ost", default_mietpreis=40))
        await database[Collection.SCHIEDSRICHTER].insert_one(
            documents.schiedsrichter_document(SCHIEDSRICHTER, email="otto@example.com", name=REFEREE, default_payment=20, einwilligung=None)
        )
        await database[Collection.SPIELE].insert_one(spiel())
        await database[Collection.SPIELBESTAETIGUNGEN].insert_many(
            rows if rows is not None else [confirmation(ROW1, TEAM1), confirmation(ROW2, TEAM2)]
        )

        return await body(database, client)


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
) -> None:
    """`who`'s answer, signed in at their own address, to their club's row or to `row_id`."""

    team_id, seat = who
    body = {
        "answer": answer,
        "vorschlag": None if vorschlag is None else {"date": vorschlag[0], "time": vorschlag[1]},
        "reason": reason,
    }

    await post_team_answer(
        spielbestaetigung_id=ROW_OF[team_id] if row_id is None else row_id,
        answer_data=FLSpielbestaetigungTeamAnswerPayload.model_validate(body),
        identifier=address(team_id, seat),
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=either(database, Collection.SPIELE, spiele),
        saison_teams_collection=either(database, Collection.SAISON_TEAMS, saison_teams),
        spieltage_collection=either(database, Collection.SPIELTAGE, spieltage),
        records=record_collections(database),
        db=client,
        germany_now=now,
    )


async def decline_as_team(
    database: AsyncDatabase, client: AsyncMongoClient, who: tuple[ObjectId, str], vorschlag: tuple[str, str], **kwargs: Any
) -> None:
    await press_answer(database, client, who, answer="declined", vorschlag=vorschlag, **kwargs)


async def row_now(database: AsyncDatabase, row_id: ObjectId) -> Mapping[str, Any]:
    return await the_row(database, Collection.SPIELBESTAETIGUNGEN, {"_id": row_id})


class TestTheSeatTheAnswerRecords:
    async def test_the_stellvertretung_answers_and_the_trainers_press_then_finds_it_answered(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await press_answer(database, client, holder(TEAM1, "stellvertretung"))
            second = await outcome_of(press_answer(database, client, holder(TEAM1, "trainer")))

            return second, await row_now(database, ROW1), await row_now(database, ROW2)

        second, row, other = await on_a_spiel(mongo_replica_set_url, body)

        assert row["answer"] == {
            "kind": "agreed",
            "at": TODAY,
            "by": {"kind": "kontakt", "seat": "stellvertretung"},
            "vorschlag": None,
            "reason": None,
        }
        assert second == Code.ANSETZUNG_UNANSWERABLE
        # The other club's row is its own question.
        assert other["answer"] is None


class TestAProposalIsJudgedWhereTheAdminIsJudged:
    """The administrator's three judges, each through the route, each fault on the proposal's own box."""

    @pytest.mark.parametrize(
        ("vorschlag", "neighbour", "austritt", "faults"),
        [
            pytest.param(
                ("2126-05-20", "18:00:00"), None, None, [(Code.SPIEL_OUTSIDE_SPIELTAG, ("vorschlag", "date"))], id="outside-the-matchday"
            ),
            # Four hours apart is the buffer; two is inside it, on the referee's other booking.
            pytest.param(
                ("2126-05-15", "20:00:00"),
                ("2126-05-15", "18:00:00"),
                None,
                [(Code.SPIEL_DOUBLE_BOOKED, ("vorschlag", "time"))],
                id="beside-the-referees-other-fixture",
            ),
            pytest.param(
                ("2126-05-15", "18:00:00"), None, "2126-05-15", [(Code.ELIGIBILITY_DISQUALIFIED, ("vorschlag", "date"))], id="on-a-clubs-exit"
            ),
            # Two judges at once, so an answer naming the first alone leaves the hour for a later press.
            pytest.param(
                ("2126-05-20", "20:00:00"),
                ("2126-05-20", "18:00:00"),
                None,
                [(Code.SPIEL_OUTSIDE_SPIELTAG, ("vorschlag", "date")), (Code.SPIEL_DOUBLE_BOOKED, ("vorschlag", "time"))],
                id="outside-the-matchday-and-beside-another-fixture",
            ),
        ],
    )
    async def test_a_refused_proposal_writes_no_row_and_no_span(
        self,
        mongo_replica_set_url: str,
        vorschlag: tuple[str, str],
        neighbour: tuple[str, str] | None,
        austritt: str | None,
        faults: list[tuple[str, tuple[str, ...]]],
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            if neighbour is not None:
                await database[Collection.SPIELE].insert_one(
                    spiel(NEIGHBOUR, spiel_nr=2, date=neighbour[0], time=neighbour[1], spielort=None, team1=None, team2=None)
                )
            if austritt is not None:
                exit_record = {"type": "rueckzug", "reason": "Schule zieht zurück", "date": austritt}
                await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM2}, {"$set": {"austritt": exit_record}})

            with pytest.raises(APIError) as refused:
                await decline_as_team(database, client, holder(TEAM1, "trainer"), vorschlag)

            return refused.value, await row_now(database, ROW1), await database[Collection.SPIELTAGE].find_one({"_id": SPIELTAG})

        refused, row, spieltag = await on_a_spiel(mongo_replica_set_url, body)

        # On the boxes the club typed, never as a gate naming none.
        assert [(fault.code, fault.path) for fault in refused.faults] == faults
        assert row["answer"] is None
        assert (spieltag["start"], spieltag["end"]) == SPAN

    async def test_a_day_gone_by_and_outside_the_matchday_are_named_in_one_answer(self, mongo_replica_set_url: str):
        """The proposal's own rule and the save's beside it: 409, as the matchday's span is stored data."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> APIError:
            with pytest.raises(APIError) as refused:
                await decline_as_team(database, client, holder(TEAM1, "trainer"), ("2126-04-20", "18:00:00"))

            return refused.value

        refused = await on_a_spiel(mongo_replica_set_url, body)

        assert (refused.status_code, [(fault.code, fault.path, dict(fault.bounds)) for fault in refused.faults]) == (
            HTTPStatus.CONFLICT,
            [
                (Code.ANSETZUNG_VORSCHLAG_PAST, ("vorschlag", "date"), {"earliest": TODAY}),
                (Code.SPIEL_OUTSIDE_SPIELTAG, ("vorschlag", "date"), {"earliest": SPAN[0]}),
            ],
        )


class ConfirmationsRunningARivalBeforeTheWrite(InterleavedCollection):
    """The confirmations the answer writes, a rival run once after the answer's judgement and before its write."""

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.find_one_and_update(*args, **kwargs)


async def move_the_kick_off(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"time": "19:30:00"}})


# A change no answer is judged on, so the fixture's save takes it whichever order the two commit in.
MOVED_NOTE = "Halle umgebucht"


async def inside_a_fixture_save(database: AsyncDatabase, client: AsyncMongoClient, write: Rival) -> tuple[str, tuple[str, int]]:
    """`write` landing after a fixture save's reads and ahead of its write of the fixture: the save's outcome, its note and version raise."""

    loaded = await spiel_now(database)
    spiele = InterleavedCollection(database[Collection.SPIELE], write, before="find_one_and_update")
    outcome = await outcome_of(save(database, client, loaded, spiele=spiele, note=MOVED_NOTE))
    stored = await spiel_now(database)

    return outcome, (stored["note"], stored["version"] - loaded.get("version", 0))


class TestATeamsAnswerAndAFixtureSaveCrossing:
    """The answer anchors the fixture it judged, so a fixture's save landing either side of it conflicts with it."""

    async def test_a_move_inside_the_answer_refuses_it_and_writes_nothing(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = ConfirmationsRunningARivalBeforeTheWrite(
                database[Collection.SPIELBESTAETIGUNGEN], lambda: move_the_kick_off(database)
            )
            outcome = await outcome_of(press_answer(database, client, holder(TEAM1, "trainer"), spielbestaetigungen=confirmations))

            return outcome, (await row_now(database, ROW1))["answer"]

        assert await on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_UNANSWERABLE, None)

    async def test_an_answer_inside_a_fixture_save_leaves_it_committing_on_the_version_its_form_read(self, mongo_replica_set_url: str):
        """The save meets the answer's anchor and runs again, and the anchor moved no `version` for it to be refused on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await inside_a_fixture_save(database, client, lambda: press_answer(database, client, holder(TEAM1, "trainer")))

            return saved, (await row_now(database, ROW1))["answer"]["kind"]

        assert await on_a_spiel(mongo_replica_set_url, body) == ((COMMITTED, (MOVED_NOTE, 1)), "agreed")


# A decline every rival below turns into a refusal: inside the matchday, clear of the referee's other bookings, on a day
# both clubs still play.
PROPOSAL = ("2126-05-15", "18:00:00")
REASON = "Leider hat Zora an dem Tag Prüfungen"


async def narrow_the_matchday(database: AsyncDatabase) -> None:
    await database[Collection.SPIELTAGE].update_one({"_id": SPIELTAG}, {"$set": {"end": "2126-05-14"}})


# A write after which the pass's next close shuts the fixture's rows, though it closes none itself: a page read before
# it still offers an act on an open row.
async def let_the_opponent_leave_by_the_match_day(database: AsyncDatabase, _: AsyncMongoClient) -> None:
    exit_record = {"type": "rueckzug", "reason": "Schule zieht zurück", "date": DATE}
    await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM2}, {"$set": {"austritt": exit_record}})


class TestAProposalOfAPastDayIsRefusedThroughTheRoute:
    async def test_yesterday_inside_the_matchday_writes_nothing(self, mongo_replica_set_url: str):
        """A deadline of today, as a fixture inside the notice period is minted with.

        The matchday's span admits yesterday, so this rule alone refuses it.
        """

        today = "2126-05-12"

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            outcome = await outcome_of(decline_as_team(database, client, holder(TEAM1, "trainer"), ("2126-05-11", "18:00:00"), now=noon(today)))

            return outcome, await row_now(database, ROW1)

        outcome, row = await on_a_spiel(
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
        germany_now=NOW,
    )


async def discard_row(
    database: AsyncDatabase, client: AsyncMongoClient, row_id: ObjectId, *, spielbestaetigungen: Any = None, spiele: Any = None
) -> None:
    return await discard_spielbestaetigung(
        spielbestaetigung_id=row_id,
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=either(database, Collection.SPIELE, spiele),
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        outbox_collection=database[Collection.OUTBOX],
        db=client,
        germany_now=NOW,
    )


class TestTheAdministratorsZusage:
    async def test_it_names_nobody_and_a_seats_press_after_it_finds_the_row_answered(self, mongo_replica_set_url: str):
        """Key for key: a seat or a holder on it would let a person's erasure reach the league's reason."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await enter(database, client, ROW1)
            pressed = await outcome_of(press_answer(database, client, holder(TEAM1, "trainer")))

            return (await row_now(database, ROW1))["answer"], pressed

        stored, pressed = await on_a_spiel(mongo_replica_set_url, body)

        expected = {"kind": "agreed", "at": TODAY, "by": {"kind": "admin"}, "vorschlag": None, "reason": SETTLE_REASON}
        assert stored == expected
        assert pressed == Code.ANSETZUNG_UNANSWERABLE

    async def test_a_settle_after_a_seats_answer_is_refused_and_the_seats_answer_stands(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await press_answer(database, client, holder(TEAM1, "stellvertretung"))
            outcome = await outcome_of(enter(database, client, ROW1))

            return outcome, (await row_now(database, ROW1))["answer"]["by"]

        assert await on_a_spiel(mongo_replica_set_url, body) == (
            Code.ANSETZUNG_NOT_ACTIONABLE,
            {"kind": "kontakt", "seat": "stellvertretung"},
        )

    async def test_a_move_landing_inside_the_settle_refuses_it(self, mongo_replica_set_url: str):
        """The settle anchors the fixture it judged, so the move conflicts with it and the retry refuses."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = ConfirmationsRunningARivalBeforeTheWrite(
                database[Collection.SPIELBESTAETIGUNGEN], lambda: move_the_kick_off(database)
            )
            outcome = await outcome_of(enter(database, client, ROW1, spielbestaetigungen=confirmations))

            return outcome, (await row_now(database, ROW1))["answer"]

        assert await on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_NOT_ACTIONABLE, None)

    async def test_a_settle_inside_a_fixture_save_leaves_it_committing_on_the_version_its_form_read(self, mongo_replica_set_url: str):
        """The save meets the settle's anchor and runs again, and the anchor moved no `version` for it to be refused on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await inside_a_fixture_save(database, client, lambda: enter(database, client, ROW1))

            return saved, (await row_now(database, ROW1))["answer"]["by"]

        assert await on_a_spiel(mongo_replica_set_url, body) == ((COMMITTED, (MOVED_NOTE, 1)), {"kind": "admin"})


# The same day an hour later: a move the save takes.
MOVED_TO = "19:30:00"


async def move_the_match(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await save(database, client, await spiel_now(database), time=MOVED_TO)


class TestTheDiscard:
    async def test_it_closes_the_decline_and_leaves_the_teams_answer_as_given(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_team(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)
            declined = (await row_now(database, ROW1))["answer"]
            await discard_row(database, client, ROW1)
            owed = await database[Collection.OUTBOX].find({}, {"to": 1, "kind": 1, "reference": 1, "_id": 0}).to_list()

            return declined, await row_now(database, ROW1), owed

        declined, row, owed = await on_a_spiel(mongo_replica_set_url, body)

        assert (row["answer"], row["closed"]) == (declined, {"reason": "discarded"})
        # Owed the club in the discard's own transaction, the fixture's day being to come: every address its seats hold.
        assert sorted((mail["to"], mail["kind"], mail["reference"]["seat"]) for mail in owed) == sorted(
            (address(TEAM1, seat), "spiel_vorschlag_discarded", seat) for seat in KONTAKT_SEATS
        )

    async def test_a_save_landing_inside_the_discard_refuses_it_and_tells_the_team_nothing(self, mongo_replica_set_url: str):
        """Both committing, the club would be told the date stands for a slot the match has left.

        The discard writes the fixture it judges, as the save does, so the two conflict and the retry refuses.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_team(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)
            # Ahead of the discard's write of the fixture, the latest point a save can commit ahead of it.
            fixtures = InterleavedCollection(database[Collection.SPIELE], lambda: move_the_match(database, client), before="update_many")
            outcome = await outcome_of(discard_row(database, client, ROW1, spiele=fixtures))
            told = await database[Collection.OUTBOX].count_documents({"kind": "spiel_vorschlag_discarded"})

            return outcome, (await row_now(database, ROW1))["closed"], told

        assert await on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_NOT_ACTIONABLE, None, 0)

    async def test_a_discard_landing_inside_a_save_leaves_the_save_committing_on_the_version_its_form_read(self, mongo_replica_set_url: str):
        """The club is told the date stands as it did at the discard's commit; the save meets the discard's write and runs again.

        The discard's write moves no `version`, so the form read before it saves.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_team(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)
            loaded = await spiel_now(database)

            async def discard() -> None:
                await discard_row(database, client, ROW1)

            # After the save's reads and ahead of its write of the fixture.
            fixtures = InterleavedCollection(database[Collection.SPIELE], discard, before="find_one_and_update")
            outcome = await outcome_of(save(database, client, loaded, spiele=fixtures, time=MOVED_TO))
            stored = await spiel_now(database)
            told = await database[Collection.OUTBOX].count_documents({"kind": "spiel_vorschlag_discarded"})

            return outcome, (stored["time"], stored["version"]), (await row_now(database, ROW1))["closed"], told

        outcome, stored, closed, told = await on_a_spiel(mongo_replica_set_url, body)

        # The save's own raise alone.
        assert (outcome, stored) == (COMMITTED, (MOVED_TO, 1))
        assert (closed, told) == ({"reason": "discarded"}, len(KONTAKT_SEATS))


async def adopt(database: AsyncDatabase, client: AsyncMongoClient, row_id: ObjectId, *, spiele: Any = None, today: str = TODAY) -> None:
    return await adopt_spielbestaetigung(
        spielbestaetigung_id=row_id,
        spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
        spiele_collection=either(database, Collection.SPIELE, spiele),
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
        germany_now=MAIL_NOW,
    )


class TestTheAdoption:
    async def test_the_spiel_moves_to_the_proposal_and_the_row_reads_the_ansetzung_left(self, mongo_replica_set_url: str):
        """Adopted, a fixture left at the slot its club declined would ask every party about a date the league gave up."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_team(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)
            await adopt(database, client, ROW1)
            spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})
            again = await outcome_of(adopt(database, client, ROW1))

            assert spiel is not None
            return (spiel["date"], spiel["time"]), (await row_now(database, ROW1))["closed"], again

        moved_to, closed, again = await on_a_spiel(mongo_replica_set_url, body)

        assert moved_to == PROPOSAL
        # Left for the pass to close, which tells every party of the move alike; a second adoption finds the proposal spent.
        assert (closed, again) == (None, Code.ANSETZUNG_NOT_ACTIONABLE)

    async def test_a_discard_landing_inside_the_adoption_leaves_the_spiel_where_it_stands(self, mongo_replica_set_url: str):
        """Both committing, the club would be told the date stands and every party asked about the date its proposal named.

        The discard anchors the fixture the adoption's save writes, so the two conflict and the retry finds the proposal spent.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_team(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)

            async def discard() -> None:
                await discard_row(database, client, ROW1)

            # After the adoption's reads and ahead of its save's write of the fixture.
            fixtures = InterleavedCollection(database[Collection.SPIELE], discard, before="find_one_and_update")
            outcome = await outcome_of(adopt(database, client, ROW1, spiele=fixtures))
            spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})

            assert spiel is not None
            return outcome, (spiel["date"], spiel["time"]), (await row_now(database, ROW1))["closed"]["reason"]

        outcome, slot, reason = await on_a_spiel(mongo_replica_set_url, body)

        assert (outcome, reason) == (Code.ANSETZUNG_NOT_ACTIONABLE, "discarded")
        assert slot != PROPOSAL

    async def test_a_proposal_against_a_team_gone_by_its_day_is_refused_before_the_pass_closes_it(self, mongo_replica_set_url: str):
        """Adopted, a match against a club gone by its day would be moved, its rows read as a move.

        Which rows the pass would close is held at the default tier; this holds that the adoption reads the clubs' exits.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Ahead of an exit on the match day, so the save's own eligibility check would take the move.
            await decline_as_team(database, client, holder(TEAM1, "trainer"), ("2126-05-12", "18:00:00"), reason=REASON)
            await let_the_opponent_leave_by_the_match_day(database, client)
            outcome = await outcome_of(adopt(database, client, ROW1))
            spiel = await spiel_now(database)

            return outcome, (spiel["date"], spiel["time"])

        assert await on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_NOT_ACTIONABLE, (DATE, TIME))

    @pytest.mark.parametrize(
        ("since", "today", "code", "subject"),
        [
            # The proposed day passing between the club's press and the administrator's.
            pytest.param(
                None,
                "2126-05-16",
                Code.ANSETZUNG_VORSCHLAG_PAST,
                Subject(path=("vorschlag", "date"), location="body", bounds={"earliest": "2126-05-16"}),
                id="the-proposed-day-gone-by",
            ),
            # The save's own refusal of the proposed day, past the narrowed matchday's end.
            pytest.param(
                narrow_the_matchday,
                TODAY,
                Code.SPIEL_OUTSIDE_SPIELTAG,
                Subject(path=("date",), location="body", bounds={"latest": "2126-05-14"}),
                id="the-save-refusing-the-day",
            ),
        ],
    )
    async def test_a_refused_adoption_keeps_the_path_and_bounds_its_judge_named_and_leaves_the_spiel_where_it_stands(
        self,
        mongo_replica_set_url: str,
        since: Callable[[AsyncDatabase], Awaitable[None]] | None,
        today: str,
        code: Code,
        subject: Subject,
    ):
        """Moved anyway, the fixture lands on a day gone by or outside its matchday.

        The path picks the status line's sentence where a code's sentence is keyed by it, and the 409 says the stored
        proposal moved since the page was read, the adoption posting no body a 422 could judge.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_team(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)
            if since is not None:
                await since(database)
            with pytest.raises(APIError) as refused:
                await adopt(database, client, ROW1, today=today)
            spiel = await database[Collection.SPIELE].find_one({"_id": SPIEL})

            assert spiel is not None
            return refused.value, (spiel["date"], spiel["time"])

        refusal, slot = await on_a_spiel(mongo_replica_set_url, body)

        assert (refusal.status_code, refusal.error_code, refusal.subject) == (HTTPStatus.CONFLICT, code, subject)
        assert slot == (DATE, TIME)


DECLINE = {
    "kind": "declined",
    "at": TODAY,
    "by": {"kind": "kontakt", "seat": "trainer"},
    "vorschlag": {"date": PROPOSAL[0], "time": PROPOSAL[1]},
    "reason": None,
}


class TestTheQueueListsASpielItsConfirmationsPutThere:
    """The fixture lacks nothing the other conditions list, so a confirmation is the only way onto the page."""

    @pytest.mark.parametrize(
        ("row1", "today"),
        [
            pytest.param({"answer": DECLINE}, TODAY, id="a-standing-proposal"),
            pytest.param({}, "2126-05-08", id="a-deadline-passed-unanswered"),
            pytest.param({"asked_at": DEADLINE}, DEADLINE, id="due-the-day-it-was-asked"),
            pytest.param({"asked_at": None}, DEADLINE, id="due-today-and-never-asked"),
        ],
    )
    async def test_the_spiel_is_listed_where_a_teams_row_asks_for_the_administrator(
        self, mongo_replica_set_url: str, row1: dict[str, Any], today: str
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
            overview = await get_saison_overview(
                saison_id=SAISON_ID,
                saisons_collection=database[Collection.SAISONS],
                spiele_collection=database[Collection.SPIELE],
                teams_collection=database[Collection.TEAMS],
                spielorte_collection=database[Collection.SPIELORTE],
                schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
                germany_now=noon(today),
            )

            return {
                row.spiel.id
                for card in overview.cards
                for row in card.rows
                if isinstance(row, FLOverviewSpielbestaetigungRow | FLOverviewVorschlagRow)
            }

        assert await on_a_spiel(mongo_replica_set_url, body, rows=rows) == {SPIEL}


# The answering Trainer's address, and the clock their erasure runs on.
IDA = "ida@example.com"
ERASED_AT = datetime(2126, 5, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))


class JunctionsRunningARivalBeforeTheAnchor(InterleavedCollection):
    """The season rows the answer anchors the seat it was judged from on, a rival run once ahead of that anchor."""

    async def update_many(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.update_many(*args, **kwargs)


class JunctionsRunningARivalBeforeTheClearing(InterleavedCollection):
    """The season rows an erasure empties its person's seats on, a rival run once ahead of the first of those writes."""

    async def find_one_and_update(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()
        return await self._collection.find_one_and_update(*args, **kwargs)


class TestAnAnswerAndItsWritersErasureCross:
    """The answer anchors the season row its seat was judged off, and the erasure empties that seat on it, so one retries.

    Without that conflict a reason stored under an erasure's snapshot would stand until the season's end.
    """

    async def test_an_erasure_landing_inside_the_answer_leaves_it_refused_and_nothing_stored(self, mongo_replica_set_url: str):
        """The answer run again finds the person holding no seat on the row's club."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def erase_the_trainer() -> None:
                await erased(database, client, IDA, germany_now=ERASED_AT)

            junctions = JunctionsRunningARivalBeforeTheAnchor(database[Collection.SAISON_TEAMS], erase_the_trainer)
            outcome = await outcome_of(
                decline_as_team(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON, saison_teams=junctions)
            )

            return outcome, (await row_now(database, ROW1))["answer"]

        assert await on_a_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_FOREIGN_ROW, None)

    async def test_an_answer_landing_inside_the_erasure_has_its_reason_taken(self, mongo_replica_set_url: str):
        """The erasure run again finds the reason the answer stored from the seat, and nulls it; the way and the seat stay."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def answer_as_the_trainer() -> None:
                await decline_as_team(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)

            junctions = JunctionsRunningARivalBeforeTheClearing(database[Collection.SAISON_TEAMS], answer_as_the_trainer)
            await erased(database, client, IDA, germany_now=ERASED_AT, saison_teams_collection=junctions)

            return await row_now(database, ROW1)

        row = await on_a_spiel(mongo_replica_set_url, body)

        assert (row["answer"]["kind"], row["answer"]["by"], row["answer"]["reason"]) == (
            "declined",
            {"kind": "kontakt", "seat": "trainer"},
            None,
        )


class TestADiscardAndASeatHoldersErasureCross:
    """The discard anchors the season row its mailboxes were read off, and the erasure empties a seat on it, so one retries.

    Without that conflict the discard's notice would go to the mailbox of a person who had just erased themselves.
    """

    async def test_an_erasure_landing_inside_the_discard_leaves_its_mailbox_untold(self, mongo_replica_set_url: str):
        """The Ansprechperson is erased between the discard's read of the seats and its write: the discard run again mails the rest."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_team(database, client, holder(TEAM1, "trainer"), PROPOSAL, reason=REASON)

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
                germany_now=NOW,
            )
            told = await database[Collection.OUTBOX].find({"kind": "spiel_vorschlag_discarded"}, {"to": 1, "_id": 0}).to_list()

            return (await row_now(database, ROW1))["closed"], sorted(mail["to"] for mail in told)

        closed, told = await on_a_spiel(mongo_replica_set_url, body)

        assert closed == {"reason": "discarded"}
        assert told == sorted(address(TEAM1, seat) for seat in KONTAKT_SEATS if seat != "ansprechperson")


# --- A REFEREE'S OWN ROWS: the referee's answer, signed in on the person lane.

OTTO = "otto@example.com"
# A second referee, booked nowhere, so whatever row they reach is somebody else's.
UTE = ObjectId("6890a1b2c3d4e5f607d50042")
UTE_ADDRESS = "ute@example.com"
REFEREE_ROW = ObjectId("6890a1b2c3d4e5f607d50061")
NO_SUCH_ROW = ObjectId("6890a1b2c3d4e5f607d50069")
DECLINE_REASON = "An dem Abend habe ich Prüfungen"

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


async def on_a_refereed_spiel(url: str, body: Body, *, rows: list[dict[str, Any]] | None = None, spiele: Sequence[dict[str, Any]] = ()) -> Any:
    """`on_a_spiel` with its referee confirmed, Ute confirmed and booked nowhere, and the referee's row beside the clubs'."""

    async def seeded(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": {"einwilligung": confirmed_consent()}})
        await database[Collection.SCHIEDSRICHTER].insert_one(
            documents.schiedsrichter_document(UTE, email=UTE_ADDRESS, name="Ute Lang", default_payment=20, einwilligung=confirmed_consent())
        )
        if spiele:
            await database[Collection.SPIELE].insert_many(list(spiele))

        return await body(database, client)

    return await on_a_spiel(
        url, seeded, rows=rows if rows is not None else [confirmation(ROW1, TEAM1), confirmation(ROW2, TEAM2), referee_row()]
    )


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
) -> None:
    await post_schiedsrichter_answer(
        spielbestaetigung_id=row_id,
        answer_data=FLSpielbestaetigungSchiedsrichterAnswerPayload.model_validate({"answer": answer, "reason": reason}),
        identifier=identifier,
        spielbestaetigungen_collection=either(database, Collection.SPIELBESTAETIGUNGEN, spielbestaetigungen),
        spiele_collection=database[Collection.SPIELE],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        records=record_collections(database),
        db=client,
        germany_now=now,
    )


async def decline_as_referee(database: AsyncDatabase, client: AsyncMongoClient, **kwargs: Any) -> Any:
    return await einsatz_answer(database, client, answer="declined", reason=DECLINE_REASON, **kwargs)


async def spiel_now(database: AsyncDatabase, spiel_id: ObjectId = SPIEL) -> Mapping[str, Any]:
    return await the_row(database, Collection.SPIELE, {"_id": spiel_id})


class TestARefereesDeclineReturnsTheSpiel:
    async def test_the_slot_alone_empties_and_the_season_is_resolved_by_nobody(self, mongo_replica_set_url: str):
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

        before, after, halbfinale, resolved, row, acts = await on_a_refereed_spiel(mongo_replica_set_url, body, spiele=DUE_RESOLUTION)

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

    async def test_booking_the_same_referee_again_leaves_them_unheld(self, mongo_replica_set_url: str):
        """Held, the declined row would keep the next pass from asking them about the booking at all."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await decline_as_referee(database, client)
            await database[Collection.SPIELE].update_one(
                {"_id": SPIEL}, {"$set": {"schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "payment": 20}}}
            )

            return await database[Collection.SPIELBESTAETIGUNGEN].count_documents(
                {**build_held_filter(saison_id=SAISON_ID, spiel_ids=[SPIEL]), "party.kind": "schiedsrichter"}
            )

        assert await on_a_refereed_spiel(mongo_replica_set_url, body) == 0


async def book_ute(database: AsyncDatabase) -> None:
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"schiedsrichter": {"schiedsrichter_id": UTE, "payment": 20}}})


class TestARefereesAnswerAndAFixtureSaveCrossing:
    """The acceptance anchors the fixture it judged, so a write to the fixture landing either side of it conflicts with it."""

    async def test_a_reassignment_inside_the_acceptance_refuses_it(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = ConfirmationsRunningARivalBeforeTheWrite(database[Collection.SPIELBESTAETIGUNGEN], lambda: book_ute(database))
            outcome = await outcome_of(einsatz_answer(database, client, spielbestaetigungen=confirmations))

            return outcome, (await row_now(database, REFEREE_ROW))["answer"]

        assert await on_a_refereed_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_UNANSWERABLE, None)

    async def test_an_acceptance_inside_a_fixture_save_leaves_it_committing_on_the_version_its_form_read(self, mongo_replica_set_url: str):
        """The save meets the acceptance's anchor and runs again, and the anchor moved no `version` for it to be refused on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await inside_a_fixture_save(database, client, lambda: einsatz_answer(database, client))

            return saved, (await row_now(database, REFEREE_ROW))["answer"]["kind"]

        assert await on_a_refereed_spiel(mongo_replica_set_url, body) == ((COMMITTED, (MOVED_NOTE, 1)), "agreed")


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

    async with client.start_session(snapshot=True) as session:
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
            germany_now=NOW,
            dry_run=dry_run,
            session=session,
        )


class TestASaveFromAnEditorOpenedBeforeTheDecline:
    """`version_stale`: the decline raises the fixture's version, so a wholesale save from before it never books a decliner again unasked."""

    async def test_a_save_keeping_the_referee_who_declined_is_refused(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            loaded = await spiel_now(database)
            await decline_as_referee(database, client)
            outcome = await outcome_of(save(database, client, loaded, note="Halle umgebucht"))

            return outcome, await spiel_now(database)

        outcome, stored = await on_a_refereed_spiel(mongo_replica_set_url, body)

        assert (outcome, stored["schiedsrichter"], stored["note"]) == (Code.VERSION_STALE, None, "Flutlicht")


# As the dry run serves each party: by the name its own record holds, a club's season row and a referee's.
TEAM1_PARTY, TEAM2_PARTY, OTTOS = (
    {"kind": "team", "team_id": str(TEAM1), "name": "Adler"},
    {"kind": "team", "team_id": str(TEAM2), "name": "Biber"},
    {"kind": "schiedsrichter", "schiedsrichter_id": str(SCHIEDSRICHTER), "name": REFEREE},
)


class TestTheDryRunNamesWhomTheSaveHasThePassMail:
    """The match editor's warning reads the dry run's `recipients`: a copy of the pass's rules on the page would drift from them."""

    async def test_a_move_s_dry_run_names_every_party_asked(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            preview = await save(database, client, await spiel_now(database), dry_run=True, time="19:30:00")

            return preview.recipients, (await spiel_now(database))["time"]

        recipients, time = await on_a_refereed_spiel(mongo_replica_set_url, body)

        assert sorted((party.model_dump() for party in recipients), key=str) == sorted([TEAM1_PARTY, TEAM2_PARTY, OTTOS], key=str)
        assert time == TIME, "the dry run wrote the fixture"

    async def test_a_team_holding_no_confirmed_seat_is_not_named(self, mongo_replica_set_url: str):
        """The pass mails a club through its confirmed seats alone: named here, the question would promise a mail never sent."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISON_TEAMS].update_one({"team_id": TEAM2}, {"$set": {"kontakte": documents.kontakte_document()}})
            preview = await save(database, client, await spiel_now(database), dry_run=True, time="19:30:00")

            return preview.recipients

        recipients = await on_a_refereed_spiel(mongo_replica_set_url, body)

        assert sorted((party.model_dump() for party in recipients), key=str) == sorted([TEAM1_PARTY, OTTOS], key=str)

    async def test_a_party_no_read_of_the_editor_holds_is_named_by_its_own_record(self, mongo_replica_set_url: str):
        """A referee no list of the editor holds is still named in the question naming the save's mails.

        The harm: a referee retired since their booking, taken off by this save, mailed that their Einteilung is lifted and
        left out of that question.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SCHIEDSRICHTER].update_one({"_id": SCHIEDSRICHTER}, {"$set": {"inactive_since": "2126-04-20"}})
            preview = await save(database, client, await spiel_now(database), dry_run=True, schiedsrichter=None)

            return preview.recipients

        assert [party.model_dump() for party in await on_a_refereed_spiel(mongo_replica_set_url, body)] == [OTTOS]


class TestARowAnswersOnlyToItsOwnReferee:
    """`ansetzung_foreign_row`: holding the referee Funktion, and answering a row it does not name."""

    @pytest.mark.parametrize(
        ("identifier", "row_id"),
        [
            pytest.param(UTE_ADDRESS, REFEREE_ROW, id="another referee's row"),
            pytest.param(OTTO, ROW1, id="a club's row"),
        ],
    )
    async def test_a_row_naming_none_of_the_addresss_records_is_refused(self, mongo_replica_set_url: str, identifier: str, row_id: ObjectId):
        """Every row compared whole, the one the press named among them: watching one row alone would miss a write to another."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            confirmations = database[Collection.SPIELBESTAETIGUNGEN]
            before = await confirmations.find().sort("_id", 1).to_list(length=None)
            outcome = await outcome_of(einsatz_answer(database, client, row_id, identifier=identifier))

            return outcome, await confirmations.find().sort("_id", 1).to_list(length=None) == before

        assert await on_a_refereed_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_FOREIGN_ROW, True)

    async def test_a_row_of_a_season_ended_since_is_refused_as_none_of_theirs(self, mongo_replica_set_url: str):
        """The panel lists the active seasons' rows alone: answered, a decline would empty a slot of the archive."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})
            outcome = await outcome_of(decline_as_referee(database, client))

            return outcome, (await row_now(database, REFEREE_ROW))["answer"], (await spiel_now(database))["schiedsrichter"] is not None

        assert await on_a_refereed_spiel(mongo_replica_set_url, body) == (Code.ANSETZUNG_FOREIGN_ROW, None, True)


class TestARowAnswersOnlyToItsOwnTeamsSeats:
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
    async def test_a_row_of_no_seat_the_person_holds_is_refused_and_nothing_written(
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

        assert await on_a_spiel(mongo_replica_set_url, body, rows=rows) == (Code.ANSETZUNG_FOREIGN_ROW, True)


class TestARefereeAnswersUntilTheKickOffNotTheDeadline:
    """The Einteilung names no deadline, so the kick-off ends a referee's answer: the report is theirs from then."""

    async def test_a_decline_once_the_match_was_played_and_reported_is_refused_and_keeps_the_booking(self, mongo_replica_set_url: str):
        """Taken, it would empty the slot of the match just played, its report standing with nobody booked to have written it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELBERICHTE].insert_one(documents.spielbericht_document(spiel()))
            outcome = await outcome_of(decline_as_referee(database, client, now=REPORTED_THAT_EVENING))

            return outcome, (await spiel_now(database))["schiedsrichter"], (await row_now(database, REFEREE_ROW))["answer"]

        outcome, booked, answer = await on_a_refereed_spiel(mongo_replica_set_url, body)

        assert outcome == Code.ANSETZUNG_UNANSWERABLE
        assert (booked["schiedsrichter_id"], answer) == (SCHIEDSRICHTER, None)
