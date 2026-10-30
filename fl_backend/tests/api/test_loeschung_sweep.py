"""
API · the season-after rule's run and its preview, against the shipped indexes and the whole database

The league has two seasons ended, one running and one planned, so the rule keeps a squad row in the
latest ended one and every later one. Every pupil a case seeds is held against what the rule says of
them, and every reach claim is asked of the whole database, so a step taken from the run fails here.
The decisions underneath are `tests/api/test_loeschung_sweep_refusal.py`'s.
"""

import asyncio
import functools
import logging
import re
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pymongo
import pytest
from bson import ObjectId
from fastapi import FastAPI
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.api.bewerbungen.services import hash_token
from app.api.identitaet.crud import faellige_seite, saison_statuses
from app.api.identitaet.schemas import FLLoeschungLaufParams
from app.api.identitaet.system_router import LOESCHUNGEN_PER_PASS, sweep_loeschung
from app.api.registrierungen.public_router import post_registrierung
from app.api.registrierungen.schemas import FLPostRegistrierungPayload
from app.api.registrierungen.services import compose_ablehnung_update
from app.api.saisons.admin_router import activate_saison, get_loeschung_vorschau
from app.api.schiedsrichter.services import build_ghost_schiedsrichter
from app.api.spieler.admin_router import post_saison_spieler
from app.api.spieler.schemas import FLPostSaisonSpielerPayload
from app.api.spieler.services import build_ghost_spieler
from app.core.codes import Code
from app.core.collections import Collection
from app.core.config import API_VERSION
from app.core.crud import patch_one_in_db
from app.core.exceptions import DocumentNotFoundError
from app.core.journal import JOURNAL_TOKEN
from app.core.logging import JSONFormatter
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
from tests.erasure import erasure_collections
from tests.isolation import InterleavedCollection
from tests.whole_database import where_held
from tests.wire import commands_by_name, commands_sent
from tests.worker import worker_database

from .conftest import config_for
from .test_loeschung_sweep_refusal import COMMANDS_A_PERSON, OTHER_COMMANDS

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_loeschung_sweep_test")
CONFIG = config_for(DATABASE_NAME)

PATH = f"/api/v{API_VERSION}/identitaet/loeschung/sweep"

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


def pupil(spieler_id: ObjectId, email: str, *, nachname: str = "Muster", **fields: Any) -> dict[str, Any]:
    return spieler_document(spieler_id, "Quintessa", nachname, email=email, **fields)


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
    """The shipped indexes, the seasons, one team, and both sentinels as an erasure writes them."""

    async def _run() -> Any:
        async with a_clean_database(url, DATABASE_NAME, constraints=True, mutates_schema=mutates_schema) as (client, database):
            await database[Collection.SAISONS].insert_many([saison_document(saison_id, status) for saison_id, status in saisons.items()])
            await database[Collection.TEAMS].insert_one(team_document(TEAM_OID, "Lindenschule", "LSX"))
            await database[Collection.SPIELER].insert_one(build_ghost_spieler())
            await database[Collection.SCHIEDSRICHTER].insert_one(build_ghost_schiedsrichter())

            return await body(database, client)

    return on_the_seed_loop(_run())


async def run(database: AsyncDatabase, client: AsyncMongoClient, *, nach: Any = None, **replaced: Any) -> Any:
    return await sweep_loeschung(
        params=FLLoeschungLaufParams(nach=nach),
        **erasure_collections(database, **({"saisons_collection": database[Collection.SAISONS]} | replaced)),
        sperrliste=ban_list(database),
        db=client,
        config=CONFIG,
        germany_now=NOW,
    )


# More calls than any pass a case seeds can take: a pass that never ends stops here, and the case says so.
CALLS_A_PASS = 5


async def a_pass(database: AsyncDatabase, client: AsyncMongoClient, **replaced: Any) -> list[Any]:
    """Calls handing each the `nach` the last answered, until one answers null, as the press and the hourly pass loop."""

    answers = [await run(database, client, **replaced)]
    while answers[-1].nach is not None:
        assert len(answers) < CALLS_A_PASS, f"the pass did not end in {CALLS_A_PASS} calls: {[answer.nach for answer in answers]}"
        answers.append(await run(database, client, nach=answers[-1].nach, **replaced))

    return answers


