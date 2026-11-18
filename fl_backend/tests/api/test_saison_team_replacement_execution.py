import copy
from collections.abc import Awaitable, Callable, Sequence
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
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of, refused_code
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
# A junction row points at this id and NO `teams` document does: the phantom a replacement repairs.
PHANTOM = ObjectId("6890a1b2c3d4e5f607260006")
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
    PHANTOM: ("Phantom", "PHX"),
}

EXIT = {"type": "rueckzug", "reason": "Zu wenige Spieler", "date": "2026-04-01"}

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


def junction(team_id: ObjectId, gruppe: str, austritt: dict[str, Any] | None = None) -> dict[str, Any]:
    name, shorthand = PLAYED_AS[team_id]

    return saison_team_document(
        SAISON_ID,
        team_id,
        name,
        shorthand,
        gruppe=gruppe,
        austritt=austritt,
        trikot_farbe=OUTGOING_TRIKOT_FARBE,
        kontakte=copy.deepcopy(OUTGOING_KONTAKTE),
    )


def default_junctions() -> list[dict[str, Any]]:
    """The season's four rows, built per call so a test may seed a different set without editing this one."""

    return [junction(WITHDRAWN, "A", dict(EXIT)), junction(RIVAL, "A"), junction(ENTERED, "B"), junction(PHANTOM, "B")]


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
    sonderereignis: str | None = None,
    tore: tuple[int | None, int | None] = (None, None),
    saison_id: str = SAISON_ID,
    date: str = FIRST_GROUP_SPIEL_DAY,
) -> dict[str, Any]:
    """`date`, `time` and `spieltag_id` are the schedule a replacement leaves standing, so every fixture carries all three."""

    return spiel_document(
        spiel_id=ObjectId(),
        saison_id=saison_id,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG_OID,
        date=date,
        time="18:00:00",
        team1=side(home, tore[0]),
        team2=side(away, tore[1]),
        ergebnis=ergebnis,
        sonderereignis=sonderereignis,
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


# Three fixtures field the outgoing club and three do not: a group fixture on each slot, a bracket
# slot, one fixture between two other clubs, the phantom row's own, and one from the season before.
SEASON_SPIELE = [
    gruppen_spiel(1, WITHDRAWN, RIVAL),
    gruppen_spiel(2, RIVAL, WITHDRAWN),
    gruppen_spiel(3, RIVAL, ENTERED),
    knockout_spiel(4, WITHDRAWN),
    gruppen_spiel(5, WITHDRAWN, RIVAL, ergebnis="3:1", tore=(3, 1), saison_id=PRIOR_SAISON_ID),
    gruppen_spiel(6, PHANTOM, ENTERED),
]

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_seeded_season(
    url: str,
    body: Body,
    *,
    spiele: Sequence[dict[str, Any]] | None = None,
    saison_status: str = "active",
    start_date: str = FIRST_GROUP_SPIEL_DAY,
    junctions: Sequence[dict[str, Any]] | None = None,
    stores_a_refused_shape: str | None = None,
) -> Any:
    """`active` by default: a mid-season withdrawal is what this endpoint is for."""

    async with a_clean_database(url, DATABASE_NAME, stores_a_refused_shape=stores_a_refused_shape) as (client, database):
        # No case here turns on a season's rules; each season spans its own calendar year.
        await database[Collection.SAISONS].insert_many(
            [saison_document(SAISON_ID, saison_status, start_date=start_date), saison_document(PRIOR_SAISON_ID, "past")]
        )
        await database[Collection.SAISON_TEAMS].insert_many(list(default_junctions() if junctions is None else junctions))
        # No document for PHANTOM, which is the whole point of that junction row.
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
        bewerbungen_collection=database[Collection.BEWERBUNGEN],
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


async def rows_now(database: AsyncDatabase) -> list[dict[str, Any]]:
    """Read outside any transaction -- what a later request would see."""

    return await database[Collection.SAISON_TEAMS].find({"saison_id": SAISON_ID}).to_list(length=None)


async def row_of(database: AsyncDatabase, team_id: ObjectId) -> dict[str, Any] | None:
    return await database[Collection.SAISON_TEAMS].find_one({"saison_id": SAISON_ID, "team_id": team_id})


async def spiele_now(database: AsyncDatabase) -> dict[int, dict[str, Any]]:
    rows = await database[Collection.SPIELE].find({}).to_list(length=None)

    return {row["spiel_nr"]: row for row in rows}


async def kader_now(database: AsyncDatabase) -> dict[int, dict[str, Any]]:
    """Every squad row of every season, keyed by the `nummer` its seed carries."""

    rows = await database[Collection.SAISON_SPIELER].find({}).to_list(length=None)

    return {int(row["nummer"]): row for row in rows}


async def _row_after(database: AsyncDatabase, client: AsyncMongoClient, team_id: ObjectId = WITHDRAWN) -> Any:
    await call_replace(database, client, team_id=team_id)

    return await row_of(database, INCOMING)


async def _spiele_after(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    await call_replace(database, client)

    return await spiele_now(database)


async def _kader_after(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
    await call_replace(database, client)

    return await kader_now(database)


async def _refused(database: AsyncDatabase, client: AsyncMongoClient, incoming: ObjectId = INCOMING) -> Any:
    """The code, plus the two surfaces a refusal has to have left alone."""

    return (
        await refused_code(call_replace(database, client, incoming_team_id=incoming)),
        await row_of(database, WITHDRAWN),
        await spiele_now(database),
    )


class TestAllFourLayersMoveTogether:
    """A replacement touching three of the four is half done, and each half passes the other's assertions."""

    async def test_the_row_names_the_incoming_team(self, mongo_replica_set_url: str):
        """Layer one. Kills a fan-out that rewrites the fixtures and leaves the junction row where it was."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_replace(database, client)
            return await row_of(database, INCOMING), await row_of(database, WITHDRAWN)

        arrived, departed = await on_a_seeded_season(mongo_replica_set_url, body)

        assert arrived is not None
        assert departed is None, "the outgoing club still holds a row, so the season fields one club too many"

    async def test_the_rows_identity_is_reseeded_from_the_incoming_team(self, mongo_replica_set_url: str):
        """Layer two. Kills a rewrite of `team_id` alone, which leaves the season's row spelling the OUTGOING club's name."""

        row = await on_a_seeded_season(mongo_replica_set_url, _row_after)

        assert row is not None
        assert (row["name"], row["shorthand"]) == ("Incoming", "INX")

    async def test_every_side_the_team_held_moves(self, mongo_replica_set_url: str):
        """Layer three, on both slots and past the group phase. Kills a single-pass rewrite."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_replace(database, client)
            return await spiele_now(database)

        spiele = await on_a_seeded_season(mongo_replica_set_url, body)

        assert spiele[1]["team1"] == INCOMING_SIDE
        assert spiele[2]["team2"] == INCOMING_SIDE
        assert spiele[4]["team1"] == INCOMING_SIDE, "a bracket slot is part of the schedule the incoming club inherits"

    async def test_the_austritt_is_cleared(self, mongo_replica_set_url: str):
        """Layer four. Kills leaving it standing, which would mark the INCOMING club withdrawn and drop it from the table."""

        row = await on_a_seeded_season(mongo_replica_set_url, _row_after)

        assert row is not None
        assert row["austritt"] is None

    async def test_the_kit_colour_and_the_contacts_are_cleared_with_it(self, mongo_replica_set_url: str):
        """Kills leaving them standing, which would hold the OUTGOING school's three people against a club that never gave them.

        The seed is read first: read back after the write, a null proves nothing about a row that went in holding nothing.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            return await row_of(database, WITHDRAWN), await _row_after(database, client)

        seeded, row = await on_a_seeded_season(mongo_replica_set_url, body)

        assert seeded is not None
        assert seeded["trikot_farbe"] == OUTGOING_TRIKOT_FARBE
        assert seeded["kontakte"]["ansprechperson"]["email"] == OUTGOING_KONTAKTPERSON["email"]
        assert row is not None
        assert row["trikot_farbe"] is None
        assert row["kontakte"] is None

    async def test_the_group_and_the_row_count_are_left_alone(self, mongo_replica_set_url: str):
        """The row is rewritten IN PLACE. Kills a delete-and-insert, which frees the place and lets the group refill."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_replace(database, client)
            return await rows_now(database), await row_of(database, INCOMING)

        rows, row = await on_a_seeded_season(mongo_replica_set_url, body)

        assert row is not None
        assert row["gruppe"] == "A"
        assert len(rows) == 4, "the season gained or lost a junction row"

    async def test_the_schedule_survives_intact(self, mongo_replica_set_url: str):
        """Kills a rewrite that redraws the fixture rather than replacing one side of it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            before = await spiele_now(database)
            await call_replace(database, client)
            return before, await spiele_now(database)

        before, after = await on_a_seeded_season(mongo_replica_set_url, body)

        for spiel_nr in before:
            for field in ("_id", "date", "time", "spieltag_id", "saison_phase", "spiel_nr"):
                assert after[spiel_nr][field] == before[spiel_nr][field], f"spiel {spiel_nr} lost its {field}"

        assert after[1]["team2"] == before[1]["team2"], "the opponent was rewritten"


class TestTheOutgoingTeamsKaderIsRetired:
    """The fifth surface, the one that does not move: `kader_team_not_in_saison` refuses a squad row whose club has no junction row there."""

    async def test_the_live_rows_are_stamped_with_the_day_of_the_replacement(self, mongo_replica_set_url: str):
        """Kills leaving them standing: the club page's squad, a season-and-team read, goes on serving the outgoing club's squad."""

        kader = await on_a_seeded_season(mongo_replica_set_url, _kader_after)

        assert (kader[1]["inactive_since"], kader[2]["inactive_since"]) == (REPLACED_ON, REPLACED_ON)

    async def test_a_row_that_left_the_kader_earlier_keeps_its_own_date(self, mongo_replica_set_url: str):
        """Kills dropping `inactive_since: None` from the filter, which rewrites the date of a departure that had already happened."""

        kader = await on_a_seeded_season(mongo_replica_set_url, _kader_after)

        assert kader[3]["inactive_since"] == LEFT_EARLIER_ON

    async def test_the_players_stay_with_the_team_they_registered_for(self, mongo_replica_set_url: str):
        """Kills repointing `team_id` at the incoming club: nobody transferred, and that club registers a squad of its own."""

        kader = await on_a_seeded_season(mongo_replica_set_url, _kader_after)

        assert {kader[index]["team_id"] for index in (1, 2, 3)} == {WITHDRAWN}

    async def test_another_teams_kader_in_the_same_season_is_untouched(self, mongo_replica_set_url: str):
        """Kills a filter missing `team_id`, which would empty every squad in the season."""

        kader = await on_a_seeded_season(mongo_replica_set_url, _kader_after)

        assert kader[4]["inactive_since"] is None

    async def test_the_same_player_in_another_season_is_untouched(self, mongo_replica_set_url: str):
        """Kills a filter missing `saison_id`: row 5 is row 1's own player, in the same club, one season back."""

        kader = await on_a_seeded_season(mongo_replica_set_url, _kader_after)

        assert kader[5]["inactive_since"] is None

    async def test_its_line_ups_go_and_every_other_stays(self, mongo_replica_set_url: str):
        """Kills leaving them, which keeps a squad's pupils named for fixtures their club no longer plays, and a filter missing either term."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[str, ObjectId]]:
            await database[Collection.AUFSTELLUNGEN].insert_many(
                [
                    aufstellung_document({"_id": ObjectId(), "saison_id": saison_id}, team_id, starters=[ObjectId()])
                    for saison_id, team_id in ((SAISON_ID, WITHDRAWN), (SAISON_ID, RIVAL), (PRIOR_SAISON_ID, WITHDRAWN))
                ]
            )
            await call_replace(database, client)

            return [(row["saison_id"], row["team_id"]) async for row in database[Collection.AUFSTELLUNGEN].find().sort("_id")]

        assert await on_a_seeded_season(mongo_replica_set_url, body) == [(SAISON_ID, RIVAL), (PRIOR_SAISON_ID, WITHDRAWN)]

    async def test_an_abort_takes_the_retirement_back(self, mongo_replica_set_url: str):
        """Kills dropping `session=`, which retires a squad for a replacement that never landed. The line-ups' removal fails after it."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(OperationFailure):
                await call_replace(database, client, aufstellungen_collection=_LineUpRemovalFails(database[Collection.AUFSTELLUNGEN]))
            return await kader_now(database)

        kader = await on_a_seeded_season(mongo_replica_set_url, body)

        assert [kader[index]["inactive_since"] for index in (1, 2)] == [None, None]


class TestTheReplacementReachesNothingElse:
    async def test_a_spiel_between_two_other_teams_is_untouched(self, mongo_replica_set_url: str):
        """Kills a fan-out filtered on the season alone, which passes every assertion about the sides that did move."""

        spiele = await on_a_seeded_season(mongo_replica_set_url, _spiele_after)

        assert (spiele[3]["team1"]["team_id"], spiele[3]["team2"]["team_id"]) == (RIVAL, ENTERED)

    async def test_another_seasons_spiel_is_untouched(self, mongo_replica_set_url: str):
        """Kills a fan-out missing `saison_id`, and a played-check missing it: spiel 5 is the same club, with a result, one season back."""

        spiele = await on_a_seeded_season(mongo_replica_set_url, _spiele_after)

        assert spiele[5]["team1"] == side(WITHDRAWN, 3), "a past season keeps the club it was played by"

    async def test_the_other_junction_rows_are_untouched(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_replace(database, client)
            return await row_of(database, RIVAL)

        row = await on_a_seeded_season(mongo_replica_set_url, body)

        assert row is not None
        assert (row["gruppe"], row["name"]) == ("A", "Rival-Alt")


class TestAPhantomRowIsRepaired:
    """Repairing a row naming a club no `teams` document holds is one of the operation's purposes.

    No refusal here may therefore require the outgoing club to exist.
    """

    async def test_a_row_whose_team_is_gone_is_replaced(self, mongo_replica_set_url: str):
        """Kills a guard reading the outgoing club for its name or its standing, which would 404 on exactly the row this repairs."""

        row = await on_a_seeded_season(mongo_replica_set_url, lambda database, client: _row_after(database, client, team_id=PHANTOM))

        assert row is not None
        assert (row["gruppe"], row["name"], row["shorthand"]) == ("B", "Incoming", "INX")

    async def test_its_spiele_move_with_it(self, mongo_replica_set_url: str):
        """Kills a fan-out composing the new side out of the OUTGOING club, which here has no document to read."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await call_replace(database, client, team_id=PHANTOM)
            return await spiele_now(database)

        spiele = await on_a_seeded_season(mongo_replica_set_url, body)

        assert spiele[6]["team1"] == INCOMING_SIDE


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

            return outcome, seasons.passes, await row_of(database, WITHDRAWN)

        outcome, passes, row = await on_a_seeded_season(
            mongo_replica_set_url, body, spiele=[gruppen_spiel(1, WITHDRAWN, RIVAL), gruppen_spiel(2, RIVAL, WITHDRAWN)]
        )

        assert outcome != COMMITTED, "the replacement committed on a start it judged before the patch moved it"
        assert outcome == Code.REPLACE_SAISON_STARTED
        assert row is not None, "the junction row was handed over anyway"
        # The judgement's read and the retry's: the replacement conflicted on the anchor rather than committing.
        assert passes == 2


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
        """Kills pointing the row at a club that is not there -- which is the phantom this endpoint exists to repair."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundError):
                await call_replace(database, client, incoming_team_id=ABSENT)
            return await row_of(database, WITHDRAWN)

        row = await on_a_seeded_season(mongo_replica_set_url, body)

        assert row is not None, "the row was rewritten before the incoming club was resolved"


class SeasonsRunningARivalAfterTheSessionRead(InterleavedCollection):
    """A `saisons` stand-in running its rival once, just after the first read made inside a transaction.

    The read before the transaction is the 404 check, so a rival there would land before any snapshot.
    """

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._collection.find_one(*args, **kwargs)
        if kwargs.get("session") is not None:
            await self.run_the_rival()

        return found
