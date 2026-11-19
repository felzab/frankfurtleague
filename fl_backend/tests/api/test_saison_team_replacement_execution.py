import copy
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.api.teams.admin_router import replace_saison_team
from app.api.teams.schemas import FLReplaceSaisonTeamPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.crud import ANCHOR_FIELD, VERSION_FIELD
from app.core.exceptions import DocumentNotFoundError
from tests.database import a_clean_database
from tests.documents import (
    aufstellung_document,
    confirmed_kenntnisnahme,
    saison_document,
    saison_spieler_document,
    saison_team_document,
    spiel_document,
    team_document,
)
from tests.isolation import COMMITTED, SeasonsRunningARivalAfterTheSessionRead, outcome_of, refused_code
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_replacement_test")

SAISON_ID = "2026"
PRIOR_SAISON_ID = "2025"

# Fixed rather than generated, so a failure names the same club every run.
WITHDRAWN = ObjectId("6890a1b2c3d4e5f607260001")
INCOMING = ObjectId("6890a1b2c3d4e5f607260002")
RIVAL = ObjectId("6890a1b2c3d4e5f607260003")
ENTERED = ObjectId("6890a1b2c3d4e5f607260004")
RETIRED = ObjectId("6890a1b2c3d4e5f607260005")
ABSENT = ObjectId("6890a1b2c3d4e5f607260009")

# The club's CURRENT identity, which is what a replacement seeds the row and the fixtures from.
TEAM_NAMES = {
    WITHDRAWN: ("Withdrawn", "WDX"),
    INCOMING: ("Incoming", "INX"),
    RIVAL: ("Rival", "RIX"),
    ENTERED: ("Entered", "ENX"),
    RETIRED: ("Retired", "REX"),
}

# The season's own copy, deliberately NOT the club's current one: a reseed taken off the junction
# row rather than off `teams` would leave these spellings in place and pass every other assertion.
PLAYED_AS = {
    WITHDRAWN: ("Withdrawn-Alt", "WXX"),
    RIVAL: ("Rival-Alt", "RXX"),
    ENTERED: ("Entered-Alt", "EXX"),
}

SPIELTAG_OID = ObjectId("6890a1b2c3d4e5f6072600f1")

INCOMING_SIDE = {"team_id": INCOMING, "tore": None}

# The day the replacement runs, and a departure from the same squad that predates it.
REPLACED_ON = "2026-04-15"
# After the replacement day, and the season's start unless a case says so, so the season it runs on has not started.
FIRST_GROUP_SPIEL_DAY = "2026-05-01"
LEFT_EARLIER_ON = "2026-03-01"

# A prefix of their own, so a squad row's id cannot be mistaken for a club's in a failure message.
KADER_ROW_ID = "6890a1b2c3d4e5f60726a{:03d}"
KADER_PERSON_ID = "6890a1b2c3d4e5f60726b{:03d}"


# What the OUTGOING school filled in. Seeded on every row so the clearing below has something to
# clear: a test over a row that carried no contacts would pass against an endpoint that clears none.
OUTGOING_KONTAKTPERSON = {
    "first_name": "Anke",
    "last_name": "Koerner",
    "email": "a.koerner@outgoing.example.net",
    "phone": "+49 171 3920000",
    "birth_date": "1984-05-09",
    "einwilligung": confirmed_kenntnisnahme(),
}

OUTGOING_KONTAKTE = {
    "trainer": dict(OUTGOING_KONTAKTPERSON),
    "ansprechperson": dict(OUTGOING_KONTAKTPERSON),
    "stellvertretung": dict(OUTGOING_KONTAKTPERSON),
    "trainer_is_also": "ansprechperson",
}

OUTGOING_TRIKOT_FARBE = "bordeaux"


def junction(team_id: ObjectId, gruppe: str) -> dict[str, Any]:
    name, shorthand = PLAYED_AS[team_id]

    return saison_team_document(
        SAISON_ID,
        team_id,
        name,
        shorthand,
        gruppe=gruppe,
        trikot_farbe=OUTGOING_TRIKOT_FARBE,
        kontakte=copy.deepcopy(OUTGOING_KONTAKTE),
    )