async def refuse_writes_breaking(database: AsyncDatabase, collection: Collection, schema: Mapping[str, Any]) -> None:
    """How this suite forces one row's write to fail mid-pass: a `$jsonSchema` the planted row breaks and every other row keeps."""

    await database.command("collMod", str(collection), validator={"$jsonSchema": dict(schema)}, validationLevel="strict")


def refusing_its_redaction(spieler_id: ObjectId) -> dict[str, Any]:
    """A log image missing its `trace_id`, so the redaction's update is refused: any row a write is refused on."""

    return {
        "at": "2025-01-01T00:00:00+00:00",
        "at_date": datetime.now(UTC),
        "actor": {"kind": "system", "email": "SYSTEM"},
        "request": None,
        "collection": str(Collection.SPIELER),
        "operation": "patch_one",
        "document_id": spieler_id,
        "db_filter": None,
        "before": pupil(spieler_id, "vorher@beispielschule.de"),
        "modified_count": None,
        "redacted_at": None,
        "anlass": None,
    }


def counts(answer: Any) -> dict[str, Any]:
    return answer.model_dump(exclude={"nach"})


# Past any population a case seeds, so the read names every due pupil at once.
WHOLE = 1000


async def population(database: AsyncDatabase) -> list[Any]:
    seite, _ = await faellige_seite(
        await saison_statuses(saisons_collection=database[Collection.SAISONS]),
        nach=None,
        groesse=WHOLE,
        spieler_collection=database[Collection.SPIELER],
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
    )

    return [row["_id"] for row in seite]


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
WITH_A_PENDING_REGISTRATION = numbered(7)

PENDING = "thessaly.okonkwo@beispielschule.de"

LABELS = {
    TWO_SEASONS_BACK: "a squad row two seasons back alone",
    DECLINED_ALONE: "a declined registration alone",
    LIVE_IN_THE_SEASON_JUST_ENDED: "a live row in the season just ended",
    RETIRED_IN_THE_SEASON_JUST_ENDED: "a retired row in the season just ended",
    IN_THE_RUNNING_SEASON: "a row in the running season",
    IN_THE_PLANNED_SEASON: "a row in the planned season",
    WITH_A_PENDING_REGISTRATION: "a pending registration",
}


async def a_league_of_every_kind(database: AsyncDatabase) -> None:
    await database[Collection.SPIELER].insert_many(
        [pupil(spieler_id, address_of(position)) for position, spieler_id in enumerate(LABELS, start=1)]
    )
    await database[Collection.SPIELER].update_one({"_id": WITH_A_PENDING_REGISTRATION}, {"$set": {"email": PENDING}})
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
            registration(numbered(102), PENDING),
        ]
    )


class TestThePopulation:
    def test_it_names_the_pupils_the_rule_makes_due_and_no_other(self, mongo_replica_set_url: str):
        """Each pupil stands for one arm of the rule; a kept one appearing names the arm that broke."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> list[str]:
            await a_league_of_every_kind(database)

            return [LABELS.get(spieler_id, str(spieler_id)) for spieler_id in await population(database)]

        assert on_a_league(mongo_replica_set_url, body) == [LABELS[TWO_SEASONS_BACK], LABELS[DECLINED_ALONE]]

    def test_neither_sentinel_is_read_or_touched(self, mongo_replica_set_url: str):
        """Seeded as an erasure writes them: the pupils' sentinel holds no address, which keeps it out."""

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
    await database[Collection.REGISTRIERUNGEN].insert_one(registration(REACHED_REGISTRATION, ADDRESS, declined=True, nachname="Pupillensloot"))
    await database[Collection.SAISON_TEAMS].insert_one(
        {
            "_id": SEAT_ROW,
            **saison_team_document(
                "2026",
                TEAM_OID,
                "Lindenschule",
                "LSX",
                kontakte=kontakte_document(
                    ansprechperson=kontaktperson_document("Quirinus", bestaetigt_am="2026-03-01", nachname="Sitzsloot", email=ADDRESS)
                ),
            ),
        }
    )
    await database[Collection.SCHIEDSRICHTER].insert_one(
        schiedsrichter_document(REFEREE, email=ADDRESS, name="Quirinus Schiedssloot", default_payment=20, einwilligung=None)
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
                await where_held(database, "Pupillensloot", "Sitzsloot", "Schiedssloot", ADDRESS),
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
            ADDRESS: ["aktionen", "berechtigungen", "saison_teams", "schiedsrichter"],
        }
        assert unredacted == []


