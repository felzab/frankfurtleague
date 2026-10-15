"""
API · the season-after rule's run and its preview, against the shipped validators and the whole database

The league has two seasons ended, one running and one planned, so the rule keeps a squad row in the
latest ended one and every later one. Every pupil a case seeds is held against what the rule says of
them, and every reach claim is asked of the whole database, so a step taken from the run fails here.
The decisions underneath are `tests/api/test_loeschung_sweep_refusal.py`'s.
"""

import asyncio
import functools
import logging
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient, ReturnDocument, monitoring
from pymongo.asynchronous.database import AsyncDatabase

from app.api.identitaet.crud import ERASURE_JOURNAL_LINE, faellige_spieler, saison_statuses
from app.api.identitaet.sweep_router import LOESCHUNGEN_PER_PASS, post_loeschung_lauf
from app.api.registrierungen.services import compose_ablehnung_update
from app.api.saisons.admin_router import activate_saison, preview_loeschung
from app.api.schiedsrichter.services import build_ghost_schiedsrichter
from app.api.spieler.services import build_ghost_spieler
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db
from app.core.exception_handlers import DATABASE_FAILED
from app.core.exceptions import DocumentNotFoundException
from app.main import create_app
from tests.app_client import app_client
from tests.bans import ban_list
from tests.config import SYSTEM_AUTH
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import (
    kontakte_document,
    kontaktperson_document,
    registrierung_document,
    saison_document,
    saison_spieler_document,
    saison_team_document,
    schiedsrichter_document,
    spiel_document,
    spieler_document,
    team_document,
)
from tests.whole_database import where_held
from tests.worker import worker_database

from .conftest import config_for
from .test_loeschung_sweep_refusal import COMMANDS_A_PERSON

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_loeschung_sweep_test")
CONFIG = config_for(DATABASE_NAME)

PATH = f"/api/v{API_VERSION}/identitaet/loeschung/lauf"

NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))
TODAY = "2026-04-01"

# Two ended, one running, one planned: the rule keeps a squad row in 2025, 2026 and 2027.
LEAGUE = {"2023": "past", "2024": "past", "2025": "past", "2026": "active", "2027": "future"}
JUST_ENDED = "2025"

TEAM_OID = ObjectId("6890a1b2c3d4e5f607d10001")


def numbered(position: int) -> ObjectId:
    """Ids in seeding order, so the run's `_id` order is the order a case seeds in."""

    return ObjectId(f"6890a1b2c3d4e5f607d2{position:04d}")


def address_of(position: int) -> str:
    return f"schuelerin.{position}@beispielschule.de"


def pupil(spieler_id: ObjectId, email: str | None, *, nachname: str = "Muster", **fields: Any) -> dict[str, Any]:
    return spieler_document(spieler_id, "Quintessa", nachname, **({} if email is None else {"email": email}), **fields)


def squad_row(spieler_id: ObjectId, saison_id: str, **fields: Any) -> dict[str, Any]:
    return saison_spieler_document(spieler_id, saison_id, TEAM_OID, **fields)


def registration(registrierung_id: ObjectId, email: str, *, declined: bool = False, nachname: str = "Muster") -> dict[str, Any]:
    document = registrierung_document(
        registrierung_id,
        email,
        saison_id="2026",
        team_id=TEAM_OID,
        vorname="Quintessa",
        nachname=nachname,
        token=f"token-{registrierung_id}",
        eingereicht_am="2026-03-02",
        frist="2026-03-09",
    )

    return (
        {**document, **compose_ablehnung_update(von="sitz@beispielschule.de", grund=None, today="2026-03-05")["$set"]} if declined else document
    )


def a_due_pupil(position: int) -> dict[Collection, list[dict[str, Any]]]:
    """The run's largest shape: squad rows only in ended seasons the rule does not keep, and a declined registration."""

    spieler_id = numbered(position)

    return {
        Collection.SPIELER: [pupil(spieler_id, address_of(position))],
        Collection.SAISON_SPIELER: [squad_row(spieler_id, "2023"), squad_row(spieler_id, "2024")],
        Collection.REGISTRIERUNGEN: [registration(numbered(5000 + position), address_of(position), declined=True)],
    }


async def seeded(database: AsyncDatabase, *shapes: Mapping[Collection, list[dict[str, Any]]]) -> None:
    for shape in shapes:
        for collection, documents in shape.items():
            await database[collection].insert_many(documents)