def kader_row(
    index: int,
    *,
    team_id: ObjectId,
    inactive_since: str | None,
    saison_id: str = SAISON_ID,
    person: int | None = None,
) -> dict[str, Any]:
    """One `saison_spieler` row, keyed back by its `nummer`. A live one carries an explicit `None`, which is what the retirement matches on.

    `person` names the `spieler_id`, so one player can hold a row in two seasons.
    """

    return saison_spieler_document(
        ObjectId(KADER_PERSON_ID.format(index if person is None else person)),
        saison_id,
        team_id,
        _id=ObjectId(KADER_ROW_ID.format(index)),
        nummer=str(index),
        inactive_since=inactive_since,
    )


# The outgoing club's live squad, a row that left it earlier, another club's squad in the same
# season, and row 1's own player one season back -- the four sets the retirement has to tell apart.
KADER_ROWS = [
    kader_row(1, team_id=WITHDRAWN, inactive_since=None),
    kader_row(2, team_id=WITHDRAWN, inactive_since=None),
    kader_row(3, team_id=WITHDRAWN, inactive_since=LEFT_EARLIER_ON),
    kader_row(4, team_id=RIVAL, inactive_since=None),
    kader_row(5, team_id=WITHDRAWN, inactive_since=None, saison_id=PRIOR_SAISON_ID, person=1),
]


def team(team_id: ObjectId, inactive_since: str | None = None) -> dict[str, Any]:
    name, shorthand = TEAM_NAMES[team_id]

    return team_document(
        team_id,
        name,
        shorthand,
        full_name=f"{name}-Schule Frankfurt",
        website_url=f"https://{shorthand.lower()}.example.net",
        inactive_since=inactive_since,
    )


def side(team_id: ObjectId, tore: int | None = None) -> dict[str, Any]:
    """A side as `spiele` stores it: the club and its goals, the name joined at read off the season's row."""

    return {"team_id": team_id, "tore": tore}


def gruppen_spiel(
    spiel_nr: int,
    home: ObjectId,
    away: ObjectId,
    *,
    ergebnis: str | None = None,
    tore: tuple[int | None, int | None] = (None, None),
    saison_id: str = SAISON_ID,
) -> dict[str, Any]:
    """`date`, `time` and `spieltag_id` are the schedule a replacement leaves standing, so every fixture carries all three."""

    return spiel_document(
        spiel_id=ObjectId(),
        saison_id=saison_id,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG_OID,
        date=FIRST_GROUP_SPIEL_DAY,
        time="18:00:00",
        team1=side(home, tore[0]),
        team2=side(away, tore[1]),
        ergebnis=ergebnis,
    )


def knockout_spiel(spiel_nr: int, home: ObjectId) -> dict[str, Any]:
    """A bracket slot with its second side still unfilled -- a shape the replacement has to survive."""

    return spiel_document(
        spiel_id=ObjectId(),
        saison_id=SAISON_ID,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG_OID,
        saison_phase="viertelfinale",
        date="2026-05-20",
        time="18:00:00",
        team1=side(home),
    )