class TestEachPupilIsJudgedAgainInTheirOwnTransaction:
    @pytest.mark.parametrize(
        "rival",
        [
            pytest.param(lambda database: database[Collection.SAISON_SPIELER].insert_one(squad_row(numbered(1), "2026")), id="a squad row"),
            pytest.param(
                lambda database: database[Collection.REGISTRIERUNGEN].insert_one(registration(numbered(901), address_of(1))),
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


# --- A rival committing INSIDE a pupil's transaction, after its snapshot and before its first write.

# Waited for the rival at most this long: it contends with nothing before the pupil's first write, so
# only a rival that failed or hung waits it out, and the case then says so rather than passing.
RIVAL_BOUND_S = 5.0

EINLADUNG = numbered(950)
EINLADUNG_TOKEN = "hwGqQ4kP6yJr3VnZbT8sXeM2dLuF9aCwR1oY5iN7pKg"


class CommittedInsideThePupilsTransaction:
    """The seasons, running `rival` to its commit after a pupil's transaction reads the statuses, its first read.

    Bounded rather than awaited outright: a rival waiting on a write of the pupil's would never finish.
    """

    def __init__(self, collection: Any, rival: Callable[[], Awaitable[Any]]) -> None:
        self._collection = collection
        self._rival: Callable[[], Awaitable[Any]] | None = rival
        self.committed = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def aggregate(self, *args: Any, **kwargs: Any) -> Any:
        cursor = await self._collection.aggregate(*args, **kwargs)
        if self._rival is not None and kwargs.get("session") is not None:
            rival, self._rival = self._rival, None
            task = asyncio.ensure_future(rival())
            await asyncio.wait({task}, timeout=RIVAL_BOUND_S)
            self.committed = task.done() and task.exception() is None

        return cursor


async def a_squad_row_entered(database: AsyncDatabase, client: AsyncMongoClient, *, saison_id: str = "2026") -> Any:
    """The administrator's entry into a kept season, the running one unless named, which keeps the pupil."""

    return await post_saison_spieler(
        spieler_id=numbered(1),
        saison_spieler_data=FLPostSaisonSpielerPayload(
            saison_id=saison_id, team_id=TEAM_OID, nummer=None, position=None, stufe=None, rolle=None
        ),
        spieler_collection=database[Collection.SPIELER],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=database[Collection.SAISONS],
        spieltage_collection=database[Collection.SPIELTAGE],
        db=client,
        today=TODAY,
    )


async def a_registration_submitted(
    database: AsyncDatabase, client: AsyncMongoClient, *, position: int = 1, einladungen_collection: Any = None
) -> Any:
    """A pupil's own registration for the running season, the first pupil's unless named, typed otherwise, which keeps them."""

    return await post_registrierung(
        registrierung_data=FLPostRegistrierungPayload.model_validate(
            {
                "token": EINLADUNG_TOKEN,
                "vorname": "Quintessa",
                "nachname": "Muster",
                "email": address_of(position).capitalize(),
                "position": None,
                "nummer": None,
                "stufe": None,
            }
        ),
        idempotency_key=None,
        registrierungen_collection=database[Collection.REGISTRIERUNGEN],
        einladungen_collection=database[Collection.EINLADUNGEN] if einladungen_collection is None else einladungen_collection,
        saisons_collection=database[Collection.SAISONS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saison_spieler_collection=database[Collection.SAISON_SPIELER],
        postausgang_collection=database[Collection.POSTAUSGANG],
        sperrliste=ban_list(database),
        db=client,
        today=TODAY,
        germany_now=NOW,
    )


async def a_running_season_open_to_its_team(database: AsyncDatabase) -> None:
    """The team entered in 2026, its registration window open today and its link live, so nothing but the race decides."""

    await database[Collection.SAISONS].update_one(
        {"_id": "2026"}, {"$set": {"registrierung": {"offen": True, "von": "2026-03-01", "bis": "2026-04-30"}}}
    )
    await database[Collection.SAISON_TEAMS].insert_one(saison_team_document("2026", TEAM_OID, "Lindenschule", "LSX"))
    await database[Collection.EINLADUNGEN].insert_one(
        {
            "_id": EINLADUNG,
            "saison_id": "2026",
            "team_id": TEAM_OID,
            "token_hashes": [hash_token(EINLADUNG_TOKEN)],
            "erstellt_am": "2026-03-15",
            "erstellt_von": "admin@frankfurtleague.de",
            "widerrufen_am": None,
        }
    )


class TestARivalCommittingInsideThePupilsTransactionKeepsThem:
    @pytest.mark.parametrize(
        "rival",
        [
            # Held by the person alone: the entry anchors the pupil, whose deletion then conflicts with it, and
            # the season the entry counts its squad in is no write of the deletion's.
            pytest.param(a_squad_row_entered, id="a squad row"),
            # The same anchor in the season just ended, which no registration reaches.
            pytest.param(functools.partial(a_squad_row_entered, saison_id=JUST_ENDED), id="a squad row in the season just ended"),
        ],
    )
    def test_the_pupil_stands(self, mongo_replica_set_url: str, rival: Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]):
        """Remove the pupil's anchor in `pull_a_person_to_enter` and both arms fail."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1))
            await a_running_season_open_to_its_team(database)
            await database[Collection.SAISON_TEAMS].insert_one(saison_team_document(JUST_ENDED, TEAM_OID, "Lindenschule", "LSX"))
            seasons = CommittedInsideThePupilsTransaction(database[Collection.SAISONS], lambda: rival(database, client))
            answer = await run(database, client, saisons_collection=seasons)

            return seasons.committed, counts(answer), await database[Collection.SPIELER].count_documents({"_id": numbered(1)})

        committed, answer, standing = on_a_league(mongo_replica_set_url, body)

        assert committed, "the rival never committed inside the pupil's transaction, so this case proves nothing"
        assert (answer["spieler"], answer["uebersprungen"], standing) == (0, 1, 1)


class LinkReadThenRival(InterleavedCollection):
    """The invitations, running the rival to its commit once a submission has read its link: its first read, before any write."""

    async def find_one(self, *args: Any, **kwargs: Any) -> Any:
        found = await self._collection.find_one(*args, **kwargs)
        await self.run_the_rival()
        return found


class TestTwoAddressesRegisteringForOneSeasonWaitOnNeitherOther:
    def test_one_committing_inside_the_other_sends_it_round_no_second_time(self, mongo_replica_set_url: str):
        """Write the season in the submission again and the outer one meets the inner's commit, read twice."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await a_running_season_open_to_its_team(database)
            links = LinkReadThenRival(database[Collection.EINLADUNGEN], lambda: a_registration_submitted(database, client, position=2))
            await a_registration_submitted(database, client, position=3, einladungen_collection=links)

            return links.passes, await database[Collection.REGISTRIERUNGEN].count_documents({})

        assert on_a_league(mongo_replica_set_url, body) == (1, 2)


# Planned below the season just ended, which activation does not refuse, beside a running season whose fixtures are all played.
PLANNED_BELOW = "2023"
BELOW_THE_ENDED = {PLANNED_BELOW: "future", "2024": "active", "2025": "past"}


class TestAnActivationInsideThePupilsTransactionKeepsThem:
    def test_the_pupil_stands(self, mongo_replica_set_url: str):
        """Remove the planned season's anchor in `erase_if_still_due` and the pupil goes.

        The pupil's only row is in the planned season, which activating it keeps; the transaction read it planned.
        """

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(
                database,
                {Collection.SPIELER: [pupil(numbered(1), address_of(1))], Collection.SAISON_SPIELER: [squad_row(numbered(1), PLANNED_BELOW)]},
            )
            # What makes the planned season activatable (`activate_target_undrawn`).
            await database[Collection.SPIELE].insert_one(
                spiel_document(spiel_id=numbered(900), saison_id=PLANNED_BELOW, spiel_nr=1, spieltag_id=numbered(901))
            )

            async def activate() -> Any:
                return await activate_saison(
                    saison_id=PLANNED_BELOW,
                    saisons_collection=database[Collection.SAISONS],
                    spiele_collection=database[Collection.SPIELE],
                    spieltage_collection=database[Collection.SPIELTAGE],
                    sperrliste_collection=database[Collection.SPERRLISTE],
                    db=client,
                )

            seasons = CommittedInsideThePupilsTransaction(database[Collection.SAISONS], activate)
            answer = await run(database, client, saisons_collection=seasons)

            return seasons.committed, counts(answer), await database[Collection.SPIELER].count_documents({"_id": numbered(1)})

        committed, answer, standing = on_a_league(mongo_replica_set_url, body, saisons=BELOW_THE_ENDED)

        assert committed, "the activation never committed inside the pupil's transaction, so this case proves nothing"
        assert (answer["spieler"], answer["uebersprungen"], standing) == (0, 1, 1)


class TestOneRecordHoldsBackNobody:
    def test_a_refused_erasure_is_counted_and_the_next_pupil_goes(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """A log image refusing the redaction's update, a real failure under strict validation.

        Remove the catch and the call fails, the second pupil standing.
        """

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1), a_due_pupil(2))
            await database[Collection.AKTIONEN].insert_one(refusing_its_redaction(numbered(1)))
            await refuse_writes_breaking(database, Collection.AKTIONEN, {"required": ["trace_id"]})

            async with app_client(mongo_replica_set_url, app=_app(), now=NOW) as http:
                response = await http.post(PATH, headers=SYSTEM_AUTH)

            return response.status_code, response.json(), await database[Collection.SPIELER].distinct("_id", {"email": {"$type": "string"}})

        with caplog.at_level(logging.ERROR):
            status, answer, standing = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert status == 200, answer
        assert (answer["spieler"], answer["fehlgeschlagen"], answer["verbleibend"]) == (1, 1, 1)
        assert standing == [numbered(1)]
        failures = [record for record in caplog.records if getattr(record, "error_code", None) == Code.DATABASE_FAILED]
        assert [(getattr(record, "spieler_id", None), "WriteError" in getattr(record, "diagnosis", "")) for record in failures] == [
            (str(numbered(1)), True)
        ]
        # Neither the address nor the name, which the line would keep past the erasure it reports.
        lines = [JSONFormatter().format(record) for record in failures]
        assert not [line for line in lines if address_of(1) in line or "Quintessa" in line]

    def test_a_failure_not_the_databases_is_counted_and_the_next_pupil_goes(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Catch the database's failures alone and the call fails, the second pupil standing and the next pass stopping at the first again."""

        class NotTheDatabases(Exception):
            """A failure no driver raises, standing for every class an erasure can meet outside the database."""

        class RaisesForOnePupil:
            """The squad rows, whose in-session read for the first pupil raises `NotTheDatabases`."""

            def __init__(self, collection: Any) -> None:
                self._collection = collection

            def __getattr__(self, name: str) -> Any:
                return getattr(self._collection, name)

            async def aggregate(self, pipeline: list[Any], *args: Any, **kwargs: Any) -> Any:
                if pipeline and pipeline[0] == {"$match": {"spieler_id": numbered(1)}}:
                    raise NotTheDatabases("synthetic")

                return await self._collection.aggregate(pipeline, *args, **kwargs)

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1), a_due_pupil(2))
            answer = await run(database, client, saison_spieler_collection=RaisesForOnePupil(database[Collection.SAISON_SPIELER]))

            return counts(answer), answer.nach, await database[Collection.SPIELER].distinct("_id", {"email": {"$type": "string"}})

        with caplog.at_level(logging.ERROR):
            answer, nach, standing = on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["fehlgeschlagen"], answer["verbleibend"], nach) == (1, 1, 1, None)
        assert standing == [numbered(1)]
        [failure] = [record for record in caplog.records if getattr(record, "error_code", None) == Code.UNHANDLED_CRASH]
        assert (failure.levelname, failure.getMessage(), getattr(failure, "spieler_id", None)) == (
            "ERROR",
            "identitaet.loeschung_failed",
            str(numbered(1)),
        )
        # Located by the frame that raised it, and never by its message, which can quote a value.
        diagnosis = getattr(failure, "diagnosis", "")
        assert re.fullmatch(r"NotTheDatabases in aggregate at .+\.py:\d+", diagnosis) is not None, diagnosis


