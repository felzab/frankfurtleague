"""
API · a line-up saved and read as a seat of the club and as an administrator, against a real database

Each handler is called directly with the clock it is handed, so the lock is reached without waiting for it.
"""

from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.aufstellungen.admin_router import get_aufstellung, put_aufstellung
from app.api.aufstellungen.person_router import get_aufstellung_self, put_aufstellung_self
from app.api.aufstellungen.schemas import FLAufstellungEntry, FLAufstellungPayload, FLAufstellungResponse, FLAufstellungSpieler
from app.api.spiele.admin_router import patch_spiel
from app.api.spiele.schemas import FLPatchSpielDataPayload
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError
from app.core.recording import ACT_BY_KONTAKT
from app.shared.schemas.literals import KONTAKT_SEATS
from app.shared.schemas.responses import FLVersionResponse
from tests import documents
from tests.acts import acting_as, acts_of
from tests.app_client import app_client, app_under_test
from tests.config import ADMIN_KEY, ADMINISTRATORS, grants_for_the_suite
from tests.database import a_clean_database
from tests.erasure import erased
from tests.isolation import COMMITTED, InterleavedCollection, outcome_of
from tests.payloads import spiel_patch_body
from tests.records import record_collections
from tests.session_headers import StampedHeaders
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_aufstellung_save_test")

SAISON_ID = "2026"
HOME, AWAY = ObjectId("6890a1b2c3d4e5f607470001"), ObjectId("6890a1b2c3d4e5f607470002")
SPIELTAG, FIRST_SPIELTAG = ObjectId("6890a1b2c3d4e5f607470031"), ObjectId("6890a1b2c3d4e5f607470032")
SPIEL, UNDATED = ObjectId("6890a1b2c3d4e5f607470021"), ObjectId("6890a1b2c3d4e5f607470022")
# The home squad: numbers stored as strings, so `7` must come before `10`, and the unnumbered pupil last.
LINA, OLE, MIA, NEWCOMER, LEAVER = (ObjectId(f"6890a1b2c3d4e5f6074700{n}") for n in (41, 42, 43, 44, 45))
# The away club's pupil, in no squad of the home club.
AWAY_PUPIL = ObjectId("6890a1b2c3d4e5f607470051")

HOME_SEAT, AWAY_SEAT = "ansprech.heim@schule.example.org", "ansprech.gast@schule.example.org"
# The home club's seat for the next season alone.
LATER_SAISON_ID, LATER_SEAT = "2027", "ansprech.folge@schule.example.org"
ADMIN = "admin@example.org"
# The administrator a served save is sent by, one the suite's grants hold.
SERVED_ADMIN = ADMINISTRATORS[0]

# Saturday 14 November 2026, 16:00 in Berlin, 15:00 UTC: locked for the club from 14:00 UTC.
OPEN = datetime(2026, 11, 10, 12, tzinfo=UTC)
LOCKED = datetime(2026, 11, 14, 14, 30, tzinfo=UTC)
# Two hours after the kick-off.
PLAYED = datetime(2026, 11, 14, 17, tzinfo=UTC)

Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def _junction(team_id: ObjectId, name: str, seat: str, *, saison_id: str = SAISON_ID) -> dict[str, Any]:
    ansprech = documents.kontaktperson_document("Anna", confirmed_at="2026-01-06", email=seat, phone="+49 69 90009199")
    kontakte = {**{seat: None for seat in KONTAKT_SEATS}, "ansprechperson": ansprech, "trainer_is_also": None}
    return documents.saison_team_document(saison_id, team_id, name, name[:3].upper(), kontakte=kontakte)


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