async def edited(database: AsyncDatabase, collection: Collection, document_id: Any, update: Mapping[str, Any]) -> None:
    """One recorded edit, so the log holds an image of the document as it stood."""

    await patch_one_in_db(collection=database[collection], db_filter={"_id": document_id}, update=update, return_document=ReturnDocument.BEFORE)


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


def on_a_league(url: str, body: Body, *, saisons: Mapping[str, str] = LEAGUE, mutates_schema: bool = False) -> Any:
    """The shipped validators, the seasons, one team, and both sentinels as an erasure writes them."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SAISONS].insert_many([saison_document(saison_id, status) for saison_id, status in saisons.items()])
            await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, "Lindenschule", "LS"))
            await database[Collection.SPIELER].insert_one(build_ghost_spieler())
            await database[Collection.SCHIEDSRICHTER].insert_one(build_ghost_schiedsrichter())

            return await body(database, client)

    return on_the_seed_loop(_run())


def the_collections(database: AsyncDatabase, **replaced: Any) -> dict[str, Any]:
    handles = {
        f"{collection}_collection": database[collection]
        for collection in (
            Collection.SAISONS,
            Collection.SPIELER,
            Collection.SAISON_SPIELER,
            Collection.SAISON_TEAMS,
            Collection.BEWERBUNGEN,
            Collection.SCHIEDSRICHTER,
            Collection.SPIELE,
            Collection.REGISTRIERUNGEN,
            Collection.DROSSELUNG,
            Collection.AKTIONEN,
            Collection.BERECHTIGUNGEN,
            Collection.BERECHTIGUNGEN_ANGEKUENDIGT,
            Collection.BERECHTIGUNGEN_POSTAUSGANG,
            Collection.EINLADUNGEN,
            Collection.SPERRLISTE,
        )
    }

    return {**handles, **replaced}


async def run(database: AsyncDatabase, client: AsyncMongoClient, **replaced: Any) -> Any:
    return await post_loeschung_lauf(
        **the_collections(database, **replaced), sperrliste=ban_list(database), db=client, config=CONFIG, germany_now=NOW
    )


def counts(answer: Any) -> dict[str, Any]:
    return answer.model_dump(exclude={"acknowledged"})


async def population(database: AsyncDatabase) -> list[Any]:
    return await faellige_spieler(
        await saison_statuses(saisons_collection=database[Collection.SAISONS]),
        spieler_collection=database[Collection.SPIELER],
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
    )


class WrittenAfterThePopulationRead:
    """The pupils' collection, writing `rival` once the run's population read has answered and before any pupil's own transaction."""

    def __init__(self, collection: Any, rival: Callable[[], Awaitable[Any]]) -> None:
        self._collection = collection
        self._rival: Callable[[], Awaitable[Any]] | None = rival

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        # The population read is the one read outside a session; every pupil's own reads carry theirs.
        if self._rival is not None and kwargs.get("session") is None:
            rival, self._rival = self._rival, None
            await rival()

        return cursor


# --- The population: whom the read names, before any transaction re-judges them.

TWO_SEASONS_BACK = numbered(1)
DECLINED_ALONE = numbered(2)
LIVE_IN_THE_SEASON_JUST_ENDED = numbered(3)
RETIRED_IN_THE_SEASON_JUST_ENDED = numbered(4)
IN_THE_RUNNING_SEASON = numbered(5)
IN_THE_PLANNED_SEASON = numbered(6)
PENDING_TYPED_OTHERWISE = numbered(7)
ADDRESSLESS = numbered(8)

PENDING_FOLDED = "thessaly.okonkwo@beispielschule.de"
PENDING_TYPED = "Thessaly.Okonkwo@beispielschule.de"

LABELS = {
    TWO_SEASONS_BACK: "a squad row two seasons back alone",
    DECLINED_ALONE: "a declined registration alone",
    LIVE_IN_THE_SEASON_JUST_ENDED: "a live row in the season just ended",
    RETIRED_IN_THE_SEASON_JUST_ENDED: "a retired row in the season just ended",
    IN_THE_RUNNING_SEASON: "a row in the running season",
    IN_THE_PLANNED_SEASON: "a row in the planned season",
    PENDING_TYPED_OTHERWISE: "a pending registration typed with capitals",
    ADDRESSLESS: "no address",
}