# Long enough that the pupil before the stall is erased inside it on a loaded machine.
SHORT_DEADLINE_S = 1.5


class StallsOnePupil:
    """The squad rows, whose in-session read for one pupil is sent once the call's deadline has passed.

    Spent before the read, as earlier pupils spend it: a script sleeping on the server outlives the deadline and holds the abort.
    """

    def __init__(self, collection: Any, stalled: ObjectId) -> None:
        self._collection = collection
        self._stalled = stalled

    def __getattr__(self, name: str) -> Any:
        return getattr(self._collection, name)

    async def aggregate(self, pipeline: list[Any], *args: Any, **kwargs: Any) -> Any:
        if pipeline and pipeline[0] == {"$match": {"spieler_id": self._stalled}}:
            await asyncio.sleep(SHORT_DEADLINE_S)

        return await self._collection.aggregate(pipeline, *args, **kwargs)


class TestTheDeadlineStopsTheCall:
    def test_it_warns_once_and_the_rest_stay_due(self, mongo_replica_set_url: str, caplog: pytest.LogCaptureFixture):
        """Fail each pupil past the deadline instead and every later one is logged an ERROR naming a refusal that never happened."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, a_due_pupil(1), a_due_pupil(2), a_due_pupil(3))
            with pymongo.timeout(SHORT_DEADLINE_S):
                answer = await run(database, client, saison_spieler_collection=StallsOnePupil(database[Collection.SAISON_SPIELER], numbered(2)))
            standing = await database[Collection.SPIELER].distinct("_id", {"email": {"$type": "string"}})
            # The next pass, unstalled: the cut left nothing behind that keeps either of them.
            await a_pass(database, client)

            return counts(answer), answer.nach, standing, await database[Collection.SPIELER].distinct("_id", {"email": {"$type": "string"}})

        with caplog.at_level(logging.WARNING):
            answer, nach, standing, after_the_next_pass = on_a_league(mongo_replica_set_url, body)

        assert (answer["spieler"], answer["fehlgeschlagen"], answer["verbleibend"], nach) == (1, 0, 2, numbered(2))
        assert standing == [numbered(2), numbered(3)]
        assert after_the_next_pass == []
        lines = [
            (record.levelname, record.getMessage(), getattr(record, "spieler_id", None), getattr(record, "erasure_unanswered", None))
            for record in caplog.records
            if getattr(record, "error_code", None) in {Code.DATABASE_FAILED, Code.UNKNOWN_OUTCOME}
        ]
        assert lines == [("WARNING", "identitaet.loeschung_cut", str(numbered(2)), False)]


@functools.cache
def _app() -> FastAPI:
    return create_app(CONFIG)


@pytest.fixture(scope="module", autouse=True)
def _built_before_any_case() -> None:
    """Never inside a case: a build re-runs the logging `dictConfig`, which strips the handler `caplog` reads that case's records from."""

    _app()


