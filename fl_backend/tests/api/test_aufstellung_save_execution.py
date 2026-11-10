"""
API · a line-up saved and read as a seat of the club and as an administrator, against a real database

Each handler is called directly with the clock it is handed, so the lock is reached without waiting for it.
"""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from fastapi import Response
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.aufstellungen.admin_router import get_aufstellung, put_aufstellung
from app.api.aufstellungen.person_router import get_aufstellung_self, put_aufstellung_self
from app.api.aufstellungen.schemas import FLAufstellungEntry, FLAufstellungPayload, FLAufstellungResponse
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.core.recording import ACT_BY_KONTAKT, actor_var
from app.core.sentinels import GHOST_SPIELER_ID
from app.shared.schemas.literals import KONTAKT_ROLLEN
from tests import documents
from tests.acts import acts_of
from tests.database import a_clean_database, on_the_seed_loop
from tests.erasure import erased
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.records import record_collections
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_aufstellung_save_test")

SAISON_ID = "2026"
HOME, AWAY = ObjectId("6890a1b2c3d4e5f607470001"), ObjectId("6890a1b2c3d4e5f607470002")
SPIELTAG, FIRST_SPIELTAG = ObjectId("6890a1b2c3d4e5f607470031"), ObjectId("6890a1b2c3d4e5f607470032")
SPIEL, UNDATED = ObjectId("6890a1b2c3d4e5f607470021"), ObjectId("6890a1b2c3d4e5f607470022")
# The home squad: numbers stored as strings, so `7` must come before `10`, and the unnumbered pupil last.
LINA, OLE, MIA, NEU, WEG = (ObjectId(f"6890a1b2c3d4e5f6074700{n}") for n in (41, 42, 43, 44, 45))
# The away club's pupil, in no squad of the home club.
FREMD = ObjectId("6890a1b2c3d4e5f607470051")

HOME_SEAT, AWAY_SEAT = "ansprech.heim@schule.de", "ansprech.gast@schule.de"
ADMIN = "admin@example.org"

# Saturday 14 November 2026, 16:00 in Berlin, 15:00 UTC: locked for the club from 14:00 UTC.
OPEN = datetime(2026, 11, 10, 12, tzinfo=UTC)
LOCKED = datetime(2026, 11, 14, 14, 30, tzinfo=UTC)
# Two hours after the kick-off.
PLAYED = datetime(2026, 11, 14, 17, tzinfo=UTC)

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def _junction(team_id: ObjectId, name: str, seat: str) -> dict[str, Any]:
    ansprech = documents.kontaktperson_document("Anna", confirmed_at="2026-01-06", email=seat, phone="+49 69 5550199")
    kontakte = {**{slot: None for slot in KONTAKT_ROLLEN}, "ansprechperson": ansprech, "trainer_is_also": None}
    return documents.saison_team_document(SAISON_ID, team_id, name, name[:3].upper(), kontakte=kontakte)


def _spiel(spiel_id: ObjectId, spiel_nr: int, **fields: Any) -> dict[str, Any]:
    return documents.spiel_document(
        spiel_id=spiel_id,
        saison_id=SAISON_ID,
        spiel_nr=spiel_nr,
        spieltag_id=SPIELTAG,
        team1={"team_id": HOME, "tore": None},
        team2={"team_id": AWAY, "tore": None},
        **fields,
    )