async def a_league_of_every_kind(database: AsyncDatabase) -> None:
    await database[Collection.SPIELER].insert_many(
        [pupil(spieler_id, None if spieler_id == ADDRESSLESS else address_of(position)) for position, spieler_id in enumerate(LABELS, start=1)]
    )
    await database[Collection.SPIELER].update_one({"_id": PENDING_TYPED_OTHERWISE}, {"$set": {"email": PENDING_FOLDED}})
    await database[Collection.SAISON_SPIELER].insert_many(
        [
            squad_row(TWO_SEASONS_BACK, "2024"),
            squad_row(LIVE_IN_THE_SEASON_JUST_ENDED, JUST_ENDED),
            # Retired as removing a player leaves the row; only the erasure deletes one.
            squad_row(RETIRED_IN_THE_SEASON_JUST_ENDED, JUST_ENDED, inactive_since="2025-03-01"),
            squad_row(IN_THE_RUNNING_SEASON, "2026"),
            squad_row(IN_THE_PLANNED_SEASON, "2027"),
        ]
    )
    await database[Collection.REGISTRIERUNGEN].insert_many(
        [
            registration(numbered(101), address_of(2), declined=True),
            registration(numbered(102), PENDING_TYPED),
        ]
    )


class TestThePopulation:
    def test_it_names_the_pupils_the_rule_makes_due_and_no_other(self, mongo_replica_set_url: str):
        """Each pupil stands for one arm of the rule; a kept one appearing names the arm that broke.

        An addressless pupil is never read: nothing erases by a name.
        """

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> list[str]:
            await a_league_of_every_kind(database)

            return [LABELS.get(spieler_id, str(spieler_id)) for spieler_id in await population(database)]

        assert on_a_league(mongo_replica_set_url, body) == [LABELS[TWO_SEASONS_BACK], LABELS[DECLINED_ALONE]]

    def test_neither_sentinel_is_read_or_touched(self, mongo_replica_set_url: str):
        """Seeded as an erasure writes them. The pupils' sentinel is kept out twice, by its id and by holding no address.

        Either term alone keeps it out, so only both removed turn this red.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            named = await population(database)
            answer = await run(database, client)

            return named, counts(answer), await database[Collection.SPIELER].find_one({"_id": build_ghost_spieler()["_id"]})

        named, answer, ghost = on_a_league(mongo_replica_set_url, body)

        assert named == []
        assert answer["spieler"] == 0
        assert ghost == build_ghost_spieler()


# --- The run.

ADDRESS = "quirinus.vandersloot@beispielschule.de"
TYPED = "Quirinus.VanDerSloot@beispielschule.de"
REACHED = numbered(11)
REACHED_ROWS = (numbered(12), numbered(13))
REACHED_REGISTRATION = numbered(14)
SEAT_ROW = numbered(15)
REFEREE = numbered(16)
GRANT = numbered(17)


async def one_address_in_four_roles(database: AsyncDatabase) -> None:
    """A due pupil, and a contact seat, a referee row and a grant held at the same address, each with its log images."""

    await database[Collection.SPIELER].insert_one(pupil(REACHED, ADDRESS, nachname="Pupillensloot"))
    await database[Collection.SAISON_SPIELER].insert_many(
        [squad_row(REACHED, saison_id, _id=row_id) for saison_id, row_id in zip(("2023", "2024"), REACHED_ROWS, strict=True)]
    )
    await database[Collection.REGISTRIERUNGEN].insert_one(registration(REACHED_REGISTRATION, TYPED, declined=True, nachname="Pupillensloot"))
    await database[Collection.SAISON_TEAMS].insert_one(
        {
            "_id": SEAT_ROW,
            **saison_team_document(
                "2026",
                TEAM_OID,
                "Lindenschule",
                "LS",
                kontakte=kontakte_document(
                    ansprechperson=kontaktperson_document("Quirinus", bestaetigt_am="2026-03-01", nachname="Sitzsloot", email=TYPED)
                ),
            ),
        }
    )
    await database[Collection.SCHIEDSRICHTER].insert_one(
        schiedsrichter_document(REFEREE, email=TYPED, name="Quirinus Schiedssloot", default_payment=20, einwilligung=None)
    )
    await database[Collection.BERECHTIGUNGEN].insert_one(
        {
            "_id": GRANT,
            "adresse": ADDRESS,
            "verwaltung": "administration",
            "erteilt_von": "PLAYGROUND",
            "erteilt_am": datetime(2026, 1, 1, tzinfo=UTC),
        }
    )

    await edited(database, Collection.SPIELER, REACHED, {"$set": {"geburtsdatum": "2008-04-04"}})
    for row_id in REACHED_ROWS:
        await edited(database, Collection.SAISON_SPIELER, row_id, {"$set": {"nummer": "7"}})
    await edited(database, Collection.REGISTRIERUNGEN, REACHED_REGISTRATION, {"$set": {"nummer": "7"}})
    await edited(database, Collection.SAISON_TEAMS, SEAT_ROW, {"$set": {"gruppe": "B"}})
    await edited(database, Collection.SCHIEDSRICHTER, REFEREE, {"$set": {"schule": "Lindenschule"}})
    await edited(database, Collection.BERECHTIGUNGEN, GRANT, {"$set": {"verwaltung": "administration"}})


class TestThePupilsOwnDataAlone:
    def test_the_pupil_goes_whole_and_every_other_role_at_the_address_stands(self, mongo_replica_set_url: str):
        """Run in the full scope and this fails: the seat empties, the referee row and the grant go."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await one_address_in_four_roles(database)
            answer = await run(database, client)

            return (
                counts(answer),
                await where_held(database, "Pupillensloot", "Sitzsloot", "Schiedssloot", TYPED, ADDRESS),
                await database[Collection.AKTIONEN]
                .find(
                    {
                        "collection": {"$in": [str(Collection.SPIELER), str(Collection.SAISON_SPIELER), str(Collection.REGISTRIERUNGEN)]},
                        "before": {"$ne": None},
                    }
                )
                .to_list(None),
            )

        answer, held, unredacted = on_a_league(mongo_replica_set_url, body)

        assert answer == {
            "abgeschlossene_saison_id": JUST_ENDED,
            "spieler": 1,
            "saison_spieler": 2,
            "registrierungen": 1,
            "uebersprungen": 0,
            "fehlgeschlagen": 0,
            "verbleibend": 0,
        }
        assert held == {
            "Pupillensloot": [],
            "Sitzsloot": ["aktionen", "saison_teams"],
            "Schiedssloot": ["aktionen", "schiedsrichter"],
            TYPED: ["aktionen", "saison_teams", "schiedsrichter"],
            ADDRESS: ["aktionen", "berechtigungen"],
        }
        assert unredacted == []