# Three fixtures field the outgoing club and two do not: a group fixture on each slot, a bracket
# slot, one fixture between two other clubs, and one from the season before.
SEASON_SPIELE = [
    gruppen_spiel(1, WITHDRAWN, RIVAL),
    gruppen_spiel(2, RIVAL, WITHDRAWN),
    gruppen_spiel(3, RIVAL, ENTERED),
    knockout_spiel(4, WITHDRAWN),
    gruppen_spiel(5, WITHDRAWN, RIVAL, ergebnis="3:1", tore=(3, 1), saison_id=PRIOR_SAISON_ID),
]

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_seeded_season(
    url: str,
    body: Body,
    *,
    spiele: Sequence[dict[str, Any]] | None = None,
    saison_status: str = "active",
    start_date: str = FIRST_GROUP_SPIEL_DAY,
) -> Any:
    """Activated and not yet started by default: a club leaving before the start is the one a replacement takes."""

    async with a_clean_database(url, DATABASE_NAME) as (client, database):
        # No case here turns on a season's rules; each season spans its own calendar year.
        await database[Collection.SAISONS].insert_many(
            [saison_document(SAISON_ID, saison_status, start_date=start_date), saison_document(PRIOR_SAISON_ID, "past")]
        )
        await database[Collection.SAISON_TEAMS].insert_many([junction(WITHDRAWN, "A"), junction(RIVAL, "A"), junction(ENTERED, "B")])
        await database[Collection.TEAMS].insert_many(
            [team(WITHDRAWN), team(INCOMING), team(RIVAL), team(ENTERED), team(RETIRED, inactive_since="2026-02-01")]
        )
        await database[Collection.SAISON_SPIELER].insert_many(list(KADER_ROWS))
        await database[Collection.SPIELE].insert_many(list(SEASON_SPIELE if spiele is None else spiele))

        return await body(database, client)


async def call_replace(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    team_id: ObjectId = WITHDRAWN,
    incoming_team_id: ObjectId = INCOMING,
    *,
    saisons_collection: Any = None,
    aufstellungen_collection: Any = None,
) -> None:
    """Each overridable collection lets a case hand the endpoint a stand-in there and nothing else."""

    await replace_saison_team(
        team_id=team_id,
        saison_id=SAISON_ID,
        replacement_data=FLReplaceSaisonTeamPayload(incoming_team_id=incoming_team_id),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=saisons_collection if saisons_collection is not None else database[Collection.SAISONS],
        spiele_collection=database[Collection.SPIELE],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        aufstellungen_collection=aufstellungen_collection if aufstellungen_collection is not None else database[Collection.AUFSTELLUNGEN],
        db=client,
        today=REPLACED_ON,
    )


class _LineUpRemovalFails:
    """The real line-up collection with its removal raising, handed to the parameter the endpoint declares.

    A write that fails after the squad's retirement, inside the same transaction; a fake rather than a patch, so nothing
    in production knows it exists.
    """

    def __init__(self, collection: Any) -> None:
        self._collection = collection

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def delete_many(self, *_: Any, **__: Any) -> Any:
        raise OperationFailure("the write could not be applied")


async def row_of(database: AsyncDatabase, team_id: ObjectId) -> dict[str, Any] | None:
    return await database[Collection.SAISON_TEAMS].find_one({"saison_id": SAISON_ID, "team_id": team_id})


async def spiele_now(database: AsyncDatabase) -> dict[int, dict[str, Any]]:
    rows = await database[Collection.SPIELE].find({}).to_list(length=None)

    return {row["spiel_nr"]: row for row in rows}


async def kader_now(database: AsyncDatabase) -> dict[int, dict[str, Any]]:
    """Every squad row of every season, keyed by the `nummer` its seed carries."""

    rows = await database[Collection.SAISON_SPIELER].find({}).to_list(length=None)

    return {int(row["nummer"]): row for row in rows}


async def _refused(database: AsyncDatabase, client: AsyncMongoClient, incoming: ObjectId = INCOMING) -> Any:
    """The code, plus the two surfaces a refusal has to have left alone."""

    return (
        await refused_code(call_replace(database, client, incoming_team_id=incoming)),
        await row_of(database, WITHDRAWN),
        await spiele_now(database),
    )


def uncounted(document: Mapping[str, Any]) -> dict[str, Any]:
    """A document without its write count and its anchor count, which a write raises and no reader shows."""

    return {key: value for key, value in document.items() if key not in (VERSION_FIELD, ANCHOR_FIELD)}


@dataclass(frozen=True)
class League:
    """What a replacement can reach, as a later request would read it."""

    #: This season's rows, by club.
    rows: dict[ObjectId, dict[str, Any]]
    #: Every season's fixtures, by number.
    spiele: dict[int, dict[str, Any]]
    #: Every season's squad rows, by `nummer`: the club and the day it left.
    kader: dict[int, tuple[ObjectId, str | None]]
    #: Every line-up's season and club.
    aufstellungen: list[tuple[str, ObjectId]]