def on_a_season(url: str, body: Body) -> Any:
    """A running season's second matchday of two, one fixture on it dated and one not, and both clubs' squads."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME) as (client, database):
            await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
            await database[Collection.SPIELTAGE].insert_many(
                [
                    {
                        "_id": spieltag_id,
                        "start": None,
                        "end": None,
                        "position": position,
                        "saison_phase": "gruppenphase",
                        "saison_id": SAISON_ID,
                    }
                    for spieltag_id, position in ((FIRST_SPIELTAG, 1), (SPIELTAG, 2))
                ]
            )
            await database[Collection.SAISON_TEAMS].insert_many([_junction(HOME, "Alpha", HOME_SEAT), _junction(AWAY, "Beta", AWAY_SEAT)])
            await database[Collection.SPIELE].insert_many([_spiel(SPIEL, 1, date="2026-11-14", time="16:00:00"), _spiel(UNDATED, 2)])
            await database[Collection.SPIELER].insert_many(
                [
                    documents.spieler_document(pupil, name, "Muster")
                    for pupil, name in ((LINA, "Lina"), (OLE, "Ole"), (MIA, "Mia"), (NEU, "Neu"), (WEG, "Weg"), (FREMD, "Fremd"))
                ]
            )
            await database[Collection.SAISON_SPIELER].insert_many(
                [
                    documents.saison_spieler_document(LINA, SAISON_ID, HOME, nummer="10", rolle="kapitaen"),
                    documents.saison_spieler_document(OLE, SAISON_ID, HOME, nummer="7"),
                    documents.saison_spieler_document(MIA, SAISON_ID, HOME),
                    documents.saison_spieler_document(NEU, SAISON_ID, HOME, nummer="3", is_nachnominiert=True),
                    documents.saison_spieler_document(WEG, SAISON_ID, HOME, nummer="5", inactive_since="2026-10-01"),
                    documents.saison_spieler_document(FREMD, SAISON_ID, AWAY, nummer="9"),
                ]
            )
            return await body(database, client)

    return on_the_seed_loop(_run())


def _payload(*named: ObjectId, starters: int = 0, version: int | None = None) -> FLAufstellungPayload:
    return FLAufstellungPayload(
        spieler=[FLAufstellungEntry(spieler_id=pupil, starts=index < starters) for index, pupil in enumerate(named)], version=version
    )


async def seat_saves(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    payload: FLAufstellungPayload,
    *,
    seat: str = HOME_SEAT,
    team_id: ObjectId = HOME,
    spiel_id: ObjectId = SPIEL,
    now: datetime = OPEN,
    aufstellungen: Any = None,
) -> tuple[FLAufstellungResponse, int]:
    """A club's line-up, the home club's unless named, saved through the seat's handler, and the status it answers: 201 for a create."""

    response = Response()
    answer = await put_aufstellung_self(
        spiel_id=spiel_id,
        team_id=team_id,
        aufstellung_data=payload,
        response=response,
        identifier=seat,
        spiele_collection=database[Collection.SPIELE],
        saisons_collection=database[Collection.SAISONS],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        spieler_collection=database[Collection.SPIELER],
        aufstellungen_collection=database[Collection.AUFSTELLUNGEN] if aufstellungen is None else aufstellungen,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        records=record_collections(database),
        db=client,
        now=now,
    )
    return answer, response.status_code


async def admin_saves(
    database: AsyncDatabase, client: AsyncMongoClient, payload: FLAufstellungPayload, *, spiel_id: ObjectId = SPIEL, now: datetime = OPEN
) -> tuple[FLAufstellungResponse, int]:
    """The home club's line-up saved through the administrator's handler, under the actor its request would bind."""

    response = Response()
    token = actor_var.set(ADMIN)
    try:
        answer = await put_aufstellung(
            spiel_id=spiel_id,
            team_id=HOME,
            aufstellung_data=payload,
            response=response,
            spiele_collection=database[Collection.SPIELE],
            saisons_collection=database[Collection.SAISONS],
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            spieler_collection=database[Collection.SPIELER],
            aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
            db=client,
            now=now,
        )
    finally:
        actor_var.reset(token)
    return answer, response.status_code


async def refusal_of(saving: Awaitable[Any]) -> tuple[Code, list[tuple[str | int, ...]]]:
    with pytest.raises(APIError) as refused:
        await saving
    return refused.value.error_code, list(refused.value.fields)