class TestEachPupilIsJudgedAgainInTheirOwnTransaction:
    @pytest.mark.parametrize(
        "rival",
        [
            pytest.param(lambda database: database[Collection.SAISON_SPIELER].insert_one(squad_row(numbered(1), "2026")), id="a squad row"),
            pytest.param(
                lambda database: database[Collection.REGISTRIERUNGEN].insert_one(registration(numbered(901), address_of(1).upper())),
                id="a pending registration",
            ),
        ],
    )
    def test_what_arrives_after_the_read_keeps_its_pupil(self, mongo_replica_set_url: str, rival: Callable[[AsyncDatabase], Awaitable[Any]]):
        """Drop the re-judgement and this fails: the read named them due, and the erasure would take the new record too."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1))
            pupils = WrittenAfterThePopulationRead(database[Collection.SPIELER], lambda: rival(database))
            answer = await run(database, client, spieler_collection=pupils)

            return counts(answer), await database[Collection.SPIELER].count_documents({"_id": numbered(1)})

        answer, standing = on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["uebersprungen"], answer["verbleibend"], standing) == (0, 1, 0, 1)

    def test_an_address_corrected_by_hand_is_erased_as_it_stands_now(self, mongo_replica_set_url: str):
        """Carry the read's address into the erasure and this fails: the pupil stands, and a stranger's registration goes."""

        corrected = "quintessa.neu@beispielschule.de"
        stranger = numbered(902)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1))
            # Another person's, at the address the pupil held when the run read them.
            await database[Collection.REGISTRIERUNGEN].insert_one(registration(stranger, address_of(1), declined=True, nachname="Fremd"))
            await database[Collection.REGISTRIERUNGEN].update_one({"_id": numbered(5001)}, {"$set": {"email": corrected}})

            async def correct_it() -> None:
                await database[Collection.SPIELER].update_one({"_id": numbered(1)}, {"$set": {"email": corrected}})

            answer = await run(database, client, spieler_collection=WrittenAfterThePopulationRead(database[Collection.SPIELER], correct_it))

            return (
                counts(answer),
                await database[Collection.SPIELER].count_documents({"_id": numbered(1)}),
                [row["_id"] for row in await database[Collection.REGISTRIERUNGEN].find().to_list(None)],
            )

        answer, standing, registrations = on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["registrierungen"], standing) == (1, 1, 0)
        assert registrations == [stranger]


class TestOneRecordHoldsBackNobody:
    def test_a_refused_erasure_is_counted_and_the_next_pupil_goes(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A log row stored before its validator required `trace_id` refuses the redaction's update, a real failure under strict validation.

        Remove the catch and the call fails, the second pupil standing.
        """

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1), a_due_pupil(2))
            await database[Collection.AKTIONEN].insert_one(
                {
                    "at": "2025-01-01T00:00:00+00:00",
                    "actor": {"kind": "system", "email": "SYSTEM"},
                    "request": None,
                    "collection": str(Collection.SPIELER),
                    "operation": "patch_one",
                    "document_id": numbered(1),
                    "db_filter": None,
                    "before": pupil(numbered(1), address_of(1)),
                    "modified_count": None,
                    "redacted_at": None,
                },
                bypass_document_validation=True,
            )

            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                response = await http.post(PATH, headers=SYSTEM_AUTH)

            return response.status_code, response.json(), await database[Collection.SPIELER].distinct("_id", {"email": {"$type": "string"}})

        with caplog.at_level(logging.ERROR):
            status, answer, standing = on_a_league(mongo_replica_set_url, body)

        assert status == 200, answer
        assert (answer["spieler"], answer["fehlgeschlagen"], answer["verbleibend"]) == (1, 1, 1)
        assert standing == [numbered(1)]
        failures = [record for record in caplog.records if getattr(record, "error_code", None) == DATABASE_FAILED]
        assert [str(numbered(1)) in record.getMessage() and "WriteError" in record.getMessage() for record in failures] == [True]
        # Neither the address nor the name, which the line would keep past the erasure it reports.
        assert not [record for record in failures if address_of(1) in record.getMessage() or "Quintessa" in record.getMessage()]


