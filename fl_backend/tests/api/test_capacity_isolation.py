"""
API · the three rules a count-then-insert reaches, driven with a rival landing inside the window

Each case runs a rival write to completion at the moment the endpoint takes the season's
`bounded_writes`, so the endpoint's own write conflicts on a document the two share. What that
proves is the retry: the callback runs a second time, judges the figure the rival left, and refuses.
The refusals themselves are decided on in `tests/api/test_team_entry_refusal.py`,
`:: test_containment_refusals.py` and `:: test_spieltag_refusals.py`; nothing here re-decides one.
"""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.api.spieler.admin_router import reactivate_saison_spieler
from app.api.spieltage.admin_router import patch_spieltag
from app.api.spieltage.schemas import FLPatchSpieltagPayload
from app.api.teams.admin_router import post_team_entry
from app.api.teams.schemas import FLPostTeamEntryPayload
from app.core.codes import Code
from app.core.collections import Collection
from tests import documents
from tests.database import a_clean_database
from tests.isolation import InterleavedCollection, outcome_of
from tests.worker import worker_database

pytestmark = pytest.mark.db

DATABASE_NAME = worker_database("fl_capacity_isolation_test")

SAISON = "2026"
TEAMS_PER_GROUP = 4
MAX_KADER_SIZE = 18

# One phase, two dated positions. The pair each writer moves to is one the other's neighbours
# permit and the committed pair is not.
STANDING_FIRST = "2026-03-01"
STANDING_SECOND = "2026-03-20"
POSTPONED_FIRST = "2026-03-15"
ADVANCED_SECOND = "2026-03-10"


def oid(tail: int) -> ObjectId:
    return ObjectId(f"6890a1b2c3d4e5f608{tail:06d}")


def saison_document() -> dict[str, Any]:
    """`future`, which is the one status `entry_saison_not_future` admits an entry under."""

    return documents.saison_document(
        SAISON, "future", rules=documents.rules_document(teams_per_gruppe=TEAMS_PER_GROUP, max_kader_size=MAX_KADER_SIZE)
    )


def team_document(index: int) -> dict[str, Any]:
    return documents.team_document(
        oid(index),
        f"Schule {index}",
        # Three letters, which is what a club's write holds a shorthand to.
        f"S{chr(65 + index // 26)}{chr(65 + index % 26)}",
        full_name=f"Schule {index} Gesamtschule",
        website_url="https://example.net",
    )


def junction_document(index: int, gruppe: str) -> dict[str, Any]:
    return documents.saison_team_document(
        SAISON, oid(index), f"Schule {index}", f"S{chr(65 + index // 26)}{chr(65 + index % 26)}", _id=oid(1000 + index), gruppe=gruppe
    )


def spieler_document(index: int) -> dict[str, Any]:
    return documents.spieler_document(oid(2000 + index), f"Vorname{index}", f"Nachname{index}")


def kader_document(index: int, team_index: int, *, inactive_since: str | None = None) -> dict[str, Any]:
    return documents.saison_spieler_document(
        oid(2000 + index), SAISON, oid(team_index), _id=oid(3000 + index), nummer=str(index), inactive_since=inactive_since
    )


def matchday(position: int, start: str) -> dict[str, Any]:
    return documents.spieltag_document(oid(4000 + position), SAISON, position, start=start, end=start)


def before_the_anchor(database: AsyncDatabase, rival: Callable[[], Awaitable[None]]) -> InterleavedCollection:
    """`saisons`, the rival run once just before the write that anchors the bounded judgement, after its read."""

    return InterleavedCollection(database[Collection.SAISONS], rival, before="update_many")


Body = Callable[[AsyncDatabase, AsyncMongoClient], Awaitable[Any]]


async def on_a_league(url: str, body: Body, seed: dict[str, list[Any]]) -> Any:
    """A transaction cannot create a collection, so every one a body writes in is built by the seed."""

    async with a_clean_database(url, DATABASE_NAME, constraints=True) as (client, database):
        for name, rows in seed.items():
            if rows:
                await database[name].insert_many(rows)

        return await body(database, client)


async def enter_the_group(database: AsyncDatabase, client: AsyncMongoClient, team_index: int, saisons: Any) -> Any:
    return await post_team_entry(
        saison_id=SAISON,
        entry_data=FLPostTeamEntryPayload.model_validate(
            {"team": {"kind": "known", "team_id": oid(team_index)}, "gruppe": "A", "trikot_farbe": None}
        ),
        teams_collection=database[Collection.TEAMS],
        saison_teams_collection=database[Collection.SAISON_TEAMS],
        saisons_collection=saisons,
        db=client,
    )