class TestEachCallTakesAShare:
    def test_a_share_and_one_more_take_a_pass_of_two_calls_and_a_later_call_finds_nobody(self, mongo_replica_set_url: str):
        """The shipped share, seeded one over: ignore it and the first call takes everybody and ends the pass."""

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, *(a_due_pupil(position) for position in range(LOESCHUNGEN_PER_PASS + 1)))
            answers = await a_pass(database, client)

            return [(answer.spieler, answer.verbleibend, answer.nach) for answer in answers], await run(database, client)

        answers, later = on_a_league(mongo_replica_set_url, body)

        assert answers == [(LOESCHUNGEN_PER_PASS, 1, numbered(LOESCHUNGEN_PER_PASS - 1)), (1, 0, None)]
        assert (later.spieler, later.verbleibend, later.nach) == (0, 0, None)

    def test_a_share_of_failing_pupils_holds_back_none_behind_it_in_the_pass(self, mongo_replica_set_url: str):
        """A whole share whose erasures the database refuses, and one ordinary pupil after them.

        Restart each call at the lowest id and the same share fails every call, the last pupil never reached.
        """

        failing = range(1, LOESCHUNGEN_PER_PASS + 1)
        last = LOESCHUNGEN_PER_PASS + 1

        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            await seeded(database, *(a_due_pupil(position) for position in [*failing, last]))
            await database[Collection.AKTIONEN].insert_many([refusing_its_redaction(numbered(position)) for position in failing])
            await refuse_writes_breaking(database, Collection.AKTIONEN, {"required": ["trace_id"]})
            answers = await a_pass(database, client)

            return [(answer.spieler, answer.fehlgeschlagen) for answer in answers], await database[Collection.SPIELER].count_documents(
                {"_id": numbered(last)}
            )

        answers, standing = on_a_league(mongo_replica_set_url, body, mutates_schema=True)

        assert answers == [(0, LOESCHUNGEN_PER_PASS), (1, 0)]
        assert standing == 0

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
        assert not [record for record in caplog.records if record.getMessage().startswith(JOURNAL_TOKEN)]