async def on_a_season(url: str, body: Body) -> Any:
    """A running season's second matchday of two, one fixture on it dated and one not, and both clubs' squads."""

    async with a_clean_database(url, DATABASE_NAME) as (client, database):
        await database[Collection.SAISONS].insert_one(documents.saison_document(SAISON_ID, "active"))
        await database[Collection.SPIELTAGE].insert_many(
            [documents.spieltag_document(spieltag_id, SAISON_ID, position) for spieltag_id, position in ((FIRST_SPIELTAG, 1), (SPIELTAG, 2))]
        )
        await database[Collection.SAISON_TEAMS].insert_many([_junction(HOME, "Alpha", HOME_SEAT), _junction(AWAY, "Beta", AWAY_SEAT)])
        await database[Collection.SPIELE].insert_many([_spiel(SPIEL, 1, date="2026-11-14", time="16:00:00"), _spiel(UNDATED, 2)])
        await database[Collection.SPIELER].insert_many(
            [
                documents.spieler_document(pupil, name, "Muster")
                for pupil, name in ((LINA, "Lina"), (OLE, "Ole"), (MIA, "Mia"), (NEWCOMER, "Neu"), (LEAVER, "Weg"), (AWAY_PUPIL, "Fremd"))
            ]
        )
        await database[Collection.SAISON_SPIELER].insert_many(
            [
                documents.saison_spieler_document(LINA, SAISON_ID, HOME, nummer="10", rolle="kapitaen"),
                documents.saison_spieler_document(OLE, SAISON_ID, HOME, nummer="7"),
                documents.saison_spieler_document(MIA, SAISON_ID, HOME),
                documents.saison_spieler_document(NEWCOMER, SAISON_ID, HOME, nummer="3", is_nachnominiert=True),
                documents.saison_spieler_document(LEAVER, SAISON_ID, HOME, nummer="5", inactive_since="2026-10-01"),
                documents.saison_spieler_document(AWAY_PUPIL, SAISON_ID, AWAY, nummer="9"),
            ]
        )
        return await body(database, client)


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
) -> FLVersionResponse:
    """A club's line-up, the home club's unless named, saved through the seat's handler."""

    return await put_aufstellung_self(
        spiel_id=spiel_id,
        team_id=team_id,
        aufstellung_data=payload,
        identifier=seat,
        spiele_collection=database[Collection.SPIELE],
        saisons_collection=database[Collection.SAISONS],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        spieler_collection=database[Collection.SPIELER],
        aufstellungen_collection=database[Collection.AUFSTELLUNGEN] if aufstellungen is None else aufstellungen,
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        records=record_collections(database),
        db=client,
        germany_now=now,
    )


async def admin_saves(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    payload: FLAufstellungPayload,
    *,
    spiel_id: ObjectId = SPIEL,
    now: datetime = OPEN,
    aufstellungen: Any = None,
) -> FLVersionResponse:
    """The home club's line-up saved through the administrator's handler, under the actor its request would bind."""

    with acting_as(ADMIN):
        return await put_aufstellung(
            spiel_id=spiel_id,
            team_id=HOME,
            aufstellung_data=payload,
            spiele_collection=database[Collection.SPIELE],
            saisons_collection=database[Collection.SAISONS],
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            spieler_collection=database[Collection.SPIELER],
            aufstellungen_collection=database[Collection.AUFSTELLUNGEN] if aufstellungen is None else aufstellungen,
            db=client,
            germany_now=now,
        )


async def seat_reads(
    database: AsyncDatabase,
    client: AsyncMongoClient,
    *,
    seat: str = HOME_SEAT,
    team_id: ObjectId = HOME,
    spiel_id: ObjectId = SPIEL,
    now: datetime = OPEN,
) -> FLAufstellungResponse:
    """A club's line-up screen, the home club's unless named, read through the seat's handler in a snapshot as its request is."""

    async with client.start_session(snapshot=True) as session:
        return await get_aufstellung_self(
            spiel_id=spiel_id,
            team_id=team_id,
            identifier=seat,
            spiele_collection=database[Collection.SPIELE],
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            spieler_collection=database[Collection.SPIELER],
            aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
            records=record_collections(database),
            session=session,
            germany_now=now,
        )