async def redate(database: AsyncDatabase, client: AsyncMongoClient, position: int, start: str, saisons: Any) -> Any:
    stored = await database[Collection.SPIELTAGE].find_one({"_id": oid(4000 + position)}, {"version": 1})
    assert stored is not None
    return await patch_spieltag(
        spieltag_id=oid(4000 + position),
        spieltag_data=FLPatchSpieltagPayload(start=start, end=start, version=stored["version"]),
        spieltage_collection=database[Collection.SPIELTAGE],
        saisons_collection=saisons,
        spiele_collection=database[Collection.SPIELE],
        db=client,
    )


class TestASecondEntryLandingMidEntryIsJudgedAgain:
    """Group A holds one free place when both entries judge, and none when the second one writes."""

    async def test_the_second_entry_is_refused_on_the_place_the_first_took(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def the_rival_takes_the_place() -> None:
                await enter_the_group(database, client, 21, database[Collection.SAISONS])

            seasons = before_the_anchor(database, the_rival_takes_the_place)
            outcome = await outcome_of(enter_the_group(database, client, 20, seasons))

            occupied = await database[Collection.SAISON_TEAMS].count_documents({"saison_id": SAISON, "gruppe": "A"})

            return outcome, occupied

        outcome, occupied = await on_a_league(
            mongo_replica_set_url,
            body,
            {
                Collection.SAISONS: [saison_document()],
                Collection.TEAMS: [team_document(index) for index in (1, 2, 3, 20, 21)],
                Collection.SAISON_TEAMS: [junction_document(index, "A") for index in (1, 2, 3)],
            },
        )

        assert (outcome, occupied) == (Code.ENTRY_GRUPPE_FULL, TEAMS_PER_GROUP)


class TestASecondReturnLandingMidReturnIsJudgedAgain:
    """One free place in the squad when both returns judge, and none when the second one writes."""

    def _kader_seed(self) -> dict[str, list[Any]]:
        """A squad one short of the cap, and two retired rows each with a claim on the last place."""

        return {
            Collection.SAISONS: [saison_document()],
            Collection.TEAMS: [team_document(1)],
            Collection.SAISON_TEAMS: [junction_document(1, "A")],
            Collection.SPIELER: [spieler_document(index) for index in [*range(1, MAX_KADER_SIZE), 91, 92]],
            Collection.SAISON_SPIELER: [
                *(kader_document(index, 1) for index in range(1, MAX_KADER_SIZE)),
                kader_document(91, 1, inactive_since="2026-02-01"),
                kader_document(92, 1, inactive_since="2026-02-01"),
            ],
        }

    async def _bring_back(self, database: AsyncDatabase, client: AsyncMongoClient, index: int, saisons: Any) -> Any:
        return await reactivate_saison_spieler(
            spieler_id=oid(2000 + index),
            saison_id=SAISON,
            saison_spieler_collection=database[Collection.SAISON_SPIELER],
            saison_teams_collection=database[Collection.SAISON_TEAMS],
            saisons_collection=saisons,
            db=client,
        )

    async def test_a_return_is_refused_on_the_place_a_rival_return_took(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def the_rival_takes_the_place() -> None:
                await self._bring_back(database, client, 91, database[Collection.SAISONS])

            seasons = before_the_anchor(database, the_rival_takes_the_place)
            outcome = await outcome_of(self._bring_back(database, client, 92, seasons))

            kader_size = await database[Collection.SAISON_SPIELER].count_documents(
                {"saison_id": SAISON, "team_id": oid(1), "inactive_since": None}
            )

            return outcome, kader_size

        outcome, kader_size = await on_a_league(mongo_replica_set_url, body, self._kader_seed())

        assert (outcome, kader_size) == (Code.KADER_FULL, MAX_KADER_SIZE)


class TestASecondDatingLandingMidDatingIsJudgedAgain:
    """Each writer's step passes against the day the other is replacing, and the pair they would leave runs backwards."""

    async def test_the_second_dating_is_refused_on_the_day_the_first_left(self, mongo_replica_set_url: str):
        async def body(database: AsyncDatabase, client: AsyncMongoClient) -> Any:
            async def the_rival_advances_the_second() -> None:
                await redate(database, client, 2, ADVANCED_SECOND, database[Collection.SAISONS])

            seasons = before_the_anchor(database, the_rival_advances_the_second)
            outcome = await outcome_of(redate(database, client, 1, POSTPONED_FIRST, seasons))

            rows = await database[Collection.SPIELTAGE].find({"saison_id": SAISON}).sort([("position", 1)]).to_list(length=None)

            return outcome, [row["start"] for row in rows]

        outcome, starts = await on_a_league(
            mongo_replica_set_url,
            body,
            {
                Collection.SAISONS: [saison_document()],
                Collection.SPIELTAGE: [matchday(1, STANDING_FIRST), matchday(2, STANDING_SECOND)],
            },
        )

        # The rival's advance stands and the postponement does not, so the phase reads forwards.
        assert (outcome, starts) == (Code.SPIELTAG_START_OUT_OF_ORDER, [STANDING_FIRST, ADVANCED_SECOND])