@functools.cache
def _app() -> FastAPI:
    return create_app(CONFIG)


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Never inside a case: a build re-runs the logging `dictConfig`, which strips the handler `caplog` reads that case's records from."""

    _app()


class TestEachCallTakesAShare:
    def test_a_share_and_one_more_take_two_calls_and_the_third_finds_nobody(self, mongo_replica_set_url: str):
        """The shipped share, seeded one over: ignore it and the first call takes everybody."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> list[tuple[int, int]]:
            await seeded(database, *(a_due_pupil(position) for position in range(LOESCHUNGEN_PER_PASS + 1)))

            return [(answer.spieler, answer.verbleibend) for answer in [await run(database, client) for _ in range(3)]]

        assert on_a_league(mongo_replica_set_url, body) == [(LOESCHUNGEN_PER_PASS, 1), (1, 0), (0, 0)]

    def test_two_calls_at_once_erase_each_pupil_once(self, mongo_replica_set_url: str):
        """Count the attempts rather than the erasures and the sum exceeds the pupils; a conflict surfacing as a failure fails it too."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, *(a_due_pupil(position) for position in range(3)))
            # No sentinel yet, so both calls race to write it as well.
            await database[Collection.SPIELER].delete_one({"_id": build_ghost_spieler()["_id"]})

            answers = await asyncio.gather(run(database, client), run(database, client))

            return [counts(answer) for answer in answers], await population(database)

        answers, left = on_a_league(mongo_replica_set_url, body)

        assert sum(answer["spieler"] for answer in answers) == 3
        assert [answer["fehlgeschlagen"] for answer in answers] == [0, 0]
        assert left == []