async def admin_reads(
    database: AsyncDatabase, client: AsyncMongoClient, *, team_id: ObjectId = HOME, spiel_id: ObjectId = SPIEL, now: datetime = OPEN
) -> FLAufstellungResponse:
    """A club's line-up screen, the home club's unless named, read through the administrator's handler."""

    async with client.start_session(snapshot=True) as session:
        return await get_aufstellung(
            spiel_id=spiel_id,
            team_id=team_id,
            spiele_collection=database[Collection.SPIELE],
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            spieler_collection=database[Collection.SPIELER],
            aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
            session=session,
            germany_now=now,
        )


async def refusal_of(saving: Awaitable[Any]) -> tuple[Code, list[tuple[str | int, ...]]]:
    with pytest.raises(APIError) as refused:
        await saving
    return refused.value.error_code, list(refused.value.fields)


async def test_a_seats_first_save_creates_the_line_up_the_screen_then_reads(mongo_replica_set_url: str):
    """The squad, the matchday by its stored position, each side with its Kürzel, and the act recorded.

    The act's record is the line-up, so its season and number alone name the fixture in the Protokoll.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> None:
        written = await seat_saves(database, client, _payload(LINA, OLE, starters=1))
        stored = await database[Collection.AUFSTELLUNGEN].find_one({"spiel_id": SPIEL, "team_id": HOME})
        answer = await seat_reads(database, client)

        assert written == FLVersionResponse(version=0)
        assert sorted((row.first_name, row.last_name) for row in answer.kader) == [
            ("Lina", "Muster"),
            ("Mia", "Muster"),
            ("Neu", "Muster"),
            ("Ole", "Muster"),
        ]
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
        assert [(row["saison_id"], row["spiel_nr"], row["label"]) async for row in database[Collection.ACTION_LOG].find()] == [
            ("2026", 1, None)
        ]

    await on_a_season(mongo_replica_set_url, body)


async def test_the_lock_refuses_the_seat_and_never_the_administrator(mongo_replica_set_url: str):
    """From one hour before kick-off the line-up is the administration's, on the same document.

    The administrator's save is recorded under the address their request bound and no club's name.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        refused = await refusal_of(seat_saves(database, client, _payload(LINA), now=LOCKED))
        # Through the route, so the act is recorded for the administrator its request binds and no one else.
        await database[Collection.GRANTS].insert_many(grants_for_the_suite())
        async with app_client(mongo_replica_set_url, app=app_under_test(DATABASE_NAME), now=LOCKED) as http:
            response = await http.put(
                f"/api/aufstellungen/spiele/{SPIEL}/teams/{HOME}/admin",
                json=_payload(LINA).model_dump(mode="json"),
                headers=StampedHeaders(SERVED_ADMIN, ADMIN_KEY),
            )
        return refused, response.status_code, [act[:3] for act in await acts_of(database)]

    assert await on_a_season(mongo_replica_set_url, body) == ((Code.AUFSTELLUNG_LOCKED, []), 200, [("aufstellung.saved", SERVED_ADMIN, None)])


async def test_an_undated_fixture_takes_no_line_up_from_anybody(mongo_replica_set_url: str):
    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        return (
            await refusal_of(seat_saves(database, client, _payload(LINA), spiel_id=UNDATED)),
            await refusal_of(admin_saves(database, client, _payload(LINA), spiel_id=UNDATED)),
        )

    assert await on_a_season(mongo_replica_set_url, body) == ((Code.AUFSTELLUNG_SPIEL_UNDATED, []),) * 2