# --- What a call costs on the wire, which the share is sized at.


# Two runs apart by this many pupils, both inside one share.
FEW = LOESCHUNGEN_PER_PASS // 2

# The server's first batch for a cursor naming no size: one pending registration more takes the read a `getMore`.
FIRST_BATCH = 101


class TestOnePupilCostsTheCommandsItsShareIsSizedAt:
    def test_counted_on_the_wire(self, mongo_replica_set_url: str):
        """A step added to the pupil's transaction, or a read moved into it, turns this red before it times out a call in production."""

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[int, int]:
            async def counted(due: int) -> int:
                for collection in (Collection.SPIELER, Collection.SAISON_SPIELER, Collection.REGISTRIERUNGEN, Collection.AKTIONEN):
                    await database[collection].delete_many({"_id": {"$ne": build_ghost_spieler()["_id"]}})
                await seeded(database, *(a_due_pupil(position) for position in range(due)))

                return await commands_sent(mongo_replica_set_url, DATABASE_NAME, run)

            return await counted(FEW), await counted(2 * FEW)

        few, twice = on_a_league(mongo_replica_set_url, body)

        assert (twice - few) / FEW == COMMANDS_A_PERSON


class TestTheWorstCallSendsTheCommandsItsBudgetCounts:
    def test_a_full_share(self, mongo_replica_set_url: str):
        """`tests/api/test_loeschung_sweep_refusal.py`'s budget: a share and one more due, the pending registrations past the first batch.

        A command added to the call turns this red, so the share is judged against the deadline again.
        """

        waiting = [registration(numbered(6000 + position), f"angemeldet.{position}@beispielschule.de") for position in range(FIRST_BATCH + 1)]

        async def body(database: AsyncDatabase, _: AsyncMongoClient) -> tuple[Any, Counter[str]]:
            await seeded(
                database, *(a_due_pupil(position) for position in range(LOESCHUNGEN_PER_PASS + 1)), {Collection.REGISTRIERUNGEN: waiting}
            )

            return await commands_by_name(mongo_replica_set_url, DATABASE_NAME, run)

        answer, names = on_a_league(mongo_replica_set_url, body)

        # The premise first: a full share erased, and the pending registrations read past the first batch.
        assert (answer.spieler, names["getMore"]) == (LOESCHUNGEN_PER_PASS, 1), names
        assert names.total() - LOESCHUNGEN_PER_PASS * COMMANDS_A_PERSON == OTHER_COMMANDS, names


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

            vorschau = await get_loeschung_vorschau(
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
            with pytest.raises(DocumentNotFoundError):
                await get_loeschung_vorschau(
                    saison_id="2099",
                    saisons_collection=database[Collection.SAISONS],
                    spieler_collection=database[Collection.SPIELER],
                    registrierungen_collection=database[Collection.REGISTRIERUNGEN],
                )

            return "not found"

        assert on_a_league(mongo_replica_set_url, body) == "not found"