def test_a_seats_first_save_creates_the_line_up_and_answers_the_screen(mongo_replica_set_url: str):
    """The squad by shirt number, the matchday by its stored position, each side with its Kürzel, and the act recorded."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> None:
        answer, status = await seat_saves(database, client, _payload(LINA, OLE, starters=1))
        stored = await database[Collection.AUFSTELLUNGEN].find_one({"spiel_id": SPIEL, "team_id": HOME})

        assert status == 201
        assert [row.first_name for row in answer.kader] == ["Neu", "Ole", "Lina", "Mia"]
        spiel = answer.spiel
        assert (spiel.saison_phase, spiel.spieltag_position, spiel.count_spieltage_in_phase, spiel.for_third_place) == (
            "gruppenphase",
            2,
            2,
            False,
        )
        assert spiel.team1 is not None and spiel.team2 is not None
        assert (spiel.team1.shorthand, spiel.team2.shorthand) == ("ALP", "BET")
        assert answer.marks is not None and (answer.marks.stored, answer.marks.phase) == (True, "open")
        assert (answer.version, [(entry.spieler_id, entry.starts) for entry in answer.spieler]) == (0, [(LINA, True), (OLE, False)])
        assert stored is not None
        assert await acts_of(database) == [("aufstellung.saved", ACT_BY_KONTAKT, "Alpha", stored["_id"])]

    on_a_season(mongo_replica_set_url, body)


def test_the_lock_refuses_the_seat_and_never_the_administrator(mongo_replica_set_url: str):
    """From one hour before kick-off the line-up is the administration's, on the same document."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        refused = await refusal_of(seat_saves(database, client, _payload(LINA), now=LOCKED))
        _, status = await admin_saves(database, client, _payload(LINA), now=LOCKED)
        return refused, status

    assert on_a_season(mongo_replica_set_url, body) == ((Code.AUFSTELLUNG_LOCKED, []), 201)


def test_an_undated_fixture_takes_no_line_up_from_anybody(mongo_replica_set_url: str):
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        return (
            await refusal_of(seat_saves(database, client, _payload(LINA), spiel_id=UNDATED)),
            await refusal_of(admin_saves(database, client, _payload(LINA), spiel_id=UNDATED)),
        )

    assert on_a_season(mongo_replica_set_url, body) == ((Code.AUFSTELLUNG_SPIEL_UNDATED, []),) * 2


def test_another_clubs_seat_is_refused_the_club(mongo_replica_set_url: str):
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        return await refusal_of(seat_saves(database, client, _payload(LINA), seat=AWAY_SEAT))

    assert on_a_season(mongo_replica_set_url, body) == (Code.ROLE_NOT_HELD, [])


def test_a_save_judges_its_names_against_the_squad_and_the_stored_line_up(mongo_replica_set_url: str):
    """The club's squad is read for the judgement, and so is the stored line-up, which keeps a pupil ausgetragen since.

    What the judgement decides is `test_aufstellung_save_rules.py`'s, on the default tier.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        refused, _ = await refusal_of(seat_saves(database, client, _payload(OLE, WEG)))
        await database[Collection.AUFSTELLUNGEN].insert_one(
            documents.aufstellung_document({"_id": SPIEL, "saison_id": SAISON_ID}, HOME, starters=[WEG])
        )
        kept, _ = await seat_saves(database, client, _payload(WEG, OLE, version=0))
        return refused, [row.first_name for row in kept.named]

    assert on_a_season(mongo_replica_set_url, body) == (Code.SPIELER_NOT_IN_KADER, ["Weg"])


def test_the_seat_reads_the_screen_the_save_answered(mongo_replica_set_url: str):
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[FLAufstellungResponse, FLAufstellungResponse]:
        saved, _ = await seat_saves(database, client, _payload(LINA, OLE, starters=2))
        async with client.start_session(snapshot=True) as session:
            read = await get_aufstellung_self(
                spiel_id=SPIEL,
                team_id=HOME,
                identifier=HOME_SEAT,
                spiele_collection=database[Collection.SPIELE],
                saison_spieler_collection=database[Collection.SAISON_SPIELER],
                spieler_collection=database[Collection.SPIELER],
                aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
                records=record_collections(database),
                session=session,
                now=OPEN,
            )
        return saved, read

    saved, read = on_a_season(mongo_replica_set_url, body)

    assert read == saved
    assert read.saison_status == "active"


async def the_season_ends(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})


async def nothing_written(database: AsyncDatabase) -> tuple[Any, list[Any]]:
    return await database[Collection.AUFSTELLUNGEN].find_one({}), await acts_of(database)


def test_a_finished_seasons_line_up_is_read_only_for_the_administrator(mongo_replica_set_url: str):
    """The save refused as every other administrator write about a finished season's match is, and the read says why."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        await the_season_ends(database)
        refused = await refusal_of(admin_saves(database, client, _payload(LINA)))
        async with client.start_session(snapshot=True) as session:
            read = await get_aufstellung(
                spiel_id=SPIEL,
                team_id=HOME,
                spiele_collection=database[Collection.SPIELE],
                saison_spieler_collection=database[Collection.SAISON_SPIELER],
                spieler_collection=database[Collection.SPIELER],
                aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
                session=session,
                now=OPEN,
            )
        return refused, read.saison_status, await nothing_written(database)

    assert on_a_season(mongo_replica_set_url, body) == ((Code.SAISON_PAST, []), "past", (None, []))