async def test_another_teams_seat_is_refused_the_team(mongo_replica_set_url: str):
    """On the read as on the save."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        return (
            await refusal_of(seat_reads(database, client, seat=AWAY_SEAT)),
            await refusal_of(seat_saves(database, client, _payload(LINA), seat=AWAY_SEAT)),
        )

    assert await on_a_season(mongo_replica_set_url, body) == ((Code.ROLE_NOT_HELD, []),) * 2


async def test_a_seat_is_asked_for_the_fixtures_season_and_a_stranger_learns_of_no_fixture(mongo_replica_set_url: str):
    """A seat on the club for the next season alone saves nothing on this season's line-up.

    Where no fixture carries the id, the club's own seat holder is told it is not found and another club's is refused the
    club, so the refusal tells a stranger nothing of which fixtures exist; a fixture fielding the club on neither side is
    not found either.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        await database[Collection.SAISONS].insert_one(documents.saison_document(LATER_SAISON_ID, "future"))
        await database[Collection.SAISON_TEAMS].insert_one(_junction(HOME, "Alpha", LATER_SEAT, saison_id=LATER_SAISON_ID))
        nowhere = ObjectId()

        return (
            await refusal_of(seat_saves(database, client, _payload(LINA), seat=LATER_SEAT)),
            await refusal_of(seat_reads(database, client, spiel_id=nowhere)),
            await refusal_of(seat_reads(database, client, seat=AWAY_SEAT, spiel_id=nowhere)),
            await refusal_of(admin_reads(database, client, team_id=nowhere)),
        )

    assert await on_a_season(mongo_replica_set_url, body) == (
        (Code.ROLE_NOT_HELD, []),
        (Code.DOCUMENT_NOT_FOUND, []),
        (Code.ROLE_NOT_HELD, []),
        (Code.DOCUMENT_NOT_FOUND, []),
    )


async def test_a_pupil_the_line_up_names_outside_the_teams_kader_is_named_off_their_record(mongo_replica_set_url: str):
    """The pupil's one squad row of the season is another club's, as admitting a pupil ausgetragen here to that club leaves it.

    The screen names them off their person record as it reads, and again after a save keeping them.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        await database[Collection.AUFSTELLUNGEN].insert_one(
            documents.aufstellung_document({"_id": SPIEL, "saison_id": SAISON_ID}, HOME, starters=[AWAY_PUPIL])
        )
        read = await admin_reads(database, client)
        await admin_saves(database, client, FLAufstellungPayload(spieler=read.spieler, version=read.version))

        return read.named, (await admin_reads(database, client)).named

    named = FLAufstellungSpieler(
        spieler_id=AWAY_PUPIL, first_name="Fremd", last_name="Muster", nummer=None, position=None, rolle=None, is_nachnominiert=False
    )

    assert await on_a_season(mongo_replica_set_url, body) == ([named], [named])


async def test_a_save_judges_its_names_against_the_kader_and_the_stored_line_up(mongo_replica_set_url: str):
    """The club's squad is read for the judgement, and so is the stored line-up, which keeps a pupil ausgetragen since.

    What the judgement decides is `test_aufstellung_save_rules.py`'s, on the default tier.
    """

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        refused, _ = await refusal_of(seat_saves(database, client, _payload(OLE, LEAVER)))
        await database[Collection.AUFSTELLUNGEN].insert_one(
            documents.aufstellung_document({"_id": SPIEL, "saison_id": SAISON_ID}, HOME, starters=[LEAVER])
        )
        await seat_saves(database, client, _payload(LEAVER, OLE, version=0))
        return refused, [row.first_name for row in (await seat_reads(database, client)).named]

    assert await on_a_season(mongo_replica_set_url, body) == (Code.SPIELER_NOT_IN_KADER, ["Weg"])


async def test_the_seat_reads_the_version_the_save_answered(mongo_replica_set_url: str):
    """So the editor's next save, sent on the answered version, is judged against the line-up this save left."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[FLVersionResponse, FLAufstellungResponse]:
        await seat_saves(database, client, _payload(LINA))
        saved = await seat_saves(database, client, _payload(LINA, OLE, starters=2, version=0))
        return saved, await seat_reads(database, client)

    saved, read = await on_a_season(mongo_replica_set_url, body)

    assert (saved.version, read.version) == (1, 1)
    assert [(entry.spieler_id, entry.starts) for entry in read.spieler] == [(LINA, True), (OLE, True)]
    assert read.saison_status == "active"