async def league_now(database: AsyncDatabase) -> League:
    rows = await database[Collection.SAISON_TEAMS].find({"saison_id": SAISON_ID}).to_list(length=None)

    return League(
        rows={row["team_id"]: uncounted(row) for row in rows},
        spiele={nr: uncounted(spiel) for nr, spiel in (await spiele_now(database)).items()},
        kader={nr: (row["team_id"], row["inactive_since"]) for nr, row in (await kader_now(database)).items()},
        aufstellungen=[(row["saison_id"], row["team_id"]) async for row in database[Collection.AUFSTELLUNGEN].find().sort("_id")],
    )


def handed_over(spiel: dict[str, Any], *slots: str) -> dict[str, Any]:
    return {**spiel, **{slot: INCOMING_SIDE for slot in slots}}


class TestAReplacementHandsTheWholePlaceOver:
    """The row, its fixtures, the squad and the line-ups as one after-image.

    A replacement touching some of them is half done, and each half passes the other's assertions.
    """

    async def test_everything_the_outgoing_club_held_moves_or_retires_and_nothing_else_changes(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[League, League]:
            await database[Collection.AUFSTELLUNGEN].insert_many(
                [
                    aufstellung_document({"_id": ObjectId(), "saison_id": saison_id}, team_id, starters=[ObjectId()])
                    for saison_id, team_id in ((SAISON_ID, WITHDRAWN), (SAISON_ID, RIVAL), (PRIOR_SAISON_ID, WITHDRAWN))
                ]
            )
            before = await league_now(database)
            await call_replace(database, client)

            return before, await league_now(database)

        before, after = await on_a_seeded_season(mongo_replica_set_url, body)

        # The seed read first: a cleared colour or block proves nothing about a row that went in holding none.
        outgoing = before.rows[WITHDRAWN]
        assert (outgoing["trikot_farbe"], outgoing["kontakte"]) == (OUTGOING_TRIKOT_FARBE, OUTGOING_KONTAKTE)

        assert after.rows == {
            # In place, its `_id` and group kept: a delete-and-insert frees the place and lets the group refill.
            INCOMING: {
                **outgoing,
                "team_id": INCOMING,
                "name": "Incoming",
                "shorthand": "INX",
                "trikot_farbe": None,
                "kontakte": None,
                "confirmations": None,
            },
            RIVAL: before.rows[RIVAL],
            ENTERED: before.rows[ENTERED],
        }, (
            "the season's rows: the outgoing row is handed over in place under the incoming club's own name, its colour and "
            "its three people cleared, and every other row stands"
        )
        assert after.spiele == {
            **before.spiele,
            1: handed_over(before.spiele[1], "team1"),
            2: handed_over(before.spiele[2], "team2"),
            4: handed_over(before.spiele[4], "team1"),
        }, (
            "the fixtures: each side the outgoing club held is handed over, on both slots and in the bracket, with its "
            "opponent and schedule kept; a fixture of two other clubs and the season before's stand"
        )
        assert after.kader == {
            1: (WITHDRAWN, REPLACED_ON),
            2: (WITHDRAWN, REPLACED_ON),
            3: (WITHDRAWN, LEFT_EARLIER_ON),
            4: (RIVAL, None),
            5: (WITHDRAWN, None),
        }, (
            "the squads: the outgoing club's live rows retire on the day and stay its own, an earlier departure keeps its date, "
            "and another club's squad and another season's row stand"
        )
        assert after.aufstellungen == [(SAISON_ID, RIVAL), (PRIOR_SAISON_ID, WITHDRAWN)], (
            "the line-ups: the outgoing club's of this season go, and another club's and another season's stand"
        )


class TestAnAbortTakesTheRetirementBack:
    async def test_the_squad_stays_live_when_a_later_write_fails(self, mongo_replica_set_url: str):
        """Kills dropping `session=`, which retires a squad for a replacement that never landed. The line-ups' removal fails after it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(OperationFailure):
                await call_replace(database, client, aufstellungen_collection=_LineUpRemovalFails(database[Collection.AUFSTELLUNGEN]))
            return await kader_now(database)

        kader = await on_a_seeded_season(mongo_replica_set_url, body)

        assert [kader[index]["inactive_since"] for index in (1, 2)] == [None, None]


class TestAStartedSeasonIsNotReplaced:
    async def test_a_season_starting_on_the_replacement_day_refuses_it(self, mongo_replica_set_url: str):
        """From the season's `start_date` a club leaves by its Austritt and is not replaced, with the whole write rolled back."""

        code, row, spiele = await on_a_seeded_season(
            mongo_replica_set_url,
            _refused,
            spiele=[gruppen_spiel(1, WITHDRAWN, RIVAL), gruppen_spiel(2, RIVAL, WITHDRAWN)],
            start_date=REPLACED_ON,
        )

        assert code == Code.REPLACE_SAISON_STARTED
        assert row is not None, "the junction row was handed over anyway"
        assert spiele[2]["team2"] == side(WITHDRAWN), "the fan-out ran before the refusal, or outside the transaction"


class TestAStartMovedUnderTheReplacementIsJudgedAgain:
    """The season has not started when the replacement judges, and has when it writes: `PATCH /saisons` moved its start."""

    async def test_the_replacement_is_refused_on_the_start_moved_under_it(self, mongo_replica_set_url: str):
        """Drop the season's anchor from `replace_saison_team` and this fails: it reads the start and never writes the season."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def move_the_start_to_the_replacement_day() -> None:
                # The season patch's own write, the one document both share.
                await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"start_date": REPLACED_ON}})

            seasons = SeasonsRunningARivalAfterTheSessionRead(database[Collection.SAISONS], move_the_start_to_the_replacement_day)
            outcome = await outcome_of(call_replace(database, client, saisons_collection=seasons))

            return outcome, await row_of(database, WITHDRAWN)

        outcome, row = await on_a_seeded_season(
            mongo_replica_set_url, body, spiele=[gruppen_spiel(1, WITHDRAWN, RIVAL), gruppen_spiel(2, RIVAL, WITHDRAWN)]
        )

        assert outcome != COMMITTED, "the replacement committed on a start it judged before the patch moved it"
        assert outcome == Code.REPLACE_SAISON_STARTED
        assert row is not None, "the junction row was handed over anyway"


class TestTheSeasonGateOnTheRoute:
    async def test_a_finished_season_refuses_it_and_writes_nothing(self, mongo_replica_set_url: str):
        """`saison_past` through the route: a past season's fixtures are the record of who played."""

        code, row, spiele = await on_a_seeded_season(mongo_replica_set_url, _refused, saison_status="past")

        assert code == Code.SAISON_PAST
        assert row is not None
        assert spiele[1]["team1"] == side(WITHDRAWN)


class TestWhoMayArrive:
    async def test_a_team_the_season_already_holds_is_refused(self, mongo_replica_set_url: str):
        """`saison_teams` holds one row a club, and the row handed over would be its second."""

        code, row, spiele = await on_a_seeded_season(mongo_replica_set_url, lambda database, client: _refused(database, client, incoming=RIVAL))

        assert code == Code.REPLACE_INCOMING_ALREADY_ENTERED
        assert row is not None
        assert spiele[1]["team1"] == side(WITHDRAWN)

    async def test_a_team_that_left_the_league_is_refused(self, mongo_replica_set_url: str):
        """The entry gate's own code, because a replacement is one more way of bringing a club into a season."""

        code, _, _ = await on_a_seeded_season(mongo_replica_set_url, lambda database, client: _refused(database, client, incoming=RETIRED))

        assert code == Code.TEAM_RETIRED

    async def test_an_id_naming_no_team_is_a_404(self, mongo_replica_set_url: str):
        """Kills pointing the row at a club that is not there: the season would field a club no `teams` document holds."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundError):
                await call_replace(database, client, incoming_team_id=ABSENT)
            return await row_of(database, WITHDRAWN)

        row = await on_a_seeded_season(mongo_replica_set_url, body)

        assert row is not None, "the row was rewritten before the incoming club was resolved"