def test_a_finished_season_grants_its_seat_holder_no_line_up(mongo_replica_set_url: str):
    """A finished season grants no seat, so its seat holder is refused the club before the season is asked."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        await the_season_ends(database)
        return await refusal_of(seat_saves(database, client, _payload(LINA))), await nothing_written(database)

    assert on_a_season(mongo_replica_set_url, body) == ((Code.ROLE_NOT_HELD, []), (None, []))


class LineUpsRunningARivalAtTheirRead(InterleavedCollection):
    """An `aufstellungen` stand-in running one rival once the save has read the squad and before it reads the line-up."""

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()

        return await self._collection.find_one(*args, **kwargs)


def test_a_pupil_ausgetragen_inside_the_save_refuses_it(mongo_replica_set_url: str):
    """The squad row is read and never written, so its change conflicts with nothing: the judgement asked after the write refuses it."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, Any]:
        async def ole_is_ausgetragen() -> None:
            await database[Collection.SAISON_SPIELER].update_one({"spieler_id": OLE}, {"$set": {"inactive_since": "2026-11-10"}})

        aufstellungen = LineUpsRunningARivalAtTheirRead(database[Collection.AUFSTELLUNGEN], ole_is_ausgetragen)
        outcome = await outcome_of(seat_saves(database, client, _payload(LINA, OLE), aufstellungen=aufstellungen))
        # Committed before it, the rival is met at the squad's read, and the save is refused at its first read of the
        # line-up, before the write reads it again.
        aufstellungen.assert_landed_inside(serially=1)

        return outcome, await database[Collection.AUFSTELLUNGEN].find_one({})

    assert on_a_season(mongo_replica_set_url, body) == (str(Code.SPIELER_NOT_IN_KADER), None)


async def erase(database: AsyncDatabase, client: AsyncMongoClient, *pupils: ObjectId, now: datetime) -> None:
    """Each pupil erased through the registry, by the address their record holds, at `now`."""

    for pupil in pupils:
        person = await database[Collection.SPIELER].find_one({"_id": pupil}, {"email": 1})
        assert person is not None
        await erased(database, client, person["email"], germany_now=now)