async def the_season_ends(database: AsyncDatabase) -> None:
    await database[Collection.SAISONS].update_one({"_id": SAISON_ID}, {"$set": {"status": "past"}})


async def nothing_written(database: AsyncDatabase) -> tuple[Any, list[Any]]:
    return await database[Collection.AUFSTELLUNGEN].find_one({}), await acts_of(database)


async def test_a_finished_seasons_line_up_is_read_only_for_the_administrator(mongo_replica_set_url: str):
    """The save refused as every other administrator write about a finished season's match is, and the read says why."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[Any, ...]:
        await the_season_ends(database)
        refused = await refusal_of(admin_saves(database, client, _payload(LINA)))
        read = await admin_reads(database, client)
        return refused, read.saison_status, await nothing_written(database)

    assert await on_a_season(mongo_replica_set_url, body) == ((Code.SAISON_PAST, []), "past", (None, []))


class LineUpsRunningARivalAtTheirRead(InterleavedCollection):
    """An `aufstellungen` stand-in running one rival once the save has read the squad and before it reads the line-up."""

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        await self.run_the_rival()

        return await self._collection.find_one(*args, **kwargs)


async def erase(database: AsyncDatabase, client: AsyncMongoClient, *pupils: ObjectId, now: datetime) -> None:
    """Each pupil erased through the person erasure, by the address their record holds, at `now`."""

    for pupil in pupils:
        person = await database[Collection.SPIELER].find_one({"_id": pupil}, {"email": 1})
        assert person is not None
        await erased(database, client, person["email"], germany_now=now)


class TestAnErasedPupilsEntry:
    """Kept naming nobody where the match was played, removed where it is still to come."""

    async def test_two_erased_after_kick_off_stand_naming_nobody_and_the_line_up_saves_as_served(self, mongo_replica_set_url: str):
        """A played match keeps its shape: each entry stands in its place, and a save of the screen as served keeps both.

        Each erasure raises the line-up's count, so a screen read before it is refused rather than writing the pupil back.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            saved = await admin_saves(database, client, _payload(LINA, OLE, MIA, starters=2))
            await erase(database, client, LINA, OLE, now=PLAYED)
            stale = await refusal_of(admin_saves(database, client, _payload(LINA, OLE, MIA, starters=2, version=saved.version), now=PLAYED))
            served = await admin_reads(database, client, now=PLAYED)
            await admin_saves(database, client, FLAufstellungPayload(spieler=served.spieler, version=served.version), now=PLAYED)
            answer = await admin_reads(database, client, now=PLAYED)
            stored = await database[Collection.AUFSTELLUNGEN].find_one({"spiel_id": SPIEL, "team_id": HOME})
            assert stored is not None

            return stale, served, answer, stored["spieler"]

        stale, served, answer, stored = await on_a_season(mongo_replica_set_url, body)

        assert stale == (Code.VERSION_STALE, [])
        assert [(entry.spieler_id, entry.starts) for entry in served.spieler] == [(None, True), (None, True), (MIA, False)]
        assert (served.named, answer.spieler) == ([], served.spieler)
        assert stored == [
            {"spieler_id": None, "starts": True},
            {"spieler_id": None, "starts": True},
            {"spieler_id": MIA, "starts": False},
        ]

    async def test_one_erased_once_the_line_up_locked_before_kick_off_leaves_it(self, mongo_replica_set_url: str):
        """The match is still to come, though locked for the club: an entry kept would hold a place in the Startelf nobody could name."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seat_saves(database, client, _payload(LINA, OLE, starters=2))
            await erase(database, client, LINA, now=LOCKED)
            stored = await database[Collection.AUFSTELLUNGEN].find_one({"spiel_id": SPIEL, "team_id": HOME})
            assert stored is not None

            return stored["spieler"]

        assert await on_a_season(mongo_replica_set_url, body) == [{"spieler_id": OLE, "starts": True}]

    async def test_one_naming_only_the_erased_after_kick_off_stands_as_stored(self, mongo_replica_set_url: str):
        """It is the club's record of whom it fielded: read as none, the club's marks would ask for a line-up it gave."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await admin_saves(database, client, _payload(LINA, starters=1))
            await erase(database, client, LINA, now=PLAYED)
            screen = await seat_reads(database, client, now=PLAYED)

            return screen.marks, screen.spieler

        marks, spieler = await on_a_season(mongo_replica_set_url, body)

        assert marks is not None
        assert ((marks.stored, marks.phase), spieler) == ((True, "locked"), [FLAufstellungEntry(spieler_id=None, starts=True)])