class TestNothingIsDueBeforeASeasonHasEnded:
    def test_a_league_with_no_past_season_erases_nobody(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await database[Collection.SPIELER].insert_one(pupil(numbered(1), address_of(1)))

            return counts(await run(database, client)), await database[Collection.SPIELER].count_documents({"_id": numbered(1)})

        answer, standing = on_a_league(mongo_replica_set_url, body, saisons={"2026": "active", "2027": "future"})

        assert answer["abgeschlossene_saison_id"] is None
        assert (answer["spieler"], answer["verbleibend"], standing) == (0, 0, 1)


class TestNoJournalLine:
    def test_the_run_writes_none(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A restore's replay would erase the whole address, where the rule deletes the pupil again on its own."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> int:
            await seeded(database, a_due_pupil(1))

            return (await run(database, client)).spieler

        with caplog.at_level(logging.INFO):
            erased = on_a_league(mongo_replica_set_url, body)

        assert erased == 1
        assert not [record for record in caplog.records if record.getMessage().startswith(ERASURE_JOURNAL_LINE)]


# --- What one pupil costs on the wire, which the share is sized at.


class _Counting(monitoring.CommandListener):
    def __init__(self) -> None:
        self.commands = 0

    def started(self, event: monitoring.CommandStartedEvent) -> None:
        self.commands += 1

    def succeeded(self, event: monitoring.CommandSucceededEvent) -> None:
        pass

    def failed(self, event: monitoring.CommandFailedEvent) -> None:
        pass


# Two runs apart by this many pupils, both inside one share.
FEW = LOESCHUNGEN_PER_PASS // 2


class TestOnePupilCostsTheCommandsItsShareIsSizedAt:
    def test_counted_on_the_wire(self, mongo_replica_set_url: str):
        """A step added to the pupil's transaction, or a read moved into it, turns this red before it times out a call in production."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                for collection in (Collection.SPIELER, Collection.SAISON_SPIELER, Collection.REGISTRIERUNGEN, Collection.AKTIONEN):
                    await database[collection].delete_many({"_id": {"$ne": build_ghost_spieler()["_id"]}})
                await seeded(database, *(a_due_pupil(position) for position in range(due)))

                listener = _Counting()
                counting = AsyncMongoClient(mongo_replica_set_url, event_listeners=[listener])
                try:
                    await run(counting[DATABASE_NAME], counting)
                finally:
                    await counting.close()

                return listener.commands

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert (twice - few) / FEW == COMMANDS_A_PERSON


# --- The preview.

FUTURE = "2027"


class TestThePreviewCountsWhomTheNextActivationsRunErases:
    def test_the_run_after_the_activation_erases_the_count_the_preview_answered(self, mongo_replica_set_url: str):
        """Read on today's statuses, the preview counts one pupil short: the row in 2025 keeps its pupil until 2026 ends."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            # Kept today by the season just ended; due once 2026 is `past` and 2027 `active`.
            await seeded(database, a_due_pupil(1), {Collection.SAISON_SPIELER: [squad_row(numbered(2), JUST_ENDED)]})
            await database[Collection.SPIELER].insert_one(pupil(numbered(2), address_of(2)))
            # Still kept after it: a row in the season being activated.
            await database[Collection.SPIELER].insert_one(pupil(numbered(3), address_of(3)))
            await database[Collection.SAISON_SPIELER].insert_one(squad_row(numbered(3), FUTURE))
            await database[Collection.SPIELE].insert_one(
                spiel_document(
                    spiel_id=numbered(900), saison_id=FUTURE, spiel_nr=1, spieltag_id=numbered(901), datum="2027-03-15", uhrzeit="18:00:00"
                )
            )

            vorschau = await preview_loeschung(
                saison_id=FUTURE,
                saisons_collection=database[Collection.SAISONS],
                spieler_collection=database[Collection.SPIELER],
                registrierungen_collection=database[Collection.REGISTRIERUNGEN],
            )
            await activate_saison(
                saison_id=FUTURE,
                saisons_collection=database[Collection.SAISONS],
                spiele_collection=database[Collection.SPIELE],
                spieltage_collection=database[Collection.SPIELTAGE],
                sperrliste_collection=database[Collection.SPERRLISTE],
                db=client,
            )

            return counts(vorschau), counts(await run(database, client))

        vorschau, answer = on_a_league(mongo_replica_set_url, body)

        assert vorschau == {"abgeschlossene_saison_id": "2026", "spieler": 2}
        assert (answer["spieler"], answer["abgeschlossene_saison_id"]) == (2, "2026")

    def test_an_unknown_season_is_not_found(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            with pytest.raises(DocumentNotFoundException):
                await preview_loeschung(
                    saison_id="2099",
                    saisons_collection=database[Collection.SAISONS],
                    spieler_collection=database[Collection.SPIELER],
                    registrierungen_collection=database[Collection.REGISTRIERUNGEN],
                )

            return "not found"

        assert on_a_league(mongo_replica_set_url, body) == "not found"