class TestAnErasedPupilsEntry:
    """Kept as the record where the match has kicked off, removed where it is still ahead."""

    def test_two_erased_after_kick_off_stay_apart_and_the_line_up_saves_as_served(self, mongo_replica_set_url: str):
        """Both entries name the one sentinel: served among the named, a save of the screen as served was refused as naming one twice."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await admin_saves(database, client, _payload(LINA, OLE, MIA, starters=2))
            await erase(database, client, LINA, OLE, now=PLAYED)
            async with client.start_session(snapshot=True) as session:
                served = await get_aufstellung(
                    spiel_id=SPIEL,
                    team_id=HOME,
                    spiele_collection=database[Collection.SPIELE],
                    saison_spieler_collection=database[Collection.SAISON_SPIELER],
                    spieler_collection=database[Collection.SPIELER],
                    aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
                    session=session,
                    now=PLAYED,
                )
            answer, _ = await admin_saves(database, client, FLAufstellungPayload(spieler=served.spieler, version=served.version), now=PLAYED)
            stored = await database[Collection.AUFSTELLUNGEN].find_one({"spiel_id": SPIEL, "team_id": HOME})
            assert stored is not None

            return served, answer, stored["spieler"]

        served, answer, stored = on_a_season(mongo_replica_set_url, body)

        assert ([entry.spieler_id for entry in served.spieler], [row.spieler_id for row in served.named]) == ([MIA], [])
        assert [entry.starts for entry in served.erased] == [True, True]
        assert [entry.starts for entry in answer.erased] == [True, True]
        assert stored == [
            {"spieler_id": MIA, "starts": False},
            {"spieler_id": GHOST_SPIELER_ID, "starts": True},
            {"spieler_id": GHOST_SPIELER_ID, "starts": True},
        ]

    def test_one_erased_before_kick_off_leaves_the_line_up(self, mongo_replica_set_url: str):
        """The club fielded nobody yet: an entry kept would hold a place in the Startelf no save could free."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seat_saves(database, client, _payload(LINA, OLE, starters=2))
            await erase(database, client, LINA, now=OPEN)
            stored = await database[Collection.AUFSTELLUNGEN].find_one({"spiel_id": SPIEL, "team_id": HOME})
            assert stored is not None

            return stored["spieler"]

        assert on_a_season(mongo_replica_set_url, body) == [{"spieler_id": OLE, "starts": True}]


# --- One document per club per fixture: a club's two seats saving at once meet on it, and the other club's save never does.


async def stored_line_ups(database: AsyncDatabase) -> list[tuple[ObjectId, list[ObjectId], int]]:
    """Every stored line-up of the fixture: its club, whom it names and its count, in the order written."""

    rows = await database[Collection.AUFSTELLUNGEN].find({"spiel_id": SPIEL}).sort("_id").to_list(length=None)

    return [(row["team_id"], [entry["spieler_id"] for entry in row["spieler"]], row["version"]) for row in rows]


class LineUpsRunningARivalBeforeTheirInsert(InterleavedCollection):
    """An `aufstellungen` stand-in running one rival after the save read no line-up and before it inserts its own."""

    async def insert_one(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()

        return await self._collection.insert_one(*args, **kwargs)


def test_a_clubs_second_first_save_meets_the_first_and_is_told_the_page_is_stale(mongo_replica_set_url: str):
    """Two seats of one club open the empty screen and both save: one line-up stands, the earlier one.

    The later save's insert conflicts with the earlier's commit, and its retry reads the line-up now standing. What this
    case holds is the retry's judgement, without which the later save overwrites the earlier.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        async def the_other_seat_saves() -> None:
            await seat_saves(database, client, _payload(OLE))

        aufstellungen = LineUpsRunningARivalBeforeTheirInsert(database[Collection.AUFSTELLUNGEN], the_other_seat_saves)
        outcome = await outcome_of(seat_saves(database, client, _payload(LINA), aufstellungen=aufstellungen))
        # Committed before it, the rival is met at the read and the save never reaches its insert.
        aufstellungen.assert_landed_inside(serially=0)

        return outcome, await stored_line_ups(database)

    assert on_a_season(mongo_replica_set_url, body) == (str(Code.VERSION_STALE), [(HOME, [OLE], 0)])


def test_a_save_on_a_count_another_save_raised_is_refused(mongo_replica_set_url: str):
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        first, _ = await seat_saves(database, client, _payload(LINA))
        await seat_saves(database, client, _payload(OLE, version=first.version))
        outcome = await outcome_of(seat_saves(database, client, _payload(LINA, version=first.version)))

        return outcome, await stored_line_ups(database)

    assert on_a_season(mongo_replica_set_url, body) == (str(Code.VERSION_STALE), [(HOME, [OLE], 1)])


def test_the_other_clubs_first_save_for_the_same_fixture_stands_beside_it(mongo_replica_set_url: str):
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await seat_saves(database, client, _payload(LINA))
        outcome = await outcome_of(seat_saves(database, client, _payload(FREMD), seat=AWAY_SEAT, team_id=AWAY))

        return outcome, await stored_line_ups(database)

    assert on_a_season(mongo_replica_set_url, body) == (COMMITTED, [(HOME, [LINA], 0), (AWAY, [FREMD], 0)])