async def the_seat_is_handed_on(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    ansprech = documents.kontaktperson_document(
        "Berta", confirmed_at="2026-01-06", email="ansprech.neu@schule.example.org", phone="+49 69 90009198"
    )
    await database[Collection.SAISON_TEAMS].update_one(
        {"saison_id": SAISON_ID, "team_id": HOME}, {"$set": {"kontakte.ansprechperson": ansprech}}
    )


async def the_season_is_ended(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await the_season_ends(database)


async def lina_is_erased(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await erase(database, client, LINA, now=OPEN)


async def the_fixture_is_undated(database: AsyncDatabase, client: AsyncMongoClient) -> None:
    await database[Collection.SPIELE].update_one({"_id": SPIEL}, {"$set": {"date": None, "time": None}})


async def nothing_saved(database: AsyncDatabase) -> tuple[Any, list[Any]]:
    """The line-up and the save's own acts: an erasure records its own."""

    return await database[Collection.AUFSTELLUNGEN].find_one({}), [act for act in await acts_of(database) if act[0] == "aufstellung.saved"]


class TestWhatTheSaveAnchorsMovingInsideItIsRefusedInItsTransaction:
    """Each rival writes a document the save is judged on and anchors, so the anchor conflicts and the retry refuses the save.

    Unanchored, the save would commit on what the rival replaced.
    """

    @pytest.mark.parametrize(
        ("rival", "saves", "code"),
        [
            pytest.param(the_seat_is_handed_on, seat_saves, Code.ROLE_NOT_HELD, id="the-seat-handed-on"),
            # The administrator's save, since a finished season grants no seat.
            pytest.param(the_season_is_ended, admin_saves, Code.SAISON_PAST, id="the-season-ended"),
            pytest.param(lina_is_erased, seat_saves, Code.SPIELER_NOT_IN_KADER, id="the-pupil-erased"),
        ],
    )
    async def test_the_save_retries_and_writes_nothing(
        self,
        mongo_replica_set_url: str,
        rival: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[None]],
        saves: Callable[..., Awaitable[Any]],
        code: Code,
    ):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, Any]:
            aufstellungen = LineUpsRunningARivalAtTheirRead(database[Collection.AUFSTELLUNGEN], lambda: rival(database, client))
            outcome = await outcome_of(saves(database, client, _payload(LINA), aufstellungen=aufstellungen))

            return outcome, await nothing_saved(database)

        assert await on_a_season(mongo_replica_set_url, body) == (str(code), (None, []))


async def save_the_fixture(database: AsyncDatabase, client: AsyncMongoClient, loaded: Mapping[str, Any], *, spiele: Any) -> Any:
    """The administrator's save of the fixture from an editor that loaded `loaded`, moving its note alone."""

    async with client.start_session(snapshot=True) as session:
        return await patch_spiel(
            spiel_id=SPIEL,
            spiel_data=FLPatchSpielDataPayload.model_validate(spiel_patch_body(loaded, note=MOVED_NOTE)),
            db=client,
            spiele_collection=spiele,
            teams_collection=database[Collection.TEAMS],
            saisons_collection=database[Collection.SAISONS],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            spieltage_collection=database[Collection.SPIELTAGE],
            spielorte_collection=database[Collection.SPIELORTE],
            schiedsrichter_collection=database[Collection.SCHIEDSRICHTER],
            spielberichte_collection=database[Collection.SPIELBERICHTE],
            aufstellungen_collection=database[Collection.AUFSTELLUNGEN],
            spielbestaetigungen_collection=database[Collection.SPIELBESTAETIGUNGEN],
            germany_now=OPEN,
            session=session,
        )


# A change no line-up is judged on, so the fixture's save takes it whichever order the two commit in.
MOVED_NOTE = "Halle Ost"


class TestALineUpAndAFixtureSaveCrossing:
    """The save anchors the fixture it judged, so a fixture's save landing either side of it conflicts with it."""

    async def test_a_fixture_undated_inside_the_save_refuses_it(self, mongo_replica_set_url: str):
        """Unanchored, the line-up would stand on a fixture no longer dated."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> tuple[str, Any]:
            aufstellungen = LineUpsRunningARivalAtTheirRead(
                database[Collection.AUFSTELLUNGEN], lambda: the_fixture_is_undated(database, client)
            )
            outcome = await outcome_of(seat_saves(database, client, _payload(LINA), aufstellungen=aufstellungen))

            return outcome, await nothing_saved(database)

        assert await on_a_season(mongo_replica_set_url, body) == (str(Code.AUFSTELLUNG_SPIEL_UNDATED), (None, []))

    async def test_a_line_up_saved_inside_a_fixture_save_leaves_it_committing_on_the_version_its_form_read(self, mongo_replica_set_url: str):
        """The fixture's save meets the line-up's anchor and runs again, and the anchor moved no `version` for it to be refused on."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            loaded = await database[Collection.SPIELE].find_one({"_id": SPIEL})
            assert loaded is not None

            async def the_seat_saves() -> None:
                await seat_saves(database, client, _payload(LINA))

            # After the fixture save's reads and ahead of its write of the fixture.
            spiele = InterleavedCollection(database[Collection.SPIELE], the_seat_saves, before="find_one_and_update")
            outcome = await outcome_of(save_the_fixture(database, client, loaded, spiele=spiele))
            stored = await database[Collection.SPIELE].find_one({"_id": SPIEL})
            assert stored is not None

            return outcome, (stored["note"], stored["version"] - loaded.get("version", 0)), await stored_line_ups(database)

        # The fixture's save raised its version once; the line-up stands as the seat saved it.
        assert await on_a_season(mongo_replica_set_url, body) == (COMMITTED, (MOVED_NOTE, 1), [(HOME, [LINA], 0)])


# --- One document per club per fixture: the other club's save never meets it.


async def stored_line_ups(database: AsyncDatabase) -> list[tuple[ObjectId, list[ObjectId], int]]:
    """Every stored line-up of the fixture: its club, whom it names and its count, in the order written."""

    rows = await database[Collection.AUFSTELLUNGEN].find({"spiel_id": SPIEL}).sort("_id").to_list(length=None)

    return [(row["team_id"], [entry["spieler_id"] for entry in row["spieler"]], row["version"]) for row in rows]


async def test_the_other_teams_first_save_for_the_same_fixture_stands_beside_it(mongo_replica_set_url: str):
    """And its save and its read answer its own line-up, never the home club's written before it."""

    async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
        await seat_saves(database, client, _payload(LINA))
        await seat_saves(database, client, _payload(LINA, version=0))
        answer = await seat_saves(database, client, _payload(AWAY_PUPIL), seat=AWAY_SEAT, team_id=AWAY)
        read = await seat_reads(database, client, seat=AWAY_SEAT, team_id=AWAY)

        return answer.version, [entry.spieler_id for entry in read.spieler], await stored_line_ups(database)

    assert await on_a_season(mongo_replica_set_url, body) == (0, [AWAY_PUPIL], [(HOME, [LINA], 1), (AWAY, [AWAY_PUPIL], 0)])
